/**
 * The Notify Push section of the Settings panel.
 *
 * It answers three questions and nothing else: where are notifications going,
 * which events are armed, and did the last few deliveries actually land. The
 * "send test" button is the one action, because the only honest way to confirm
 * a phone-push path is to make the phone buzz.
 *
 * The Settings shell supplies the chrome — the nav entry, the panel, and the
 * scrolling container this is rendered into — so the component deliberately owns
 * no page geometry: no `height`, no second scroll, no horizontal padding. It is
 * a plain column that grows downwards inside the shell's `.options` area.
 *
 * The component receives its translate seat through props; it never imports the
 * locale service. Everything else arrives from the host half over the plugin's
 * own routes.
 *
 * @module dsh-notify-push/client/SettingsSection
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react'
import {
  API,
  type HistoryEntry,
  type HistoryPayload,
  type StatusPayload,
  type TestPayload,
} from '../protocol.ts'
import type { PanelTranslate } from './locales.ts'
import { ConfigForm } from './ConfigForm.tsx'
import { ROOT_CLASS } from './styles.ts'

/** Props composed by the slot framework for this entry of `settings.section`. */
export interface SettingsSectionProps {
  /** Translate seat bound to this plugin's dictionary. */
  t: PanelTranslate
}

/** Human-readable form of an unknown thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read one JSON route.
 * @param path - route path.
 * @returns the parsed payload.
 * @throws when the response is not ok.
 */
async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return (await response.json()) as T
}

/**
 * POST one bodyless JSON route.
 * @param path - route path.
 * @returns the parsed payload.
 * @throws when the response is not ok.
 */
async function postJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return (await response.json()) as T
}

/**
 * Render an ISO timestamp as a local wall-clock time.
 * @param iso - ISO 8601 string.
 * @returns `HH:MM:SS`, or the raw value when it will not parse.
 */
function timeOf(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString()
}

/**
 * The one-line explanation of how a delivery ended.
 * @param entry - the history row.
 * @returns the detail column text.
 */
function detailOf(entry: HistoryEntry): string {
  if (entry.outcome === 'sent') return `${entry.ms} ms`
  if (entry.outcome === 'failed') return entry.error ?? 'failed'
  return entry.reason ?? 'suppressed'
}

/** Props for the trigger-chip row. */
interface TriggerProps {
  /** Armed triggers reported by the host. */
  triggers: StatusPayload['triggers']
  /** Translate seat. */
  t: PanelTranslate
}

/**
 * Render the triggers as chips, so the section shows at a glance which events
 * are armed rather than making the reader compare config values.
 * @param props - the trigger states and the translate seat.
 * @returns the chip row.
 */
function Triggers({ triggers, t }: TriggerProps): ReactElement {
  const rows: Array<{ key: keyof StatusPayload['triggers']; label: string }> = [
    { key: 'idle', label: t('triggerIdle') },
    { key: 'error', label: t('triggerError') },
    { key: 'approval', label: t('triggerApproval') },
    { key: 'question', label: t('triggerQuestion') },
  ]
  return (
    <div className="chips">
      {rows.map(({ key, label }) => (
        <span key={key} className="chip" data-on={triggers[key]}>
          {label} · {triggers[key] ? t('armed') : t('disarmed')}
        </span>
      ))}
    </div>
  )
}

/**
 * Render the settings section.
 * @param props - the framework-injected translate seat.
 * @returns the section element tree.
 */
