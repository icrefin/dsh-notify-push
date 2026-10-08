/**
 * Request building for every backend.
 *
 * The load-bearing assertions here are the ones that were expensive to learn:
 * ntfy parses a JSON body **only at the server root**, so the publish URL must
 * be `{server}/` and must never contain the topic — posting JSON to
 * `{server}/{topic}` is accepted with HTTP 200 and puts the raw JSON blob on
 * the lock screen. That is a silent failure, so it gets a regression test.
 *
 * The second theme is leakage: a token or device key may appear in the request
 * but never in the `summary` the panel and the log are allowed to see.
 *
 * @module dsh-notify-push/test/providers
 */

import { describe, expect, it } from 'vitest'
import type { NotifyPushConfig } from '../src/config.ts'
import { makeEvent } from '../src/format.ts'
import { buildRequest, inspect, maskSecret } from '../src/providers.ts'
import { resolveSettings } from '../src/settings.ts'

/** Resolve a config from plain values, the way `apply()` would. */
function settings(values: Record<string, unknown>) {
  return resolveSettings(values as NotifyPushConfig)
}

const event = makeEvent('turn-finished', {
  host: 'mac',
  session: 'Fix the login redirect',
  detail: 'done in 42s',
})

describe('ntfy', () => {
  it('refuses to plan without a topic', () => {
    expect(inspect(settings({ provider: 'ntfy', ntfyServer: 'https://ntfy.sh' })).configured).toBe(false)
  })

  it('publishes JSON to the server ROOT, never to the topic path', () => {
    const built = buildRequest(settings({ provider: 'ntfy', ntfyServer: 'https://ntfy.sh', ntfyTopic: 'my-topic' }), event)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    // The regression: `https://ntfy.sh/my-topic` would make ntfy treat the JSON
    // as the message text.
    expect(built.request.url).toBe('https://ntfy.sh/')
    expect(built.request.url).not.toContain('my-topic')
    const body = JSON.parse(built.request.init.body) as Record<string, unknown>
    expect(body.topic).toBe('my-topic')
    expect(body.title).toBe('Agent finished · mac')
    expect(body.message).toBe('Fix the login redirect\ndone in 42s')
    expect(body.priority).toBe(3)
    expect(body.tags).toEqual(['white_check_mark'])
  })

  it('strips a trailing slash from a self-hosted base URL', () => {
    const built = buildRequest(
      settings({ provider: 'ntfy', ntfyServer: 'https://ntfy.example.com/', ntfyTopic: 't' }),
      event,
    )
    expect(built.ok).toBe(true)
    if (built.ok) expect(built.request.url).toBe('https://ntfy.example.com/')
  })

  it('sends the access token as a bearer credential', () => {
    const built = buildRequest(
      settings({ provider: 'ntfy', ntfyTopic: 't', ntfyToken: 'EXAMPLE-NOT-A-REAL-TOKEN' }),
      event,
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.request.init.headers.authorization).toBe('Bearer EXAMPLE-NOT-A-REAL-TOKEN')
  })

  it('raises priority with urgency', () => {
    const config = settings({ provider: 'ntfy', ntfyTopic: 't' })
    const urgent = makeEvent('agent-error', { host: 'mac', detail: 'boom' })
    const built = buildRequest(config, urgent)
    expect(built.ok).toBe(true)
    if (built.ok) expect((JSON.parse(built.request.init.body) as { priority: number }).priority).toBe(5)
  })

  it('keeps the topic out of the summary it reports', () => {
    const config = settings({ provider: 'ntfy', ntfyTopic: 'super-secret-topic' })
    expect(inspect(config).target).not.toContain('super-secret-topic')
  })
})

