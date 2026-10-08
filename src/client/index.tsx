/**
 * dsh-notify-push — browser half.
 *
 * Contributes one entry to the settings navigation (`settings.section`), keyed
 * by `dshNotifyPush`. The Settings shell owns the trigger, the panel, the nav
 * list and the scrolling container; this plugin only supplies the section body.
 *
 * That seat was chosen over a sidebar row plus a centre-column page, which is
 * what an earlier revision used. A notifier is a thing you configure once and
 * glance at occasionally, so giving it a permanent rail icon and a whole page in
 * the main column overstated it. The settings shell also means the plugin no
 * longer has to draw its own chrome: `settings.section` is a `list` slot whose
 * entries carry `{ id, order, label }`, and the shell renders the active one
 * inside its own scrolling panel — so this half must not add a second scroll
 * container or its own horizontal padding.
 *
 * `dsh.client.inject` in package.json orders this bundle after
 * `@deepseek-ai/dsh-client-ui-settings-general`, which is the package that
 * declares `settings.section` (and registers the General section itself), so the
 * `slots.inject` below resolves instead of racing the declaration.
 *
 * This module is bundled into the loader's factory form; its top-level side
 * effects run at materialization, which is when the client module system claims
 * styles and installs the plugin.
 *
 * @module dsh-notify-push/client
 */

import type { SlotCore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only import for its `declare module` augmentation: `ui-settings` owns the
// canonical settings slot contract, so this is what makes `'settings.section'` a
// known key of SlotMap — and therefore what makes a typo in the slot id or its
// options a compile error instead of a silent no-op at runtime.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SettingsSection } from './SettingsSection.tsx'
import { en, zh, type PanelTranslate } from './locales.ts'
// The ids and the injection list live in a plain `.ts` module so a test can
// import them without pulling JSX into the host tsconfig.
import { NS, PANEL_ID, inject } from './plugin.ts'
import { injectStyles } from './styles.ts'

export { NS, PANEL_ID, inject }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Keys of this plugin's own dictionary. */
    dshNotifyPush: keyof typeof en
  }
}

/** Structural face of the client locale service. */
interface LocaleService {
  register(namespace: 'dshNotifyPush', dictionaries: { en: typeof en; zh: typeof zh }): () => void
  bind(namespace: 'dshNotifyPush'): TranslateNS<'dshNotifyPush'>
}

/** Structural face of the client slot service. */
interface SlotsService {
  readonly register: SlotCore['register']
  /**
   * Run `callback` once the named slot is declared; the returned disposer is
   * the registration's own disposer, so the effect teardown removes it.
   */
  inject(key: string, callback: () => () => void): () => void
}

/** Structural face of the client root context this plugin uses. */
interface ClientContext {
  effect(callback: () => (() => void) | void, label?: string): void
  slots: SlotsService
  locale: LocaleService
}

/**
 * Where the section sits in the settings navigation.
 *
 * The shell's own sections use `-10` (Account) and `0` (General); a positive
 * order puts a plugin's section after the built-ins rather than between them.
 */
const SECTION_ORDER = 40

/**
 * Register the settings section.
 *
 * An external plugin must never take the web shell down with it, so mounting
 * failures are logged rather than thrown: the shell fails the whole boot when a
 * plugin's `apply` throws.
 *
 * @param ctx - client root context carrying the slot and locale services.
 */
export function apply(ctx: ClientContext): void {
  try {
    ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-notify-push: dictionaries')
    const t: PanelTranslate = ctx.locale.bind(NS)

    ctx.effect(
      () =>
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: PANEL_ID,
              order: SECTION_ORDER,
              // A function, not a string: the nav list folds this on every
              // locale revision, so the entry follows the language setting.
              label: () => t('panel'),
              locale: NS,
            },
            SettingsSection,
          ),
        ),
      'dsh-notify-push: settings section',
    )
  } catch (error) {
    console.warn('[dsh-notify-push] the settings section could not mount', error)
  }
}

// Materialization runs this: the client module system claims a style tag created
// from the bundle's factory body and removes it again when the plugin unloads.
injectStyles()