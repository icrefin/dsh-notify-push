/**
 * The status payload, built by the real `apply()` and read through the real
 * route handler.
 *
 * This spec exists because of a reported bug: the panel had **no way to read the
 * full ntfy topic**, so there was nothing to type into the phone app. The topic
 * was masked everywhere as a secret — correct for a publish token, wrong for a
 * subscription identifier.
 *
 * The fix is a `subscribe` field that carries the topic verbatim while `target`
 * stays masked, and the assertions below pin both halves of that decision: the
 * topic must be complete, and the masked summary must not leak it.
 *
 * @module dsh-notify-push/test/status
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { NotifyPushConfig } from '../src/config.ts'
import { apply } from '../src/index.ts'
import { API, type StatusPayload } from '../src/protocol.ts'
import { packageVersion } from '../src/version.ts'

/** A topic long enough that masking actually hides something. */
const TOPIC = 'dsh-0123456789abcdef0123456789abcdef'

/**
 * Mount the real host half on a fake context and capture its routes.
 * @param config - plain config values, as a schema-less mount would pass them.
 * @returns the routes the plugin registered.
 */
function mount(config: Record<string, unknown>, services: { settings?: unknown } = {}): WebRoute[] {
  const routes: WebRoute[] = []
  const ctx = {
    logger: { info() {}, warn() {}, debug() {}, error() {} },
    // Mirrors the real seam: `ctx.get` is how the host half looks up the
    // optional settings service, so a deployment without one returns undefined.
    get: (name: string) => (name === 'settings' ? services.settings : undefined),
    effect: (callback: () => (() => void) | void) => {
      callback()
    },
    on: () => () => {},
    webServer: {
      register: (route: WebRoute) => {
        routes.push(route)
        return () => {}
      },
    },
  } as unknown as Context
  apply(ctx, config as NotifyPushConfig)
  return routes
}

/**
 * Drive the status route over a loopback-shaped request double.
 * @param routes - the mounted routes.
 * @returns the HTTP status and the parsed payload.
 */
