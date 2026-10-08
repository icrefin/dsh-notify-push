/**
 * The editable surface: which config keys the panel may show, and what a
 * settings write is allowed to contain.
 *
 * Two jobs live here, and they belong together because they must agree.
 *
 * 1. **Describe** the fields the panel renders. The host sends descriptors
 *    rather than the client hard-coding a form, so adding a provider is one
 *    entry here. Labels are *not* sent — the panel looks each `key` up in its own
 *    dictionary, because a translated string baked into a host payload would
 *    ignore the language setting.
 * 2. **Validate** a patch before anything is written. This is a trust boundary:
 *    the settings document outlives the process, so a bad write persists across
 *    restarts. Only known keys, only primitives, only in-range numbers, and only
 *    a listed value for a select.
 *
 * Secrets are described but never valued. A `secret` field reports only whether
 * something is stored, and an empty string from the panel means "leave it alone"
 * rather than "clear it" — clearing is expressed by an explicit empty write is
 * deliberately *not* offered, so a form the user submits without touching the
 * token field can never silently wipe a working credential.
 *
 * @module dsh-notify-push/fields
 */

import { PROVIDER_IDS } from './config.ts'
import type { ConfigField } from './protocol.ts'
import type { Settings } from './settings.ts'

/** One editable config key, and the rules for writing it. */
interface FieldSpec {
  /** Config key; also the panel's dictionary key for the label. */
  key: string
  /** How the panel renders it. */
  kind: ConfigField['kind']
  /** Which provider it belongs to, or `common`. */
  group: string
  /** Allowed values, for a select. */
  options?: readonly string[]
  /** Inclusive bounds, for a number. */
  min?: number
  max?: number
}

/**
 * Every field the panel may write, in render order.
 *
 * `common` fields are always shown; a provider's fields are shown when that
 * provider is selected. Nothing here is a secret value — see the module note.
 */
export const FIELD_SPECS: readonly FieldSpec[] = [
  { key: 'enabled', kind: 'switch', group: 'common' },
  { key: 'provider', kind: 'select', group: 'common', options: PROVIDER_IDS },
  // The triggers. They were shown as read-only chips before, which made
  // "Notifications are armed" something a user could see but not change.
  { key: 'notifyOnIdle', kind: 'switch', group: 'common' },
  { key: 'notifyOnError', kind: 'switch', group: 'common' },
  { key: 'notifyOnApproval', kind: 'switch', group: 'common' },
  { key: 'notifyOnQuestion', kind: 'switch', group: 'common' },
  { key: 'minTurnDurationMs', kind: 'number', group: 'common', min: 0, max: 600_000 },

  { key: 'ntfyServer', kind: 'text', group: 'ntfy' },
  { key: 'ntfyTopic', kind: 'text', group: 'ntfy' },
  { key: 'ntfyToken', kind: 'secret', group: 'ntfy' },
  { key: 'ntfyClick', kind: 'text', group: 'ntfy' },

  { key: 'barkServer', kind: 'text', group: 'bark' },
  { key: 'barkKey', kind: 'secret', group: 'bark' },
  { key: 'barkGroup', kind: 'text', group: 'bark' },
  { key: 'barkSound', kind: 'text', group: 'bark' },

  { key: 'gotifyServer', kind: 'text', group: 'gotify' },
  { key: 'gotifyToken', kind: 'secret', group: 'gotify' },

  { key: 'telegramBotToken', kind: 'secret', group: 'telegram' },
  { key: 'telegramChatId', kind: 'text', group: 'telegram' },

  { key: 'webhookUrl', kind: 'text', group: 'webhook' },
]

/** Longest string a patch may carry into the settings document. */
const MAX_STRING_LENGTH = 512

/**
 * Build the descriptors the panel renders, with current values filled in.
 * @param settings - the resolved config.
 * @returns one descriptor per editable field.
 */
export function describeFields(settings: Settings): ConfigField[] {
  const values = settings as unknown as Record<string, unknown>
  return FIELD_SPECS.map((spec) => {
    const field: ConfigField = { key: spec.key, kind: spec.kind, group: spec.group }
    if (spec.options !== undefined) field.options = [...spec.options]

    const raw = spec.key === 'provider' ? settings.providerRaw : values[spec.key]
    if (spec.kind === 'secret') {
      // Never the value: only whether one exists, so the panel can say
      // "stored" without the secret crossing back over the wire.
      field.set = typeof raw === 'string' && raw.length > 0
    } else if (spec.kind === 'switch') {
      field.value = typeof raw === 'boolean' ? raw : false
    } else if (spec.kind === 'number') {
      field.value = typeof raw === 'number' ? raw : 0
    } else {
      field.value = typeof raw === 'string' ? raw : ''
    }
    return field
  })
}

/** A patch that passed validation. */
export type ValidPatch = Record<string, string | number | boolean>

/** Either a clean patch or the reason it was refused. */
export type PatchVerdict = { ok: true; patch: ValidPatch } | { ok: false; problem: string }

/**
 * Validate a patch against {@link FIELD_SPECS}.
 *
 * Rejects anything it does not recognise rather than passing it through: an
 * unknown key written into the settings document would survive every restart
 * and be reapplied to a row whose schema never declared it.
 *
 * @param input - the parsed JSON body's `patch`.
 * @returns a clean patch, or the first problem found.
 */
export function validatePatch(input: unknown): PatchVerdict {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, problem: 'patch must be a JSON object' }
  }

  const patch: ValidPatch = {}
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const spec = FIELD_SPECS.find((candidate) => candidate.key === key)
    if (spec === undefined) return { ok: false, problem: `unknown setting "${key}"` }

    switch (spec.kind) {
      case 'switch': {
        if (typeof raw !== 'boolean') return { ok: false, problem: `"${key}" must be true or false` }
        patch[key] = raw
        break
      }
      case 'number': {
        if (typeof raw !== 'number' || !Number.isFinite(raw)) {
          return { ok: false, problem: `"${key}" must be a number` }
        }
        if (spec.min !== undefined && raw < spec.min) {
          return { ok: false, problem: `"${key}" must be at least ${spec.min}` }
        }
        if (spec.max !== undefined && raw > spec.max) {
          return { ok: false, problem: `"${key}" must be at most ${spec.max}` }
        }
        patch[key] = raw
        break
      }
      case 'select': {
        const allowed = spec.options ?? []
        if (typeof raw !== 'string' || !allowed.includes(raw)) {
          return { ok: false, problem: `"${key}" must be one of: ${allowed.join(', ')}` }
        }
        patch[key] = raw
        break
      }
      default: {
        if (typeof raw !== 'string') return { ok: false, problem: `"${key}" must be a string` }
        if (raw.length > MAX_STRING_LENGTH) {
          return { ok: false, problem: `"${key}" is longer than ${MAX_STRING_LENGTH} characters` }
        }
        patch[key] = raw
        break
      }
    }
  }

  if (Object.keys(patch).length === 0) return { ok: false, problem: 'the patch is empty' }
  return { ok: true, patch }
}