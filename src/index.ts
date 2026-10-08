/**
 * dsh-notify-push — host half.
 *
 * Watches the harness's own lifecycle events and pushes a short, phone-shaped
 * notification out through one configured backend. The browser half
 * (`./client`) is the sidebar panel that reads this half's state and can fire a
 * test delivery.
 *
 * ## What a notification says
 *
 * Every notification carries the same three facts, in a fixed shape, because
 * that is what the user asked to see on a lock screen:
 *
 * | Part | Field | Example |
 * |---|---|---|
 * | event type | title segment 1 | `Agent finished` |
 * | host | title segment 2 | `workstation.local` |
 * | session | body line 1 | `Fix the login redirect` |
 * | detail | body line 2 | `done in 42s` |
 *
 * ## Why the event types are declared locally
 *
 * The event names and payload shapes below are verified against dsh
 * `0.2.0-rc.2` (`@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-user-approval`).
 * They are re-declared as structural types rather than imported, so this
 * package does not pin three more `@deepseek-ai/*` runtime versions for the
 * sake of a type-only augmentation — but the names are a closed union, so a
 * typo is still a compile error.
 *
 * ## The one non-obvious hook
 *
 * `agent/error` carries `{ turn, step, error }` — **no agent and no session**,
 * so a root-level listener cannot name the session that failed. To get the
 * session name onto the notification, this plugin listens for `agent/created`
 * and installs a second `agent/error` listener on the *agent's own* context,
 * which has the agent in scope. The root listener stays as a fallback for an
 * agent whose context was not reachable, with a `WeakSet` of already-handled
 * payloads so one error never produces two notifications.
 *
 * @module dsh-notify-push
 */

import { hostname } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
// Type-only import for the declaration merging that puts `webServer` on Context.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { Config as configSchema, type NotifyPushConfig } from './config.ts'
import { createEngine, type Engine, type FetchLike } from './engine.ts'
import { describeFields, type ValidPatch } from './fields.ts'
import { bodyOf, formatDuration, makeEvent, titleOf } from './format.ts'
import { inspect } from './providers.ts'
import { API, type HistoryEntry, type NotifyEvent, type StatusPayload, type TestPayload } from './protocol.ts'
import { makeRoutes, type RouteApi } from './routes.ts'
import { resolveSettings, type Settings } from './settings.ts'
import { packageVersion } from './version.ts'

/** Loader row id; mirrors `cordis.patch.yml`. */
export const name = 'dsh-notify-push'

/** Services required before this plugin may mount. */
export const inject = ['webServer']

/** The row's config schema, re-exported under the name the Loader looks for. */
export const Config = configSchema

/** A registration's disposer. */
type Disposer = () => void

/** The lifecycle events this plugin subscribes to. */
type HostEvent =
  | 'agent/status'
  | 'agent/error'
  | 'agent/created'
  | 'agent/disposed'
  | 'approval/request'
  | 'user-questions/request'

/** Payload of `agent/status`. */
interface AgentStatusPayload {
  /** The agent whose status changed. */
  agent: AgentLike
  /** `running` while a turn is in flight, `idle` otherwise. */
  status: 'idle' | 'running'
}

/** Payload of `agent/error`, whose shape explains the scoped listener below. */
interface AgentErrorPayload {
  /** 1-based turn number. */
  turn?: number
  /** 1-based step number within the turn. */
  step?: number
  /** The failure. */
  error?: unknown
}

/** Payload of `agent/created` and `agent/disposed`. */
interface AgentLifecyclePayload {
  /** The agent. */
  agent: AgentLike
}

/** Payload of the `approval/request` waterfall. */
interface ApprovalRequestPayload {
  /** The agent asking. */
  agent?: AgentLike
  /** Tool awaiting a decision. */
  toolName?: string
  /** Why the tool wants a decision. */
  reason?: string
}

/** One question inside a `user-questions/request`. */
interface UserQuestionLike {
  /** Stable id, echoed in the answer. */
  id?: unknown
  /** The question to put to the user. */
  question?: unknown
  /** Optional short heading, e.g. `Confirm` or `Choose Mode`. */
  header?: unknown
  /** Optional choices offered. */
  options?: Array<{ label?: unknown }>
}

