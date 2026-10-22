/**
 * Session deletion service.
 *
 * One delete removes four things that belong to exactly one session:
 *
 *   1. the durable log directory under the JSONL backend's root;
 *   2. the projection-cache row, through the live storage domain (so the
 *      write-behind cache cannot re-publish a stale document later);
 *   3. the sidebar bookkeeping — workspace grouping, the global archive set
 *      and the global pin set, through the official registry;
 *   4. the `dsh-workspace-session` mirror snapshot under
 *      `<workspace>/.dsh/sessions/<id>/`, when that plugin is in use. Without
 *      step 4 a deleted session can be imported again ("resurrected") from its
 *      workspace snapshot, so it is on by default.
 *
 * Ordered so a half-deleted session cannot fall out of its group: the busy
 * check and the file removal happen before any accounting write, and the live
 * session is detached only after its log is gone (so the dispose-time export
 * path of the snapshot plugin has nothing left to read).
 *
 * @module dsh-session-delete/lib/delete
 */

import { cp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  encodeSegment, ensureDir, nowIso, projectKey, randomSuffix, readJsonFile,
  sessionIdVariants, sleep, statOrUndefined, writeJsonAtomic,
} from './util.js'
import { directorySize, locateSessionDir, locateSnapshotDir, resolveSessionRoot, trashRoot } from './paths.js'

/** A stable, user-facing deletion failure. */
export class DeleteError extends Error {
  /**
   * @param {string} code - stable error code for the API/UI.
   * @param {string} message - human-readable cause.
   * @param {Record<string, any>} [details] - extra structured payload.
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'DeleteError'
    this.code = code
    this.details = details
  }
}

/**
 * Validate a session identity before it is used as a key or path segment.
 * @param {any} raw - candidate id.
 * @returns {string} the validated id.
 */
export function validateSessionId(raw) {
  if (typeof raw !== 'string') throw new DeleteError('invalid-request', 'sessionId must be a string')
  const id = raw.trim()
  if (id === '' || id.length > 200) throw new DeleteError('invalid-request', 'sessionId is empty or too long')
  // `encodeSegment` neutralizes separators, `..` and NUL before any path use;
  // here only refusal-worthy control characters are rejected.
  if (/[\u0000-\u001f\u007f]/.test(id)) throw new DeleteError('invalid-request', 'sessionId contains control characters')
  return id
}

/**
 * Move a directory, falling back to copy+delete across filesystems.
 * @param {string} from - source path.
 * @param {string} to - destination path (must not exist).
 * @returns {Promise<void>}
 */
async function movePath(from, to) {
  try {
    const { rename } = await import('node:fs/promises')
    await rename(from, to)
    return
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error
  }
  await cp(from, to, { recursive: true, errorOnExist: true, force: false })
  await rm(from, { recursive: true, force: true })
}

/** Timestamp slug for trash ids: `YYYYMMDD-HHmmss`. */
function stamp() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * Service owning every session mutation this plugin exposes.
 */
export class DeleteService {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
   * @param {{ configStore: any, home: string, logger?: any }} options - plugin services.
   */
  constructor(ctx, options) {
    this.ctx = ctx
    this.configStore = options.configStore
    this.home = options.home
    this.logger = options.logger
    /** Cached `overview()` value: `{ at, value }` or null. */
    this._listCache = null
    /** Folded display titles, filled lazily by `refreshTitles`. */
    this._titleCache = new Map()
  }

  /**
   * Drop the cached overview (called after every mutation and config change).
   * The title cache survives: titles are immutable per session.
   */
  invalidate() {
    this._listCache = null
  }

  /**
   * Fast management-page payload: sessions, recycle bin, config and counts.
   * Cached for two minutes because folding titles over a large corpus reads
   * every session log; `force` (the Refresh button) rescans.
   * @param {{ force?: boolean }} [options] - rescan instead of using the cache.
   * @returns {Promise<any>} overview payload.
   */
  async overview(options = {}) {
    const TTL_MS = 120000
    if (options.force !== true && this._listCache !== null
      && Date.now() - this._listCache.at < TTL_MS) {
      return this._listCache.value
    }
    const sessions = await this.listSessions()
    const trash = await this.listTrash()
    const value = {
      sessions,
      trash,
      config: this.config,
      counts: {
        sessions: sessions.length,
        archived: sessions.filter(row => row.archived).length,
        active: sessions.filter(row => row.active).length,
        trash: trash.length,
        trashBytes: trash.reduce((sum, row) => sum + (Number(row.sizeBytes) || 0), 0),
      },
      titlesPending: sessions.some(row => row.title === ''),
    }
    this._listCache = { at: Date.now(), value }
    return value
  }

