/**
 * Filesystem layout helpers: where a session lives on disk, where its
 * workspace snapshot lives, and where the recycle bin keeps removed payloads.
 *
 * Session directories follow the shipped JSONL backend layout
 * (`<root>/--<project>--/<encoded-id>/`). The project directory is derived
 * from the stored header's `cwd`; a bounded scan is the fallback when the
 * header carries no cwd or the derived path does not exist.
 *
 * @module dsh-session-delete/lib/paths
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { encodeSegment, projectKey, sessionIdVariants, statOrUndefined } from './util.js'

/** Relative path of the plugin's own state below the Harness home. */
export const PLUGIN_DIR = 'dsh-session-delete'

/**
 * The session root in effect for this process.
 * @param {any} config - plugin configuration.
 * @param {any} persistence - the live `ctx.sessionPersistence` service.
 * @param {string} home - Harness home.
 * @returns {string} absolute session root.
 */
export function resolveSessionRoot(config, persistence, home) {
  const configured = typeof config?.sessionsRoot === 'string' ? config.sessionsRoot.trim() : ''
  if (configured !== '') return configured
  // The JSONL backend keeps its resolved root in a private field. Reading it is
  // a best-effort probe: it makes a custom `root:` composition work without
  // duplicating that setting here. Every failure falls back to the shipped
  // default (`dshHomePath('sessions')` in the base bundle).
  try {
    const root = persistence?.root
    if (typeof root === 'string' && root.trim() !== '') return root
  } catch {
    // Private field unavailable: use the default.
  }
  return join(home, 'sessions')
}

/**
 * Derive the on-disk directory of one session, with a bounded scan fallback.
 * @param {{ root: string, sessionId: string, cwd: string | undefined }} input - root, id and stored cwd.
 * @returns {Promise<{ dir: string, projectKey: string } | null>} the session dir, or null.
 */
export async function locateSessionDir({ root, sessionId, cwd }) {
  // Session ids appear in two spellings on disk across DSH versions
  // (`<uuid>` and `session-<uuid>`), so every spelling is probed.
  const encodedVariants = sessionIdVariants(sessionId).map(encodeSegment)
  if (typeof cwd === 'string' && cwd !== '') {
    const project = projectKey(cwd)
    for (const encoded of encodedVariants) {
      const candidate = join(root, project, encoded)
      if (await statOrUndefined(candidate) !== undefined) return { dir: candidate, projectKey: project }
    }
  }
  // Fallback: scan project directories for this session id. Session ids are
  // unique, so at most one directory can match.
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    for (const encoded of encodedVariants) {
      const candidate = join(root, entry.name, encoded)
      if (await statOrUndefined(candidate) !== undefined) {
        return { dir: candidate, projectKey: entry.name }
      }
    }
  }
  return null
}

/**
 * Directory of a workspace's session snapshot (the dsh-workspace-session
 * mirror), or null when the workspace path does not exist.
 * @param {string} workspacePath - workspace directory.
 * @param {string} sessionId - session identity.
 * @returns {Promise<string | null>} snapshot dir, or null when absent.
 */
export async function locateSnapshotDir(workspacePath, sessionId) {
  if (typeof workspacePath !== 'string' || workspacePath === '') return null
  for (const encoded of sessionIdVariants(sessionId).map(encodeSegment)) {
    const candidate = join(workspacePath, '.dsh', 'sessions', encoded)
    if (await statOrUndefined(candidate) !== undefined) return candidate
  }
  return null
}

/**
 * The recycle-bin root for removed session payloads.
 * @param {string} home - Harness home.
 * @returns {string} absolute trash root.
 */
export function trashRoot(home) {
  return join(home, PLUGIN_DIR, 'trash')
}

/**
 * Recursive byte size of a directory (best effort: unreadable entries count 0).
 * @param {string} dir - directory path.
 * @returns {Promise<number>} total bytes.
 */
export async function directorySize(dir) {
  let total = 0
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const child = join(dir, entry.name)
    if (entry.isDirectory()) total += await directorySize(child)
    else {
      const info = await statOrUndefined(child)
      if (info !== undefined && typeof info.size === 'number') total += info.size
    }
  }
  return total
}

/**
 * Resolve a workspace path that no longer exists to its nearest existing
 * ancestor, so snapshot cleanup still finds the directory.
 * @param {string} workspacePath - recorded workspace path.
 * @returns {Promise<string | undefined>} an existing directory or undefined.
 */
export async function existingWorkspacePath(workspacePath) {
  let current = workspacePath
  for (let depth = 0; depth < 16 && typeof current === 'string' && current !== ''; depth += 1) {
    if (await statOrUndefined(current) !== undefined) return current
    const parent = current.replace(/[\\/][^\\/]+$/, '')
    if (parent === current) return undefined
    current = parent
  }
  return undefined
}
