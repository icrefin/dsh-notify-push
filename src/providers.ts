/**
 * The delivery backends.
 *
 * Each provider is a {@link plan} function that either refuses with a
 * human-readable reason or returns a {@link ProviderPlan}: a secret-free
 * description of the destination plus a way to build the HTTP request for one
 * event. Both `inspect()` (the status route) and `buildRequest()` (the delivery
 * path) go through the same plan, so a provider can never report itself
 * "configured" and then fail for a reason it already knew about.
 *
 * ## The ntfy detail worth knowing
 *
 * ntfy parses a JSON body **only at the server root**. `POST {server}/{topic}`
 * with a JSON body is accepted with HTTP 200 and the whole blob is used as the
 * message text — verified against ntfy.sh — so a topic-URL publish shows the
 * raw JSON on the lock screen. Every JSON publish here therefore targets
 * `{server}/` and carries `topic` in the body.
 *
 * ## What never leaves this module
 *
 * `summary` is what the status route and the log are allowed to see. Tokens and
 * device keys are masked before they get anywhere near it, and the request
 * headers/body that do carry a secret are never logged.
 *
 * @module dsh-notify-push/providers
 */

import { bodyOf, titleOf } from './format.ts'
import type { Level, NotifyEvent } from './protocol.ts'
import type { ProviderId } from './config.ts'
import type { Settings } from './settings.ts'

/** The subset of `RequestInit` this plugin actually uses. */
export interface HttpInit {
  /** HTTP method. */
  method: string
  /** Request headers. */
  headers: Record<string, string>
  /** Request body. */
  body: string
  /** Cancellation, so a delivery can be bounded by a timeout. */
  signal?: AbortSignal
}

/** One prepared HTTP request. */
export interface ProviderRequest {
  /** Absolute URL. */
  url: string
  /** Method, headers and body. */
  init: HttpInit
}

/** A backend that is ready to send. */
export interface ProviderPlan {
  /** Secret-free description of the destination, safe for a log or the panel. */
  summary: string
  /**
   * Build the request for one event.
   * @param event - the resolved event.
   * @returns the request to send.
   */
  make(event: NotifyEvent): ProviderRequest
}

/** Result of planning a delivery. */
export type PlanOutcome = { ok: true; plan: ProviderPlan } | { ok: false; problem: string }

/** ntfy's 1–5 priority scale. */
const NTFY_PRIORITY: Record<Level, number> = { info: 3, warn: 4, error: 5 }

/** A recognisable emoji tag per event kind. */
const NTFY_TAGS: Record<NotifyEvent['kind'], string> = {
  'turn-finished': 'white_check_mark',
  'agent-error': 'rotating_light',
  'approval-needed': 'warning',
  'question-asked': 'question',
  test: 'test_tube',
}

/** Gotify's 0–10 priority scale. */
const GOTIFY_PRIORITY: Record<Level, number> = { info: 2, warn: 5, error: 8 }

/** Bark's interruption levels. `timeSensitive` breaks through Focus. */
const BARK_LEVEL: Record<Level, string> = { info: 'active', warn: 'timeSensitive', error: 'timeSensitive' }

/** Strip trailing slashes without touching the scheme. */
function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/**
 * Mask a secret so it can be named in a log or on screen without being usable.
 * @param secret - the value to mask.
 * @returns a short recognisable fragment, or `(unset)`.
 */
export function maskSecret(secret: string): string {
  const value = secret.trim()
  if (value.length === 0) return '(unset)'
  if (value.length <= 6) return '••••'
  return `${value.slice(0, 2)}…${value.slice(-2)}`
}

/** Plan the ntfy backend. */
function planNtfy(settings: Settings): PlanOutcome {
  const server = trimBase(settings.ntfyServer)
  const topic = settings.ntfyTopic.trim()
  if (server.length === 0) return { ok: false, problem: 'ntfyServer is empty' }
  if (topic.length === 0) return { ok: false, problem: 'ntfyTopic is empty' }
  const token = settings.ntfyToken.trim()
  const click = settings.ntfyClick.trim()
  // The root endpoint, not `{server}/{topic}` — see the module note above.
  const url = `${server}/`
  return {
    ok: true,
    plan: {
      summary: `${server} → topic ${maskSecret(topic)}`,
      make(event) {
        const body: Record<string, unknown> = {
          topic,
          title: titleOf(event, settings.titlePrefix),
          message: bodyOf(event),
          priority: NTFY_PRIORITY[event.level],
          tags: [NTFY_TAGS[event.kind]],
        }
        if (click.length > 0) body.click = click
        const headers: Record<string, string> = { 'content-type': 'application/json' }
        if (token.length > 0) headers.authorization = `Bearer ${token}`
        return { url, init: { method: 'POST', headers, body: JSON.stringify(body) } }
      },
    },
  }
}