/** Payload of the `user-questions/request` waterfall. */
interface UserQuestionRequestPayload {
  /** The batch of questions the agent is blocked on. */
  questions?: UserQuestionLike[]
  /** The agent asking. */
  agent?: AgentLike
}

/** The slice of a live agent this plugin reads. */
interface AgentLike {
  /** The session the agent drives. */
  session?: { id?: unknown }
  /** The agent's own cordis context, where its scoped events land. */
  ctx?: ScopedContext
}

/** A context owned by something else, onto which this plugin registers. */
interface ScopedContext {
  /**
   * Subscribe to one of the agent's scoped events.
   * @param event - event name.
   * @param listener - the handler.
   * @returns a disposer, when the implementation provides one.
   */
  on(event: HostEvent, listener: (...args: never[]) => unknown): Disposer | void
}

/** The slice of the cordis root context this plugin uses. */
interface HostContext {
  /**
   * Subscribe to a lifecycle event.
   * @param event - event name.
   * @param listener - the handler.
   * @param options - `prepend` puts this listener outermost in a waterfall.
   * @returns the disposer.
   */
  on(
    event: HostEvent,
    listener: (...args: never[]) => unknown,
    options?: { prepend?: boolean },
  ): Disposer
  /**
   * Run a registration, and undo it when the plugin unloads.
   * @param callback - returns the disposer.
   * @param label - diagnostic label.
   */
  effect(callback: () => Disposer | void, label?: string): void
  /**
   * Look up an optional service.
   * @param name - service name.
   * @returns the service, or `undefined` when this deployment has no such thing.
   */
  get(name: string): unknown
  /** Register a named HTTP route. */
  webServer: { register(route: WebRoute): Disposer }
  /** Diagnostics. */
  logger: {
    info(...args: unknown[]): void
    warn(...args: unknown[]): void
    debug(...args: unknown[]): void
  }
}

/** The session-title service, when the deployment composes one. */
interface SessionTitleService {
  /**
   * Read the latest folded title for a session.
   * @param session - the live session.
   * @returns a snapshot carrying `.title`, or `undefined`.
   */
  get(session: unknown): { title?: unknown } | undefined
}

/**
 * The slice of the harness settings service this plugin uses.
 *
 * A Loader entry's `Config` **is** its settings namespace, so the row id is the
 * namespace string here. Writing through this service lands the value in the
 * host's settings document, which is reapplied to the row on the next boot — and
 * because every field of this plugin's schema is `.volatile()`, the loader also
 * swaps it into the running fiber, so a saved change takes effect immediately
 * instead of at the next restart.
 */
interface SettingsService {
  /**
   * Merge editable fields into this row's config.
   * @param ns - profile entry id, which is this plugin's row id.
   * @param patch - field values to merge.
   * @returns resolves once the document is written.
   */
  update(ns: string, patch: Record<string, string | number | boolean>): Promise<void>
}

/** The real `fetch`, narrowed to the shape the engine needs. */
const httpFetch: FetchLike = (url, init) => fetch(url, init)

/**
 * The machine name that goes into every notification title.
 * @returns the hostname, or a placeholder when the platform will not say.
 */
function machineName(): string {
  try {
    const value = hostname().trim()
    return value.length > 0 ? value : 'unknown-host'
  } catch {
    return 'unknown-host'
  }
}

/** Shorten an unknown thrown value into one line. */
function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? 'unknown error')
  return text.replace(/\s+/g, ' ').trim().slice(0, 200)
}

/**
 * Flatten and shorten a string to one notification-sized line.
 *
 * A lock screen shows one or two lines before it truncates on its own terms, so
 * the cutting is done here — on a word boundary's worth of sense rather than
 * mid-word by the OS, and with the ellipsis visible so a truncated question is
 * never mistaken for the whole one.
 *
 * @param text - the source text.
 * @param limit - maximum length, ellipsis included.
 * @returns the flattened text, cut to `limit` when it had to be.
 */
function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat
}