  /** Current configuration object (mutable from the settings page). */
  get config() {
    return this.configStore.value
  }

  /** The live session-persistence service. */
  get persistence() {
    return this.ctx.sessionPersistence
  }

  /** Resolve one optional service defensively. */
  service(name) {
    try {
      return typeof this.ctx.get === 'function' ? this.ctx.get(name) : this.ctx[name]
    } catch {
      return undefined
    }
  }

  /** Registered workspaces, or an empty list without a registry. */
  workspaces() {
    const registry = this.service('workspaceRegistry')
    if (!registry || typeof registry.list !== 'function') return []
    try {
      return registry.list()
    } catch {
      return []
    }
  }

  /** The session record currently resident in the live store, when any. */
  liveSession(sessionId) {
    const sessions = this.service('sessions')
    if (!sessions || typeof sessions.get !== 'function') return undefined
    try {
      return sessions.get(sessionId)
    } catch {
      return undefined
    }
  }

  /**
   * Ask the same activity waterfall the shipped archive admission uses.
   * @param {string} sessionId - session to observe.
   * @returns {Promise<any[]>} reported activities (empty when idle).
   */
  async activity(sessionId) {
    try {
      const reported = await this.ctx.waterfall('workspace/session-activity', { sessionId }, () => [])
      return Array.isArray(reported) ? reported : []
    } catch {
      return []
    }
  }

  /** The stat snapshot of a stored session, if any. */
  async storedSnapshot(sessionId) {
    try {
      return await this.persistence.stat(sessionId)
    } catch {
      return undefined
    }
  }

  /** Workspace accounting record for one session, when attached. */
  workspaceOf(sessionId) {
    for (const workspace of this.workspaces()) {
      if (workspace.sessionIds.includes(sessionId)) return workspace
    }
    // The raw spelling may differ between stores; retry on the bare uuid.
    const bare = sessionId.startsWith('session-') ? sessionId.slice(8) : `session-${sessionId}`
    for (const workspace of this.workspaces()) {
      if (workspace.sessionIds.includes(bare)) return workspace
    }
    return undefined
  }

  /** Whether one id is in the global archive set. */
  isArchived(sessionId) {
    const registry = this.service('workspaceRegistry')
    try {
      return registry?.archivedSessionIds?.includes(sessionId) ?? false
    } catch {
      return false
    }
  }

  /** Whether one id is in the global pin set. */
  isPinned(sessionId) {
    const registry = this.service('workspaceRegistry')
    try {
      return registry?.pinnedSessionIds?.includes(sessionId) ?? false
    } catch {
      return false
    }
  }

