/**
 * Wire contract shared by both halves.
 *
 * Both halves import this module, so a route path or payload field can never
 * drift between the host that serves it and the browser that reads it. Keep it
 * dependency-free — the client bundle inlines it, and it must not drag the
 * host's `node:` imports into the page.
 *
 * @module dsh-notify-push/protocol
 */

/** Route paths served by the host half under the web server's route table. */
export const API = {
  /** Delivery state, resolved target and counters. */
  status: '/api/dsh-notify-push/status',
  /** Recent deliveries, newest first. */
  history: '/api/dsh-notify-push/history',
  /** Send one synthetic notification through the configured provider. */
  test: '/api/dsh-notify-push/test',
  /** Merge validated settings into this row's config. */
  config: '/api/dsh-notify-push/config',
} as const

/**
 * How the panel should render one editable config field.
 *
 * Sent by the host so the form follows the schema instead of duplicating it.
 * `key` is also the client dictionary key for the label, which is how the
 * wording stays localized without the host shipping English.
 */
export interface ConfigField {
  /** Config key, and the locale key for its label. */
  key: string
  /** Input to render. `secret` is a write-only text input. */
  kind: 'text' | 'number' | 'switch' | 'select' | 'secret'
  /** `common`, or the provider this field belongs to. */
  group: string
  /** Current value. Absent for a secret, which is never sent back. */
  value?: string | number | boolean
  /** For a secret: whether a value is stored. */
  set?: boolean
  /** For a select: the permitted values. */
  options?: string[]
}

/** Body of `POST API.config`. */
export interface ConfigPatchRequest {
  /** Field values to merge. Secrets are omitted when untouched. */
  patch: Record<string, string | number | boolean>
}

/** What raised a notification. */
export type EventKind =
  | 'turn-finished'
  | 'agent-error'
  | 'approval-needed'
  | 'question-asked'
  | 'test'

/** Urgency, which each provider maps onto its own scale. */
export type Level = 'info' | 'warn' | 'error'

/** How one delivery ended. */
export type DeliveryOutcome = 'sent' | 'failed' | 'suppressed'

/**
 * One notification, already resolved into display text.
 *
 * This is the unit the providers render and the panel displays. It carries no
 * harness objects on purpose: everything is a string by the time it exists, so
 * a provider can be exercised without a live agent.
 */
export interface NotifyEvent {
  /** What raised it. */
  kind: EventKind
  /** Urgency. */
  level: Level
  /** Event-type label, e.g. `Agent finished`. */
  label: string
  /** Machine that raised the event. */
  host: string
  /** Session title, empty when the event could not be attributed to a session. */
  session: string
  /** Short detail line, e.g. `done in 42s`. */
  detail: string
  /** Session id, when known. */
  sessionId?: string
  /** ISO 8601 timestamp. */
  ts: string
}

/** One row of the delivery log. */
export interface HistoryEntry {
  /** ISO 8601 timestamp. */
  ts: string
  /** What raised it. */
  kind: EventKind
  /** Urgency. */
  level: Level
  /** Notification title as delivered. */
  title: string
  /** Notification body as delivered. */
  body: string
  /** Backend that was asked to deliver it. */
  provider: string
  /** How it ended. */
  outcome: DeliveryOutcome
  /** HTTP status, when a request was actually made. */
  status?: number
  /** Failure reason, when `outcome` is `failed`. */
  error?: string
  /** Why it was dropped, when `outcome` is `suppressed`. */
  reason?: string
  /** Round-trip time in milliseconds. */
  ms: number
}

/** Body of a successful `GET API.status`. */
export interface StatusPayload {
  /** Loader row id, so the panel can prove which plugin answered. */
  id: string
  /**
   * Version of the host half that answered.
   *
   * The panel shows it beside the title. Read at runtime, not baked in, so it
   * reports the build the harness actually loaded — which is the only way to
   * tell a live swap from a pending restart.
   */
  version: string
  /** Master switch. */
  enabled: boolean
  /** Configured backend name. */
  provider: string
  /** Whether the selected backend has everything it needs to send. */
  configured: boolean
  /** Why it is not configured, when `configured` is false. */
  problem?: string
  /** Secret-free description of where notifications go. */
  target: string
  /**
   * The exact server and topic to subscribe to in the ntfy app.
   *
   * Present only for the ntfy backend, and deliberately **unmasked**: unlike a
   * publish token, the topic is the subscription identifier, so masking it makes
   * the phone impossible to set up. `target` stays masked for logs; this is the
   * one field the user has to read and retype.
   */
  subscribe?: { server: string; topic: string }
  /** Machine that would be named in the notification. */
  host: string
  /** Which triggers are armed. */
  triggers: { idle: boolean; error: boolean; approval: boolean; question: boolean }
  /** Example title/body the next idle notification would carry. */
  sample: { title: string; body: string }
  /** Delivery counters since the host started. */
  counters: { sent: number; failed: number; suppressed: number }
  /**
   * Editable fields for the panel's form, with current values filled in.
   *
   * Always present, even when {@link StatusPayload.canEdit} is false — the form
   * still renders and explains itself, rather than the section vanishing on a
   * composition whose values it could only read.
   */
  fields: ConfigField[]
  /**
   * Whether edits can actually be persisted.
   *
   * False on a composition with no settings service. A value can still be
   * *read*, but there is nowhere to save it, so the form is disabled instead of
   * accepting a change that would silently evaporate.
   */
  canEdit: boolean
  /** Host clock, ISO 8601. */
  time: string
}

/** Body of a successful `GET API.history`. */
export interface HistoryPayload {
  /** Newest first. */
  entries: HistoryEntry[]
}

/** Body of a successful `POST API.test`. */
export interface TestPayload {
  /** The event that was synthesized, so the panel can show exactly what was sent. */
  event: NotifyEvent
  /** The single delivery result. */
  entry: HistoryEntry
}

/** Body of any failed request. */
export interface ErrorPayload {
  error: string
}