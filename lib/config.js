/**
 * Durable plugin configuration.
 *
 * The settings live in `$DSH_HOME/dsh-session-delete/config.json` (machine
 * local, never synced). Every field has a safe default so a missing or partial
 * file still yields a usable configuration.
 *
 * @module dsh-session-delete/lib/config
 */

import { join } from 'node:path'
import { ensureDir, isRecord, readJsonFile, writeJsonAtomic } from './util.js'

/** Default configuration. */
export const DEFAULT_CONFIG = Object.freeze({
  /**
   * Session root override. Empty means "resolve automatically": the live
   * JSONL backend's own root when readable, else `$DSH_HOME/sessions`.
   */
  sessionsRoot: '',
  /** Move the session payload into the local recycle bin instead of erasing it. */
  trashEnabled: true,
  /** Also remove a matching `<workspace>/.dsh/sessions/<id>/` snapshot (dsh-workspace-session). */
  snapshotCleanup: true,
  /** Also drop the session's `session_projcache` row so the cache cannot rewrite it. */
  projCacheCleanup: true,
  /** Days to keep recycle-bin items; 0 keeps them forever. */
  keepDays: 0,
})

/**
 * Validate one config patch and merge it over the current value.
 * Unknown keys are ignored; a wrong type keeps the previous value.
 * @param {any} current - current configuration.
 * @param {any} patch - proposed fields.
 * @returns {any} merged configuration.
 */
export function mergeConfig(current, patch) {
  const next = { ...DEFAULT_CONFIG, ...(isRecord(current) ? current : {}) }
  if (!isRecord(patch)) return next
  if (typeof patch.sessionsRoot === 'string') {
    const value = patch.sessionsRoot.trim()
    next.sessionsRoot = value === '' || value.startsWith('/') ? value : value
  }
  if (typeof patch.trashEnabled === 'boolean') next.trashEnabled = patch.trashEnabled
  if (typeof patch.snapshotCleanup === 'boolean') next.snapshotCleanup = patch.snapshotCleanup
  if (typeof patch.projCacheCleanup === 'boolean') next.projCacheCleanup = patch.projCacheCleanup
  if (Number.isInteger(patch.keepDays) && patch.keepDays >= 0) next.keepDays = patch.keepDays
  return next
}

/** Loads, validates and persists the plugin configuration. */
export class ConfigStore {
  /**
   * @param {{ home: string, logger?: { warn?: (message: string) => void } }} options - resolved home and logger.
   */
  constructor(options) {
    this.home = options.home
    this.logger = options.logger
    this.path = join(this.home, 'dsh-session-delete', 'config.json')
    /** @type {any} */
    this.value = { ...DEFAULT_CONFIG }
  }

  /** Load the file, falling back to defaults on absence or corruption. */
  async load() {
    try {
      const raw = await readJsonFile(this.path, null)
      this.value = mergeConfig(DEFAULT_CONFIG, raw)
    } catch (error) {
      this.logger?.warn?.(`dsh-session-delete: cannot read ${this.path}: ${error instanceof Error ? error.message : String(error)}`)
      this.value = { ...DEFAULT_CONFIG }
    }
    return this.value
  }

  /**
   * Apply one validated patch and persist it atomically.
   * @param {any} patch - proposed fields.
   * @returns {Promise<any>} the resulting configuration.
   */
  async update(patch) {
    this.value = mergeConfig(this.value, patch)
    await ensureDir(join(this.home, 'dsh-session-delete'))
    await writeJsonAtomic(this.path, this.value)
    return this.value
  }
}
