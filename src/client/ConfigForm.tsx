/**
 * The editable configuration form.
 *
 * Rendered generically from the descriptors the host sends, so a new provider
 * is one entry in `src/fields.ts` rather than a new branch here. Labels are
 * looked up in the panel's dictionary by config key, which is why the host sends
 * keys and not English.
 *
 * Two behaviours are deliberate:
 *
 *  - **A secret field is write-only.** The stored value never leaves the host, so
 *    the input starts blank and an untouched field is simply omitted from the
 *    patch. There is no "clear" action, because that would make a save able to
 *    wipe a working credential by accident.
 *  - **Only changed values are sent.** The form compares against what the host
 *    reported, so saving re-states nothing the user did not touch.
 *
 * @module dsh-notify-push/client/ConfigForm
 */

import { useCallback, useState, type ReactElement } from 'react'
import { API, type ConfigField, type StatusPayload } from '../protocol.ts'
import { fieldLabelKey, type PanelTranslate } from './locales.ts'
import { PANEL_ID } from './plugin.ts'

/** A value the user is editing. Numbers stay strings until save. */
type DraftValue = string | number | boolean

/** Props for the reveal glyph. */
interface EyeIconProps {
  /** Whether the value is currently masked, which is when a slash is drawn. */
  off: boolean
}

/**
 * The reveal glyph: an eye, crossed out while the value is hidden.
 *
 * Drawn inline in `currentColor` so it inherits the button's own colour in both
 * themes, and `aria-hidden` because the button already carries the label.
 *
 * @param props - whether the value is masked.
 * @returns the inline SVG glyph.
 */
function EyeIcon({ off }: EyeIconProps): ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1.4 8S3.8 4.1 8 4.1 14.6 8 14.6 8 12.2 11.9 8 11.9 1.4 8 1.4 8Z" />
      <circle cx="8" cy="8" r="1.85" />
      {off ? <path d="M2.6 13.4 13.4 2.6" /> : null}
    </svg>
  )
}

/** Props composed by the panel. */
export interface ConfigFormProps {
  /** Field descriptors from the host. */
  fields: ConfigField[]
  /** Whether a write can actually be persisted. */
  canEdit: boolean
  /** The currently selected provider, from the status payload. */
  provider: string
  /** Translate seat. */
  t: PanelTranslate
  /**
   * Called with the fresh status after a successful save.
   * @param status - the payload the host returned for the write.
   */
  onSaved(status: StatusPayload): void
}

/**
 * Render the configuration form.
 * @param props - descriptors, editability, the translate seat and the save hook.
 * @returns the form section.
 */
