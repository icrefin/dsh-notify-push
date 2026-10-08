/**
 * The notification's two lines.
 *
 * These assertions are the contract the user asked for: a phone lock screen
 * must show the event type, the host and the session without opening anything.
 * They are string-equal rather than shape-based precisely because the layout is
 * the requirement.
 *
 * @module dsh-notify-push/test/format
 */

import { describe, expect, it } from 'vitest'
import { EVENT_LABEL, EVENT_LEVEL, bodyOf, formatDuration, makeEvent, titleOf } from '../src/format.ts'

describe('title and body composition', () => {
  const event = makeEvent('turn-finished', {
    host: 'dev-box',
    session: 'Fix the login redirect',
    detail: 'done in 42s',
  })

  it('puts the event type and the host in the title', () => {
    expect(titleOf(event)).toBe('Agent finished · dev-box')
  })

  it('puts the session and the detail in the body, session first', () => {
    expect(bodyOf(event)).toBe('Fix the login redirect\ndone in 42s')
  })

  it('prefixes the title when configured', () => {
    expect(titleOf(event, 'DSH')).toBe('DSH · Agent finished · dev-box')
  })

  it('ignores a blank prefix rather than emitting a dangling separator', () => {
    expect(titleOf(event, '   ')).toBe('Agent finished · dev-box')
  })

  it('degrades to just the event type when the host is unknown', () => {
    const bare = makeEvent('agent-error', { host: '', session: '', detail: 'boom' })
    expect(titleOf(bare)).toBe('Agent error')
    expect(bodyOf(bare)).toBe('boom')
  })

  it('does not leave a blank first line when the session is unknown', () => {
    const bare = makeEvent('approval-needed', { host: 'mac', session: '', detail: 'bash — run it?' })
    expect(bodyOf(bare)).toBe('bash — run it?')
  })
})

describe('event defaults', () => {
  it('labels every kind', () => {
    expect(EVENT_LABEL['turn-finished']).toBe('Agent finished')
    expect(EVENT_LABEL['agent-error']).toBe('Agent error')
    expect(EVENT_LABEL['approval-needed']).toBe('Approval needed')
    expect(EVENT_LABEL.test).toBe('Test notification')
  })

  it('stamps the urgency each kind carries', () => {
    const error = makeEvent('agent-error', { host: '', detail: 'x' })
    const approval = makeEvent('approval-needed', { host: '', detail: 'x' })
    expect(error.level).toBe(EVENT_LEVEL['agent-error'])
    expect(error.level).toBe('error')
    expect(approval.level).toBe('warn')
  })

  it('records a session id only when one is known', () => {
    expect(makeEvent('test', { host: '', detail: 'x' }).sessionId).toBeUndefined()
    expect(makeEvent('test', { host: '', detail: 'x', sessionId: 's1' }).sessionId).toBe('s1')
  })
})

describe('formatDuration', () => {
  it('reads in the unit a person would use', () => {
    expect(formatDuration(420)).toBe('420ms')
    expect(formatDuration(42_000)).toBe('42s')
    expect(formatDuration(187_000)).toBe('3m 07s')
  })

  it('refuses to render nonsense as a duration', () => {
    expect(formatDuration(Number.NaN)).toBe('unknown')
    expect(formatDuration(-1)).toBe('unknown')
  })
})