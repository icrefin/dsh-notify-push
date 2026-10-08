/**
 * The panel stylesheet.
 *
 * Two rules make plugin UI look like the Harness rather than beside it:
 *
 *  - every color is a `--dsw-alias-*` theme token, never a literal, so light
 *    and dark both work and a renamed token degrades instead of breaking;
 *  - the tag is created from the bundle's own factory body, so the client
 *    module system claims it and removes it when the plugin is disabled.
 *
 * Selectors hang off one plugin-unique root class rather than repeating a
 * prefix on every rule, which keeps the sheet readable and is exactly as
 * collision-proof: nothing outside this subtree can match.
 *
 * Geometry and type follow the repo's `STYLES.md`: a centred 960px column that
 * owns its own scrolling, a 20px page title, 13px body, 12px table, 8–12px
 * radii, and `color-mix` tints held to 10%.
 *
 * @module dsh-notify-push/client/styles
 */

/** Id of the stylesheet tag, so injection stays idempotent. */
export const STYLE_ID = 'dsh-notify-push-style'

/** Class on the panel's outermost element; every rule below hangs off it. */
export const ROOT_CLASS = 'dsh-notify-push-page'

/** Theme-token-only stylesheet for the settings section. */
export const PANEL_CSS = `
/* The section body, not a page. The Settings shell renders this into its own
   scrolling container (flex:1; min-height:0; padding:0 24px 24px; overflow-y:auto),
   so this rule deliberately sets no height, no scroll, no max-width and no
   horizontal padding — any of those would double what the shell already does.
   The page geometry in the repo style contract applies to a centre-column view,
   which this is not. */
.${ROOT_CLASS}{
  color-scheme:light dark;
  display:flex;flex-direction:column;gap:24px;
  box-sizing:border-box;
  color:var(--dsw-alias-label-primary);
  font-size:13px;line-height:20px;
  -webkit-font-smoothing:antialiased;
}
/* The panel supplies the top padding; a small nudge keeps the heading off the
   nav's edge without the main window's frame-clearance rule, which belongs to a
   view pinned under the title bar rather than to a modal. */
.${ROOT_CLASS} > header{padding-top:4px;display:flex;flex-direction:column;gap:8px}
.${ROOT_CLASS} h1{margin:0;font-size:20px;font-weight:500;line-height:28px}
/* Version chip beside the title, per the repo style contract: 12px/500 in
   label-caption, nudged 6px off the title, tabular figures so "0.1.10" does not
   jitter the title's width when it rolls over. */
.${ROOT_CLASS} h1 .version{
  margin-left:6px;font-size:12px;font-weight:500;line-height:1;
  color:var(--dsw-alias-label-caption);
  font-variant-numeric:tabular-nums;
}
.${ROOT_CLASS} h2{margin:0;font-size:13px;font-weight:600;line-height:20px}
.${ROOT_CLASS} .intro{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;max-width:64ch}
.${ROOT_CLASS} .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}

.${ROOT_CLASS} button{
  font:inherit;font-size:12.5px;line-height:18px;
  border:1px solid transparent;border-radius:8px;padding:6px 12px;cursor:pointer;
  background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);
}
.${ROOT_CLASS} button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.${ROOT_CLASS} button:disabled{opacity:.45;cursor:default}
.${ROOT_CLASS} button.primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.${ROOT_CLASS} button.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.${ROOT_CLASS} :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}

.${ROOT_CLASS} section{display:flex;flex-direction:column;gap:12px}
.${ROOT_CLASS} .panel{
  border:1px solid var(--dsw-alias-border-l2);border-radius:12px;
  background:var(--dsw-alias-bg-layer-1);padding:16px;
  display:flex;flex-direction:column;gap:12px;
}
.${ROOT_CLASS} .grid{display:grid;grid-template-columns:max-content 1fr;gap:8px 20px}
.${ROOT_CLASS} .key{color:var(--dsw-alias-label-secondary)}
.${ROOT_CLASS} .value{word-break:break-word}
.${ROOT_CLASS} .mono{font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px}

.${ROOT_CLASS} .chip{
  display:inline-flex;align-items:center;gap:6px;
  border:0.5px solid var(--dsw-alias-border-l3);border-radius:999px;
  padding:3px 10px;font-size:11px;line-height:16px;font-weight:500;
  color:var(--dsw-alias-label-tertiary);
}
.${ROOT_CLASS} .chip[data-on=true]{
  color:var(--dsw-alias-state-success-primary);
  border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 30%, transparent);
}
.${ROOT_CLASS} .chips{display:flex;flex-wrap:wrap;gap:8px}

.${ROOT_CLASS} .preview{
  border:1px solid var(--dsw-alias-border-l2);border-radius:12px;
  background:var(--dsw-alias-bg-module-platform);padding:12px 14px;
  display:flex;flex-direction:column;gap:4px;max-width:52ch;
}
.${ROOT_CLASS} .preview .ptitle{font-size:13px;font-weight:600;line-height:18px}
.${ROOT_CLASS} .preview .pbody{font-size:13px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:pre-line}

/* The subscribe fields carry a value the user has to retype on a phone.
   \`user-select:all\` makes one click take the whole string, which is the
   difference between a copyable topic and a 36-character transcription. */
.${ROOT_CLASS} .stack{display:flex;flex-direction:column;gap:10px}
.${ROOT_CLASS} .field{
  display:block;width:100%;box-sizing:border-box;
  border:1px solid var(--dsw-alias-border-l2);border-radius:8px;
  background:var(--dsw-alias-bg-module-platform);padding:6px 10px;
  font-size:12px;line-height:18px;
  font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);
  user-select:all;cursor:text;word-break:break-all;
}
.${ROOT_CLASS} .fieldLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin-bottom:2px}

/* The configuration form. A two-column grid keeps every label aligned with its
   control, and min-width:0 stops a long server URL from blowing out the column. */
.${ROOT_CLASS} .form{display:flex;flex-direction:column;gap:10px}
.${ROOT_CLASS} .row{display:grid;grid-template-columns:minmax(140px,220px) 1fr;align-items:center;gap:12px}
.${ROOT_CLASS} .row .fieldLabel{margin:0}
.${ROOT_CLASS} input[type=text],
.${ROOT_CLASS} input[type=password],
.${ROOT_CLASS} input[type=number],
.${ROOT_CLASS} select{
  font:inherit;font-size:12px;line-height:18px;box-sizing:border-box;
  width:100%;min-width:0;padding:5px 9px;
  border:1px solid var(--dsw-alias-border-l2);border-radius:8px;
  background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);
}
.${ROOT_CLASS} input::placeholder{color:var(--dsw-alias-label-tertiary)}
.${ROOT_CLASS} input:disabled,
.${ROOT_CLASS} select:disabled{opacity:.5}
/* brand-primary is the sanctioned accent for switches, per the style contract. */
.${ROOT_CLASS} input[type=checkbox]{width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary)}

/* A secret input with its reveal button sitting inside the field, so the
   affordance is attached to the value it affects rather than a global switch. */
.${ROOT_CLASS} .inputWrap{position:relative;display:block;min-width:0}
.${ROOT_CLASS} .inputWrap input{padding-right:34px}
.${ROOT_CLASS} .eye{
  position:absolute;top:50%;right:5px;transform:translateY(-50%);
  display:inline-flex;align-items:center;justify-content:center;
  width:24px;height:24px;padding:0;border:0;border-radius:6px;
  background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;
}
.${ROOT_CLASS} .eye:hover:not(:disabled){
  background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);
}
.${ROOT_CLASS} .eye:disabled{opacity:.45;cursor:default}

.${ROOT_CLASS} table{width:100%;border-collapse:collapse;font-size:12px}
.${ROOT_CLASS} th{
  text-align:left;font-weight:500;color:var(--dsw-alias-label-secondary);
  padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);
}
.${ROOT_CLASS} td{padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);vertical-align:top}
.${ROOT_CLASS} tbody tr:last-child td{border-bottom:none}
.${ROOT_CLASS} td.detail{color:var(--dsw-alias-label-secondary);word-break:break-word;max-width:44ch}

.${ROOT_CLASS} .badge{display:inline-block;border-radius:999px;padding:2px 8px;font-size:11px;line-height:16px;font-weight:500}
.${ROOT_CLASS} .badge[data-outcome=sent]{
  color:var(--dsw-alias-state-success-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
}
.${ROOT_CLASS} .badge[data-outcome=failed]{
  color:var(--dsw-alias-state-error-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
}
.${ROOT_CLASS} .badge[data-outcome=suppressed]{
  color:var(--dsw-alias-label-tertiary);
  background:var(--dsw-alias-bg-module-platform);
}

.${ROOT_CLASS} .counters{display:flex;gap:24px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.${ROOT_CLASS} .counters b{display:block;font-size:16px;font-weight:500;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.${ROOT_CLASS} .error{color:var(--dsw-alias-state-error-primary)}
.${ROOT_CLASS} .notice{color:var(--dsw-alias-state-success-primary)}
.${ROOT_CLASS} .hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
`

/** Append the stylesheet once per document. */
export function injectStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = PANEL_CSS
  document.head.append(style)
}