async function readStatus(routes: WebRoute[]): Promise<{ status: number; payload: StatusPayload }> {
  const route = routes.find((candidate) => candidate.path === API.status)
  if (route === undefined) throw new Error('the status route was not registered')
  let status = 0
  let body = ''
  const req = {
    method: 'GET',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage
  const res = {
    writeHead(code: number) {
      status = code
    },
    end(text?: string) {
      body = text ?? ''
    },
  } as unknown as ServerResponse
  await route.handler(req, res)
  return { status, payload: JSON.parse(body) as StatusPayload }
}

describe('the ntfy topic is readable from the panel', () => {
  it('reports the full topic, so the phone can be subscribed', async () => {
    const { status, payload } = await readStatus(
      mount({ provider: 'ntfy', ntfyServer: 'https://ntfy.sh', ntfyTopic: TOPIC }),
    )
    expect(status).toBe(200)
    expect(payload.subscribe).toEqual({ server: 'https://ntfy.sh', topic: TOPIC })
    // The whole point: nothing truncated or elided.
    expect(payload.subscribe?.topic).toBe(TOPIC)
    expect(payload.subscribe?.topic).not.toContain('…')
  })

  it('keeps the masked summary masked', async () => {
    const { payload } = await readStatus(
      mount({ provider: 'ntfy', ntfyServer: 'https://ntfy.sh', ntfyTopic: TOPIC }),
    )
    // Two different jobs: `target` is the log-friendly summary, `subscribe` is
    // the string the user retypes. Only the second may carry the topic.
    expect(payload.target).not.toContain(TOPIC)
    expect(payload.target).toContain('…')
  })

  it('normalizes a trailing slash off the server it reports', async () => {
    const { payload } = await readStatus(
      mount({ provider: 'ntfy', ntfyServer: 'https://ntfy.example.com/', ntfyTopic: TOPIC }),
    )
    expect(payload.subscribe?.server).toBe('https://ntfy.example.com')
  })

  it('offers nothing to subscribe to before a topic is set', async () => {
    const { payload } = await readStatus(mount({ provider: 'ntfy', ntfyServer: 'https://ntfy.sh' }))
    expect(payload.subscribe).toBeUndefined()
    expect(payload.configured).toBe(false)
  })

  it('offers nothing to subscribe to on a backend that has no topic', async () => {
    const { payload } = await readStatus(
      mount({ provider: 'webhook', webhookUrl: 'https://example.test/hook' }),
    )
    expect(payload.configured).toBe(true)
    expect(payload.subscribe).toBeUndefined()
  })
})

describe('the rest of the status payload', () => {
  it('reports the three facts the notification carries', async () => {
    const { payload } = await readStatus(mount({ provider: 'ntfy', ntfyTopic: TOPIC }))
    expect(payload.sample.title).not.toBe('')
    expect(payload.sample.body).toContain('\n')
    // The event type leads the title, so the sample matches a real one.
    expect(payload.sample.title.startsWith('Agent finished')).toBe(true)
  })

  it('carries the topic in exactly the two places it is needed, and nowhere else', async () => {
    const { payload } = await readStatus(mount({ provider: 'ntfy', ntfyTopic: TOPIC }))

    // Deliberate: `subscribe` is what the user types into the phone, and the
    // form's own `ntfyTopic` field is what prefills that input. Both are the
    // same value, and both are required for the page to be usable.
    expect(payload.subscribe?.topic).toBe(TOPIC)
    expect(payload.fields.find((field) => field.key === 'ntfyTopic')?.value).toBe(TOPIC)

    // Everywhere else it must not appear — least of all in the masked summary.
    const withoutTheTwo = JSON.stringify({
      ...payload,
      subscribe: undefined,
      fields: payload.fields.map((field) =>
        field.key === 'ntfyTopic' ? { ...field, value: undefined } : field,
      ),
    })
    expect(withoutTheTwo).not.toContain(TOPIC)
    expect(payload.target).toContain('…')
  })

  it('leaves the other providers secret values out of the form descriptors', async () => {
    const { payload } = await readStatus(
      mount({ provider: 'bark', barkKey: 'EXAMPLE-BARK-KEY' }),
    )
    // A secret is described, never valued — the panel only learns that one exists.
    const key = payload.fields.find((field) => field.key === 'barkKey')
    expect(key?.kind).toBe('secret')
    expect(key?.set).toBe(true)
    expect(JSON.stringify(payload)).not.toContain('EXAMPLE-BARK-KEY')
  })
})

describe('the version chip', () => {
  it('reports the version of the build that actually answered', async () => {
    const { payload } = await readStatus(mount({ provider: 'ntfy', ntfyTopic: TOPIC }))
    // Equal to the manifest on disk, because the whole point of reading it at
    // runtime is that a stale process reports the stale version.
    expect(payload.version).toBe(packageVersion())
    expect(payload.version).not.toBe('unknown')
    expect(payload.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('is present even when nothing is configured, so the chip always renders', async () => {
    const { payload } = await readStatus(mount({}))
    expect(payload.configured).toBe(false)
    expect(payload.version).toBe(packageVersion())
  })
})

/**
 * Drive any route, optionally with a JSON body.
 *
 * The config route reads its request as an async stream (`for await … of req`),
 * so the request double is an async iterable rather than a plain object with a
 * body property — anything simpler would pass a test the real route would fail.
 *
 * @param routes - the mounted routes.
 * @param path - route path.
 * @param method - HTTP method.
 * @param body - optional JSON body text.
 * @returns the response status and the parsed body.
 */
async function callRoute(
  routes: WebRoute[],
  path: string,
  method: string,
  body?: string,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const route = routes.find((candidate) => candidate.path === path)
  if (route === undefined) throw new Error(`route ${path} was not registered`)
  let status = 0
  let text = ''
  const req = {
    method,
    headers: body === undefined ? {} : { 'content-length': String(Buffer.byteLength(body)) },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(body)
    },
  } as unknown as IncomingMessage
  const res = {
    writeHead(code: number) {
      status = code
    },
    end(chunk?: string) {
      text = chunk ?? ''
    },
  } as unknown as ServerResponse
  await route.handler(req, res)
  return { status, payload: (text === '' ? {} : JSON.parse(text)) as Record<string, unknown> }
}

describe('the configuration form', () => {
  it('says it cannot save when the composition has no settings service', async () => {
    const { payload } = await readStatus(mount({ provider: 'ntfy' }))
    expect(payload.canEdit).toBe(false)
    // The fields are still described, so the form renders and can explain
    // itself rather than the section vanishing.
    expect(payload.fields.length).toBeGreaterThan(0)
  })

  it('says it can save when the settings service is present', async () => {
    const { payload } = await readStatus(mount({ provider: 'ntfy' }, { settings: { update: async () => {} } }))
    expect(payload.canEdit).toBe(true)
  })
})

describe('saving takes effect without a restart', () => {
  it('writes to the row namespace and reflects the value immediately', async () => {
    // A plain mutable object stands in for the live volatile config, so
    // assigning a patch here is exactly what the loader does to the fiber.
    const config: Record<string, unknown> = { provider: 'ntfy', ntfyServer: 'https://ntfy.sh' }
    const namespaces: string[] = []
    const routes = mount(config, {
      settings: {
        update: async (ns: string, patch: Record<string, unknown>) => {
          namespaces.push(ns)
          Object.assign(config, patch)
        },
      },
    })

    const before = await readStatus(routes)
    expect(before.payload.configured).toBe(false)
    expect(before.payload.subscribe).toBeUndefined()

    const saved = await callRoute(routes, API.config, 'POST', JSON.stringify({ patch: { ntfyTopic: TOPIC } }))
    expect(saved.status).toBe(200)
    // The row id doubles as the settings namespace.
    expect(namespaces).toEqual(['dsh-notify-push'])
    // The response to the write already carries the new value...
    expect((saved.payload as unknown as StatusPayload).subscribe?.topic).toBe(TOPIC)
    // ...and so does a later read, with no re-mount and no re-apply.
    const after = await readStatus(routes)
    expect(after.payload.subscribe?.topic).toBe(TOPIC)
    expect(after.payload.configured).toBe(true)
  })

  it('refuses an unroutable setting without touching the live config', async () => {
    const config: Record<string, unknown> = { provider: 'ntfy', ntfyTopic: TOPIC }
    const routes = mount(config, { settings: { update: async () => {} } })
    const refused = await callRoute(routes, API.config, 'POST', JSON.stringify({ patch: { nope: 'x' } }))
    expect(refused.status).toBe(400)
    expect(config.nope).toBeUndefined()
  })
})