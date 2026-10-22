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
      async fetch(request) {
        try {
          const force = new URL(request.url).searchParams.get('refresh') === '1'
          return ok(await service.overview({ force }))
        } catch (error) {
          return failure(error)
        }
      },
    },
    {
      path: `${API_PREFIX}/titles`,
      methods: /** @type {const} */ (['POST']),
      requestBody: 'buffered',
      async fetch(request) {
        try {
          const body = await readObjectBody(request)
          const ids = Array.isArray(body.ids) ? body.ids.slice(0, 500) : []
          return ok({ titles: await service.refreshTitles(ids) })
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
          const config = await configStore.update(body.patch)
          if (typeof service.invalidate === 'function') service.invalidate()
          return ok({ config })
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
          const view = await service.overview()
          return ok({ config: view.config, counts: view.counts })
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
