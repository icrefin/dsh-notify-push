/**
 * The host half's route family, served from a real loopback HTTP server and
 * driven with `fetch`. Nothing about the handlers is stubbed: the fences, the
 * status codes and the payload shape are the shipped code's own. Only the
 * `RouteApi` behind them is a fake, which is what lets the test assert that the
 * test route actually reached the delivery path.
 *
 * The loopback fence itself is not covered here: a request served over
 * `127.0.0.1` is by definition a loopback request, so the 403 branch needs a
 * non-loopback peer, which this harness cannot produce. The method and
 * body-size branches of the same `admit()` are covered.
 *
 * @module dsh-notify-push/test/routes
 */

import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { makeEvent } from '../src/format.ts'
import {
  API,
  type HistoryEntry,
  type HistoryPayload,
  type StatusPayload,
  type TestPayload,
} from '../src/protocol.ts'
import { makeRoutes, type RouteApi } from '../src/routes.ts'

/** The event the fake delivery path reports having sent. */
const sentEvent = makeEvent('test', { host: 'mac', detail: 'if you can read this, delivery works' })

/** The history row the fake delivery path reports. */
const sentEntry: HistoryEntry = {
  ts: sentEvent.ts,
  kind: 'test',
  level: 'info',
  title: 'Test notification · mac',
  body: sentEvent.detail,
  provider: 'ntfy',
  outcome: 'sent',
  status: 200,
  ms: 12,
}

/** The status the fake route family reports. */
const status: StatusPayload = {
  id: 'dsh-notify-push',
  version: '0.2.0',
  enabled: true,
  provider: 'ntfy',
  configured: true,
  target: 'https://ntfy.sh → topic su…ic',
  host: 'mac',
  triggers: { idle: true, error: true, approval: false, question: true },
  sample: { title: 'Agent finished · mac', body: 'Fix the login redirect\ndone in 42s' },
  counters: { sent: 3, failed: 1, suppressed: 2 },
  fields: [
    { key: 'provider', kind: 'select', group: 'common', value: 'ntfy', options: ['ntfy', 'bark'] },
    { key: 'ntfyTopic', kind: 'text', group: 'ntfy', value: 'sub-…ic' },
    { key: 'ntfyToken', kind: 'secret', group: 'ntfy', set: true },
  ],
  canEdit: true,
  time: '2026-10-04T12:00:00.000Z',
}

/** How many times the fake test route was asked to deliver. */
let testCalls = 0

/** Every patch the fake config route was asked to save. */
const savedPatches: Array<Record<string, string | number | boolean>> = []

const api: RouteApi = {
  status: () => status,
  history: () => [sentEntry],
  test: async (): Promise<TestPayload> => {
    testCalls += 1
    return { event: sentEvent, entry: sentEntry }
  },
  saveConfig: async (patch): Promise<StatusPayload> => {
    savedPatches.push(patch)
    return status
  },
}

/** Minimal host context: the route family only reads `logger`. */
const ctx = {
  logger: { debug() {}, info() {}, warn() {}, error() {} },
} as unknown as Context

const routes = makeRoutes(ctx, api)

