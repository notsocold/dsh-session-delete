/**
 * Small shared helpers for dsh-session-delete.
 *
 * Zero-dependency on purpose: this plugin is a build-free ESM bundle that only
 * uses Node built-ins plus the Cordis services it injects.
 *
 * @module dsh-session-delete/lib/util
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Environment variable naming the Harness home. */
const DSH_HOME_ENV = 'DSH_HOME'

/**
 * Resolve the Harness home the same way DSH does: `$DSH_HOME`, then `~/.dsh`.
 * @param {string | undefined} [explicit] - an explicit root, when a caller has one.
 * @returns {string} absolute Harness home.
 */
export function resolveDshHome(explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit
  const env = process.env[DSH_HOME_ENV]
  if (typeof env === 'string' && env.trim() !== '') return env
  return join(homedir(), '.dsh')
}

/**
 * Join path parts below the Harness home.
 * @param {string} home - Harness home.
 * @param {...string} parts - path segments.
 * @returns {string} absolute path.
 */
export function dshHomePath(home, ...parts) {
  return join(home, ...parts)
}

/**
 * Create a directory recursively, owner-only.
 * @param {string} path - directory path.
 * @returns {Promise<void>}
 */
export async function ensureDir(path) {
  await mkdir(path, { recursive: true, mode: 0o700 })
}

/**
 * Read one JSON file, returning `fallback` for a missing file.
 * @param {string} path - file path.
 * @param {any} fallback - value for ENOENT.
 * @returns {Promise<any>} parsed JSON or the fallback.
 */
export async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

/**
 * Write JSON atomically: sibling temp file, then rename over the target.
 * @param {string} path - target file.
 * @param {any} value - JSON-serializable value.
 * @param {{ mode?: number }} [options] - file mode.
 * @returns {Promise<void>}
 */
export async function writeJsonAtomic(path, value, options = {}) {
  await ensureDir(dirname(path))
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: options.mode ?? 0o600 })
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * Stat a path, returning `undefined` for ENOENT.
 * @param {string} path - path to stat.
 * @returns {Promise<import('node:fs').Stats | undefined>} stats or undefined.
 */
export async function statOrUndefined(path) {
  try {
    return await stat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Resolve the canonical path of a directory, returning undefined when it does
 * not exist or is not a directory.
 * @param {string} path - candidate path.
 * @returns {Promise<string | undefined>} canonical directory path.
 */
export async function realpathDirectory(path) {
  try {
    const { realpath } = await import('node:fs/promises')
    const resolved = await realpath(path)
    const info = await stat(resolved)
    return info.isDirectory() ? resolved : undefined
  } catch {
    return undefined
  }
}

/**
 * Encode an arbitrary string as one safe path segment. Mirrors the DSH JSONL
 * backend's `encodeSegment` so this plugin addresses the same session dirs.
 * @param {string} raw - raw value.
 * @returns {string} safe path segment.
 */
export function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

/**
 * Build the readable directory key for a project path. Mirrors the DSH JSONL
 * backend's `projectKey`: separators become `-`, unsafe code units use the
 * `~XXXX` escape, and the slug is bounded for filesystem component limits.
 * @param {string} cwd - the session's project directory.
 * @returns {string} a single filesystem-safe project directory name.
 */
export function projectKey(cwd) {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i += 1) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

/**
 * Session ids appear in two spellings across stores: the raw uuid and the
 * prefixed `session-<uuid>`. Return every unique spelling.
 * @param {string} sessionId - one spelling.
 * @returns {string[]} every spelling.
 */
export function sessionIdVariants(sessionId) {
  const variants = new Set([sessionId])
  if (sessionId.startsWith('session-')) variants.add(sessionId.slice('session-'.length))
  else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    variants.add(`session-${sessionId}`)
  }
  return [...variants]
}

/**
 * Collapse either spelling to the bare uuid, the form two stores can be
 * joined on.
 * @param {string} id - one spelling.
 * @returns {string} bare uuid (or the input when it has no uuid shape).
 */
export function normId(id) {
  return id.startsWith('session-') ? id.slice('session-'.length) : id
}

/**
 * Whether a value is a plain object.
 * @param {any} value - candidate.
 * @returns {boolean} true for plain objects.
 */
export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Current time as an ISO string.
 * @returns {string} ISO timestamp.
 */
export function nowIso() {
  return new Date().toISOString()
}

/**
 * A short random suffix for temp/backup names.
 * @returns {string} hex suffix.
 */
export function randomSuffix() {
  return randomUUID().replaceAll('-', '').slice(0, 12)
}

/**
 * SHA-256 of a string, prefixed for display.
 * @param {string} text - input text.
 * @returns {string} `sha256:<hex>`.
 */
export function sha256(text) {
  return 'sha256:' + createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Resolve after a delay.
 * @param {number} ms - delay in milliseconds.
 * @returns {Promise<void>} resolves after the delay.
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Convert a thrown value into a stable error payload.
 * @param {any} error - thrown value.
 * @returns {{ code: string, message: string }} payload.
 */
export function errorPayload(error) {
  const code = typeof error?.code === 'string' ? error.code : 'internal'
  const message = error instanceof Error ? error.message : String(error)
  return { code, message }
}

/**
 * Human-readable byte size.
 * @param {number | undefined} bytes - byte count.
 * @returns {string} display string.
 */
export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`
}