describe('bark', () => {
  it('posts to /push with the device key in the body', () => {
    const built = buildRequest(settings({ provider: 'bark', barkKey: 'DEVICEKEY123' }), event)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.request.url).toBe('https://api.day.app/push')
    const body = JSON.parse(built.request.init.body) as Record<string, unknown>
    expect(body.device_key).toBe('DEVICEKEY123')
    expect(body.title).toBe('Agent finished · mac')
    expect(body.body).toBe('Fix the login redirect\ndone in 42s')
    // An urgent event is allowed to break through Focus.
    expect(body.level).toBe('active')
  })

  it('uses timeSensitive for an approval request', () => {
    const approval = makeEvent('approval-needed', { host: 'mac', detail: 'bash' })
    const built = buildRequest(settings({ provider: 'bark', barkKey: 'k' }), approval)
    expect(built.ok).toBe(true)
    if (built.ok) expect((JSON.parse(built.request.init.body) as { level: string }).level).toBe('timeSensitive')
  })

  it('honours an explicit level override', () => {
    const built = buildRequest(settings({ provider: 'bark', barkKey: 'k', barkLevel: 'passive' }), event)
    expect(built.ok).toBe(true)
    if (built.ok) expect((JSON.parse(built.request.init.body) as { level: string }).level).toBe('passive')
  })

  it('refuses to plan without a key', () => {
    expect(inspect(settings({ provider: 'bark' })).configured).toBe(false)
  })
})

describe('gotify', () => {
  it('carries the token in the query and the text in the body', () => {
    const built = buildRequest(
      settings({ provider: 'gotify', gotifyServer: 'https://gotify.example.com/', gotifyToken: 'APPTOKEN' }),
      event,
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.request.url).toBe('https://gotify.example.com/message?token=APPTOKEN')
    const body = JSON.parse(built.request.init.body) as Record<string, unknown>
    expect(body.message).toBe('Fix the login redirect\ndone in 42s')
    expect(body.priority).toBe(2)
  })

  it('requires both the server and the token', () => {
    expect(inspect(settings({ provider: 'gotify', gotifyServer: 'https://g.example.com' })).configured).toBe(false)
    expect(inspect(settings({ provider: 'gotify', gotifyToken: 't' })).configured).toBe(false)
  })
})

describe('telegram', () => {
  it('joins title and body into one text field', () => {
    const built = buildRequest(
      settings({ provider: 'telegram', telegramBotToken: 'BOT', telegramChatId: '42' }),
      event,
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.request.url).toBe('https://api.telegram.org/botBOT/sendMessage')
    const body = JSON.parse(built.request.init.body) as Record<string, unknown>
    expect(body.text).toBe('Agent finished · mac\nFix the login redirect\ndone in 42s')
    expect(body.chat_id).toBe('42')
  })

  it('keeps the bot token out of the summary', () => {
    const config = settings({ provider: 'telegram', telegramBotToken: '123456:AAsecrettoken', telegramChatId: '42' })
    expect(inspect(config).target).not.toContain('AAsecrettoken')
  })
})

describe('generic webhook', () => {
  it('sends the resolved text plus the raw fields', () => {
    const built = buildRequest(settings({ provider: 'webhook', webhookUrl: 'https://example.test/hook' }), event)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const body = JSON.parse(built.request.init.body) as Record<string, unknown>
    expect(body.text).toBe('Agent finished · mac\nFix the login redirect\ndone in 42s')
    expect(body.content).toBe(body.text)
    expect(body.kind).toBe('turn-finished')
    expect(body.host).toBe('mac')
    expect(body.session).toBe('Fix the login redirect')
  })

  it('rejects a URL that is not http(s)', () => {
    expect(inspect(settings({ provider: 'webhook', webhookUrl: 'ftp://example.test' })).configured).toBe(false)
  })
})

describe('provider selection', () => {
  it('names an unknown provider in the problem it reports', () => {
    const result = inspect(settings({ provider: 'ntfyy', ntfyTopic: 't' }))
    expect(result.configured).toBe(false)
    expect(result.problem).toContain('ntfyy')
  })

  it('reports nothing configured by default, so installing is inert', () => {
    expect(inspect(settings({})).configured).toBe(false)
  })
})

describe('maskSecret', () => {
  it('keeps a long secret recognisable but unusable', () => {
    const masked = maskSecret('super-secret-topic')
    expect(masked).toContain('…')
    expect(masked).not.toBe('super-secret-topic')
    expect(masked.length).toBeLessThan('super-secret-topic'.length)
  })

  it('fully hides a short secret', () => {
    expect(maskSecret('abc')).toBe('••••')
  })

  it('says so when nothing is set', () => {
    expect(maskSecret('   ')).toBe('(unset)')
  })
})