/**
 * The scope list against what the code actually ASKS Google to do.
 *
 * QA-7. `GOOGLE_SCOPES` was reviewed twice — by a security-architect pass and a
 * security-engineer pass — and both asked the same question of it: *is this too
 * much access?* Neither asked *is this enough?*, so a missing scope survived two
 * reviews of the exact lines it was missing from. This file asks the second
 * question, mechanically, every run.
 *
 * SHAPE-BASED, not literal. A test that asserted the eight (now nine) scope
 * strings would go green the moment someone edited both the array and the test,
 * which records an edit and guards nothing. What is pinned here is the
 * CAPABILITY: for every Drive method `RealClassroomProvider` actually calls, the
 * granted scopes must include one that permits that call on the file the call is
 * made against. Delete `drive.metadata.readonly` from `GOOGLE_SCOPES` while
 * `driveFileHealth()` still calls `drive.files.get` and this goes red.
 *
 * Scopes are asserted BY IMPORT — `GOOGLE_SCOPES` itself, never a copy of it.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildAuthorizationUrl, GOOGLE_SCOPES } from './oauth-client.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROVIDER_SRC = readFileSync(path.join(HERE, 'real-classroom-provider.ts'), 'utf8')

const DRIVE = 'https://www.googleapis.com/auth/drive'

/**
 * Every Drive method the provider is allowed to call, and what each one needs.
 *
 * `grantedBy` is the set of scopes any ONE of which permits the call as the
 * provider makes it. The comments record WHY, because the whole failure this
 * file exists for was a correct scope decision that nobody could see had been
 * dropped.
 */
const DRIVE_CALLS = [
  {
    /** `driveFileHealth()` — trashed-state and `capabilities/canCopy`. */
    method: 'files.get',
    /**
     * The target is a Drive file the TEACHER created, long before this app
     * existed — a pre-existing Classroom attachment. `drive.file` grants access
     * only to files this app itself created or the user explicitly opened with
     * it, so it cannot read this one: against live Google every real attachment
     * would 403/404 and be classified `permission_locked`/`deleted`.
     * Metadata-level read over files the app was not individually granted is
     * exactly `drive.metadata.readonly` (04-architecture.md §2, §7/S9).
     */
    capability: 'read metadata of a Drive file this app did not create',
    grantedBy: [`${DRIVE}.metadata.readonly`, `${DRIVE}.readonly`, DRIVE],
  },
  {
    /** `copyAttachmentToMyDrive()` — the "Copy to My Drive" fallback. */
    method: 'files.copy',
    /**
     * The WRITE half: the copy lands in the acting teacher's own Drive and is a
     * file this app created, which is `drive.file`'s own case and the scope
     * `files.copy` is documented under. (Whether the SOURCE is readable under
     * this grant is a separate, tracked question — see 05-implementation §10's
     * MANUAL-VERIFY. It is not re-litigated here.)
     */
    capability: 'create a copy of a Drive file in the acting account',
    grantedBy: [`${DRIVE}.file`, DRIVE],
  },
] as const

/** Every `this.clients.drive.<resource>.<method>(` the provider source contains. */
function driveMethodsCalledInSource(): string[] {
  const calls = new Set<string>()
  for (const match of PROVIDER_SRC.matchAll(/this\.clients\.drive\.(\w+)\.(\w+)\s*\(/g)) {
    calls.add(`${match[1]}.${match[2]}`)
  }
  return [...calls].sort()
}

describe('GOOGLE_SCOPES vs. the Drive calls the provider actually makes', () => {
  it('has a capability entry for every Drive method the provider calls', () => {
    // If this goes red, a Drive call was added without anyone asking whether the
    // scope list permits it. Add the entry — do not delete the assertion.
    expect(driveMethodsCalledInSource()).toEqual(DRIVE_CALLS.map((c) => c.method).sort())
  })

  for (const call of DRIVE_CALLS) {
    it(`grants a scope that can ${call.capability} (${call.method})`, () => {
      // Guard: the requirement below is conditional on the call still existing,
      // so prove it does rather than passing vacuously on a stale table.
      expect(driveMethodsCalledInSource()).toContain(call.method)

      const granting = call.grantedBy.filter((scope) =>
        (GOOGLE_SCOPES as readonly string[]).includes(scope),
      )
      expect(
        granting,
        `no granted scope can "${call.capability}" for drive.${call.method}; one of ${call.grantedBy.join(', ')} is required`,
      ).not.toHaveLength(0)
    })
  }
})

describe('the consent screen asks for the scopes this module declares', () => {
  /**
   * Without this, `GOOGLE_SCOPES` could satisfy every capability above and
   * still be an array nobody sends. Asserted BY IMPORT against the real URL
   * builder — the scope strings are never re-typed here.
   */
  it('carries every declared scope in the authorization URL it builds', () => {
    const url = new URL(buildAuthorizationUrl({ challenge: 'test-challenge', state: 'test-state' }))
    const requested = (url.searchParams.get('scope') ?? '').split(' ').filter(Boolean)
    expect([...requested].sort()).toEqual([...GOOGLE_SCOPES].sort())
  })
})
