/**
 * Host HTTP API for the browser half.
 *
 * Every route is registered through `ctx.connection.fetch`, so it lives inside
 * the authenticated `/api` fence: only the page's owner peer reaches it, and a
 * route never becomes a public port. The browser uses plain `fetch`; no
 * generated Remote client is required.
 *
 * @module dsh-session-delete/lib/api
 */

import { DeleteError } from './delete.js'

/** Shared path prefix of every route. */
export const API_PREFIX = '/api/dsh-session-delete'

/**
 * Build a success response.
 * @param {any} value - JSON payload.
 * @returns {Response} response.
 */
function ok(value) {
  return Response.json({ ok: true, value }, { headers: { 'cache-control': 'no-store' } })
}

/**
 * Map a thrown value to a stable HTTP failure.
 * @param {any} error - thrown value.
 * @returns {Response} response.
 */
function failure(error) {
  const code = error instanceof DeleteError
    ? error.code
    : (typeof error?.code === 'string' ? error.code : 'internal')
  const message = error instanceof Error ? error.message : String(error)
  const status = code === 'invalid-request'
    ? 400
    : code === 'not-found'
      ? 404
      : code === 'session-busy' || code === 'already-exists'
        ? 409
        : 500
  return Response.json(
    { ok: false, error: { code, message, details: error instanceof DeleteError ? error.details : undefined } },
    { status, headers: { 'cache-control': 'no-store' } },
  )
}

/**
 * Read one JSON object body, rejecting anything else.
 * @param {Request} request - incoming request.
 * @returns {Promise<any>} parsed body object.
 */
async function readObjectBody(request) {
  let body
  try {
    body = await request.json()
  } catch {
    throw new DeleteError('invalid-request', 'request body must be a JSON object')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new DeleteError('invalid-request', 'request body must be a JSON object')
  }
  return body
}

/**
 * Build the route list for one deletion service.
 * @param {{ service: import('./delete.js').DeleteService, configStore: any }} services - plugin services.
 * @returns {Array<Record<string, any>>} fetch routes.
 */
export function apiRoutes(services) {
  const { service, configStore } = services
  return [
    {
      path: `${API_PREFIX}/list`,
      methods: /** @type {const} */ (['GET']),
      requestBody: 'buffered',
      async fetch() {
        try {
          return ok({ sessions: await service.listSessions(), trash: await service.listTrash() })
        } catch (error) {
          return failure(error)
        }
      },
    },
    {
      path: `${API_PREFIX}/status`,
      methods: /** @type {const} */ (['GET']),
      requestBody: 'buffered',
      async fetch(request) {
        try {
          const sessionId = new URL(request.url).searchParams.get('sessionId')
          if (sessionId === null || sessionId === '') {
            throw new DeleteError('invalid-request', 'sessionId query parameter is required')
          }
          return ok(await service.status(sessionId))
        } catch (error) {
          return failure(error)
        }
      },
    },
    {
      path: `${API_PREFIX}/delete`,
      methods: /** @type {const} */ (['POST']),
      requestBody: 'buffered',
      async fetch(request) {
        try {
          const body = await readObjectBody(request)
          return ok(await service.deleteSession(body.sessionId, { trash: body.trash !== false }))
        } catch (error) {
          return failure(error)
        }
      },
    },
    {
      path: `${API_PREFIX}/restore`,
      methods: /** @type {const} */ (['POST']),
      requestBody: 'buffered',
      async fetch(request) {
        try {
          const body = await readObjectBody(request)
          return ok(await service.restore(body.trashId))
        } catch (error) {
          return failure(error)
        }
      },
    },
    {
      path: `${API_PREFIX}/purge`,
      methods: /** @type {const} */ (['POST']),
      requestBody: 'buffered',
      async fetch(request) {
        try {
          const body = await readObjectBody(request)
          return ok(await service.purge(body.trashId))
        } catch (error) {
          return failure(error)
        }
      },
    },
    {
      path: `${API_PREFIX}/empty-trash`,
      methods: /** @type {const} */ (['POST']),
      requestBody: 'buffered',
      async fetch(request) {
        try {
          await readObjectBody(request)
          return ok(await service.emptyTrash())
        } catch (error) {
          return failure(error)
        }
      },
    },
    {
      path: `${API_PREFIX}/config`,
      methods: /** @type {const} */ (['POST']),
      requestBody: 'buffered',
      async fetch(request) {
        try {
          const body = await readObjectBody(request)
          if (typeof body.patch !== 'object' || body.patch === null || Array.isArray(body.patch)) {
            throw new DeleteError('invalid-request', '"patch" must be an object')
          }
          return ok({ config: await configStore.update(body.patch) })
        } catch (error) {
          return failure(error)
        }
      },
    },
    {
      path: `${API_PREFIX}/state`,
      methods: /** @type {const} */ (['GET']),
      requestBody: 'buffered',
      async fetch() {
        try {
          const sessions = await service.listSessions()
          const trash = await service.listTrash()
          return ok({
            config: configStore.value,
            counts: {
              sessions: sessions.length,
              archived: sessions.filter(row => row.archived).length,
              active: sessions.filter(row => row.active).length,
              trash: trash.length,
              trashBytes: trash.reduce((sum, row) => sum + (row.sizeBytes ?? 0), 0),
            },
          })
        } catch (error) {
          return failure(error)
        }
      },
    },
  ]
}

/**
 * Register the routes while a `connection` service exists; a profile without a
 * Web surface simply never registers them.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @param {{ service: import('./delete.js').DeleteService, configStore: any }} services - plugin services.
 */
export function registerApi(ctx, services) {
  ctx.inject(['connection'], (scoped) => {
    scoped.effect(async () => {
      const disposers = []
      try {
        for (const route of apiRoutes(services)) {
          disposers.push(await scoped.connection.fetch.register(route))
        }
      } catch (error) {
        for (const dispose of disposers) {
          try {
            await dispose()
          } catch {
            // Rollback only.
          }
        }
        throw error
      }
      return async () => {
        for (const dispose of disposers) {
          try {
            await dispose()
          } catch {
            // Unload only.
          }
        }
      }
    }, 'dsh-session-delete: fetch routes')
  })
}
