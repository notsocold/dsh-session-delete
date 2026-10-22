/**
 * Host plugin smoke tests: `apply` registers the authenticated routes, and
 * each route maps its result or failure to the documented envelope.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'
import { apiRoutes } from '../lib/api.js'
import { DEFAULT_CONFIG } from '../lib/config.js'
import { DeleteError } from '../lib/delete.js'

/** A minimal fake service with the surface the routes touch. */
function fakeService(overrides = {}) {
  return {
    listSessions: async () => [{ sessionId: 'session-a', title: 'A', archived: false, active: false }],
    listTrash: async () => [],
    overview: async () => ({
      trash: [],
      config: { ...DEFAULT_CONFIG, trashEnabled: true },
      counts: { trash: 0, trashBytes: 0 },
    }),
    refreshTitles: async ids => Object.fromEntries(ids.map(id => [id, `title:${id}`])),
    invalidate: () => {},
    status: async sessionId => ({ sessionId, busy: false, sizeBytes: 10, trashEnabled: true }),
    deleteSession: async (sessionId, options) => ({ sessionId, deleted: true, trashed: options.trash !== false }),
    restore: async trashId => ({ trashId, restored: true }),
    purge: async trashId => ({ trashId, purged: true }),
    emptyTrash: async () => ({ removed: 2 }),
    ...overrides,
  }
}

/** Build a config store double. */
function fakeConfig(value = {}) {
  return {
    value: { ...DEFAULT_CONFIG, ...value },
    async update(patch) {
      this.value = { ...this.value, ...patch }
      return this.value
    },
  }
}

/** Call one route. */
async function callRoute(routes, path, init) {
  const [routePath, query] = path.split('?')
  const route = routes.find(candidate => candidate.path.endsWith(routePath))
  assert.ok(route, `route ${path} is registered`)
  return route.fetch(new Request(`http://host${route.path}${query === undefined ? '' : `?${query}`}`, init))
}

test('apply registers the authenticated routes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-sd-api-'))
  const routes = []
  const pending = []
  const scoped = {
    effect(fn) {
      const result = fn()
      if (result !== undefined && typeof result.then === 'function') pending.push(result)
      return () => {}
    },
    connection: {
      fetch: {
        register: async (route) => {
          routes.push(route)
          return async () => {}
        },
      },
    },
  }
  const ctx = {
    sessionPersistence: { stat: async () => undefined, list: async () => [] },
    inject(services, callback) {
      assert.deepEqual(services, ['connection'])
      callback(scoped)
    },
    get() {
      return undefined
    },
    waterfall: async () => [],
    emit() {},
    logger: { info() {}, warn() {} },
  }
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    await apply(ctx)
    await Promise.all(pending)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
  assert.equal(routes.length, 9)
  assert.deepEqual(routes.map(route => route.path).sort(), [
    '/api/dsh-session-delete/config',
    '/api/dsh-session-delete/delete',
    '/api/dsh-session-delete/empty-trash',
    '/api/dsh-session-delete/list',
    '/api/dsh-session-delete/purge',
    '/api/dsh-session-delete/restore',
    '/api/dsh-session-delete/state',
    '/api/dsh-session-delete/status',
    '/api/dsh-session-delete/titles',
  ])
})

test('list and state return the success envelope', async () => {
  const routes = apiRoutes({ service: fakeService(), configStore: fakeConfig() })
  const list = await callRoute(routes, '/list')
  assert.equal(list.status, 200)
  const listBody = await list.json()
  assert.equal(listBody.ok, true)
  assert.deepEqual(listBody.value.trash, [])
  assert.equal(listBody.value.config.trashEnabled, true)
  assert.equal(listBody.value.counts.trash, 0)

  const state = await callRoute(routes, '/state')
  const stateBody = await state.json()
  assert.equal(stateBody.ok, true)
  assert.equal(stateBody.value.counts.trash, 0)
  assert.equal(stateBody.value.config.trashEnabled, true)
})

test('list forwards the refresh flag to the overview', async () => {
  let seen = null
  const service = fakeService({
    overview: async options => {
      seen = options
      return { trash: [], config: {}, counts: {} }
    },
  })
  const routes = apiRoutes({ service, configStore: fakeConfig() })
  await callRoute(routes, '/list?refresh=1')
  assert.deepEqual(seen, { force: true })
})

test('titles returns folded titles for the requested ids', async () => {
  const routes = apiRoutes({ service: fakeService(), configStore: fakeConfig() })
  const response = await callRoute(routes, '/titles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids: ['session-a', 'session-b'] }),
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.value.titles['session-a'], 'title:session-a')
  assert.equal(body.value.titles['session-b'], 'title:session-b')
})

test('status requires a session id', async () => {
  const routes = apiRoutes({ service: fakeService(), configStore: fakeConfig() })
  const missing = await callRoute(routes, '/status')
  assert.equal(missing.status, 400)
  const body = await missing.json()
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'invalid-request')

  const present = await callRoute(routes, '/status?sessionId=session-a')
  assert.equal(present.status, 200)
})

test('delete maps a busy refusal to 409', async () => {
  const service = fakeService({
    async deleteSession() {
      throw new DeleteError('session-busy', 'still working')
    },
  })
  const routes = apiRoutes({ service, configStore: fakeConfig() })
  const response = await callRoute(routes, '/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'session-a' }),
  })
  assert.equal(response.status, 409)
  const body = await response.json()
  assert.equal(body.error.code, 'session-busy')
})

test('delete maps a missing session to 404 and passes the trash flag', async () => {
  const seen = []
  const service = fakeService({
    async deleteSession(sessionId, options) {
      seen.push([sessionId, options])
      if (sessionId === 'missing') throw new DeleteError('not-found', 'nope')
      return { sessionId, deleted: true, trashed: options.trash }
    },
  })
  const routes = apiRoutes({ service, configStore: fakeConfig() })
  const missing = await callRoute(routes, '/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'missing' }),
  })
  assert.equal(missing.status, 404)

  const trashed = await callRoute(routes, '/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'session-a', trash: false, title: 'Row title' }),
  })
  assert.equal(trashed.status, 200)
  const last = seen.at(-1)
  assert.equal(last[0], 'session-a')
  assert.equal(last[1].trash, false)
  assert.equal(last[1].title, 'Row title')
})

test('restore, purge and empty-trash reach the service', async () => {
  const routes = apiRoutes({ service: fakeService(), configStore: fakeConfig() })
  const restore = await callRoute(routes, '/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trashId: 't1' }),
  })
  assert.equal((await restore.json()).value.restored, true)

  const purge = await callRoute(routes, '/purge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trashId: 't1' }),
  })
  assert.equal((await purge.json()).value.purged, true)

  const empty = await callRoute(routes, '/empty-trash', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal((await empty.json()).value.removed, 2)
})

test('config rejects a non-object patch and saves a valid one', async () => {
  const configStore = fakeConfig()
  const routes = apiRoutes({ service: fakeService(), configStore })
  const bad = await callRoute(routes, '/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patch: [] }),
  })
  assert.equal(bad.status, 400)

  const good = await callRoute(routes, '/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patch: { trashEnabled: false } }),
  })
  assert.equal(good.status, 200)
  assert.equal((await good.json()).value.config.trashEnabled, false)
})
