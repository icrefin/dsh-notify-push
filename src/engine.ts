/**
 * The delivery engine: pacing, de-duplication, timeouts and the delivery log.
 *
 * Two rules shape everything here.
 *
 * 1. **A notifier must never break the agent loop.** The payloads arrive from
 *    listeners on the harness's own lifecycle events, so `dispatch()` swallows
 *    every failure into a history row — a bad URL, a DNS failure, a timeout and
 *    a thrown provider all end the same way, as a `failed` entry. Nothing
 *    propagates.
 * 2. **A phone must not be spammed.** An agent error can repeat per step, and a
 *    burst of short turns can each cross the duration gate. So a send is paced
 *    (`minIntervalMs`), an identical event inside `dedupeWindowMs` is dropped,
 *    and both drops are recorded as `suppressed` with the reason, which is what
 *    makes the panel's counters honest rather than just quiet.
 *
 * The clock and the `fetch` are injected so the tests can drive real pacing and
 * real HTTP semantics without sleeping or touching the network.
 *
 * @module dsh-notify-push/engine
 */

import type { DeliveryOutcome, HistoryEntry, NotifyEvent } from './protocol.ts'
import { buildRequest, type HttpInit } from './providers.ts'
import type { Settings } from './settings.ts'

/** The subset of a `fetch` response this plugin reads. */
export interface FetchResponse {
  /** HTTP status code. */
  status: number
  /** Whether the status is in the 2xx range. */
  ok: boolean
  /**
   * Read the response body as text.
   * @returns the body, used only for the failure reason.
   */
  text(): Promise<string>
}

/** An injectable `fetch`. */
export type FetchLike = (url: string, init: HttpInit) => Promise<FetchResponse>

/** Engine collaborators. */
export interface EngineDeps {
  /**
   * Read the current settings.
   * @returns a fresh snapshot; volatile fields may have changed since the last call.
   */
  settings(): Settings
  /** HTTP client. */
  fetch: FetchLike
  /** Wall clock, in epoch milliseconds. */
  now(): number
  /**
   * Log one line.
   * @param message - text to log.
   */
  log(message: string): void
}

/** Counters since the host started. */
export interface Counters {
  /** Deliveries the backend accepted. */
  sent: number
  /** Deliveries that were attempted and failed. */
  failed: number
  /** Events dropped by the master switch, the pacing gate or the dedupe window. */
  suppressed: number
}

/** The delivery engine. */
export interface Engine {
  /**
   * Deliver one event, subject to the master switch, pacing and de-duplication.
   * @param event - the resolved event.
   * @returns the history row describing what happened; never throws.
   */
  dispatch(event: NotifyEvent): Promise<HistoryEntry>
  /**
   * The delivery log, newest first.
   * @returns a copy, so a caller cannot mutate the ring buffer.
   */
  history(): HistoryEntry[]
  /**
   * Delivery counters.
   * @returns a copy of the running totals.
   */
  counters(): Counters
  /** Drop the log and reset the pacing state. */
  clear(): void
}

