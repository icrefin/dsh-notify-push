/**
 * The Loader row's `Config` schema, plus the readers that make a volatile
 * field safe to read.
 *
 * Every field is `.volatile()`: a volatile value arrives at `apply()` as a live
 * holder rather than a plain value, and the Loader swaps its contents in place
 * when the row's config changes, so a listener registered once in `apply()`
 * always reads the current value without a re-`apply()` and without a restart.
 *
 * The cost of that is that every read has to go through a holder:
 * {@link readString} / {@link readNumber} / {@link readBoolean} unwrap both
 * shapes, because a schema-less or older mount can still hand over a plain
 * value.
 *
 * The fields are flat on purpose. schemastery validates this document against
 * the row's `config` in the profile's `cordis.patch.yml`, and a flat document
 * keeps the YAML a user edits readable.
 *
 * @module dsh-notify-push/config
 */

import z from '@deepseek-ai/schemastery'

/** Provider identifiers this plugin knows how to deliver through. */
export const PROVIDER_IDS = ['ntfy', 'bark', 'gotify', 'telegram', 'webhook'] as const

/** One delivery backend. */
export type ProviderId = (typeof PROVIDER_IDS)[number]

/** Whether `value` names a provider this build supports. */
export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value)
}

/**
 * The row config: triggers, delivery backend, and that backend's credentials.
 *
 * Defaults reproduce "installed but inert": `enabled` is true and every trigger
 * is on, but no provider is configured, so nothing is ever sent until a topic,
 * key or token is supplied. Installing the plugin therefore cannot surprise a
 * user with traffic.
 */
export const Config = z.object({
  // ---- behaviour -------------------------------------------------------
  enabled: z.boolean().default(true).volatile()
    .description('Master switch. When false, events are recorded but nothing is delivered.'),
  provider: z.string().default('ntfy').volatile()
    .description('Delivery backend: ntfy, bark, gotify, telegram or webhook.'),
  notifyOnIdle: z.boolean().default(true).volatile()
    .description('Notify when an agent finishes a turn (agent/status flips running -> idle).'),
  notifyOnError: z.boolean().default(true).volatile()
    .description('Notify when a step or turn errors (agent/error).'),
  notifyOnApproval: z.boolean().default(true).volatile()
    .description('Notify when a tool call is waiting for user approval (approval/request).'),
  notifyOnQuestion: z.boolean().default(true).volatile()
    .description('Notify when the agent asks the user a question (user-questions/request).'),
  minTurnDurationMs: z.number().default(5000).volatile()
    .description('Only notify for turns that ran at least this long, so quick replies stay quiet.'),
  includeHostName: z.boolean().default(true).volatile()
    .description('Put the machine that raised the event in the notification title.'),
  includeSessionName: z.boolean().default(true).volatile()
    .description('Put the session title in the notification body.'),
  titlePrefix: z.string().default('').volatile()
    .description('Optional literal prefix for every notification title, e.g. "DSH".'),
  minIntervalMs: z.number().default(3000).volatile()
    .description('Minimum gap between two deliveries; anything faster is suppressed.'),
  dedupeWindowMs: z.number().default(15000).volatile()
    .description('Suppress an identical event seen again within this window.'),
  timeoutMs: z.number().default(10000).volatile()
    .description('Per-delivery HTTP timeout.'),
  historyLimit: z.number().default(50).volatile()
    .description('How many recent deliveries the panel can show.'),

  // ---- ntfy ------------------------------------------------------------
  ntfyServer: z.string().default('https://ntfy.sh').volatile()
    .description('ntfy base URL, e.g. https://ntfy.sh or your own https://ntfy.example.com.'),
  ntfyTopic: z.string().default('').volatile()
    .description('ntfy topic to publish to. On a public server this name is the password: make it long and random.'),
  ntfyToken: z.string().default('').volatile()
    .description('Optional ntfy access token, sent as "Authorization: Bearer".'),
  ntfyClick: z.string().default('').volatile()
    .description('Optional URL opened when the notification is tapped.'),

  // ---- Bark ------------------------------------------------------------
  barkServer: z.string().default('https://api.day.app').volatile()
    .description('Bark server base URL. The public server is https://api.day.app.'),
  barkKey: z.string().default('').volatile()
    .description('Bark device key (the path segment in the app\'s example URL).'),
  barkGroup: z.string().default('DeepSeek Harness').volatile()
    .description('Bark notification group, used by the app to group messages.'),
  barkSound: z.string().default('').volatile()
    .description('Optional Bark sound name, e.g. "minuet".'),
  barkLevel: z.string().default('').volatile()
    .description('Bark interruption level: active, timeSensitive, passive or critical. Empty derives it from the event.'),

  // ---- Gotify ----------------------------------------------------------
  gotifyServer: z.string().default('').volatile()
    .description('Gotify base URL, e.g. https://gotify.example.com.'),
  gotifyToken: z.string().default('').volatile()
    .description('Gotify application token used to publish a message.'),

  // ---- Telegram --------------------------------------------------------
  telegramBotToken: z.string().default('').volatile()
    .description('Telegram bot token from @BotFather.'),
  telegramChatId: z.string().default('').volatile()
    .description('Telegram chat id to send to (a user, group or channel id).'),

  // ---- generic webhook -------------------------------------------------
  webhookUrl: z.string().default('').volatile()
    .description('Generic POST target for the raw event JSON (Slack-compatible "text" field included).'),
})

