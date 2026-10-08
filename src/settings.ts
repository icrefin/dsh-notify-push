/**
 * One flat, plain-valued snapshot of the row config.
 *
 * `apply()` receives volatile holders, and a listener may run at any moment, so
 * every reader resolves the whole document once and then works from plain
 * values. That keeps the providers and the delivery engine free of holder
 * plumbing, and makes both trivially testable with an object literal.
 *
 * The defaults are repeated here even though the schema carries them: a
 * schema-less or older mount hands over a plain object with no defaults
 * applied, and reading `undefined` where a number is expected would tax every
 * call site. `resolveSettings` is the single place that decision lives.
 *
 * @module dsh-notify-push/settings
 */

import {
  isProviderId,
  readBoolean,
  readNumber,
  readString,
  type NotifyPushConfig,
  type ProviderId,
} from './config.ts'

/** Everything the delivery path needs, as plain values. */
export interface Settings {
  /** Master switch. */
  enabled: boolean
  /** Selected backend, or `undefined` when the row names one this build does not know. */
  provider: ProviderId | undefined
  /** The raw `provider` string, so a typo can be reported verbatim. */
  providerRaw: string
  /** Armed triggers. */
  notifyOnIdle: boolean
  notifyOnError: boolean
  notifyOnApproval: boolean
  notifyOnQuestion: boolean
  /** Turn-length gate for the idle trigger. */
  minTurnDurationMs: number
  /** Content switches. */
  includeHostName: boolean
  includeSessionName: boolean
  titlePrefix: string
  /** Delivery pacing. */
  minIntervalMs: number
  dedupeWindowMs: number
  timeoutMs: number
  historyLimit: number
  /** ntfy. */
  ntfyServer: string
  ntfyTopic: string
  ntfyToken: string
  ntfyClick: string
  /** Bark. */
  barkServer: string
  barkKey: string
  barkGroup: string
  barkSound: string
  barkLevel: string
  /** Gotify. */
  gotifyServer: string
  gotifyToken: string
  /** Telegram. */
  telegramBotToken: string
  telegramChatId: string
  /** Generic webhook. */
  webhookUrl: string
}

/**
 * Project the row config onto {@link Settings}.
 * @param config - the row config as it arrived at `apply()`.
 * @returns the plain-valued snapshot.
 */
export function resolveSettings(config: NotifyPushConfig): Settings {
  const providerRaw = readString(config, 'provider', 'ntfy').trim()
  return {
    enabled: readBoolean(config, 'enabled', true),
    provider: isProviderId(providerRaw) ? providerRaw : undefined,
    providerRaw,
    notifyOnIdle: readBoolean(config, 'notifyOnIdle', true),
    notifyOnError: readBoolean(config, 'notifyOnError', true),
    notifyOnApproval: readBoolean(config, 'notifyOnApproval', true),
    notifyOnQuestion: readBoolean(config, 'notifyOnQuestion', true),
    minTurnDurationMs: readNumber(config, 'minTurnDurationMs', 5000),
    includeHostName: readBoolean(config, 'includeHostName', true),
    includeSessionName: readBoolean(config, 'includeSessionName', true),
    titlePrefix: readString(config, 'titlePrefix', ''),
    minIntervalMs: readNumber(config, 'minIntervalMs', 3000),
    dedupeWindowMs: readNumber(config, 'dedupeWindowMs', 15000),
    timeoutMs: readNumber(config, 'timeoutMs', 10000),
    historyLimit: readNumber(config, 'historyLimit', 50),
    ntfyServer: readString(config, 'ntfyServer', 'https://ntfy.sh'),
    ntfyTopic: readString(config, 'ntfyTopic', ''),
    ntfyToken: readString(config, 'ntfyToken', ''),
    ntfyClick: readString(config, 'ntfyClick', ''),
    barkServer: readString(config, 'barkServer', 'https://api.day.app'),
    barkKey: readString(config, 'barkKey', ''),
    barkGroup: readString(config, 'barkGroup', 'DeepSeek Harness'),
    barkSound: readString(config, 'barkSound', ''),
    barkLevel: readString(config, 'barkLevel', ''),
    gotifyServer: readString(config, 'gotifyServer', ''),
    gotifyToken: readString(config, 'gotifyToken', ''),
    telegramBotToken: readString(config, 'telegramBotToken', ''),
    telegramChatId: readString(config, 'telegramChatId', ''),
    webhookUrl: readString(config, 'webhookUrl', ''),
  }
}