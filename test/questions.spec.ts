/**
 * The `user-questions/request` trigger.
 *
 * This is the riskiest listener in the plugin for two reasons, and both are
 * asserted here.
 *
 * 1. **It must delegate.** The event is a waterfall and the answerer that claims
 *    it is the only thing that lets the agent continue, so a listener that
 *    observed and returned early would not merely drop a notification — it would
 *    block the turn forever behind a prompt nobody could reach.
 * 2. **It must be outermost.** A waterfall composes outermost-first and `next()`
 *    walks inwards, but a claimer does not walk at all: it resolves with the
 *    user's answer and the chain stops there. `dsh-api-remotes` is exactly that
 *    answerer and it is registered by the time this plugin loads, so a listener
 *    appended behind it is never invoked. That was a real bug here — the
 *    delivery log stayed empty, which is how it was caught.
 *
 * The harness therefore mirrors Cordis's own `register`/`waterfall` pair rather
 * than just recording that a listener exists: `prepend` unshifts, appending
 * pushes, and the chain stops at the first listener that does not call `next()`.
 * A test that only asserted "a listener is registered" passed while the feature
 * was dead in production.
 *
 * @module dsh-notify-push/test/questions
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { NotifyPushConfig } from '../src/config.ts'
import { apply } from '../src/index.ts'

/** One captured outbound request. */
interface CapturedRequest {
  url: string
  body: string
}

/** One registered listener, with the placement option it was registered under. */
interface Hook {
  callback: (...args: unknown[]) => unknown
  prepend?: boolean
}

/** The hook table, keyed by event name. */
type HookTable = Map<string, Hook[]>

/** Append or prepend a hook, mirroring Cordis's `register()`. */
function addHook(
  hooks: HookTable,
  event: string,
  callback: (...args: unknown[]) => unknown,
  options?: { prepend?: boolean },
): void {
  const list = hooks.get(event) ?? []
  if (options?.prepend === true) list.unshift({ callback, prepend: true })
  else list.push({ callback })
  hooks.set(event, list)
}

/**
 * Mount the real host half and capture its listeners.
 * @param config - plain config values, as a schema-less mount would pass them.
 * @param pre - a listener registered BEFORE the plugin, standing in for a
 *   package that loaded earlier (which is what `dsh-api-remotes` is).
 * @returns the hook table.
 */
function mount(
  config: Record<string, unknown>,
  pre?: { event: string; callback: (...args: unknown[]) => unknown },
): HookTable {
  const hooks: HookTable = new Map()
  const ctx = {
    logger: { info() {}, warn() {}, debug() {}, error() {} },
    get: () => undefined,
    effect: (callback: () => (() => void) | void) => {
      callback()
    },
    on: (
      event: string,
      handler: (...args: unknown[]) => unknown,
      options?: { prepend?: boolean },
    ) => {
      addHook(hooks, event, handler, options)
      return () => {}
    },
    webServer: { register: () => () => {} },
  } as unknown as Context

  if (pre !== undefined) addHook(hooks, pre.event, pre.callback)
  apply(ctx, config as NotifyPushConfig)
  return hooks
}

/** The first registered listener for an event. */
function listenerFor(hooks: HookTable, event: string): (...args: unknown[]) => unknown {
  const hook = hooks.get(event)?.[0]
  if (hook === undefined) throw new Error(`no listener registered for ${event}`)
  return hook.callback
}

/**
 * Run a waterfall the way Cordis does: outermost-first, stopping at the first
 * listener that does not call `next()`.
 * @param hooks - the hook table.
 * @param event - event name.
 * @param request - the dispatch argument.
 * @param inner - the fallback used when the chain is exhausted.
 * @returns the outermost listener's result.
 */
function runWaterfall(
  hooks: HookTable,
  event: string,
  request: unknown,
  inner: () => unknown,
): unknown {
  const callbacks = (hooks.get(event) ?? []).map((hook) => hook.callback)
  const next = (): unknown => {
    const callback = callbacks.shift()
    return callback === undefined ? inner() : callback(request, next)
  }
  return next()
}

/** Stub `fetch` and collect what was sent. */
function captureRequests(): CapturedRequest[] {
  const sent: CapturedRequest[] = []
  vi.stubGlobal('fetch', async (url: unknown, init: { body?: string }) => {
    sent.push({ url: String(url), body: init.body ?? '' })
    return { status: 200, ok: true, text: async () => 'ok' }
  })
  return sent
}

/**
 * Wait for at least one captured request.
 * @param sent - the capture buffer.
 * @returns the first captured request.
 */
async function waitForRequest(sent: CapturedRequest[]): Promise<CapturedRequest> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const first = sent[0]
    if (first !== undefined) return first
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('no request was delivered')
}

/** A question batch shaped like the real request payload. */
const batch = {
  questions: [
    {
      id: 'q1',
      header: 'Choose Mode',
      question: 'Which deployment should I target?',
      options: [{ label: 'Blue' }, { label: 'Green' }],
    },
  ],
}

/** Config that delivers to a stub, with pacing and de-duplication out of the way. */
const delivering = {
  provider: 'webhook',
  webhookUrl: 'https://example.test/hook',
  minIntervalMs: 0,
  dedupeWindowMs: 0,
}

/**
 * An answerer like `dsh-api-remotes`: it claims the request and resolves with
 * the answer, never calling `next()`.
 * @param onClaim - called when the claim happens.
 * @returns the listener.
 */