/** A volatile holder, as the Loader materializes a `.volatile()` field. */
interface Holder<T> {
  get(): T | undefined
}

/** Either shape a config field can arrive in. */
type FieldValue<T> = Holder<T> | T | undefined

/**
 * Every field of the row config, as it reaches `apply()`.
 *
 * Deliberately structural rather than `z.infer`: a volatile field's static type
 * is a holder, and reading it needs a runtime branch either way.
 */
export interface NotifyPushConfig {
  enabled?: FieldValue<boolean>
  provider?: FieldValue<string>
  notifyOnIdle?: FieldValue<boolean>
  notifyOnError?: FieldValue<boolean>
  notifyOnApproval?: FieldValue<boolean>
  notifyOnQuestion?: FieldValue<boolean>
  minTurnDurationMs?: FieldValue<number>
  includeHostName?: FieldValue<boolean>
  includeSessionName?: FieldValue<boolean>
  titlePrefix?: FieldValue<string>
  minIntervalMs?: FieldValue<number>
  dedupeWindowMs?: FieldValue<number>
  timeoutMs?: FieldValue<number>
  historyLimit?: FieldValue<number>
  ntfyServer?: FieldValue<string>
  ntfyTopic?: FieldValue<string>
  ntfyToken?: FieldValue<string>
  ntfyClick?: FieldValue<string>
  barkServer?: FieldValue<string>
  barkKey?: FieldValue<string>
  barkGroup?: FieldValue<string>
  barkSound?: FieldValue<string>
  barkLevel?: FieldValue<string>
  gotifyServer?: FieldValue<string>
  gotifyToken?: FieldValue<string>
  telegramBotToken?: FieldValue<string>
  telegramChatId?: FieldValue<string>
  webhookUrl?: FieldValue<string>
}

/** Config keys whose value is a string. */
export type StringKey = {
  [K in keyof NotifyPushConfig]-?: NotifyPushConfig[K] extends FieldValue<string> ? K : never
}[keyof NotifyPushConfig]

/** Config keys whose value is a number. */
export type NumberKey = {
  [K in keyof NotifyPushConfig]-?: NotifyPushConfig[K] extends FieldValue<number> ? K : never
}[keyof NotifyPushConfig]

/** Config keys whose value is a boolean. */
export type BooleanKey = {
  [K in keyof NotifyPushConfig]-?: NotifyPushConfig[K] extends FieldValue<boolean> ? K : never
}[keyof NotifyPushConfig]

/**
 * Unwrap one config field, accepting both a live volatile holder and a plain
 * value. Exported for tests, which exercise both shapes.
 *
 * @param holder - the field as it arrived.
 * @returns the current value, or `undefined` when unset.
 */
export function unwrap<T>(holder: FieldValue<T>): T | undefined {
  if (holder === undefined || holder === null) return undefined
  if (typeof holder === 'object' && typeof (holder as Holder<T>).get === 'function') {
    return (holder as Holder<T>).get()
  }
  return holder as T
}

/**
 * Read one string field.
 * @param config - the row config.
 * @param key - field name.
 * @param fallback - value used when the field is unset or the wrong type.
 * @returns the current string value.
 */
export function readString(config: NotifyPushConfig, key: StringKey, fallback = ''): string {
  const value = unwrap<string>(config[key])
  return typeof value === 'string' ? value : fallback
}

/**
 * Read one number field, rejecting `NaN`.
 * @param config - the row config.
 * @param key - field name.
 * @param fallback - value used when the field is unset, wrong-typed or `NaN`.
 * @returns the current number value.
 */
export function readNumber(config: NotifyPushConfig, key: NumberKey, fallback: number): number {
  const value = unwrap<number>(config[key])
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Read one boolean field.
 * @param config - the row config.
 * @param key - field name.
 * @param fallback - value used when the field is unset or wrong-typed.
 * @returns the current boolean value.
 */
export function readBoolean(config: NotifyPushConfig, key: BooleanKey, fallback: boolean): boolean {
  const value = unwrap<boolean>(config[key])
  return typeof value === 'boolean' ? value : fallback
}