/** Plan the Bark backend. */
function planBark(settings: Settings): PlanOutcome {
  const server = trimBase(settings.barkServer)
  const key = settings.barkKey.trim()
  if (server.length === 0) return { ok: false, problem: 'barkServer is empty' }
  if (key.length === 0) return { ok: false, problem: 'barkKey is empty' }
  const group = settings.barkGroup.trim()
  const sound = settings.barkSound.trim()
  const levelOverride = settings.barkLevel.trim()
  return {
    ok: true,
    plan: {
      summary: `${server} → key ${maskSecret(key)}`,
      make(event) {
        const body: Record<string, unknown> = {
          device_key: key,
          title: titleOf(event, settings.titlePrefix),
          body: bodyOf(event),
          // Bark's `level` gates Focus/DND behaviour, so an approval ask is
          // allowed to break through while a finished turn is not.
          level: levelOverride.length > 0 ? levelOverride : BARK_LEVEL[event.level],
        }
        if (group.length > 0) body.group = group
        if (sound.length > 0) body.sound = sound
        return {
          url: `${server}/push`,
          init: {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
        }
      },
    },
  }
}

/** Plan the Gotify backend. */
function planGotify(settings: Settings): PlanOutcome {
  const server = trimBase(settings.gotifyServer)
  const token = settings.gotifyToken.trim()
  if (server.length === 0) return { ok: false, problem: 'gotifyServer is empty' }
  if (token.length === 0) return { ok: false, problem: 'gotifyToken is empty' }
  return {
    ok: true,
    plan: {
      summary: `${server} → token ${maskSecret(token)}`,
      make(event) {
        return {
          url: `${server}/message?token=${encodeURIComponent(token)}`,
          init: {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              title: titleOf(event, settings.titlePrefix),
              message: bodyOf(event),
              priority: GOTIFY_PRIORITY[event.level],
            }),
          },
        }
      },
    },
  }
}

/** Plan the Telegram backend. */
function planTelegram(settings: Settings): PlanOutcome {
  const token = settings.telegramBotToken.trim()
  const chatId = settings.telegramChatId.trim()
  if (token.length === 0) return { ok: false, problem: 'telegramBotToken is empty' }
  if (chatId.length === 0) return { ok: false, problem: 'telegramChatId is empty' }
  return {
    ok: true,
    plan: {
      summary: `api.telegram.org → chat ${maskSecret(chatId)}`,
      make(event) {
        return {
          url: `https://api.telegram.org/bot${token}/sendMessage`,
          init: {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              // Telegram has one text field, so the two lines are joined.
              text: `${titleOf(event, settings.titlePrefix)}\n${bodyOf(event)}`,
              disable_web_page_preview: true,
            }),
          },
        }
      },
    },
  }
}

/** Plan the generic webhook backend. */
function planWebhook(settings: Settings): PlanOutcome {
  const url = settings.webhookUrl.trim()
  if (url.length === 0) return { ok: false, problem: 'webhookUrl is empty' }
  if (!/^https?:\/\//i.test(url)) return { ok: false, problem: 'webhookUrl must start with http:// or https://' }
  return {
    ok: true,
    plan: {
      summary: url,
      make(event) {
        const title = titleOf(event, settings.titlePrefix)
        const body = bodyOf(event)
        return {
          url,
          init: {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              // The resolved strings, plus the raw fields, so a receiver can
              // either display `text` directly or route on `kind`/`level`.
              title,
              body,
              text: `${title}\n${body}`,
              content: `${title}\n${body}`,
              kind: event.kind,
              level: event.level,
              label: event.label,
              host: event.host,
              session: event.session,
              sessionId: event.sessionId ?? '',
              detail: event.detail,
              ts: event.ts,
            }),
          },
        }
      },
    },
  }
}

/**
 * Plan a delivery through the configured backend.
 * @param settings - the resolved config.
 * @returns either a ready plan or the reason there is not one.
 */
export function plan(settings: Settings): PlanOutcome {
  if (settings.provider === undefined) {
    return {
      ok: false,
      problem: `unknown provider "${settings.providerRaw}"; expected ntfy, bark, gotify, telegram or webhook`,
    }
  }
  switch (settings.provider) {
    case 'ntfy':
      return planNtfy(settings)
    case 'bark':
      return planBark(settings)
    case 'gotify':
      return planGotify(settings)
    case 'telegram':
      return planTelegram(settings)
    case 'webhook':
      return planWebhook(settings)
  }
}

/**
 * Build the request for one event.
 * @param settings - the resolved config.
 * @param event - the resolved event.
 * @returns the request, or the reason none could be built.
 */
export function buildRequest(
  settings: Settings,
  event: NotifyEvent,
): { ok: true; request: ProviderRequest; summary: string } | { ok: false; problem: string } {
  const planned = plan(settings)
  if (!planned.ok) return planned
  return { ok: true, request: planned.plan.make(event), summary: planned.plan.summary }
}

/**
 * Describe where notifications would go, without building a request.
 * @param settings - the resolved config.
 * @returns whether the backend is ready, why not, and a secret-free target.
 */
export function inspect(settings: Settings): { configured: boolean; problem?: string; target: string } {
  const planned = plan(settings)
  if (!planned.ok) return { configured: false, problem: planned.problem, target: '' }
  return { configured: true, target: planned.plan.summary }
}

/** Re-exported so callers can name the backend set without importing config. */
export type { ProviderId }