  /**
   * Fold display titles for a batch of sessions through the exact-read query
   * service. Titles are decoration: failures degrade to an empty map.
   * @param {string[]} sessionIds - ids to observe.
   * @returns {Promise<Map<string, string>>} id → title.
   */
  async titles(sessionIds) {
    const titles = new Map()
    const query = this.service('sessionQuery')
    if (!query || typeof query.readTitleSnapshots !== 'function' || sessionIds.length === 0) return titles
    // Folding a title requires the full event log, so a large corpus is slow;
    // bound it so one stalled read cannot hang the settings page.
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined
    const timer = controller === undefined ? undefined : setTimeout(() => controller.abort(), 8000)
    try {
      const results = await query.readTitleSnapshots(sessionIds, controller?.signal)
      for (const result of results) {
        if (result?.status === 'fulfilled' && result.value?.title?.title) {
          const id = result.sessionId ?? result.value?.session?.id ?? result.value?.sessionId
          if (typeof id === 'string') {
            titles.set(id, result.value.title.title)
            this._titleCache.set(id, result.value.title.title)
          }
        }
      }
    } catch {
      // Titles are decoration; the page renders with ids and can retry.
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
    return titles
  }

  /**
   * Resolve display titles for the given sessions without touching the
   * overview cache. Only sessions missing from the in-process title cache are
   * read, so repeated calls are cheap.
   * @param {string[]} sessionIds - sessions to fold.
   * @returns {Promise<Record<string, string>>} id → title (missing ids absent).
   */
  async refreshTitles(sessionIds) {
    const wanted = [...new Set((Array.isArray(sessionIds) ? sessionIds : [])
      .filter(id => typeof id === 'string' && id !== ''))]
    const missing = wanted.filter(id => !this._titleCache.has(id))
    if (missing.length > 0) await this.titles(missing)
    const out = {}
    for (const id of wanted) {
      const title = this._titleCache.get(id)
      if (typeof title === 'string' && title !== '') out[id] = title
    }
    return out
  }

  /**
   * Every workspace path whose snapshot directory could hold this session.
   * @param {string | undefined} cwd - the session's stored project directory.
   * @returns {string[]} candidate workspace roots.
   */
  snapshotCandidates(cwd) {
    const paths = new Set()
    for (const workspace of this.workspaces()) {
      if (typeof workspace.path === 'string' && workspace.path !== '') paths.add(workspace.path)
    }
    if (typeof cwd === 'string' && cwd !== '') paths.add(cwd)
    return [...paths]
  }

  /**
   * List every known session with the facts the management UI needs.
   * @returns {Promise<any[]>} session rows, newest first.
   */
  async listSessions() {
    const registry = this.service('workspaceRegistry')
    const archived = new Set(safeList(() => registry?.archivedSessionIds))
    const pinned = new Set(safeList(() => registry?.pinnedSessionIds))
    const liveSessions = safeList(() => this.service('sessions')?.list?.())
    const liveIds = new Set(liveSessions.map(session => session.id))
    const workspaceBySession = new Map()
    for (const workspace of this.workspaces()) {
      for (const sessionId of workspace.sessionIds) workspaceBySession.set(sessionId, workspace)
    }
    let snapshots = []
    try {
      snapshots = await this.persistence.list()
    } catch {
      snapshots = []
    }
    const rows = []
    for (const snapshot of snapshots) {
      const sessionId = snapshot.header.id
      const workspace = workspaceBySession.get(sessionId)
      rows.push({
        sessionId,
        title: this._titleCache.get(sessionId) ?? '',
        cwd: snapshot.header.cwd ?? '',
        createdAt: snapshot.header.createdAt ?? 0,
        eventCount: snapshot.eventCount ?? undefined,
        sizeBytes: snapshot.sizeBytes ?? undefined,
        workspaceId: workspace?.id,
        workspacePath: workspace?.path,
        workspaceTitle: workspace?.title,
        archived: archived.has(sessionId),
        pinned: pinned.has(sessionId),
        active: liveIds.has(sessionId),
      })
    }
    // A created-but-unmaterialized live session is visible in memory only.
    const seen = new Set(rows.map(row => row.sessionId))
    for (const session of liveSessions) {
      if (seen.has(session.id)) continue
      const workspace = workspaceBySession.get(session.id)
      rows.push({
        sessionId: session.id,
        title: this._titleCache.get(session.id) ?? '',
        cwd: session.header?.cwd ?? '',
        createdAt: session.header?.createdAt ?? 0,
        eventCount: undefined,
        sizeBytes: undefined,
        workspaceId: workspace?.id,
        workspacePath: workspace?.path,
        workspaceTitle: workspace?.title,
        archived: archived.has(session.id),
        pinned: pinned.has(session.id),
        active: true,
      })
    }
    rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    return rows
  }

  /**
   * One session's deletion preconditions.
   * @param {string} rawId - session identity.
   * @returns {Promise<any>} status payload.
   */
  async status(rawId) {
    const sessionId = validateSessionId(rawId)
    const snapshot = await this.storedSnapshot(sessionId)
    const live = this.liveSession(sessionId)
    if (snapshot === undefined && live === undefined) {
      throw new DeleteError('not-found', `session "${sessionId}" not found`)
    }
    const activity = await this.activity(sessionId)
    const workspace = this.workspaceOf(sessionId)
    const cwd = snapshot?.header?.cwd ?? live?.header?.cwd
    const root = resolveSessionRoot(this.config, this.persistence, this.home)
    const located = await locateSessionDir({ root, sessionId, cwd })
    const snapshotDirs = []
    for (const candidate of this.snapshotCandidates(cwd)) {
      const dir = await locateSnapshotDir(candidate, sessionId)
      if (dir !== null) snapshotDirs.push(dir)
    }
    return {
      sessionId,
      exists: true,
      resident: live !== undefined,
      busy: activity.length > 0,
      activity,
      archived: this.isArchived(sessionId),
      pinned: this.isPinned(sessionId),
      cwd: cwd ?? '',
      createdAt: snapshot?.header?.createdAt ?? live?.header?.createdAt ?? null,
      workspaceId: workspace?.id,
      workspacePath: workspace?.path,
      workspaceTitle: workspace?.title,
      sessionDir: located?.dir,
      snapshotDirs,
      sizeBytes: located ? await directorySize(located.dir) : (snapshot?.sizeBytes ?? 0),
      trashEnabled: this.config.trashEnabled === true,
    }
  }

  /**
   * Delete one session end-to-end.
   * @param {string} rawId - session identity.
   * @param {{ trash?: boolean }} [options] - `trash: false` erases immediately.
   * @returns {Promise<any>} per-step result.
   */
  async deleteSession(rawId, options = {}) {
    const sessionId = validateSessionId(rawId)
    const snapshot = await this.storedSnapshot(sessionId)
    const live = this.liveSession(sessionId)
    if (snapshot === undefined && live === undefined) {
      throw new DeleteError('not-found', `session "${sessionId}" not found`)
    }
    // Refuse while the session owns running work: the same admission the
    // shipped archive action asks. The UI greys the row out too, but this is
    // the enforcement.
    const activity = await this.activity(sessionId)
    if (activity.length > 0) {
      throw new DeleteError('session-busy', `session "${sessionId}" is still working (${activity.map(entry => entry.kind).join(', ')})`, { activity })
    }
    const cwd = snapshot?.header?.cwd ?? live?.header?.cwd
    const root = resolveSessionRoot(this.config, this.persistence, this.home)
    const located = await locateSessionDir({ root, sessionId, cwd })
    const sizeBytes = located ? await directorySize(located.dir) : (snapshot?.sizeBytes ?? 0)
    const useTrash = options.trash !== false && this.config.trashEnabled === true
    const trashId = useTrash ? this.newTrashId(sessionId) : null
    const trashDir = trashId === null ? null : join(trashRoot(this.home), trashId)
    const workspacePaths = this.snapshotCandidates(cwd).filter(path => typeof path === 'string' && path !== '')

    // 1. Quiet the session's pending writes before touching its files.
    if (live !== undefined) {
      try {
        await this.service('sessions')?.flush?.(live)
      } catch {
        // The log is about to be removed anyway.
      }
    }

    // 2. Remove or park the durable log directory FIRST, so the dispose-time
    //    export of the snapshot plugin finds no session to mirror.
    let payloadMoved = false
    if (located !== null) {
      if (trashDir !== null) {
        await ensureDir(trashDir)
        await movePath(located.dir, join(trashDir, 'session'))
        payloadMoved = true
      } else {
        await rm(located.dir, { recursive: true, force: true })
      }
    }

    // 3. Detach a resident session using the framework's own teardown path
    //    (`store.delete` + `session/disposed`); capability-probed.
    const detached = this.detachLive(sessionId)

    // 4. Drop workspace accounting (grouping, archive, pin).
    const accounting = await this.clearAccounting(sessionId)

    // 5. Drop the workspace snapshot(s) that would otherwise re-import it.
    let snapshotsRemoved = []
    if (this.config.snapshotCleanup !== false) {
      snapshotsRemoved = await this.removeSnapshots(sessionId, {
        trashDir,
        workspacePaths,
      })
    }

    // 6. Drop the projection-cache row through the live domain.
    const projCacheRemoved = this.config.projCacheCleanup === false
      ? false
      : await this.dropProjectionCache(sessionId)

    // 7. Tell connected clients the row is gone. A resident session already
    //    relayed `api-session/removed` through `session/disposed`; the extra
    //    frame is idempotent and covers non-resident sessions.
    try {
      this.ctx.emit('api-session/removed', sessionId)
    } catch {
      // No relay surface: clients converge on the next full refresh.
    }

    // 8. The snapshot plugin exports asynchronously (debounced after
    //    `session/disposed`). Re-check once it had time to run and remove any
    //    snapshot it managed to write between steps 2 and 5.
    let snapshotsLate = []
    if (this.config.snapshotCleanup !== false) {
      await sleep(250)
      snapshotsLate = await this.removeSnapshots(sessionId, { trashDir: null, workspacePaths })
    }

    // 9. Recycle-bin metadata, written only after the payload moved.
    if (trashDir !== null && payloadMoved) {
      await writeJsonAtomic(join(trashDir, 'meta.json'), {
        version: 1,
        trashId,
        sessionId,
        cwd: cwd ?? '',
        projectKey: located?.projectKey ?? null,
        createdAt: snapshot?.header?.createdAt ?? live?.header?.createdAt ?? null,
        deletedAt: nowIso(),
        sizeBytes,
        workspacePaths,
        snapshotWorkspacePaths: snapshotsRemoved.map(item => item.workspacePath),
        hasSession: payloadMoved,
        hasSnapshot: snapshotsRemoved.length > 0,
      })
    }

    this.invalidate()
    return {
      sessionId,
      deleted: true,
      trashed: trashId !== null,
      trashId,
      sizeBytes,
      detached,
      sessionDirRemoved: located !== null,
      snapshotRemoved: snapshotsRemoved.length > 0 || snapshotsLate.length > 0,
      snapshotDirs: [...snapshotsRemoved, ...snapshotsLate].map(item => item.dir),
      projCacheRemoved,
      accounting,
    }
  }

  /**
   * New unique recycle-bin id.
   * @param {string} sessionId - session identity.
   * @returns {string} trash id.
   */
  newTrashId(sessionId) {
    const base = `${stamp()}-${encodeSegment(sessionId)}`
    let candidate = base
    for (let attempt = 0; attempt < 32; attempt += 1) {
      if (!existsSync(join(trashRoot(this.home), candidate))) return candidate
      candidate = `${base}-${randomSuffix().slice(0, 4)}`
    }
    return `${base}-${randomSuffix()}`
  }

  /**
   * Detach a resident session from the live store.
   * @param {string} sessionId - session identity.
   * @returns {boolean} whether a session was detached.
   */
  detachLive(sessionId) {
    const sessions = this.service('sessions')
    if (!sessions || typeof sessions.get !== 'function') return false
    const detachEntered = sessions.detachEntered
    if (typeof detachEntered !== 'function') return false
    let detached = false
    for (const variant of sessionIdVariants(sessionId)) {
      let session
      try {
        session = sessions.get(variant)
      } catch {
        continue
      }
      if (session === undefined) continue
      try {
        if (typeof sessions.liveEntryFor === 'function') {
          const entry = sessions.liveEntryFor(session)
          if (entry !== undefined && entry !== null) {
            detachEntered.call(sessions, entry)
            detached = true
            continue
          }
        }
        const store = sessions.store
        if (store instanceof Map) {
          const entry = store.get(variant)
          if (entry !== undefined) {
            detachEntered.call(sessions, entry)
            detached = true
          }
        }
      } catch (error) {
        this.logger?.warn?.(`dsh-session-delete: detach of "${variant}" failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return detached
  }

  /**
   * Remove one session from workspace grouping, the archive set and the pin set.
   * @param {string} sessionId - session identity.
   * @returns {Promise<{ workspaces: number, archived: boolean, pinned: boolean }>} what changed.
   */
  async clearAccounting(sessionId) {
    const registry = this.service('workspaceRegistry')
    const variants = sessionIdVariants(sessionId)
    let workspaces = 0
    if (registry && typeof registry.list === 'function') {
      for (const workspace of safeList(() => registry.list())) {
        for (const variant of variants) {
          if (!workspace.sessionIds.includes(variant)) continue
          try {
            await workspace.detachSession(variant)
            workspaces += 1
          } catch (error) {
            this.logger?.warn?.(`dsh-session-delete: detach accounting for "${variant}" failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
    }
    let archived = false
    for (const variant of variants) {
      try {
        if (registry?.archivedSessionIds?.includes(variant)) {
          await registry.unarchiveSession(variant)
          archived = true
        }
      } catch {
        // Idempotent enough: the id cannot be opened once its payload is gone.
      }
    }
    let pinned = false
    for (const variant of variants) {
      try {
        if (registry?.pinnedSessionIds?.includes(variant)) {
          await registry.unpinSession(variant)
          pinned = true
        }
      } catch {
        // Same.
      }
    }
    return { workspaces, archived, pinned }
  }

  /**
   * Remove or park the workspace snapshots of one session.
   * @param {string} sessionId - session identity.
   * @param {{ trashDir: string | null, workspacePaths: string[] }} options - movement policy.
   * @returns {Promise<string[]>} removed snapshot directories.
   */
  async removeSnapshots(sessionId, options) {
    /** @type {{ dir: string, workspacePath: string }[]} */
    const removed = []
    const targets = new Set(options.workspacePaths ?? [])
    for (const workspace of this.workspaces()) {
      if (typeof workspace.path === 'string' && workspace.path !== '') targets.add(workspace.path)
    }
    for (const workspacePath of targets) {
      const dir = await locateSnapshotDir(workspacePath, sessionId)
      if (dir === null) continue
      try {
        if (options.trashDir !== null) {
          const target = join(options.trashDir, 'snapshot')
          if (await statOrUndefined(target) === undefined) {
            await movePath(dir, target)
            removed.push({ dir, workspacePath })
            continue
          }
        }
        await rm(dir, { recursive: true, force: true })
        removed.push({ dir, workspacePath })
      } catch (error) {
        this.logger?.warn?.(`dsh-session-delete: snapshot removal for "${sessionId}" failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return removed
  }

  /**
   * Delete the session's projection-cache row through the live storage domain.
   * @param {string} sessionId - session identity.
   * @returns {Promise<boolean>} whether a row was removed.
   */
  async dropProjectionCache(sessionId) {
    const facility = this.service('storageDomain')
    const domain = facility?.get?.('session_projcache')
    const table = domain?.table?.('sessions')
    if (!table || typeof table.delete !== 'function') return false
    let removed = false
    for (const variant of sessionIdVariants(sessionId)) {
      try {
        if (await table.delete(variant)) removed = true
      } catch {
        // A closed domain or absent table means nothing to clean.
      }
    }
    return removed
  }

  /**
   * Recycle-bin items, newest first.
   * @returns {Promise<any[]>} trash rows.
   */
  async listTrash() {
    const root = trashRoot(this.home)
    let entries
    try {
      const { readdir } = await import('node:fs/promises')
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      return []
    }
    const rows = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = join(root, entry.name)
      const meta = await readJsonFile(join(dir, 'meta.json'), null)
      if (meta === null || typeof meta !== 'object') continue
      rows.push({
        trashId: entry.name,
        sessionId: meta.sessionId,
        cwd: meta.cwd ?? '',
        deletedAt: meta.deletedAt ?? '',
        sizeBytes: meta.sizeBytes ?? 0,
        hasSession: meta.hasSession === true,
        hasSnapshot: meta.hasSnapshot === true,
        createdAt: meta.createdAt ?? null,
      })
    }
    rows.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))
    return rows
  }

  /**
   * Restore one recycle-bin item and re-attach it to its workspace.
   * @param {string} rawTrashId - trash entry name.
   * @returns {Promise<any>} restore result.
   */
  async restore(rawTrashId) {
    const trashId = String(rawTrashId ?? '').trim()
    if (trashId === '' || trashId.includes('/') || trashId.includes('\\') || trashId.includes('..')) {
      throw new DeleteError('invalid-request', 'invalid trash id')
    }
    const dir = join(trashRoot(this.home), trashId)
    const meta = await readJsonFile(join(dir, 'meta.json'), null)
    if (meta === null || typeof meta !== 'object') throw new DeleteError('not-found', `trash item "${trashId}" not found`)
    const sessionId = validateSessionId(meta.sessionId)
    const root = resolveSessionRoot(this.config, this.persistence, this.home)
    const restored = []
    if (meta.hasSession === true) {
      const projectDirName = typeof meta.projectKey === 'string' && meta.projectKey !== ''
        ? meta.projectKey
        : (typeof meta.cwd === 'string' && meta.cwd !== '' ? projectKey(meta.cwd) : undefined)
      if (projectDirName === undefined) throw new DeleteError('invalid-request', 'trash item carries no project key')
      const target = join(root, projectDirName, encodeSegment(sessionId))
      if (await statOrUndefined(target) !== undefined) {
        throw new DeleteError('already-exists', `session dir already exists: ${target}`)
      }
      await ensureDir(join(root, projectDirName))
      await movePath(join(dir, 'session'), target)
      restored.push(target)
    }
    if (meta.hasSnapshot === true) {
      const snapshotDir = join(dir, 'snapshot')
      if (await statOrUndefined(snapshotDir) !== undefined) {
        const sources = Array.isArray(meta.snapshotWorkspacePaths) && meta.snapshotWorkspacePaths.length > 0
          ? meta.snapshotWorkspacePaths
          : (meta.workspacePaths ?? [])
        for (const workspacePath of sources) {
          if (typeof workspacePath !== 'string' || workspacePath === '') continue
          const target = join(workspacePath, '.dsh', 'sessions', encodeSegment(sessionId))
          if (await statOrUndefined(target) !== undefined) continue
          await ensureDir(join(workspacePath, '.dsh', 'sessions'))
          await movePath(snapshotDir, target)
          restored.push(target)
          break
        }
      }
    }
    let attached = false
    if (typeof meta.cwd === 'string' && meta.cwd !== '') {
      const registry = this.service('workspaceRegistry')
      try {
        const workspace = await registry?.resolveByPath?.(meta.cwd)
        if (workspace && !workspace.sessionIds.includes(sessionId)) {
          await workspace.attachSession(sessionId)
          attached = true
        }
      } catch {
        // The session is restored even when the workspace no longer accepts it.
      }
    }
    await rm(dir, { recursive: true, force: true })
    this.invalidate()
    return { sessionId, restored: true, attached, paths: restored }
  }

  /**
   * Permanently erase one recycle-bin item.
   * @param {string} rawTrashId - trash entry name.
   * @returns {Promise<{ trashId: string, purged: true }>} result.
   */
  async purge(rawTrashId) {
    const trashId = String(rawTrashId ?? '').trim()
    if (trashId === '' || trashId.includes('/') || trashId.includes('\\') || trashId.includes('..')) {
      throw new DeleteError('invalid-request', 'invalid trash id')
    }
    const dir = join(trashRoot(this.home), trashId)
    if (await statOrUndefined(dir) === undefined) throw new DeleteError('not-found', `trash item "${trashId}" not found`)
    await rm(dir, { recursive: true, force: true })
    this.invalidate()
    return { trashId, purged: true }
  }

  /**
   * Erase every recycle-bin item (optionally only those older than keepDays).
   * @returns {Promise<{ removed: number }>} result.
   */
  async emptyTrash() {
    const items = await this.listTrash()
    const keepDays = Number(this.config.keepDays) || 0
    const cutoff = keepDays > 0 ? Date.now() - keepDays * 86400000 : Number.POSITIVE_INFINITY
    let removed = 0
    for (const item of items) {
      const deletedAt = Date.parse(item.deletedAt)
      const old = !Number.isFinite(deletedAt) || deletedAt <= cutoff
      if (keepDays > 0 && !old) continue
      try {
        await rm(join(trashRoot(this.home), item.trashId), { recursive: true, force: true })
        removed += 1
      } catch {
        // Keep going: one unremovable entry must not block the rest.
      }
    }
    this.invalidate()
    return { removed }
  }
}

/**
 * Call one getter, returning an empty array on absence or failure.
 * @param {() => any} getter - getter expression.
 * @returns {any[]} list value or an empty array.
 */
function safeList(getter) {
  try {
    const value = getter()
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}
