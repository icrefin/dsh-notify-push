/**
 * The `/api/dsh-notify-push` route family.
 *
 * Every route carries a loopback-only fence. That fence is not decoration: the
 * browser half reads the notification *target* here, and while the target is
 * secret-free by construction (`providers.ts` masks tokens and keys before they
 * reach a summary), a plugin API that answers a stranger is still a plugin API
 * that answers a stranger. `dsh web` bound to a LAN address must not serve it.
 *
 * The routes hold no engine knowledge — everything they need arrives as
 * {@link RouteApi}, so a test can drive the real handlers over a real socket
 * with a fake engine.
 *
 * @module dsh-notify-push/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  API,
  type ConfigPatchRequest,
  type ErrorPayload,
  type HistoryEntry,
  type HistoryPayload,
  type StatusPayload,
  type TestPayload,
} from './protocol.ts'
import { validatePatch, type ValidPatch } from './fields.ts'

/** Loader row id; mirrors `cordis.patch.yml`. */
const PLUGIN_ID = 'dsh-notify-push'

/** Cap on an accepted request body. The config route is the only one with a body. */
const MAX_BODY_BYTES = 8192

/** What the routes answer with, supplied by the host half. */
export interface RouteApi {
  /**
   * Describe the current delivery state.
   * @returns the status payload.
   */
  status(): StatusPayload
  /**
   * The recent delivery log.
   * @returns the entries, newest first.
   */
  history(): HistoryEntry[]
  /**
   * Send one synthetic notification through the configured provider.
   * @returns the event that was sent and its delivery result.
   */
  test(): Promise<TestPayload>
  /**
   * Merge a validated patch into this row's config.
   * @param patch - already validated against the field specs.
   * @returns the status payload after the write.
   * @throws when the composition has no settings service to persist into.
   */
  saveConfig(patch: ValidPatch): Promise<StatusPayload>
}

/** Write one JSON response body. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  res.end(text)
}

/** Write one JSON error body. */
function writeError(res: ServerResponse, status: number, message: string): void {
  const body: ErrorPayload = { error: message }
  writeJson(res, status, body)
}

/** Whether the request arrived over the loopback interface. */
function isLoopbackRequest(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * Reject a request that is not loopback, not the expected method, or too large.
 * @param req - the request.
 * @param res - the response, written to when the request is refused.
 * @param method - the one method this route accepts.
 * @returns whether the request should be served.
 */
function admit(req: IncomingMessage, res: ServerResponse, method: string): boolean {
  if (!isLoopbackRequest(req)) {
    writeError(res, 403, 'forbidden: loopback-only')
    return false
  }
  if (req.method !== method) {
    writeError(res, 405, `method not allowed: ${req.method ?? ''}`)
    return false
  }
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    writeError(res, 413, 'payload too large')
    return false
  }
  return true
}

/**
 * Read a bounded JSON request body.
 *
 * `admit` has already rejected a declared oversize, but a lying or absent
 * `content-length` would otherwise let the stream grow unbounded, so the cap is
 * enforced again while accumulating.
 *
 * @param req - the request.
 * @returns the parsed body, or the reason it could not be read.
 */
async function readJsonBody(req: IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false; problem: string }> {
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of req) {
      const buffer = chunk as Buffer
      size += buffer.length
      if (size > MAX_BODY_BYTES) return { ok: false, problem: 'payload too large' }
      chunks.push(buffer)
    }
  } catch {
    return { ok: false, problem: 'could not read the request body' }
  }
  if (size === 0) return { ok: false, problem: 'a JSON body is required' }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  } catch {
    return { ok: false, problem: 'the request body is not valid JSON' }
  }
}

/**
 * Build every route of the `/api/dsh-notify-push` family.
 * @param ctx - host plugin context, used for logging.
 * @param api - the state accessors the handlers answer with.
 * @returns the exact-path routes to register on `ctx.webServer`.
 */
export function makeRoutes(ctx: Context, api: RouteApi): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: API.status,
      handler: (req, res) => {
        if (!admit(req, res, 'GET')) return
        try {
          writeJson(res, 200, api.status() satisfies StatusPayload)
        } catch (error) {
          ctx.logger.warn('[%s] status failed: %s', PLUGIN_ID, String(error))
          writeError(res, 500, 'status unavailable')
        }
      },
    },
    {
      kind: 'exact',
      path: API.history,
      handler: (req, res) => {
        if (!admit(req, res, 'GET')) return
        try {
          writeJson(res, 200, { entries: api.history() } satisfies HistoryPayload)
        } catch (error) {
          ctx.logger.warn('[%s] history failed: %s', PLUGIN_ID, String(error))
          writeError(res, 500, 'history unavailable')
        }
      },
    },
    {
      kind: 'exact',
      path: API.test,
      handler: async (req, res) => {
        if (!admit(req, res, 'POST')) return
        try {
          ctx.logger.info('[%s] test notification requested', PLUGIN_ID)
          writeJson(res, 200, (await api.test()) satisfies TestPayload)
        } catch (error) {
          // `dispatch` never throws, so reaching here means the route's own
          // wiring broke; report it rather than leaving the socket open.
          ctx.logger.warn('[%s] test failed: %s', PLUGIN_ID, String(error))
          writeError(res, 500, 'test delivery failed')
        }
      },
    },
    {
      kind: 'exact',
      path: API.config,
      handler: async (req, res) => {
        if (!admit(req, res, 'POST')) return

        const body = await readJsonBody(req)
        if (!body.ok) {
          writeError(res, 400, body.problem)
          return
        }

        const patch = validatePatch((body.value as Partial<ConfigPatchRequest> | null)?.patch)
        if (!patch.ok) {
          // A refused patch is the client's mistake, not a server fault.
          writeError(res, 400, patch.problem)
          return
        }

        try {
          writeJson(res, 200, (await api.saveConfig(patch.patch)) satisfies StatusPayload)
        } catch (error) {
          ctx.logger.warn('[%s] config write failed: %s', PLUGIN_ID, String(error))
          writeError(res, 409, error instanceof Error ? error.message : 'the settings could not be saved')
        }
      },
    },
  ]
}