/**
 * Mount the event listeners and the route family.
 *
 * Every registration goes through `ctx.effect`, whose callback returns the
 * disposer. Cordis runs that cleanup when the plugin unloads, when a profile
 * patch disables the row, and at shutdown; a bare `register()` would leak past
 * unload and break hot reload.
 *
 * @param ctx - host plugin context.
 * @param config - the row's config, as volatile holders.
 */
export function apply(ctx: Context, config: NotifyPushConfig = {}): void {
  const host = ctx as unknown as HostContext

  /** Read the config afresh; a volatile field may have changed since `apply()`. */
  const settings = (): Settings => resolveSettings(config)

  /**
   * The harness settings service, looked up on demand.
   *
   * On demand rather than in `inject`, because the plugin is fully useful
   * without it: a composition that has no settings service can still deliver
   * notifications from YAML-supplied values, and holding the fiber for a service
   * that only the *editor* needs would be the wrong trade. Its absence disables
   * the form instead.
   *
   * @returns the service, or `undefined` when this deployment has none.
   */
  const settingsService = (): SettingsService | undefined => host.get('settings') as SettingsService | undefined

  const log = (message: string): void => host.logger.info('%s', message)

  const engine: Engine = createEngine({
    settings,
    fetch: httpFetch,
    now: () => Date.now(),
    log,
  })

  const machine = machineName()

  /**
   * Resolve the session behind an agent, for the notification's first body line.
   * @param agent - the agent, when the event carried one.
   * @returns the session title and id, when either is known.
   */
  function sessionOf(agent: AgentLike | undefined): { title: string; id: string } | undefined {
    const session = agent?.session
    const id = typeof session?.id === 'string' ? session.id : ''
    let title = ''
    try {
      const service = host.get('sessionTitle') as SessionTitleService | undefined
      const snapshot = service?.get(session)
      if (typeof snapshot?.title === 'string') title = snapshot.title.trim()
    } catch {
      // A missing title is a cosmetic loss; it must never stop the delivery.
    }
    if (title.length === 0 && id.length === 0) return undefined
    return { title, id }
  }

  /**
   * Build the event for one occurrence, applying the content switches.
   * @param kind - what raised it.
   * @param agent - the agent it belongs to, when known.
   * @param detail - the second body line.
   * @returns the resolved event.
   */
  function compose(kind: NotifyEvent['kind'], agent: AgentLike | undefined, detail: string): NotifyEvent {
    const current = settings()
    const session = sessionOf(agent)
    return makeEvent(kind, {
      host: current.includeHostName ? machine : '',
      session: current.includeSessionName ? (session?.title ?? '') : '',
      detail,
      ...(session === undefined || session.id.length === 0 ? {} : { sessionId: session.id }),
    })
  }

  /** Fire and forget: the engine never throws, and the loop must not wait. */
  function emit(event: NotifyEvent): void {
    void engine.dispatch(event).catch((error: unknown) => {
      host.logger.warn('[%s] dispatch failed: %s', name, describeError(error))
    })
  }

  // ---- triggers --------------------------------------------------------

  /** Turn timing, keyed by the live agent; cleaned when the agent goes away. */
  const startedAt = new Map<unknown, number>()

  host.effect(
    () =>
      host.on('agent/status', (payload) => {
        const { agent, status } = payload as unknown as AgentStatusPayload
        if (status === 'running') {
          startedAt.set(agent, Date.now())
          return
        }
        const started = startedAt.get(agent)
        startedAt.delete(agent)
        if (started === undefined) return
        const current = settings()
        if (!current.notifyOnIdle) return
        const elapsed = Date.now() - started
        if (elapsed < current.minTurnDurationMs) return
        emit(compose('turn-finished', agent, `done in ${formatDuration(elapsed)}`))
      }),
    'dsh-notify-push: turn-finished trigger',
  )

  host.effect(
    () =>
      host.on('agent/disposed', (payload) => {
        startedAt.delete((payload as unknown as AgentLifecyclePayload).agent)
      }),
    'dsh-notify-push: turn timing cleanup',
  )

  /**
   * One error, once.
   *
   * The scoped listener registered per agent marks the payload before handling
   * it, so the root fallback below can recognise an error that was already
   * reported with a session name attached.
   */
  const handledErrors = new WeakSet<object>()

  function reportError(agent: AgentLike | undefined, payload: AgentErrorPayload): void {
    if (!settings().notifyOnError) return
    const turn = payload.turn ?? 0
    const step = payload.step ?? 0
    const where = turn > 0 ? `turn ${turn}, step ${step}: ` : ''
    emit(compose('agent-error', agent, `${where}${describeError(payload.error)}`))
  }

  /** Disposers for the per-agent listeners, so an agent's cleanup is exact. */
  const scopedDisposers = new Map<unknown, Disposer>()

  host.effect(() => {
    const offCreated = host.on('agent/created', (payload) => {
      const agent = (payload as unknown as AgentLifecyclePayload).agent
      const scoped = agent?.ctx
      if (scoped === undefined || typeof scoped.on !== 'function') return
      try {
        const dispose = scoped.on('agent/error', (errorPayload) => {
          handledErrors.add(errorPayload as unknown as object)
          reportError(agent, errorPayload as unknown as AgentErrorPayload)
        })
        if (typeof dispose === 'function') scopedDisposers.set(agent, dispose)
      } catch (error) {
        host.logger.warn('[%s] could not scope an error listener: %s', name, describeError(error))
      }
    })

    const offDisposed = host.on('agent/disposed', (payload) => {
      const agent = (payload as unknown as AgentLifecyclePayload).agent
      const dispose = scopedDisposers.get(agent)
      if (dispose !== undefined) {
        scopedDisposers.delete(agent)
        try {
          dispose()
        } catch {
          // A failing disposer on teardown is not worth a notification.
        }
      }
      handledErrors.delete(agent as unknown as object)
    })

    // Fallback for an error from an agent whose context never reached us.
    const offRootError = host.on('agent/error', (payload) => {
      const typed = payload as unknown as AgentErrorPayload
      if (handledErrors.has(typed as unknown as object)) return
      reportError(undefined, typed)
    })

    return () => {
      offCreated()
      offDisposed()
      offRootError()
      for (const dispose of scopedDisposers.values()) {
        try {
          dispose()
        } catch {
          // As above: teardown failures are swallowed.
        }
      }
      scopedDisposers.clear()
    }
  }, 'dsh-notify-push: scoped error listeners')

  host.effect(
    () =>
      host.on(
        'approval/request',
        (payload, next) => {
          // `approval/request` is a WATERFALL. This listener only observes, so it
          // must delegate with `next()`; returning without it would claim the
          // decision and swallow the real answerers.
          if (settings().notifyOnApproval) {
            const request = payload as unknown as ApprovalRequestPayload
            const tool = request.toolName ?? 'a tool'
            const detail = request.reason ? `${tool} — ${request.reason}` : tool
            emit(compose('approval-needed', request.agent, detail))
          }
          return (next as () => unknown)()
        },
        // Outermost, so the notification is raised BEFORE any answerer claims
        // the request — see the note on the question trigger below.
        { prepend: true },
      ),
    'dsh-notify-push: approval trigger',
  )

  /**
   * Render one question batch into the notification's second body line.
   *
   * The question text is the point — a notification that only said "the agent
   * has a question" would make you open the app to find out whether it matters.
   * The offered choices ride along on their own line when there are few, since
   * they are what decides whether it is worth answering now.
   *
   * @param questions - the batch the agent is blocked on.
   * @returns the detail text.
   */
  function questionDetail(questions: UserQuestionLike[]): string {
    const first = questions[0]
    if (first === undefined) return 'the agent is waiting on an answer'

    const text = typeof first.question === 'string' ? first.question.trim() : ''
    const header = typeof first.header === 'string' ? first.header.trim() : ''
    const lead = header.length > 0 ? `${header} — ${text}` : text
    // A batch is answered together, so a count is more useful than a list.
    const more = questions.length > 1 ? ` (+${questions.length - 1} more)` : ''

    const labels = (first.options ?? [])
      .map((option) => (typeof option.label === 'string' ? option.label.trim() : ''))
      .filter((label) => label.length > 0)
    const choices = labels.length > 0 ? labels.slice(0, 4).join(' · ') : ''

    return [clip(lead, 240) + more, clip(choices, 120)]
      .filter((line) => line.length > 0)
      .join('\n')
  }

  host.effect(
    () =>
      host.on(
        'user-questions/request',
        (payload, next) => {
          // `user-questions/request` is a WATERFALL, and a narrower one than
          // approval: the answerer that claims it is the only thing that can let
          // the agent continue. This listener observes and delegates, never
          // returns early — doing so would block the turn forever behind a
          // notification nobody can answer from.
          if (settings().notifyOnQuestion) {
            const request = payload as unknown as UserQuestionRequestPayload
            emit(compose('question-asked', request.agent, questionDetail(request.questions ?? [])))
          }
          return (next as () => unknown)()
        },
        // **Prepend, or this listener never runs at all.**
        //
        // A waterfall composes outermost-first and `next()` walks inwards, but
        // the answerer that claims the request does not walk at all — it just
        // resolves with the user's answer. `dsh-api-remotes` is exactly that
        // answerer, so a listener registered after it sits behind a claim and is
        // never invoked. Prepend puts this one outermost, where it can observe
        // and then hand the request on; the claimer still owns the outcome.
        { prepend: true },
      ),
    'dsh-notify-push: question trigger',
  )

  // ---- routes ----------------------------------------------------------

  /** The layout a real idle notification would have, for the panel to display. */
  function sampleEvent(): NotifyEvent {
    const current = settings()
    return makeEvent('turn-finished', {
      host: current.includeHostName ? machine : '',
      session: current.includeSessionName ? 'Fix the login redirect' : '',
      detail: 'done in 42s',
    })
  }

  function statusPayload(): StatusPayload {
    const current = settings()
    const info = inspect(current)
    const sample = sampleEvent()
    const payload: StatusPayload = {
      id: name,
      version: packageVersion(),
      enabled: current.enabled,
      provider: current.providerRaw,
      configured: info.configured,
      target: info.target,
      host: machine,
      triggers: {
        idle: current.notifyOnIdle,
        error: current.notifyOnError,
        approval: current.notifyOnApproval,
        question: current.notifyOnQuestion,
      },
      sample: { title: titleOf(sample, current.titlePrefix), body: bodyOf(sample) },
      counters: engine.counters(),
      fields: describeFields(current),
      canEdit: settingsService() !== undefined,
      time: new Date().toISOString(),
    }
    // The ntfy topic is the subscription identifier, not just a publish
    // credential, so it is handed over verbatim: `target` masks it for the log,
    // and without an unmasked copy there is nothing to type into the phone app.
    const topic = current.ntfyTopic.trim()
    if (current.provider === 'ntfy' && topic.length > 0) {
      payload.subscribe = { server: current.ntfyServer.trim().replace(/\/+$/, ''), topic }
    }
    return info.problem === undefined ? payload : { ...payload, problem: info.problem }
  }

  const api: RouteApi = {
    status: statusPayload,
    history: (): HistoryEntry[] => engine.history(),
    test: async (): Promise<TestPayload> => {
      const event = compose('test', undefined, 'if you can read this, delivery works')
      const entry = await engine.dispatch(event)
      return { event, entry }
    },
    saveConfig: async (patch: ValidPatch): Promise<StatusPayload> => {
      const service = settingsService()
      if (service === undefined) {
        throw new Error('this composition has no settings service, so the value cannot be saved')
      }
      await service.update(name, patch)
      // The loader swaps volatile fields into the running fiber, so the payload
      // built right here already reflects the write — no restart, no re-apply.
      host.logger.info('[%s] saved %s', name, Object.keys(patch).join(', '))
      return statusPayload()
    },
  }

  host.effect(() => {
    // `makeRoutes` is typed against the real `Context`; `host` is the same
    // object seen through a narrower interface.
    const disposers = makeRoutes(ctx, api).map((route) => ctx.webServer.register(route))
    host.logger.info(
      '[%s] mounted %s, %s, %s and %s',
      name,
      API.status,
      API.history,
      API.test,
      API.config,
    )
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-notify-push: routes')
}