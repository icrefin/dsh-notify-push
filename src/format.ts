/**
 * Turning a resolved {@link NotifyEvent} into the two strings a phone lock
 * screen actually shows.
 *
 * The split is deliberate and is the whole point of the plugin's content
 * rules: **title** carries the event type and the machine, **body** carries the
 * session and the detail. A watch shows the title in bold and the body beneath
 * it, so the two lines together answer "what happened, where, and to which
 * session" without opening anything.
 *
 * Both functions are pure, which is what lets the tests assert the exact
 * strings rather than a shape.
 *
 * @module dsh-notify-push/format
 */

import type { EventKind, Level, NotifyEvent } from './protocol.ts'

/** Human label for each event kind, used as the title's first segment. */
export const EVENT_LABEL: Record<EventKind, string> = {
  'turn-finished': 'Agent finished',
  'agent-error': 'Agent error',
  'approval-needed': 'Approval needed',
  'question-asked': 'Question asked',
  test: 'Test notification',
}

/** Urgency each event kind carries by default. */
export const EVENT_LEVEL: Record<EventKind, Level> = {
  'turn-finished': 'info',
  'agent-error': 'error',
  // Both of these are the agent stopped and waiting on a person, so they are
  // urgent enough to break through a Focus mode rather than merely sit in the
  // tray: nothing else happens until the answer arrives.
  'approval-needed': 'warn',
  'question-asked': 'warn',
  test: 'info',
}

/**
 * Render a duration the way a person reads it.
 * @param ms - elapsed milliseconds.
 * @returns e.g. `420ms`, `42s`, `3m 07s`.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}

/**
 * Compose the notification title: optional prefix, event type, machine.
 * @param event - the resolved event.
 * @param prefix - optional literal prefix such as `DSH`.
 * @returns the title line.
 */
export function titleOf(event: NotifyEvent, prefix = ''): string {
  return [prefix.trim(), event.label, event.host]
    .filter((part) => part.length > 0)
    .join(' · ')
}

/**
 * Compose the notification body: the session name, then the detail.
 *
 * The session is on its own line so a long title cannot push it out of view,
 * and a missing session degrades to the detail alone rather than to a blank
 * line.
 *
 * @param event - the resolved event.
 * @returns the body text.
 */
export function bodyOf(event: NotifyEvent): string {
  const lines = [event.session.trim(), event.detail.trim()].filter((line) => line.length > 0)
  return lines.join('\n')
}

/**
 * Build an event from its parts, applying the kind's default label and level.
 * @param kind - what raised it.
 * @param parts - host, session and detail text, plus an optional override.
 * @returns the resolved event.
 */
export function makeEvent(
  kind: EventKind,
  parts: {
    host: string
    session?: string
    detail: string
    sessionId?: string
    level?: Level
    now?: number
  },
): NotifyEvent {
  const event: NotifyEvent = {
    kind,
    level: parts.level ?? EVENT_LEVEL[kind],
    label: EVENT_LABEL[kind],
    host: parts.host,
    session: parts.session ?? '',
    detail: parts.detail,
    ts: new Date(parts.now ?? Date.now()).toISOString(),
  }
  if (parts.sessionId !== undefined) event.sessionId = parts.sessionId
  return event
}