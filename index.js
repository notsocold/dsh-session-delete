/**
 * dsh-session-delete Host entry.
 *
 * Restores the "delete a session" capability DeepSeek Harness ships without:
 * the sidebar row menu gains a delete action, and the Host route it calls
 * removes the session log, projection cache and workspace accounting, parks
 * the payload in a local recycle bin, and clears the matching
 * `dsh-workspace-session` snapshot so the session cannot be re-imported.
 *
 * @module dsh-session-delete
 */

import { ConfigStore } from './lib/config.js'
import { DeleteService } from './lib/delete.js'
import { registerApi } from './lib/api.js'
import { resolveSessionRoot } from './lib/paths.js'
import { resolveDshHome } from './lib/util.js'

/** Cordis plugin name (matches the bundle row id). */
export const name = 'dsh-session-delete'

/**
 * Services required before activation. The session-persistence seam is the
 * plugin's reason to exist; every other service (workspaces, sessions,
 * storageDomain, connection) is optional and read defensively.
 */
export const inject = ['sessionPersistence']

/**
 * Host plugin entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 */
export async function apply(ctx) {
  const logger = ctx.logger
  const home = resolveDshHome()
  const configStore = new ConfigStore({ home, logger })
  await configStore.load()
  const service = new DeleteService(ctx, { configStore, home, logger })
  registerApi(ctx, { service, configStore })
  try {
    const root = resolveSessionRoot(configStore.value, ctx.sessionPersistence, home)
    logger?.info?.(
      `dsh-session-delete: ready (sessions=${root}, `
      + `trash=${configStore.value.trashEnabled}, snapshotCleanup=${configStore.value.snapshotCleanup})`,
    )
  } catch {
    // Logging is best-effort.
  }
}