function claimingAnswerer(onClaim: () => void): (...args: unknown[]) => unknown {
  return () => {
    onClaim()
    return { answers: [{ id: 'q1', selected: ['Blue'] }] }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the question waterfall is never claimed', () => {
  it('delegates to the real answerer and returns its result', () => {
    const hooks = mount({ enabled: false })
    const handler = listenerFor(hooks, 'user-questions/request')

    let reached = false
    const result = handler(batch, () => {
      reached = true
      return { answers: [{ id: 'q1', selected: ['Blue'] }] }
    })

    expect(reached).toBe(true)
    expect(result).toEqual({ answers: [{ id: 'q1', selected: ['Blue'] }] })
  })

  it('delegates even when it decides not to notify', () => {
    const hooks = mount({ enabled: false, notifyOnQuestion: false })
    let reached = false
    listenerFor(hooks, 'user-questions/request')(batch, () => {
      reached = true
    })
    expect(reached).toBe(true)
  })

  it('delegates without throwing on a malformed payload', () => {
    const hooks = mount({ enabled: false })
    let reached = false
    expect(() =>
      listenerFor(hooks, 'user-questions/request')({}, () => {
        reached = true
      }),
    ).not.toThrow()
    expect(reached).toBe(true)
  })
})

describe('an answerer that registered first does not starve the observer', () => {
  it('registers the question listener outermost', () => {
    const hooks = mount({ enabled: false })
    // `prepend` is what makes the listener run before the claimer; without it
    // this entry sits behind the claim and is never invoked.
    expect(hooks.get('user-questions/request')?.[0]?.prepend).toBe(true)
  })

  it('registers the approval listener outermost too', () => {
    const hooks = mount({ enabled: false })
    expect(hooks.get('approval/request')?.[0]?.prepend).toBe(true)
  })

  it('notifies and still lets the claimer answer, with the claimer registered first', async () => {
    const sent = captureRequests()
    let claimed = false
    // The claimer goes in before the plugin loads, exactly as dsh-api-remotes
    // does in a real composition.
    const hooks = mount(delivering, {
      event: 'user-questions/request',
      callback: claimingAnswerer(() => {
        claimed = true
      }),
    })

    const result = runWaterfall(hooks, 'user-questions/request', batch, () => {
      throw new Error('NO_PROVIDER — the chain never reached the claimer')
    })

    // The claimer still owns the outcome...
    expect(claimed).toBe(true)
    expect(result).toEqual({ answers: [{ id: 'q1', selected: ['Blue'] }] })
    // ...and the observation happened anyway. This is the regression: with the
    // listener appended rather than prepended, `sent` stays empty and the
    // delivery log shows nothing at all.
    const payload = JSON.parse((await waitForRequest(sent)).body) as Record<string, unknown>
    expect(payload.kind).toBe('question-asked')
  })
})

describe('the notification carries the question', () => {
  it('puts the question, its heading and the choices in the body', async () => {
    const sent = captureRequests()
    const hooks = mount(delivering)

    listenerFor(hooks, 'user-questions/request')(batch, () => {})
    const request = await waitForRequest(sent)
    const payload = JSON.parse(request.body) as Record<string, unknown>

    expect(request.url).toBe('https://example.test/hook')
    expect(payload.kind).toBe('question-asked')
    expect(payload.level).toBe('warn')
    expect(String(payload.title).startsWith('Question asked · ')).toBe(true)
    expect(payload.body).toBe('Choose Mode — Which deployment should I target?\nBlue · Green')
  })

  it('notes a batch larger than the one it quotes', async () => {
    const sent = captureRequests()
    const hooks = mount(delivering)

    listenerFor(hooks, 'user-questions/request')(
      { questions: [{ id: 'q1', question: 'First?' }, { id: 'q2', question: 'Second?' }] },
      () => {},
    )
    const payload = JSON.parse((await waitForRequest(sent)).body) as Record<string, unknown>
    expect(payload.body).toContain('First?')
    expect(payload.body).toContain('(+1 more)')
  })

  it('truncates a very long question rather than letting the OS cut it', async () => {
    const sent = captureRequests()
    const hooks = mount(delivering)

    listenerFor(hooks, 'user-questions/request')(
      { questions: [{ id: 'q1', question: 'x'.repeat(600) }] },
      () => {},
    )
    const payload = JSON.parse((await waitForRequest(sent)).body) as Record<string, unknown>
    const body = String(payload.body)
    expect(body.length).toBeLessThan(300)
    expect(body.endsWith('…')).toBe(true)
  })

  it('still says something useful when the batch is empty', async () => {
    const sent = captureRequests()
    const hooks = mount(delivering)

    listenerFor(hooks, 'user-questions/request')({ questions: [] }, () => {})
    const payload = JSON.parse((await waitForRequest(sent)).body) as Record<string, unknown>
    expect(payload.body).toBe('the agent is waiting on an answer')
  })

  it('sends nothing when the trigger is off, but still delegates', async () => {
    const sent = captureRequests()
    const hooks = mount({ ...delivering, notifyOnQuestion: false })

    let reached = false
    listenerFor(hooks, 'user-questions/request')(batch, () => {
      reached = true
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(reached).toBe(true)
    expect(sent).toHaveLength(0)
  })
})