export function ConfigForm({ fields, canEdit, provider, t, onSaved }: ConfigFormProps): ReactElement {
  const [draft, setDraft] = useState<Record<string, DraftValue>>({})
  // Reveal state is per field, not one global switch: the affordance lives on
  // the input it affects, so it reads as "unmask this one" without a label.
  const [revealedFields, setRevealedFields] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | undefined>(undefined)

  // The provider being edited, which may not be the one currently saved: the
  // select switches the visible group before anything is written.
  const activeProvider = typeof draft.provider === 'string' ? draft.provider : provider
  const visible = fields.filter(
    (field) => field.group === 'common' || field.group === activeProvider,
  )

  /** Record one edit and clear any stale save message. */
  const update = useCallback((key: string, value: DraftValue): void => {
    setDraft((previous) => ({ ...previous, [key]: value }))
    setNote(undefined)
  }, [])

  /** Flip one field between masked and plaintext. */
  const toggleReveal = useCallback((key: string): void => {
    setRevealedFields((previous) => ({ ...previous, [key]: previous[key] !== true }))
  }, [])

  const save = useCallback(async (): Promise<void> => {
    const patch: Record<string, DraftValue> = {}
    for (const [key, value] of Object.entries(draft)) {
      const field = fields.find((candidate) => candidate.key === key)
      if (field === undefined) continue

      if (field.kind === 'secret') {
        // Blank means "keep whatever is stored" — the value is never sent back,
        // so an untouched field must not become an empty write.
        if (typeof value === 'string' && value.length > 0) patch[key] = value
        continue
      }
      if (field.kind === 'number') {
        const parsed = typeof value === 'number' ? value : Number(value)
        if (Number.isFinite(parsed)) patch[key] = parsed
        continue
      }
      if (value !== field.value) patch[key] = value
    }

    if (Object.keys(patch).length === 0) {
      setNote({ ok: false, text: t('configNoChange') })
      return
    }

    setSaving(true)
    try {
      const response = await fetch(API.config, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ patch }),
      })
      const payload = (await response.json()) as StatusPayload | { error?: string }
      if (!response.ok) {
        throw new Error((payload as { error?: string }).error ?? `HTTP ${response.status}`)
      }
      setDraft({})
      onSaved(payload as StatusPayload)
      setNote({ ok: true, text: t('configSaved') })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setNote({ ok: false, text: `${t('configFailed')} — ${detail}` })
    } finally {
      setSaving(false)
    }
  }, [draft, fields, onSaved, t])

  /** Render the control for one descriptor. */
  function control(field: ConfigField): ReactElement {
    const label = t(fieldLabelKey(field.key)) || field.key
    const pending = draft[field.key]
    const disabled = !canEdit || saving
    // A real `for`/`id` pair rather than a wrapping label: the secret rows hold
    // a button, and a button inside a label forwards its click to the input.
    const inputId = `${PANEL_ID}-field-${field.key}`

    if (field.kind === 'switch') {
      const checked = typeof pending === 'boolean' ? pending : field.value === true
      return (
        <div key={field.key} className="row">
          <label className="fieldLabel" htmlFor={inputId}>
            {label}
          </label>
          <input
            id={inputId}
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(event) => update(field.key, event.target.checked)}
          />
        </div>
      )
    }

    if (field.kind === 'select') {
      const value = typeof pending === 'string' ? pending : String(field.value ?? '')
      return (
        <div key={field.key} className="row">
          <label className="fieldLabel" htmlFor={inputId}>
            {label}
          </label>
          <select
            id={inputId}
            value={value}
            disabled={disabled}
            onChange={(event) => update(field.key, event.target.value)}
          >
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      )
    }

    const isSecret = field.kind === 'secret'
    const revealed = revealedFields[field.key] === true
    const value = pending !== undefined ? String(pending) : isSecret ? '' : String(field.value ?? '')
    const placeholder = isSecret ? (field.set === true ? t('configSecretStored') : t('configSecretEmpty')) : ''
    return (
      <div key={field.key} className="row">
        <label className="fieldLabel" htmlFor={inputId}>
          {label}
        </label>
        <span className="inputWrap">
          <input
            id={inputId}
            type={isSecret && !revealed ? 'password' : field.kind === 'number' ? 'number' : 'text'}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => update(field.key, event.target.value)}
          />
          {isSecret ? (
            <button
              type="button"
              className="eye"
              // The label has to say which value it reveals: a bare "Show" next
              // to Save read as "show me the stored token", which this cannot do
              // — the browser never receives it.
              aria-label={revealed ? t('secretHide') : t('secretReveal')}
              aria-pressed={revealed}
              title={revealed ? t('secretHide') : t('secretReveal')}
              disabled={disabled}
              onClick={() => toggleReveal(field.key)}
            >
              <EyeIcon off={revealed} />
            </button>
          ) : null}
        </span>
      </div>
    )
  }

  return (
    <section>
      <h2>{t('configHeading')}</h2>
      <div className="panel">
        <div className="hint">{canEdit ? t('configIntro') : t('configReadOnly')}</div>
        <div className="form">{visible.map(control)}</div>
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={!canEdit || saving}
            onClick={() => void save()}
          >
            {saving ? t('configSaving') : t('configSave')}
          </button>
        </div>
        {note === undefined ? null : <div className={note.ok ? 'notice' : 'error'}>{note.text}</div>}
      </div>
    </section>
  )
}