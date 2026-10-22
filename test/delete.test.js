/**
 * Host behaviour tests: deletion, recycle bin, restore, busy refusal, and the
 * workspace-snapshot cleanup, all against temporary directories and a fake
 * Cordis context.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '../lib/config.js'
import { DeleteError, DeleteService } from '../lib/delete.js'
import { encodeSegment, projectKey } from '../lib/util.js'

const SESSION_ID = 'session-11111111-2222-3333-4444-555555555555'
const OTHER_ID = 'session-99999999-8888-7777-6666-555555555555'

/**
 * Build one sandbox: a Harness home, a workspace with a snapshot, and a JSONL
 * backend root holding the session log.
 */
async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-sd-'))
  const root = join(home, 'sessions')
  const workspacePath = join(home, 'ws')
  const cwd = workspacePath
  const project = projectKey(cwd)
  const sessionDir = join(root, project, encodeSegment(SESSION_ID))
  await mkdir(sessionDir, { recursive: true })
  await mkdir(workspacePath, { recursive: true })
  const log = join(sessionDir, 'session.v4.jsonl')
  await writeFile(log, '{"type":"session","version":4}\n')
  const snapshotDir = join(workspacePath, '.dsh', 'sessions', encodeSegment(SESSION_ID))
  await mkdir(snapshotDir, { recursive: true })
  const snapshotFile = join(snapshotDir, 'session.v4.jsonl')
  await writeFile(snapshotFile, '{"type":"session","version":4}\n')
  return { home, root, workspacePath, project, sessionDir, snapshotDir, log, snapshotFile }
}

/** Build a fake Host context plus the services the plugin reaches through it. */
function makeEnv(box, options = {}) {
  const archived = [...(options.archived ?? [])]
  const pinned = [...(options.pinned ?? [])]
  const live = new Map(options.live ?? [])
  const projDeleted = []
  const emitted = []
  const attached = []
  const workspaces = options.workspaces ?? [{
    id: 'ws-1',
    path: box.workspacePath,
    title: 'Workspace',
    sessionIds: [SESSION_ID],
    async detachSession(id) {
      this.sessionIds = this.sessionIds.filter(candidate => candidate !== id)
    },
    async attachSession(id) {
      if (!this.sessionIds.includes(id)) this.sessionIds = [id, ...this.sessionIds]
    },
  }]
  const registry = {
    list: () => workspaces,
    archivedSessionIds: archived,
    pinnedSessionIds: pinned,
    async unarchiveSession(id) {
      const index = archived.indexOf(id)
      if (index >= 0) archived.splice(index, 1)
    },
    async unpinSession(id) {
      const index = pinned.indexOf(id)
      if (index >= 0) pinned.splice(index, 1)
    },
    async resolveByPath(path) {
      return workspaces.find(workspace => workspace.path === path)
    },
  }
  const sessions = {
    get: id => live.get(id),
    list: () => [...live.values()],
    flush: async () => {},
    liveEntryFor: session => ({ session }),
    detachEntered(entry) {
      live.delete(entry.session.id)
    },
  }
  const storageDomain = {
    get: name => name === 'session_projcache'
      ? {
        table: table => table === 'sessions'
          ? {
            delete: async (id) => {
              projDeleted.push(id)
              return true
            },
          }
          : undefined,
      }
      : undefined,
  }
  const activity = options.activity ?? {}
  const ctx = {
    sessionPersistence: {
      list: async () => options.snapshots ?? [{
        header: { id: SESSION_ID, cwd: box.workspacePath, createdAt: 1700000000000 },
        revision: 'r1',
        eventCount: 1,
        sizeBytes: 128,
      }],
      stat: async (id) => (options.snapshots ?? [{
        header: { id: SESSION_ID, cwd: box.workspacePath, createdAt: 1700000000000 },
        revision: 'r1',
        eventCount: 1,
        sizeBytes: 128,
      }]).find(snapshot => snapshot.header.id === id),
    },
    get(name) {
      if (name === 'workspaceRegistry') return registry
      if (name === 'sessions') return sessions
      if (name === 'storageDomain') return storageDomain
      if (name === 'sessionQuery') return undefined
      return undefined
    },
    async waterfall(event, payload, fallback) {
      return activity[payload.sessionId] ?? fallback()
    },
    emit(event, id) {
      emitted.push([event, id])
    },
    logger: { info() {}, warn() {} },
  }
  const config = { ...DEFAULT_CONFIG, sessionsRoot: box.root, ...(options.config ?? {}) }
  const service = new DeleteService(ctx, {
    configStore: { value: config },
    home: box.home,
    logger: ctx.logger,
  })
  return { service, ctx, config, registry, sessions, live, projDeleted, emitted, workspaces, archived, pinned, attached }
}

/** Whether a path exists. */
async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

test('deleting a stored session parks the payload and clears every trace', async () => {
  const box = await setup()
  const env = makeEnv(box, {
    archived: [SESSION_ID],
    pinned: [SESSION_ID],
  })
  const result = await env.service.deleteSession(SESSION_ID, { trash: true })

  // The durable log and the workspace snapshot are gone from their homes.
  assert.equal(await exists(box.sessionDir), false)
  assert.equal(await exists(box.snapshotDir), false)

  // The recycle bin holds the payload, the snapshot and the metadata.
  assert.equal(result.trashed, true)
  const trashDir = join(box.home, 'dsh-session-delete', 'trash', result.trashId)
  assert.equal(await exists(join(trashDir, 'session', 'session.v4.jsonl')), true)
  assert.equal(await exists(join(trashDir, 'snapshot', 'session.v4.jsonl')), true)
  const meta = JSON.parse(await readFile(join(trashDir, 'meta.json'), 'utf8'))
  assert.equal(meta.sessionId, SESSION_ID)
  assert.equal(meta.projectKey, box.project)
  assert.equal(meta.hasSession, true)
  assert.equal(meta.hasSnapshot, true)

  // Workspace accounting is clean.
  assert.deepEqual(env.workspaces[0].sessionIds, [])
  assert.deepEqual(env.archived, [])
  assert.deepEqual(env.pinned, [])

  // Projection cache and the client notification both fired. The cache is
  // keyed by either id spelling, so both are removed.
  assert.deepEqual(env.projDeleted, [SESSION_ID, '11111111-2222-3333-4444-555555555555'])
  assert.deepEqual(env.emitted, [['api-session/removed', SESSION_ID]])
})