/** Clamp a number into an inclusive range, tolerating `NaN`. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/** Shorten a response body so a failure reason stays one line. */
function snippet(text: string, limit = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

/**
 * Build a delivery engine.
 * @param deps - settings reader, HTTP client, clock and logger.
 * @returns the engine.
 */
export function createEngine(deps: EngineDeps): Engine {
  let entries: HistoryEntry[] = []
  let sent = 0
  let failed = 0
  let suppressed = 0
  let lastKey = ''
  let lastKeyAt = Number.NEGATIVE_INFINITY
  let lastSentAt = Number.NEGATIVE_INFINITY

  function record(entry: HistoryEntry, limit: number): HistoryEntry {
    entries = [entry, ...entries].slice(0, clamp(limit, 1, 500))
    return entry
  }

  function suppress(
    event: NotifyEvent,
    provider: string,
    reason: string,
    limit: number,
  ): HistoryEntry {
    suppressed += 1
    return record(
      {
        ts: event.ts,
        kind: event.kind,
        level: event.level,
        title: event.label,
        body: event.detail,
        provider,
        outcome: 'suppressed',
        reason,
        ms: 0,
      },
      limit,
    )
  }

  return {
    async dispatch(event: NotifyEvent): Promise<HistoryEntry> {
      const settings = deps.settings()
      const limit = clamp(settings.historyLimit, 1, 500)
      const provider = settings.provider ?? settings.providerRaw
      const at = deps.now()

      if (!settings.enabled) return suppress(event, provider, 'disabled', limit)

      // Keyed on the rendered content, so two different sessions finishing at
      // the same moment are not collapsed into one.
      const key = [event.kind, event.sessionId ?? '', event.session, event.detail].join('\u0000')
      const dedupeWindow = clamp(settings.dedupeWindowMs, 0, 600_000)
      if (key === lastKey && at - lastKeyAt < dedupeWindow) {
        return suppress(event, provider, `duplicate within ${dedupeWindow}ms`, limit)
      }
      lastKey = key
      lastKeyAt = at

      const minInterval = clamp(settings.minIntervalMs, 0, 600_000)
      if (at - lastSentAt < minInterval) {
        return suppress(event, provider, `paced: ${minInterval}ms between deliveries`, limit)
      }
      lastSentAt = at

      const built = buildRequest(settings, event)
      if (!built.ok) {
        failed += 1
        deps.log(`[dsh-notify-push] cannot deliver: ${built.problem}`)
        return record(
          {
            ts: event.ts,
            kind: event.kind,
            level: event.level,
            title: event.label,
            body: event.detail,
            provider,
            outcome: 'failed',
            error: built.problem,
            ms: 0,
          },
          limit,
        )
      }

      const started = deps.now()
      try {
        const timeout = clamp(settings.timeoutMs, 500, 120_000)
        const response = await deps.fetch(built.request.url, {
          ...built.request.init,
          signal: AbortSignal.timeout(timeout),
        })
        const ms = deps.now() - started
        const title = `${event.label}${event.host ? ` · ${event.host}` : ''}`
        if (!response.ok) {
          const detail = await response.text().catch(() => '')
          failed += 1
          deps.log(`[dsh-notify-push] ${provider} replied ${response.status}: ${snippet(detail)}`)
          return record(
            {
              ts: event.ts,
              kind: event.kind,
              level: event.level,
              title,
              body: event.detail,
              provider,
              outcome: 'failed',
              status: response.status,
              error: snippet(detail) || `HTTP ${response.status}`,
              ms,
            },
            limit,
          )
        }
        sent += 1
        deps.log(`[dsh-notify-push] delivered to ${built.summary}`)
        return record(
          {
            ts: event.ts,
            kind: event.kind,
            level: event.level,
            title,
            body: event.detail,
            provider,
            outcome: 'sent',
            status: response.status,
            ms,
          },
          limit,
        )
      } catch (error) {
        const ms = deps.now() - started
        const reason = error instanceof Error ? error.message : String(error)
        failed += 1
        deps.log(`[dsh-notify-push] ${provider} request failed: ${reason}`)
        return record(
          {
            ts: event.ts,
            kind: event.kind,
            level: event.level,
            title: `${event.label}${event.host ? ` · ${event.host}` : ''}`,
            body: event.detail,
            provider,
            outcome: 'failed',
            error: reason,
            ms,
          },
          limit,
        )
      }
    },

    history(): HistoryEntry[] {
      return [...entries]
    },

    counters(): Counters {
      return { sent, failed, suppressed }
    },

    clear(): void {
      entries = []
      sent = 0
      failed = 0
      suppressed = 0
      lastKey = ''
      lastKeyAt = Number.NEGATIVE_INFINITY
      lastSentAt = Number.NEGATIVE_INFINITY
    },
  }
}

/** Re-exported so callers do not need to name the outcome union's module. */
export type { DeliveryOutcome }