export function SettingsSection({ t }: SettingsSectionProps): ReactElement {
  const [status, setStatus] = useState<StatusPayload | undefined>(undefined)
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | undefined>(undefined)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      const [nextStatus, history] = await Promise.all([
        getJson<StatusPayload>(API.status),
        getJson<HistoryPayload>(API.history),
      ])
      setStatus(nextStatus)
      setEntries(history.entries)
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const sendTest = useCallback(async (): Promise<void> => {
    setSending(true)
    setNote(undefined)
    try {
      const result = await postJson<TestPayload>(API.test)
      const outcome = result.entry.outcome
      setNote(
        outcome === 'sent'
          ? { ok: true, text: t('testSent') }
          : { ok: false, text: `${t('testBlocked')} ${result.entry.error ?? result.entry.reason ?? ''}`.trim() },
      )
      await load()
    } catch (caught) {
      setNote({ ok: false, text: `${t('testBlocked')} ${messageOf(caught)}` })
    } finally {
      setSending(false)
    }
  }, [load, t])

  return (
    <div className={ROOT_CLASS}>
      <header>
        <h1>
          {t('title')}
          {status === undefined ? null : <span className="version">v{status.version}</span>}
        </h1>
        <p className="intro">{t('intro')}</p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => void sendTest()} disabled={sending || loading}>
            {sending ? t('sending') : t('sendTest')}
          </button>
          <button type="button" onClick={() => void load()} disabled={loading}>
            {loading ? t('loading') : t('refresh')}
          </button>
        </div>
      </header>

      {error === undefined ? null : (
        <div className="error">
          {t('requestFailed')}: {error}
        </div>
      )}
      {note === undefined ? null : <div className={note.ok ? 'notice' : 'error'}>{note.text}</div>}

      <section>
        <h2>{t('statusHeading')}</h2>
        <div className="panel">
          {status === undefined ? (
            <div className="hint">{t('loading')}</div>
          ) : (
            <>
              <div className="grid">
                <div className="key">{t('provider')}</div>
                <div className="value mono">{status.provider}</div>
                <div className="key">{t('target')}</div>
                <div className="value mono">{status.configured ? status.target : t('notConfigured')}</div>
                <div className="key">{t('host')}</div>
                <div className="value mono">{status.host}</div>
                <div className="key">{t('state')}</div>
                <div className="value">{status.enabled ? t('stateOn') : t('stateOff')}</div>
              </div>
              {status.problem === undefined ? null : <div className="hint">{status.problem}</div>}
              <div className="counters">
                <div>
                  <b>{status.counters.sent}</b>
                  {t('sent')}
                </div>
                <div>
                  <b>{status.counters.failed}</b>
                  {t('failed')}
                </div>
                <div>
                  <b>{status.counters.suppressed}</b>
                  {t('suppressed')}
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      {status === undefined ? null : (
        <>
          <ConfigForm
            fields={status.fields}
            canEdit={status.canEdit}
            provider={status.provider}
            t={t}
            onSaved={setStatus}
          />

          {status.subscribe === undefined ? null : (
            <section>
              <h2>{t('subscribeHeading')}</h2>
              <div className="panel">
                <div className="stack">
                  <div>
                    <div className="fieldLabel">{t('subscribeServer')}</div>
                    <code className="field">{status.subscribe.server}</code>
                  </div>
                  <div>
                    <div className="fieldLabel">{t('subscribeTopic')}</div>
                    <code className="field">{status.subscribe.topic}</code>
                  </div>
                </div>
              </div>
              <div className="hint">{t('subscribeNote')}</div>
            </section>
          )}

          <section>
            <h2>{t('triggersHeading')}</h2>
            <Triggers triggers={status.triggers} t={t} />
          </section>

          <section>
            <h2>{t('sampleHeading')}</h2>
            <div className="preview">
              <div className="ptitle">{status.sample.title}</div>
              <div className="pbody">{status.sample.body}</div>
            </div>
            <div className="hint">{t('sampleNote')}</div>
          </section>
        </>
      )}

      <section>
        <h2>{t('recentHeading')}</h2>
        {entries.length === 0 ? (
          <div className="hint">{t('recentEmpty')}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('colTime')}</th>
                <th>{t('colEvent')}</th>
                <th>{t('colOutcome')}</th>
                <th>{t('colDetail')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={`${entry.ts}-${index}`}>
                  <td className="mono">{timeOf(entry.ts)}</td>
                  <td>{entry.title}</td>
                  <td>
                    <span className="badge" data-outcome={entry.outcome}>
                      {entry.outcome === 'sent'
                        ? t('outcomeSent')
                        : entry.outcome === 'failed'
                          ? t('outcomeFailed')
                          : t('outcomeSuppressed')}
                    </span>
                  </td>
                  <td className="detail">{detailOf(entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}