/**
 * The delivery engine.
 *
 * The interesting behaviour is what happens when things go wrong or happen too
 * often: a notifier must never throw into the agent loop, and a phone must not
 * be spammed. Both are exercised against real engine code with an injected
 * clock and HTTP client, so the pacing is tested without sleeping.
 *
 * @module dsh-notify-push/test/engine
 */

import { describe, expect, it } from 'vitest'
import type { NotifyPushConfig } from '../src/config.ts'
import { createEngine, type FetchResponse } from '../src/engine.ts'
import { makeEvent } from '../src/format.ts'
import { resolveSettings } from '../src/settings.ts'

/** A successful response. */
function ok(status = 200, text = 'ok'): FetchResponse {
  return { status, ok: status >= 200 && status < 300, text: async () => text }
}

/**
 * Build an engine over a mutable config and a recording HTTP client.
 * @param initial - starting config values.
 * @param respond - optional per-request responder.
 * @returns the engine, the recorded URLs, and clock/config controls.
 */
function harness(initial: Record<string, unknown>, respond?: (url: string) => Promise<FetchResponse>) {
  let clock = 1_000_000
  let config: Record<string, unknown> = {
    provider: 'webhook',
    webhookUrl: 'https://hook.test/x',
    minIntervalMs: 0,
    dedupeWindowMs: 0,
    ...initial,
  }
  const calls: string[] = []
  const logs: string[] = []
  const engine = createEngine({
    settings: () => resolveSettings(config as NotifyPushConfig),
    fetch: async (url) => {
      calls.push(url)
      return respond === undefined ? ok() : await respond(url)
    },
    now: () => clock,
    log: (message) => logs.push(message),
  })
  return {
    engine,
    calls,
    logs,
    advance: (ms: number): void => {
      clock += ms
    },
    set: (patch: Record<string, unknown>): void => {
      config = { ...config, ...patch }
    },
  }
}

const finished = (detail = 'done in 42s') =>
  makeEvent('turn-finished', { host: 'mac', session: 'Fix the login redirect', detail })

describe('delivery', () => {
  it('delivers and counts a success', async () => {
    const { engine, calls } = harness({})
    const entry = await engine.dispatch(finished())
    expect(entry.outcome).toBe('sent')
    expect(entry.status).toBe(200)
    expect(calls).toEqual(['https://hook.test/x'])
    expect(engine.counters()).toEqual({ sent: 1, failed: 0, suppressed: 0 })
  })

  it('records an HTTP failure with the status and a body snippet', async () => {
    const { engine } = harness({}, async () => ok(500, '  upstream   exploded  '))
    const entry = await engine.dispatch(finished())
    expect(entry.outcome).toBe('failed')
    expect(entry.status).toBe(500)
    expect(entry.error).toBe('upstream exploded')
    expect(engine.counters()).toEqual({ sent: 0, failed: 1, suppressed: 0 })
  })

  it('turns a thrown request into a failed row instead of throwing', async () => {
    const { engine } = harness({}, async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    })
    const entry = await engine.dispatch(finished())
    expect(entry.outcome).toBe('failed')
    expect(entry.error).toContain('ENOTFOUND')
  })

  it('fails cleanly when the provider is not configured', async () => {
    const { engine, calls } = harness({ webhookUrl: '' })
    const entry = await engine.dispatch(finished())
    expect(entry.outcome).toBe('failed')
    expect(entry.error).toContain('webhookUrl')
    expect(calls).toEqual([])
  })
})

describe('suppression', () => {
  it('sends nothing while the master switch is off', async () => {
    const { engine, calls } = harness({ enabled: false })
    const entry = await engine.dispatch(finished())
    expect(entry.outcome).toBe('suppressed')
    expect(entry.reason).toBe('disabled')
    expect(calls).toEqual([])
  })

  it('drops an identical event inside the dedupe window', async () => {
    const { engine, calls, advance } = harness({ dedupeWindowMs: 15_000 })
    await engine.dispatch(finished())
    advance(1000)
    const second = await engine.dispatch(finished())
    expect(second.outcome).toBe('suppressed')
    expect(second.reason).toContain('duplicate')
    expect(calls).toHaveLength(1)
  })

  it('lets the same event through once the dedupe window has passed', async () => {
    const { engine, calls, advance } = harness({ dedupeWindowMs: 1000 })
    await engine.dispatch(finished())
    advance(2000)
    expect((await engine.dispatch(finished())).outcome).toBe('sent')
    expect(calls).toHaveLength(2)
  })

  it('does not collapse two different sessions finishing together', async () => {
    const { engine, calls } = harness({ dedupeWindowMs: 15_000 })
    await engine.dispatch(makeEvent('turn-finished', { host: 'mac', session: 'One', detail: 'done in 5s' }))
    await engine.dispatch(makeEvent('turn-finished', { host: 'mac', session: 'Two', detail: 'done in 5s' }))
    expect(calls).toHaveLength(2)
  })

  it('paces a burst of distinct events', async () => {
    const { engine, calls, advance } = harness({ minIntervalMs: 3000 })
    await engine.dispatch(finished('first'))
    advance(500)
    const second = await engine.dispatch(finished('second'))
    expect(second.outcome).toBe('suppressed')
    expect(second.reason).toContain('paced')
    expect(calls).toHaveLength(1)
  })

  it('resumes once the pacing gap has elapsed', async () => {
    const { engine, calls, advance } = harness({ minIntervalMs: 3000 })
    await engine.dispatch(finished('first'))
    advance(4000)
    expect((await engine.dispatch(finished('second'))).outcome).toBe('sent')
    expect(calls).toHaveLength(2)
  })

  it('counts every suppressed event so the panel counters stay honest', async () => {
    const { engine, advance } = harness({ minIntervalMs: 5000 })
    await engine.dispatch(finished('a'))
    advance(10)
    await engine.dispatch(finished('b'))
    advance(10)
    await engine.dispatch(finished('c'))
    expect(engine.counters()).toEqual({ sent: 1, failed: 0, suppressed: 2 })
  })
})

describe('history', () => {
  it('keeps the newest first and honours the cap', async () => {
    const { engine, advance } = harness({ historyLimit: 3, minIntervalMs: 0 })
    for (const detail of ['one', 'two', 'three', 'four']) {
      await engine.dispatch(finished(detail))
      advance(1)
    }
    const entries = engine.history()
    expect(entries).toHaveLength(3)
    expect(entries.map((entry) => entry.body)).toEqual(['four', 'three', 'two'])
  })

  it('hands out a copy, so a caller cannot mutate the log', async () => {
    const { engine } = harness({})
    await engine.dispatch(finished())
    engine.history().push({
      ts: 'x',
      kind: 'test',
      level: 'info',
      title: 'x',
      body: 'x',
      provider: 'webhook',
      outcome: 'sent',
      ms: 0,
    })
    expect(engine.history()).toHaveLength(1)
  })

  it('resets on clear', async () => {
    const { engine } = harness({})
    await engine.dispatch(finished())
    engine.clear()
    expect(engine.history()).toEqual([])
    expect(engine.counters()).toEqual({ sent: 0, failed: 0, suppressed: 0 })
  })
})