test('deleting a resident session detaches it from the live store', async () => {
  const box = await setup()
  const liveSession = {
    id: SESSION_ID,
    header: { id: SESSION_ID, cwd: box.workspacePath, createdAt: 1700000000000 },
  }
  const env = makeEnv(box, { live: [[SESSION_ID, liveSession]] })
  const result = await env.service.deleteSession(SESSION_ID, { trash: false })
  assert.equal(result.detached, true)
  assert.equal(env.live.has(SESSION_ID), false)
  assert.equal(result.trashed, false)
  assert.equal(await exists(box.sessionDir), false)
  // No recycle bin item without trash.
  const trashRoot = join(box.home, 'dsh-session-delete', 'trash')
  assert.equal(await exists(trashRoot), false)
})

test('a busy session is refused before any write', async () => {
  const box = await setup()
  const env = makeEnv(box, { activity: { [SESSION_ID]: [{ kind: 'turn' }] } })
  await assert.rejects(
    () => env.service.deleteSession(SESSION_ID),
    error => error instanceof DeleteError && error.code === 'session-busy',
  )
  assert.equal(await exists(box.sessionDir), true)
  assert.equal(await exists(box.snapshotDir), true)
  assert.deepEqual(env.emitted, [])
})

test('an unknown session is refused', async () => {
  const box = await setup()
  const env = makeEnv(box, { snapshots: [] })
  await assert.rejects(
    () => env.service.deleteSession(OTHER_ID),
    error => error instanceof DeleteError && error.code === 'not-found',
  )
})

test('restore puts the payload and snapshot back and re-attaches the workspace', async () => {
  const box = await setup()
  const env = makeEnv(box, {})
  const result = await env.service.deleteSession(SESSION_ID, { trash: true })
  assert.equal(await exists(box.sessionDir), false)

  const restored = await env.service.restore(result.trashId)
  assert.equal(restored.sessionId, SESSION_ID)
  assert.equal(restored.attached, true)
  assert.equal(await exists(join(box.sessionDir, 'session.v4.jsonl')), true)
  assert.equal(await exists(join(box.snapshotDir, 'session.v4.jsonl')), true)
  assert.deepEqual(env.workspaces[0].sessionIds, [SESSION_ID])
  assert.equal(await exists(join(box.home, 'dsh-session-delete', 'trash', result.trashId)), false)
})

test('restore refuses when the session directory is occupied again', async () => {
  const box = await setup()
  const env = makeEnv(box, {})
  const result = await env.service.deleteSession(SESSION_ID, { trash: true })
  await mkdir(box.sessionDir, { recursive: true })
  await writeFile(join(box.sessionDir, 'session.v4.jsonl'), 'x\n')
  await assert.rejects(
    () => env.service.restore(result.trashId),
    error => error instanceof DeleteError && error.code === 'already-exists',
  )
})

test('the recycle bin lists, purges and empties items', async () => {
  const box = await setup()
  const env = makeEnv(box, {})
  const first = await env.service.deleteSession(SESSION_ID, { trash: true })
  const items = await env.service.listTrash()
  assert.equal(items.length, 1)
  assert.equal(items[0].trashId, first.trashId)
  assert.equal(items[0].sessionId, SESSION_ID)
  assert.ok(items[0].sizeBytes > 0)

  await env.service.purge(first.trashId)
  assert.equal(await exists(join(box.home, 'dsh-session-delete', 'trash', first.trashId)), false)
  assert.deepEqual(await env.service.listTrash(), [])
})

test('empty-trash removes every parked item', async () => {
  const box = await setup()
  const env = makeEnv(box, {})
  const first = await env.service.deleteSession(SESSION_ID, { trash: true })
  await mkdir(box.sessionDir, { recursive: true })
  await writeFile(join(box.sessionDir, 'session.v4.jsonl'), '{"type":"session","version":4}\n')
  const second = await env.service.deleteSession(SESSION_ID, { trash: true })
  const result = await env.service.emptyTrash()
  assert.equal(result.removed, 2)
  assert.equal(await exists(join(box.home, 'dsh-session-delete', 'trash', first.trashId)), false)
  assert.equal(await exists(join(box.home, 'dsh-session-delete', 'trash', second.trashId)), false)
})

test('status reports busy, archive and snapshot facts', async () => {
  const box = await setup()
  const env = makeEnv(box, { archived: [SESSION_ID], activity: { [SESSION_ID]: [{ kind: 'schedule', items: [] }] } })
  const status = await env.service.status(SESSION_ID)
  assert.equal(status.busy, true)
  assert.equal(status.archived, true)
  assert.equal(status.sessionDir, box.sessionDir)
  assert.deepEqual(status.snapshotDirs, [box.snapshotDir])
  assert.ok(status.sizeBytes > 0)
  assert.equal(status.trashEnabled, true)
})
