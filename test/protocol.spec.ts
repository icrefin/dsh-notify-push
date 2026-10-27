/**
 * The browser half's view of the route family.
 *
 * The regression this pins: an origin-absolute `/api/...` path is correct only
 * while the client is served at the origin root. `dsh-remote-control` mounts
 * the same client at `/s/<sessionId>/`, and an absolute request escapes that
 * mount — the prefix's host answers for `/api/...` with a `200 text/html` page,
 * which `response.json()` reports as `Unexpected token '<'`. Resolving the
 * plugin's own request paths against the document keeps them inside whatever
 * prefix the client is served from, which is how the harness's own channels
 * address the host.
 *
 * @module dsh-notify-push/test/protocol
 */

import { describe, expect, it } from 'vitest'
import { API, CLIENT_API, clientPath } from '../src/protocol.ts'

/** Where the desktop app and a root-mounted `dsh web` serve the client. */
const AT_ROOT = 'http://127.0.0.1:50603/'

/** Where `dsh-remote-control` serves the same client to a paired browser. */
const UNDER_TUNNEL = 'https://relay.example/s/ab12/'

describe('CLIENT_API', () => {
  it('never begins with a slash, so it resolves against the document', () => {
    for (const path of Object.values(CLIENT_API)) {
      expect(path.startsWith('/')).toBe(false)
    }
  })

  it('reaches the host route when the client is at the origin root', () => {
    expect(new URL(CLIENT_API.status, AT_ROOT).pathname).toBe(API.status)
  })

  it('stays inside a mounted prefix, which is what the tunnel needs', () => {
    expect(new URL(CLIENT_API.status, UNDER_TUNNEL).pathname).toBe(
      `/s/ab12${API.status}`,
    )
  })

  it('derives every client route from its host route', () => {
    for (const [name, path] of Object.entries(CLIENT_API)) {
      expect(path).toBe(clientPath(API[name as keyof typeof API]))
    }
  })
})

describe('the absolute path it replaced', () => {
  it('escapes the mount, which is why the panel saw HTML instead of JSON', () => {
    expect(new URL(API.status, UNDER_TUNNEL).pathname).toBe(API.status)
  })
})