let server: Server
let origin: string

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    const route = routes.find((candidate) => candidate.path === path)
    if (route === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    void route.handler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the test server bound no TCP port')
  origin = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('GET API.status', () => {
  it('answers the delivery state', async () => {
    const response = await fetch(`${origin}${API.status}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const payload = (await response.json()) as StatusPayload
    expect(payload.id).toBe('dsh-notify-push')
    expect(payload.provider).toBe('ntfy')
    expect(payload.configured).toBe(true)
    expect(payload.triggers).toEqual({ idle: true, error: true, approval: false, question: true })
    expect(payload.counters).toEqual({ sent: 3, failed: 1, suppressed: 2 })
  })

  it('rejects a method the route does not own', async () => {
    const response = await fetch(`${origin}${API.status}`, { method: 'POST' })
    expect(response.status).toBe(405)
    const payload = (await response.json()) as { error: string }
    expect(payload.error).toContain('method not allowed')
  })
})

describe('GET API.history', () => {
  it('answers the delivery log', async () => {
    const response = await fetch(`${origin}${API.history}`)
    expect(response.status).toBe(200)
    const payload = (await response.json()) as HistoryPayload
    expect(payload.entries).toHaveLength(1)
    expect(payload.entries[0]?.outcome).toBe('sent')
  })
})

describe('POST API.test', () => {
  it('drives a real delivery and returns both the event and its result', async () => {
    const before = testCalls
    const response = await fetch(`${origin}${API.test}`, { method: 'POST' })
    expect(response.status).toBe(200)
    const payload = (await response.json()) as TestPayload
    expect(testCalls).toBe(before + 1)
    expect(payload.event.kind).toBe('test')
    expect(payload.entry.outcome).toBe('sent')
  })

  it('rejects a GET, because a test send is a mutation', async () => {
    const before = testCalls
    const response = await fetch(`${origin}${API.test}`)
    expect(response.status).toBe(405)
    expect(testCalls).toBe(before)
  })
})

describe('POST API.config', () => {
  const post = (body: string): Promise<Response> =>
    fetch(`${origin}${API.config}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })

  it('saves a validated patch and answers with the fresh status', async () => {
    const before = savedPatches.length
    const response = await post(JSON.stringify({ patch: { ntfyTopic: 'a-new-topic' } }))
    expect(response.status).toBe(200)
    expect(savedPatches.length).toBe(before + 1)
    expect(savedPatches[before]).toEqual({ ntfyTopic: 'a-new-topic' })
    const payload = (await response.json()) as StatusPayload
    expect(payload.id).toBe('dsh-notify-push')
    expect(payload.fields.length).toBeGreaterThan(0)
  })

  it('refuses an unknown setting before anything is written', async () => {
    const before = savedPatches.length
    const response = await post(JSON.stringify({ patch: { notARealSetting: 'x' } }))
    expect(response.status).toBe(400)
    expect((await response.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining('notARealSetting'),
    })
    expect(savedPatches.length).toBe(before)
  })

  it('refuses a value of the wrong type', async () => {
    const response = await post(JSON.stringify({ patch: { enabled: 'yes' } }))
    expect(response.status).toBe(400)
    expect((await response.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining('true or false'),
    })
  })

  it('refuses a provider the build does not know', async () => {
    const response = await post(JSON.stringify({ patch: { provider: 'carrier-pigeon' } }))
    expect(response.status).toBe(400)
  })

  it('refuses an empty patch', async () => {
    const response = await post(JSON.stringify({ patch: {} }))
    expect(response.status).toBe(400)
    expect((await response.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining('empty'),
    })
  })

  it('refuses a body that is not JSON', async () => {
    const response = await post('not json at all')
    expect(response.status).toBe(400)
  })

  it('refuses a request with no body at all', async () => {
    const response = await fetch(`${origin}${API.config}`, { method: 'POST' })
    expect(response.status).toBe(400)
  })

  it('rejects a GET, because a config write is a mutation', async () => {
    const before = savedPatches.length
    const response = await fetch(`${origin}${API.config}`)
    expect(response.status).toBe(405)
    expect(savedPatches.length).toBe(before)
  })

  it('surfaces a refused write as a conflict, not a success', async () => {
    const failing: RouteApi = {
      ...api,
      saveConfig: async () => {
        throw new Error('this composition has no settings service, so the value cannot be saved')
      },
    }
    const failingCtx = {
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    } as unknown as Context
    const failingRoutes = makeRoutes(failingCtx, failing)
    const route = failingRoutes.find((candidate) => candidate.path === API.config)
    expect(route).toBeDefined()

    const server = createServer((req, res) => {
      void route?.handler(req, res)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no port bound')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}${API.config}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patch: { enabled: false } }),
      })
      expect(response.status).toBe(409)
      expect((await response.json()) as { error: string }).toMatchObject({
        error: expect.stringContaining('settings service'),
      })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('unknown paths', () => {
  it('fall through to the host, which has no such route', async () => {
    const response = await fetch(`${origin}/api/dsh-notify-push/nope`)
    expect(response.status).toBe(404)
  })
})