/**
 * The version of the half that is actually running.
 *
 * Read from this package's own `package.json` at runtime rather than baked in at
 * build time, on purpose. The panel prints it beside the page title, and the
 * question that chip exists to answer is "which build is loaded in the harness
 * process right now" — a build-time constant would answer a different question,
 * and would keep claiming the new version after a swap that the running process
 * never picked up. That failure mode is real here: replacing the package on disk
 * does not re-compose the profile, so a stale build stays loaded until restart.
 *
 * `npm` always includes `package.json` in a tarball regardless of the `files`
 * list, so this resolves for an installed bundle as well as a checkout.
 *
 * @module dsh-notify-push/version
 */

import { createRequire } from 'node:module'

/** `require` rooted at this module, so `../package.json` is the package root. */
const requireFromHere = createRequire(import.meta.url)

/**
 * Read this package's version.
 * @returns the version string, or `unknown` when the manifest cannot be read.
 */
export function packageVersion(): string {
  try {
    const manifest = requireFromHere('../package.json') as { version?: unknown }
    return typeof manifest.version === 'string' && manifest.version.length > 0
      ? manifest.version
      : 'unknown'
  } catch {
    // A missing manifest costs a label, never the page.
    return 'unknown'
  }
}