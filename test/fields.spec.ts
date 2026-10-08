/**
 * The editable surface: what the panel is told, and what a write may contain.
 *
 * Both halves matter for security, not just for correctness. `describeFields`
 * must never carry a stored secret back to the browser, and `validatePatch` is
 * the last gate before a value is merged into the settings document — which
 * outlives the process, so a bad write survives every restart.
 *
 * @module dsh-notify-push/test/fields
 */

import { describe, expect, it } from 'vitest'
import type { NotifyPushConfig } from '../src/config.ts'
import { describeFields, validatePatch } from '../src/fields.ts'
import { resolveSettings } from '../src/settings.ts'

/** Resolve a config from plain values, as `apply()` would. */
function settings(values: Record<string, unknown>) {
  return resolveSettings(values as NotifyPushConfig)
}

describe('describeFields', () => {
  it('describes every field with a key, a kind and a group', () => {
    const fields = describeFields(settings({}))
    expect(fields.length).toBeGreaterThan(10)
    for (const field of fields) {
      expect(field.key).toBeTruthy()
      expect(field.group).toBeTruthy()
      expect(['text', 'number', 'switch', 'select', 'secret']).toContain(field.kind)
    }
  })

  it('reports the raw provider string, so a typo is visible and fixable', () => {
    const fields = describeFields(settings({ provider: 'ntfyy' }))
    const provider = fields.find((field) => field.key === 'provider')
    // `resolveSettings` refuses to resolve an unknown provider to a ProviderId,
    // so the raw string is the only thing that can populate the select.
    expect(provider?.value).toBe('ntfyy')
    expect(provider?.options).toContain('ntfy')
  })

  it('never carries a stored secret back over the wire', () => {
    const fields = describeFields(
      settings({
        provider: 'ntfy',
        ntfyToken: 'EXAMPLE-NOT-A-REAL-TOKEN',
        barkKey: 'EXAMPLE-BARK-KEY',
        telegramBotToken: 'EXAMPLE-BOT-TOKEN',
      }),
    )
    const serialized = JSON.stringify(fields)
    expect(serialized).not.toContain('EXAMPLE-NOT-A-REAL-TOKEN')
    expect(serialized).not.toContain('EXAMPLE-BARK-KEY')
    expect(serialized).not.toContain('EXAMPLE-BOT-TOKEN')

    const token = fields.find((field) => field.key === 'ntfyToken')
    expect(token?.kind).toBe('secret')
    expect(token?.value).toBeUndefined()
    expect(token?.set).toBe(true)
  })

  it('distinguishes a stored secret from an absent one', () => {
    const fields = describeFields(settings({ provider: 'ntfy' }))
    expect(fields.find((field) => field.key === 'ntfyToken')?.set).toBe(false)
  })

  it('carries current values for non-secret fields', () => {
    const fields = describeFields(
      settings({ provider: 'ntfy', ntfyServer: 'https://ntfy.example.com', minTurnDurationMs: 1234 }),
    )
    expect(fields.find((field) => field.key === 'ntfyServer')?.value).toBe('https://ntfy.example.com')
    expect(fields.find((field) => field.key === 'minTurnDurationMs')?.value).toBe(1234)
    expect(fields.find((field) => field.key === 'enabled')?.value).toBe(true)
  })
})

describe('validatePatch', () => {
  it('accepts a well-formed patch', () => {
    const verdict = validatePatch({ ntfyTopic: 'a-topic', enabled: false, minTurnDurationMs: 9000 })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.patch).toEqual({ ntfyTopic: 'a-topic', enabled: false, minTurnDurationMs: 9000 })
    }
  })

  it('rejects a key the schema never declared', () => {
    const verdict = validatePatch({ rm: '-rf /' })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.problem).toContain('rm')
  })

  it('rejects a nested object, which a string field could not hold', () => {
    expect(validatePatch({ ntfyTopic: { nested: true } }).ok).toBe(false)
  })

  it('rejects a wrong primitive type', () => {
    expect(validatePatch({ enabled: 'yes' }).ok).toBe(false)
    expect(validatePatch({ minTurnDurationMs: 'soon' }).ok).toBe(false)
    expect(validatePatch({ ntfyTopic: 42 }).ok).toBe(false)
  })

  it('rejects a number outside its bounds', () => {
    expect(validatePatch({ minTurnDurationMs: -1 }).ok).toBe(false)
    expect(validatePatch({ minTurnDurationMs: 600_001 }).ok).toBe(false)
  })

  it('rejects NaN and Infinity, which JSON cannot carry anyway', () => {
    expect(validatePatch({ minTurnDurationMs: Number.NaN }).ok).toBe(false)
    expect(validatePatch({ minTurnDurationMs: Number.POSITIVE_INFINITY }).ok).toBe(false)
  })

  it('rejects a select value that is not on the list', () => {
    const verdict = validatePatch({ provider: 'carrier-pigeon' })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.problem).toContain('ntfy')
  })

  it('accepts every provider the build ships', () => {
    for (const provider of ['ntfy', 'bark', 'gotify', 'telegram', 'webhook']) {
      expect(validatePatch({ provider }).ok).toBe(true)
    }
  })

  it('rejects an empty patch, which would be a pointless write', () => {
    const verdict = validatePatch({})
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.problem).toContain('empty')
  })

  it('rejects a patch that is not an object', () => {
    expect(validatePatch(null).ok).toBe(false)
    expect(validatePatch('ntfyTopic=x').ok).toBe(false)
    expect(validatePatch(['ntfyTopic']).ok).toBe(false)
    expect(validatePatch(undefined).ok).toBe(false)
  })

  it('rejects an over-long string rather than persisting it', () => {
    const verdict = validatePatch({ ntfyTopic: 'x'.repeat(513) })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.problem).toContain('longer than')
  })

  it('accepts an empty string, which is how a field is cleared', () => {
    const verdict = validatePatch({ ntfyTopic: '' })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.patch.ntfyTopic).toBe('')
  })
})