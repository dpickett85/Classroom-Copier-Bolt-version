# Architecture — Real Google Integration & Duplicate Prevention (Phase 2)

> The system design for Phase 2 — a **revision layer** over
> `docs/product/04-architecture.md` (v1), not a replacement. Written by the
> architect from `01-pm-brief.md`, `02-ux-workflow.md`, `03-ui-direction.md`,
> `inputs/google-api-facts-verified.md`, `inputs/verify-baseline.md`,
> `inputs/b15-two-big-icons-diagnosis.md`, `inputs/prior-session-bug-inventory.md`,
> and the actual repository state at `06c3d05` / `0694779`, under Beast Mode
> (full elicitation, every choice auto-accepted at its recommended option,
> recorded via `stage_record_decisions` with `source: "beast-mode-auto"`).
> Date: 2026-08-23.
>
> **Track:** `docs/features/real-google-integration/`, **scopeMode: "open"** —
> this doc reads PM brief §9's keep/revise/reinvent table as its scoping
> contract. Per that table: transfer engine, reconciliation invariants,
> job/executor/lease, fixtures, port interface, mock adapter, design system,
> monetization stubs, wizard UX core are **Keep**; pre-flight engine,
> persistence, build config, deployment, and targeted UX surfaces are
> **Revise**; `RealClassroomProvider` and auth are **Reinvent**.
>
> **Product type:** GUI app (responsive web) — unchanged from v1.
>
> **Relationship to v1:** sections and modules the PM brief's §9 table marks
> **Keep** are referenced, not re-specified. Everything below earns its place
> because it is new, revised, or reinvented per that table.
>
> ---
>
> **Revision 2 (2026-08-23)** — absorbs `technical-critic`
> (`critic-reports/2026-08-23-architect-p1.md`, 15 findings, 2 of them P0)
> and `security-architect`
> (`security-reports/2026-08-23-security-architect.md`, 9 findings, none
> critical or high).
>
> **Both P0s are the same defect**, verified by reading
> `server/src/services/transfer-engine.ts` rather than assuming it:
> `execute()`'s item query filters on `jobId` alone and does not select
> `outcome`, so already-terminal items re-enter the loop and are **re-created
> in the teacher's destination course**, while `finish()`'s pending-predicate
> refuses the ledger write and leaves the reconciliation invariant balanced.
> **The corruption is invisible in the app and visible only in the teacher's
> actual Google Classroom.** The same missing filter makes Decision C's
> duplicate prevention a **no-op on the first run** — as previously designed,
> the headline feature of this phase copied every duplicate while reporting
> it as skipped. See **§4.3** for the fix, **§6.1** for why acceptance must
> be a zero-provider-call assertion, and Deltas **P0-B** / **P0-C**.
>
> Revision 1 introduced both defects by asserting this file's behavior
> without reading it. That pattern is now recorded in
> `docs/project-profile.md`'s `## Lessons learned` (written by the
> `quality-budgets-registration` module). **Treat any claim in this document
> of the form "*X already does Y*" as unverified unless a line reference
> accompanies it.**
>
> Also in revision 2: two new decisions (**L** re-entrancy, **M** PKCE); the
> MDB grows from ten modules to **twelve** so that `reconciliation.ts`, the
> four sign-in-dependent test files, `docs/project-profile.md`, and the three
> `package.json` files have owners — unowned work is unpriced work; and both
> diagrams are corrected.

## 0. Scope framing — the eleven decisions only the architect could make

The assignment named eleven decisions (A–K) that only this stage can resolve.
Each is decided explicitly below, with reasoning, and each is locatable by
letter:

| # | Decision | Resolution (short form) | Where |
|---|---|---|---|
| A | Offline access (`access_type=offline`)? | **No.** Access-token-only; no refresh token stored. | §5.1 |
| B | Token custody & session design | Server-side `GoogleAccount` model, AES-256-GCM at rest, unchanged session-cookie shape, CSRF unaffected, sign-out best-effort revokes | §5.1–§5.3, §8 |
| C | Duplicate-detection query | Two paginated destination reads (`DRAFT,PUBLISHED`), same-surface map keys, one shared enumerator | §6.1 |
| D | Topic dedupe | Name-normalized match, reuse mapping persisted, parallel accounting outside the item invariant | §6.2 |
| E | OAuth cold-start window | Warm-up + frontend-routed callback close most of it; the Google-domain-to-callback leg is honestly unclosable | §4.1, Deltas P0-A |
| F | Token failure mid-transfer mechanism | **Pause-and-wait**, DB-durable (not in-memory), resumed by an explicit trigger, bounded by a reconciler grace period; reuses existing skip reasons — no new vocabulary | §6.3 |
| G | `TransferJobStatus` duplicate-count field | `skippedDuplicate`, additive `skipReason` prop on `OutcomePill`/`OutcomeIcon` | §5.2, §6.1 |
| H | Build restoration | Exact restore from `0694779` + minimal deltas, precisely enumerated | §9.1 |
| I | Postgres dev/test mapping | Templated datasource (one model source, two providers), per-file SQLite isolation preserved for tests | §5.4 |
| J | No-Tailwind guard | Shape-based regex under `client/src/test/quality/`, red-first against `AuthFlow.tsx` | §8.4 |
| K | Render deployment topology | Two scoped build commands (never the root script), full env inventory, `npm ci` post-lockfile-regen | §9.2 |
| **L** | **`execute()` re-entrancy** *(new — P0)* | **`execute()` is NOT re-entrant.** Filter the item query on `outcome='pending'`; accumulate `topicMapJson`; never re-dispatch an attempted item; assert on provider calls | **§4.3**, Deltas P0-B/P0-C |
| **M** | **PKCE** *(new — security S1)* | `S256`, verifier carried in the existing `cc_oauth_state` cookie | §8.0 |

> **Two decisions were added in revision 2**, both because the first pass
> asserted `transfer-engine.ts`'s behavior without reading it (L) and
> specified the OAuth flow without PKCE (M). Decisions A–K are unchanged in
> substance; C, F and G have corrected *consequences* (their ADR rows say
> how), because all three depended on L's false premise or on an unowned
> mechanism.


## 1. Architectural drivers & constraints (revised)

v1's seven drivers (simplicity/velocity, reconciliation-by-construction,
resumability, Render cold-start tolerance, per-type fidelity, zero-ops
persistence, testability-as-deliverable, accessibility) all **carry forward
unchanged** — nothing about this phase weakens them. Three additions:

8. **Credential blast radius.** This phase is the first time the system holds
   a real, usable third-party credential. Every design choice that touches
   tokens is weighed against "what does compromise of the session store cost
   us" — this is the direct driver behind Decision A (no refresh token = no
   long-lived secret to steal) and Decision B (encryption at rest, a
   dedicated key, best-effort revocation on sign-out).
9. **Deployability by a non-developer.** The prior session burned ~120 of 186
   turns on deployment plumbing that a developer would have resolved in
   minutes. Every new environment variable, every Render build command, and
   every OAuth consent-screen field is written as if the person configuring
   it cannot read a stack trace. This drives Decision K's precision and the
   live-OAuth checklist's existence.
10. **Recoverability without re-litigating durability.** v1's resumability
    guarantee (job state survives a browser refresh/disconnect) must now also
    survive a *credential* interruption without inventing a second durability
    model. Decision F is designed to reuse the *exact same* mechanism v1
    already trusts (DB-checkpointed state + boot/interval reconciliation)
    rather than adding an in-process wait that would silently regress
    driver 3 (the whole reason v1 rejected in-memory job state).

**Hard constraints (from the brief, restated because they bound design):**
Testing-mode OAuth (100 test users, 7-day authorization expiry — verified,
not model knowledge); no Tailwind, ever; mock retained as test-only double;
Postgres in production; two Render services; committed to
`phase2/real-google-integration` only, never pushed; no Client Secret or
live sign-in performed by this run.

## 2. System context & boundaries (revised)

Unchanged shape from v1 §2: one system, two Render services, one external
integration surface (Google). What's new inside that surface:

- **Google OAuth 2.0** (`accounts.google.com`) — the authorization-code flow,
  now real. Previously simulated entirely in-app.
- **Google Classroom API** (`classroom.googleapis.com`) — now the actual
  target of `RealClassroomProvider`'s calls, behind the same port the mock
  already implements.
- **Google Drive API** (`www.googleapis.com/drive/v3`) — attachment health
  reads (`drive.metadata.readonly`) and the "Copy to My Drive" write
  (`drive.file`).
- **Google token revocation endpoint** (`oauth2.googleapis.com/revoke`) — new,
  best-effort, called on sign-out (Decision B).

Everything else — the browser, the two Render services, the Postgres/SQLite
store — is unchanged in shape from v1 §2.

## 3. Architecture style & major components (revised)

**Style is unchanged: modular monolith, hexagonal only at the Google
boundary.** Phase 2 does not introduce a queue, a second service, or a
worker fleet — none of the drivers that would justify one changed, and
Decision F's design deliberately avoids the one thing that *would* have
demanded new infrastructure (an in-process wait survives only as long as the
process does, which is exactly the durability regression driver 10 forbids).

**New/changed components** (full inventory; unlisted components are Keep,
per PM §9):

| Component | v1 status | Phase 2 role |
|---|---|---|
| `google-oauth-routes` (`server/src/routes/auth.ts`) | Reinvent | Real OAuth: authorization-URL issuance, callback, sign-out (+ revoke) |
| `account-directory` (new, `server/src/services/account-directory.ts`) | New | Small port abstracting "who is this account" over `MockAccount` vs `GoogleAccount`, gated by the same `GOOGLE_PROVIDER_MODE` selector that already gates `ClassroomProvider` |
| `token-crypto` (new, `server/src/services/token-crypto.ts`) | New | AES-256-GCM encrypt/decrypt for stored Google access tokens |
| `real-classroom-provider` (`server/src/adapters/google/real-classroom-provider.ts`) | Reinvent | Implements `ClassroomProvider` against `googleapis`; builds a per-request authorized client from the stored, decrypted token |
| `oauth-client` (new, `server/src/adapters/google/oauth-client.ts`) | New | Builds a `google-auth-library` `OAuth2Client` from config/tokens; the ONE module that imports `googleapis`/`google-auth-library` types into the adapter layer |
| `preflight-engine` | Revise | Gains the duplicate-detection pass and the topic-match pass (Decisions C, D) |
| `post-enumerator` | Revise | Gains a destination-course enumeration path, sharing its existing pagination loop (no second hand-rolled paginator) |
| `transfer-engine` | Revise | Gains `AuthExpiredError` handling: pause-for-reauth instead of per-item failure (Decision F); consults the persisted topic-reuse map instead of always creating |
| `job-reconciler` | Revise | Gains a reauth-grace-period branch, distinct from ordinary staleness |
| `classroom-provider.interface.ts` | Keep | Unchanged — already shaped to the real API (D19 filters already present) |
| `mock-classroom-provider.ts` | Keep (test-only) | Unchanged behavior; unreachable in production builds (§8.4) |
| `SignInLanding.tsx` / `AuthFlow.tsx` | Reinvent | Re-authored in the token system; real OAuth states |
| `Disclosure` (new, `client/src/components/shared/Disclosure.tsx`) | New | Native `<details>`-based, reused three places (UI §3.4) |
| `OutcomeIcon` / `OutcomePill` | Revise | Additive `skipReason` prop (Decision G) |
| `ReadyToTransfer.tsx`, `CompletionSummary.tsx` | Revise | Duplicate/topic disclosure, regrouped stat tiles |

## Module declarations

```yaml agent-c:modules
kind: architecture
schemaVersion: 1
featureSlug: real-google-integration
modules:
  - id: build-restoration
    title: Restore v1 build configuration from 0694779 and re-apply Phase 2 deltas
    dependsOn: []
    fileTargets:
      - package.json
      - server/package.json
      - server/tsconfig.json
      - package-lock.json
      - server/src/app.ts
      - server/src/index.ts
      - server/src/config.ts
    intent: >
      Restore root and server package.json from commit 0694779 (workspaces,
      scripts, devDependencies, engines.node, type:module), restore
      server/src/app.ts's composition-root shape (buildApp export,
      adapters/mock/ import path, createCoursesRouter->coursesRouter naming,
      requireCsrfHeader, health/auth/courses/transfer-jobs router mounting) and
      server/src/config.ts's SESSION_SECRET fail-fast pattern, then add exactly
      the Phase 2 deltas on top: googleapis + google-auth-library added to
      server/package.json dependencies, the TOKEN_ENCRYPTION_KEY (with the
      32-byte base64 length check per §8.0/S3), DATABASE_PROVIDER,
      GOOGLE_REAUTH_GRACE_MS, GOOGLE_TOKEN_MIN_REMAINING_MS and
      FRONTEND_ORIGIN env vars threaded through config.ts, and the root
      build script restored to shared->server->client (currently
      shared->client only, per §9.1). Restore the EIGHT server test:budget:*
      scripts plus test:perf and test:lease-mp, and the TEN root
      test:budget:* scripts (eight delegating to server, two to client) —
      see §9.1, the previous revision's "ten server scripts" was wrong.
      Fix server/package.json's `start` script to `node
      --env-file-if-exists=.env dist/src/index.js`, the path tsc actually
      emits under rootDir "." — see §9.1a; neither 0694779's literal nor
      HEAD's is correct. Regenerate and commit package-lock.json against the
      restored tree plus the new deltas so `npm ci` succeeds.
    acceptance: >
      `npx tsc -p server/tsconfig.json --noEmit` produces errors ONLY in
      server/src/adapters/google/real-classroom-provider.ts and
      server/src/routes/auth.ts, and no more than the 7 baseline errors
      those two files already carry (inputs/verify-baseline.md lines 20-33:
      5 + 2). Those two files are owned by real-classroom-provider and
      google-oauth-routes respectively and CANNOT be fixed from within this
      module's fileTargets — a whole-tree "0 errors" gate here is
      unachievable by construction and is NOT this module's criterion. The
      whole-tree gate lives on server-typecheck-clean instead. Also: `npm
      test` and `npm run lint` exist as root scripts and both run (pass/fail
      is later modules' concern; existence and non-crash is this module's
      gate); `npm ci` succeeds from a clean checkout against the committed
      lockfile; root `npm run build` builds shared, server, AND client,
      verified by parsing server/package.json's `start` script, extracting
      its entry-point argument, and asserting THAT file exists (never a
      hard-coded literal path — §9.1a).

  - id: datasource-postgres
    title: Templated Prisma datasource (Postgres prod, SQLite dev/test) preserving per-file test isolation
    dependsOn:
      - build-restoration
    fileTargets:
      - server/prisma/schema.template.prisma
      - server/prisma/schema.prisma
      - scripts/prisma-datasource.mjs
      - server/package.json
      - server/test/helpers/db.ts
    intent: >
      Split server/prisma/schema.prisma into a generated file: the model
      bodies move to schema.template.prisma (the single source of truth,
      already provider-portable since every closed vocabulary is already a
      String column per v1's own documented SQLite constraint), and a small
      pregenerate/predb:push script (scripts/prisma-datasource.mjs) writes
      the concrete schema.prisma by concatenating the template with a
      datasource block selected by DATABASE_PROVIDER (sqlite|postgresql,
      default sqlite). Dev/test stay on sqlite (server/test/helpers/db.ts's
      per-test-file copy pattern is UNCHANGED). Production sets
      DATABASE_PROVIDER=postgresql and DATABASE_URL to the Render Postgres
      connection string; the boot sequence (server/src/index.ts, already
      Keep) runs `prisma db push` idempotently rather than `migrate deploy`
      (see 04-architecture.md §5.4 for the explicit rationale and the
      accepted trade-off: no migration history in production at this
      project's stakes).
    acceptance: >
      F13 — the previous revision's criterion required a live Postgres
      ("against a real or dockerized Postgres"), which this project has no
      provisioning step for and no CI to run it in; as written the gate is
      unrunnable and would be silently skipped. DOWNGRADED to a
      provider-agnostic check that needs no database: `DATABASE_PROVIDER
      =sqlite` and `DATABASE_PROVIDER=postgresql` each generate a
      schema.prisma from the SAME schema.template.prisma with no manual
      edits between runs, and `prisma validate` passes on BOTH generated
      files — validate parses and type-checks the schema against the named
      provider without connecting, which is exactly the property at risk
      here (a model body that is not provider-portable). `prisma generate`
      likewise succeeds for both. The SQLite branch additionally runs the
      real db:push and the existing per-file test suite passes unchanged. A
      test asserts the generated schema.prisma is gitignored (never
      hand-edited, never committed with a stale provider).
      MANUAL-VERIFY: an actual `db push` against a real Postgres instance is
      performed once by the operator during the live-OAuth checklist's
      first production deploy, and is NOT gated here — no automated
      criterion in this repo can cover it until a provisioning step exists.

  - id: google-auth-core
    title: GoogleAccount model, token encryption, AccountDirectory port, session generalization
    dependsOn:
      - datasource-postgres
    fileTargets:
      - server/prisma/schema.template.prisma
      - server/src/services/token-crypto.ts
      - server/src/services/account-directory.ts
      - server/src/services/session.ts
      - server/src/config.ts
    intent: >
      Add the GoogleAccount model (id=Google sub, email, displayName,
      pictureUrl, accessTokenCiphertext/Iv/Tag, accessTokenExpiresAt,
      scopesGranted) to schema.template.prisma. Add token-crypto.ts
      (AES-256-GCM encrypt/decrypt keyed by TOKEN_ENCRYPTION_KEY, required
      and fail-fast when GOOGLE_PROVIDER_MODE=google in a production-like
      NODE_ENV, mirroring config.ts's existing SESSION_SECRET pattern, and
      additionally rejecting a key that does not base64-decode to exactly
      32 bytes per §8.0/S3). decrypt() catches ANY cipher error — a bad auth
      tag from a rotated or corrupted key — and throws AuthExpiredError, so
      key rotation surfaces as the routine reconnect UX rather than a raw
      500, per §8.0/S4; log at WARN with the account id and NEVER the
      ciphertext, per §8.0/S6. Add
      account-directory.ts: an AccountDirectory port
      (getAccountSummary(accountId): Promise<AccountSummary|null>) with
      MockAccountDirectory and GoogleAccountDirectory implementations,
      selected by config.googleProviderMode exactly like ClassroomProvider
      selection already works. Restore session.ts from 0694779 (SESSION_COOKIE,
      createSession/resolveSession/revokeSession, cookieOptions), but drop
      Session's Prisma relation to MockAccount specifically (accountId stays
      a plain String column with no enforced FK — the same polymorphic
      pattern this schema already uses for MockAttachment.parentType/parentId
      — because Session.accountId may now reference either MockAccount.id or
      GoogleAccount.id depending on provider mode, and Prisma cannot express
      a FK to either of two tables).
    acceptance: >
      A unit test round-trips a token through token-crypto (encrypt then
      decrypt yields the original plaintext; ciphertext/iv/tag are never
      equal across two calls with the same plaintext, proving IV
      randomness). A unit test asserts config.ts throws at boot when
      GOOGLE_PROVIDER_MODE=google, NODE_ENV=production, and
      TOKEN_ENCRYPTION_KEY is unset, and again when it is set to a value
      that does not base64-decode to 32 bytes (§8.0/S3).
      account-directory.test.ts exercises both implementations against the
      SAME interface (contract-test shape, matching
      classroom-provider.contract.test.ts's existing convention).
      §8.0/S4: a token encrypted under key A and decrypted under key B
      raises AuthExpiredError — asserted by class, not by message.
      §8.0/S5 cross-account isolation contract test (this module owns it
      because it owns the FK removal that un-pins it): seed two accounts,
      each with a course, a scan, and a job; drive every account-scoped read
      (/api/auth/me, GET /courses, GET /transfer-jobs/:id,
      GET /transfer-jobs/active, the pre-flight routes) with account B's
      session against account A's resource ids and assert 404/403 on every
      one — never 200. This test is the only thing pinning an isolation
      guarantee the database no longer enforces.

  - id: google-oauth-routes
    title: Real OAuth routes — authorization URL, callback, sign-out with revoke
    dependsOn:
      - google-auth-core
    fileTargets:
      - server/src/routes/auth.ts
      - server/src/middleware/auth.ts
      - server/src/middleware/csrf.ts
      - server/src/app.ts
      - server/test/api.integration.test.ts
      - server/test/csrf.test.ts
      - server/test/quality/courses-list.budget.test.ts
      - server/test/quality/f12-reconnect.budget.test.ts
    intent: >
      Restore middleware/auth.ts and middleware/csrf.ts from 0694779
      unmodified (requireAuth, requireCsrfHeader — both already correct,
      B12's provider-mode fail-fast lives in config.ts per
      build-restoration). Rewrite routes/auth.ts: GET /api/auth/google/url
      (builds the Google authorization URL via oauth-client WITH PKCE per
      §8.0/S1 — generateCodeVerifierAsync(), code_challenge_method 'S256' —
      and sets ONE short-lived HttpOnly cc_oauth_state cookie whose JSON
      payload is {nonce, verifier}; flags per §8.0/S7: Path=/api/auth,
      SameSite=Lax, Secure in production only, Max-Age 600); GET
      /api/auth/callback (exchanges the code WITH the code_verifier read
      back from that cookie, verifies `state` against the cookie's nonce,
      creates/updates the GoogleAccount row with the encrypted access token
      and accessTokenExpiresAt, mints a session via the UNCHANGED
      session.ts, resolves any paused TransferJob per Decision F by
      { accountId: <session account>, googleReauthRequiredAt: {not: null} }
      — NEVER a job id from the request, per §8.0/S8 — and triggers resume
      if one exists, clears the cc_oauth_state cookie on every exit path,
      then 302-redirects to config.frontendOrigin — a boot-time constant
      from FRONTEND_ORIGIN falling back to CORS_ORIGINS[0], with NO part of
      the request contributing to the origin, per §8.0/S2 — with either no
      query param (success) or ?authError=denied|expired|generic);
      POST /api/auth/sign-out (revokes the Session row as today, PLUS a
      fire-and-forget best-effort call to
      https://oauth2.googleapis.com/revoke — failure is logged at WARN and
      never fails the response); GET /api/auth/me (unchanged shape, reads
      through account-directory instead of prisma.mockAccount directly). No
      GET /api/auth/mock-accounts, POST /api/auth/sign-in (mock account
      picker), or account-picker routes in this file — see production
      guard's §8.4 requirement that they are unregistered entirely when
      GOOGLE_PROVIDER_MODE=google. Mount order in app.ts unchanged
      (health/auth ahead of the monetization gate).
      .
      CRITICAL — removing POST /api/auth/sign-in unconditionally breaks four
      existing test files, all four of which are in this module's
      fileTargets because this module is what breaks them: api.integration
      .test.ts, csrf.test.ts, courses-list.budget.test.ts, and
      f12-reconnect.budget.test.ts all authenticate by POSTing to
      /api/auth/sign-in. The routes are unregistered only when
      GOOGLE_PROVIDER_MODE=google, and the test harness runs in mock mode,
      so the ROUTE still exists for these tests — but the previous
      revision's "no POST /api/auth/sign-in in this file" instruction reads
      as an unconditional deletion and would take all four down. Resolve it
      explicitly: routes/auth.ts registers the mock-account routes ONLY
      under GOOGLE_PROVIDER_MODE=mock, in a separate router module
      (routes/auth-mock.ts) that app.ts mounts conditionally, so the
      production file genuinely does not contain them (§8.4's requirement is
      met) AND the four test files keep working unchanged. Verify all four
      still pass before and after. courses-list.budget.test.ts additionally
      gains §8.1's promised new case asserting the destination-dedupe reads
      never occur on the GET /courses path — this module owns that file, so
      the case now has an owner; the previous revision promised it with no
      module able to write it.
    acceptance: >
      An integration test drives the full callback flow against a faked
      googleapis token exchange (the ClassroomProvider mock precedent
      extended to auth): valid state -> session cookie set, GoogleAccount
      row created, redirect to frontend with no error param; missing/mismatched
      state -> redirect with ?authError=expired, no session created; Google
      error=access_denied passthrough -> ?authError=denied. Sign-out revokes
      the Session row even when the upstream revoke call is mocked to
      reject. No mock-account routes exist when GOOGLE_PROVIDER_MODE=google
      (404 envelope, asserted by test) AND all four existing sign-in-
      dependent test files still pass under GOOGLE_PROVIDER_MODE=mock.
      PKCE (§8.0/S1): the authorization URL carries code_challenge and
      code_challenge_method=S256, and a token exchange whose code_verifier
      does not match takes the ?authError=expired branch with no session
      created. Open-redirect (§8.0/S2): the callback is driven with a
      hostile Referer, a hostile Origin, a returnTo query parameter, and an
      absolute-URL state payload, and the response Location header is
      byte-identical to config.frontendOrigin in all four cases. Cookie
      (§8.0/S7): cc_oauth_state carries HttpOnly, SameSite=Lax,
      Path=/api/auth, Max-Age=600, and Secure only when NODE_ENV is
      production; it is cleared on success, mismatch, and denial alike.
      Account-scoped resume (§8.0/S8): a job paused under account A is
      untouched by a full callback completed as account B.

  - id: real-classroom-provider
    title: RealClassroomProvider against googleapis, implementing the existing port
    dependsOn:
      - build-restoration
      - google-auth-core
    fileTargets:
      - server/src/adapters/google/real-classroom-provider.ts
      - server/src/adapters/google/oauth-client.ts
      - server/src/adapters/types.ts
    intent: >
      Rewrite real-classroom-provider.ts to import
      classroom-provider.interface.ts from the CORRECT path (one directory
      up, not adapters/google/classroom-provider.interface.js — regression
      A8/B-class import-path bug). Implement every ClassroomProvider method
      against googleapis's classroom_v1 and drive_v3 clients, built per-call
      via oauth-client.ts's buildAuthorizedClient(accountId) (decrypts the
      stored token via token-crypto, throws AuthExpiredError — a NEW error
      class added to types.ts, extends ProviderError — when Google returns
      401/invalid_grant on any call). oauth-client.ts also exposes the PKCE
      helpers google-oauth-routes needs (§8.0/S1): a verifier generator and
      an authorization-URL builder taking code_challenge +
      code_challenge_method='S256', and a token exchange taking
      code_verifier — it is the ONE module importing google-auth-library, so
      PKCE lives here and not in the route file. Provider errors are mapped
      into the existing typed error classes BEFORE anything is logged, and
      the raw googleapis error object is never passed to the logger —
      it carries config.headers.Authorization with the live bearer token
      (§8.0/S6). listCourseWork/listCourseWorkMaterials
      pass courseWorkStates/courseWorkMaterialStates explicitly per the
      verified-facts finding (PUBLISHED-only default is a trap). Map real
      429 envelopes (Retry-After header) into the existing RateLimitError
      shape. Resolve the QUIZ_ASSIGNMENT divergence per the carried backlog
      note (ASSIGNMENT + detected Form attachment). listTopics/createTopic
      use classroom.topics scope.
    acceptance: >
      The EXISTING classroom-provider.contract.test.ts suite (Keep, per PM
      §9) runs against RealClassroomProvider with a fake googleapis
      transport and passes with zero test-file changes beyond the
      instantiation line — proving behavioral parity with
      MockClassroomProvider at the port boundary. A new unit test asserts
      AuthExpiredError is thrown (not RateLimitError or a generic Error) when
      the fake transport returns a 401 with reason=invalid_grant.

  - id: duplicate-topic-preflight
    title: Duplicate-detection and topic-match passes in preflight-engine
    dependsOn:
      - datasource-postgres
    fileTargets:
      - server/src/services/preflight-engine.ts
      - server/src/services/post-enumerator.ts
      - server/prisma/schema.template.prisma
      - shared/src/api-types.ts
      - shared/src/normalize.ts
    intent: >
      Add normalizeTitle() to shared/src/normalize.ts (NFC -> trim -> collapse
      internal whitespace -> case-fold, PM §6.2, one implementation reused by
      matching and any future consumer). Add enumerateDestinationCourseWork /
      enumerateDestinationMaterials / enumerateDestinationTopics to
      post-enumerator.ts, sharing the existing pagination-loop helper (not a
      second hand-rolled paginator) against courseWorkStates/
      courseWorkMaterialStates=[DRAFT,PUBLISHED] explicitly. In
      preflight-engine.ts, before the existing attachment-health pass: build
      a same-surface match map (key = sourceType + ':' + normalizeTitle(title))
      from the destination reads; classify each source item as duplicate or
      not; EXCLUDE duplicate items' attachments from the health-check
      batch (cheaper, and per PM §6.3 precedence they must never enter
      findings[] regardless of health). Build a topic-reuse map the same way
      (name-normalized, no state/surface clause) from
      enumerateDestinationTopics; on >1 match, reuse the first by API return
      order and flag ambiguous:true. Persist both:
      PreflightScanItem.duplicateOfTitle/duplicateOfState (new columns) and
      PreflightScan.topicReuseJson (new column, same idiom as the existing
      findingsJson). Add duplicates[] and topicReuse[] to
      PreflightResponseSchema (shared/src/api-types.ts) as disclosure-only
      data, separate from findings[]. Add 'duplicate_title' to
      SkipReasonSchema's closed vocabulary.
    acceptance: >
      A new fixture (next free F-number) seeds a destination course with a
      draft-match, published-match, normalization-only match, near-miss
      non-match ("Unit 1" vs "Unit 11"), cross-surface non-match, one
      combined duplicate+unhealthy-attachment item (resolves as ONE
      duplicate_title skip, never enters findings[]), and topic cases
      (exact match, normalization-only match, near-miss non-match, ambiguous
      multi-match). All resolve per PM §6.6. A test asserts
      selection_screen_call_cost (GET /courses) is UNCHANGED — 0 post
      enumerations — because the new destination reads only happen inside
      POST /courses/:sourceId/preflight, never on the courses-list path.

  - id: token-failure-resume-engine
    title: "P0: make execute() re-entrant; AuthExpiredError pause-and-resume, reconciler grace period, three-way skip split, topic-map durability"
    dependsOn:
      - real-classroom-provider
      - duplicate-topic-preflight
      - google-oauth-routes
    fileTargets:
      - server/src/services/transfer-engine.ts
      - server/src/services/reconciliation.ts
      - server/src/services/job-reconciler.ts
      - server/src/routes/transfer-jobs.ts
      - server/prisma/schema.template.prisma
      - server/src/config.ts
      - shared/src/api-types.ts
      - shared/src/api-types.test.ts
    intent: >
      P0 FIRST, BEFORE any pause/resume machinery — the four fixes in §4.3,
      each red-first against the current engine. (1) transfer-engine.ts's
      item findMany (currently line 476-489) becomes `where: { jobId,
      outcome: 'pending' }` and its select adds outcome, attemptedAt and
      claimedTargetPostId. Today it filters on jobId ALONE and does not even
      select outcome, so already-terminal items fall through processItem
      into transferPost and create REAL duplicate posts in the destination
      course while finish()'s pending-predicate refuses the ledger write and
      keeps the invariant balanced — corruption invisible in the app and
      visible only in the teacher's Google Classroom. This single change
      closes BOTH P0s: Decision F's resume AND Decision C's first-run
      duplicate prevention, which is inert without it. (2) buildTopicMap
      (currently 604-625) calls createTopic unconditionally for every source
      topic on every entry; topicReuseJson cannot fix this because it is a
      preflight snapshot blind to pass 1's own topics. Add
      TransferJob.topicMapJson (nullable String, JSON
      Record<sourceTopicId,destTopicId>), seed the map from it then from
      topicReuseJson, skip createTopic for any already-mapped topic, and
      persist the updated map in the SAME lease-checked updateMany as the
      existing per-topic heartbeat. topicsCreatedCount increments only on a
      real create, topicsReusedCount only on a topicReuseJson hit, neither
      on an already-mapped skip. (3) an item with outcome='pending' AND
      attemptedAt IS NOT NULL is evidence-ambiguous and must NOT be
      dispatched — resolve it from claimedTargetPostId via the branch
      recordItemFailure already implements (present -> finish as
      transferred; absent -> skipped/server_interrupted). This is what stops
      copyAttachmentToMyDrive (line 838) re-copying a Drive file on
      re-entry. (4) all acceptance is zero-provider-call, never outcome-
      based — see §6.1; an outcome assertion passes today WHILE the bug is
      live.
      .
      F7 — AuthExpiredError thrown from buildTopicMap or enumeratePosts is
      currently OUTSIDE processItem's try (they run before the item loop, at
      453-474), so it reaches run()'s top-level catch and marks the job
      `failed`: no googleReauthRequiredAt, no 4c banner, no resume. Extract
      the pause handler as pauseForReauth(lease) and invoke it from a
      pre-loop catch on AuthExpiredError SPECIFICALLY (every other error
      keeps its existing path to `failed`), with no item to mark because
      none was attempted. This is a routine path, not an edge case — 7-day
      expiry is guaranteed and job start is when a near-expiry token is most
      likely spent.
      .
      F9 — run(jobId) reads GoogleAccount.accessTokenExpiresAt BEFORE
      claiming the lease; if the REMAINING lifetime is under
      GOOGLE_TOKEN_MIN_REMAINING_MS (new config knob, default 10 min) it
      sets googleReauthRequiredAt=now() and returns without starting, so a
      late-session job prompts a clean reconnect instead of stalling
      mid-transfer. resume() runs the same check before re-claiming. The
      field is currently written and read by nothing (§5.1).
      .
      F6 — reconciliation.ts owns the only GROUP BY implementing Decision G
      and was in no module. Its skipped case is a two-way if/else on
      USER_SKIP_REASONS, so duplicate_title falls into skippedBySystem,
      zeroing skippedDuplicate and firing CompletionSummary's 5-term
      interrupted line on an ordinary duplicate — the exact failure UI's P0
      Delta raised. Make it three-way with the duplicate_title test FIRST,
      add skippedDuplicate to OutcomeCounts, and add duplicate_title to
      NEITHER USER_SKIP_REASONS nor SYSTEM_SKIP_REASONS. Rewrite
      shared/src/api-types.test.ts's "classifies every reason as exactly one
      of user or system" case to derive from SkipReasonSchema.options and
      assert an exhaustive, pairwise-disjoint THREE-way partition — as
      written it hard-codes toHaveLength(6) and will keep passing while its
      own claim becomes false. checkInvariant's `holds` predicate is
      UNCHANGED.
      .
      Then the pause/resume machinery. Add TransferJob.googleReauthRequiredAt
      (nullable DateTime, field-not-status, mirrors the rateLimitPause
      precedent), TransferJob.topicReuseJson (copied from the scan at job
      creation) and TransferJob.topicMapJson (fix 2 above) to
      schema.template.prisma. Replace TransferJob.topicsCreatedOrMapped with
      topicsCreatedCount + topicsReusedCount (both Int @default(0)). In
      createTransferJob (transfer-jobs.ts), items whose PreflightScanItem.
      duplicateOfTitle IS NOT NULL insert directly as TransferJobItem{
      outcome:'skipped', skipReason:'duplicate_title'} — pre-resolved, never
      entering the execute() item loop. In transfer-engine.ts's topic-build
      step, consult topicReuseJson before calling createTopic: a mapped
      source topic reuses the destination id and increments
      topicsReusedCount; an unmapped one creates and increments
      topicsCreatedCount. In the per-item catch: on AuthExpiredError
      specifically (not the generic catch-all), mark the triggering item
      skipped/provider_error (it WAS attempted), set
      TransferJob.googleReauthRequiredAt=now(), release executorId (NOT
      activeAccountId — the job stays "the active job" for /active and the
      single-active-job guard), and return WITHOUT resolving remaining
      pending items (they stay pending, durable in the DB, per driver 10 —
      no in-process wait). Add a resume(jobId) entry point (composition-root
      wired, called from google-oauth-routes' callback on successful
      reauth) that clears googleReauthRequiredAt, bumps lastHeartbeatAt, and
      re-invokes run(jobId) — the SAME entry point job creation already
      uses. execute() is made re-entrant by fixes (1)-(3) above; it is NOT
      re-entrant today and this must not be assumed. resume() resolves its
      job by { accountId: <session account>, googleReauthRequiredAt: {not:
      null} }, never a job id from the request (§8.0/S8). The pause leaves
      TransferJob.status at 'running' and activeAccountId set, nulling only
      executorId — that exact state ('running' + null executorId) is what
      the lease claim's own WHERE re-matches on resume; 'interrupted' would
      be terminal and unresumable, and a new status value would break the
      partial unique index and /active, which both derive from status
      alone. In
      job-reconciler.ts, add a config-driven GOOGLE_REAUTH_GRACE_MS (default
      30 minutes): a job with googleReauthRequiredAt set is EXEMPT from the
      ordinary heartbeat-staleness check and instead evaluated against this
      longer grace period; on lapse, resolve remaining pending items via the
      EXISTING evidence-based branch (attemptedAt IS NULL -> skipped/
      server_interrupted) and set status='interrupted' (the existing status
      value, not a new one). Add skippedDuplicate to TransferJobStatusSchema
      and googleReauthRequired: z.boolean() (derived, not the raw
      timestamp); skippedTotal becomes skippedByUser+skippedBySystem+
      skippedDuplicate by construction (GROUP BY, not an independent
      counter, per v1's own anti-drift rule). Add 'duplicate' to
      TransferJobItemRowSchema.skippedBy's enum.
    acceptance: >
      ALL P0 assertions are ZERO-PROVIDER-CALL assertions against a counting
      ClassroomProvider double that records every createCourseWork /
      createCourseWorkMaterial / createTopic / copyAttachmentToMyDrive call
      with its arguments. Outcome assertions do NOT satisfy this module —
      they pass against the unfixed engine and are therefore not evidence.
      Every one of the four must be OBSERVED FAILING against the current
      tree before the fix lands (red-first, the same discipline Decision J
      applies to the no-Tailwind guard).
      .
      P0-1 (resume): inject AuthExpiredError on item N of a 10-item job;
      items 1..N-1 transferred, item N skipped/provider_error, items N+1..10
      still pending, googleReauthRequiredAt set, executorId null,
      status STILL 'running', activeAccountId UNCHANGED. Then call
      resume(jobId) and assert the pass-2 call log contains ZERO create
      calls carrying any title from items 1..N-1, exactly (10-N) create
      calls total, and a balanced reconciliation sum at status=completed.
      .
      P0-2 (first-run duplicates): a job whose scan flagged k duplicates
      runs ONCE, from a cold start, with no pause and no resume. Assert
      totalCreateCalls === count(items where outcome='pending' at job start)
      and ZERO create calls carrying any duplicate item's title. Assert
      separately that finish() logged NO "refused to overwrite an
      already-terminal item outcome" ERROR — that log line firing at all is
      the signature of the defect and its absence is part of the gate.
      .
      P0-topics: a job paused after creating j topics and then resumed makes
      ZERO createTopic calls for those j topics on pass 2, and
      topicsCreatedCount is j (not 2j) at completion.
      .
      P0-attachments: an item left outcome='pending' with attemptedAt set
      and claimedTargetPostId set is finished as transferred with that id on
      re-entry and makes ZERO create or copyAttachmentToMyDrive calls; the
      same item with claimedTargetPostId NULL resolves
      skipped/server_interrupted, also with zero calls.
      .
      F7: AuthExpiredError injected into buildTopicMap, and separately into
      enumeratePosts, leaves the job at status='running' with
      googleReauthRequiredAt set and zero items attempted — NOT status
      ='failed'. F9: a job started with accessTokenExpiresAt 2 minutes away
      never claims the lease and sets googleReauthRequiredAt immediately.
      F6: countOutcomes puts a duplicate_title row in skippedDuplicate and
      NOT skippedBySystem; skippedTotal === byUser + bySystem + duplicate;
      checkInvariant still holds; the rewritten api-types partition test
      fails if any SkipReasonSchema option is unclassified.
      .
      Reconciler grace period: does NOT touch a job whose
      googleReauthRequiredAt is 5 minutes old but DOES resolve one older
      than GOOGLE_REAUTH_GRACE_MS, landing it at status='interrupted' with
      remaining items skipped/server_interrupted.

  - id: signin-ui-rebuild
    title: Re-author SignInLanding.tsx and AuthFlow.tsx in the token system; shape-based no-Tailwind guard
    dependsOn:
      - { id: google-oauth-routes, runtimeDependency: false }
    fileTargets:
      - client/src/features/auth/SignInLanding.tsx
      - client/src/features/auth/AuthFlow.tsx
      - client/src/lib/api-client.ts
      - client/src/styles/tokens.css
      - client/src/App.tsx
      - client/src/test/quality/no-tailwind.quality.test.ts
    intent: >
      Re-author SignInLanding.tsx and AuthFlow.tsx per UI §3.1: the
      .signin-screen shell, real .google-signin-btn (Google's exact
      colors/font/logo, contained to two classes, explicit width/height on
      every inline SVG per the 898px root-cause fix), landing/warmup/
      callback-landing/three-failure-state machine, restoring AuthFlow's
      onSignedIn/startAt/onError prop shape from 0694779 (not the current
      {children} shape). api-client.ts gains getGoogleAuthUrl() and
      confirmSession() — ordinary cold-start-wrapped fetches, per UX Decision
      2 — plus a signOut() revoke-aware caller. tokens.css gains
      .google-signin-btn/.google-g-logo (scoped, non-root exception per UI
      §2) and .signin-error (role=alert, amber family, UI §3.1). App.tsx
      wires the callback-landing route and reads ?authError from the URL on
      mount, then history.replaceState()s it away immediately (closes the
      Back-button/stale-code concern per §4.2 below — the code itself never
      reaches the frontend URL at all). Write no-tailwind.quality.test.ts
      RED FIRST against current HEAD (must fail on AuthFlow.tsx's inert
      classes before any fix lands), using the shape-based pattern from UI
      §3.1/Deltas (prefix classes, not the 5 literal substrings), then make
      it pass by the rewrite above.
    acceptance: >
      no-tailwind.quality.test.ts fails against the pre-rewrite tree
      (proven, not asserted) and passes after. A statically-served
      production build (vite build + preview, not dev server) shows both
      SVGs at their intended small size (not 898px), zero unstyled
      user-agent-default buttons, zero asset 404s, axe 0 critical/serious.
      auth.test.tsx (restored/extended) covers all three failure states,
      the warmup blocking-redirect behavior, and callback-landing's own
      cold-start coverage.

  - id: transfer-ui-extensions
    title: Duplicate/topic disclosure, regrouped stat tiles, interrupt banners, outcome-pill duplicate treatment
    dependsOn:
      - signin-ui-rebuild
      - duplicate-topic-preflight
      - token-failure-resume-engine
    fileTargets:
      - client/src/components/shared/Disclosure.tsx
      - client/src/components/shared/OutcomeIcon.tsx
      - client/src/components/shared/OutcomePill.tsx
      - client/src/features/preflight/ReadyToTransfer.tsx
      - client/src/features/summary/CompletionSummary.tsx
      - client/src/features/transfer/TransferProgress.tsx
      - client/src/styles/tokens.css
      - client/src/lib/api-client.ts
    intent: >
      Build Disclosure.tsx (native details/summary, UI §3.4) and reuse it in
      ReadyToTransfer's duplicate-items and topic-reuse lists and
      CompletionSummary's topic detail panel. Add the optional skipReason
      prop to OutcomeIcon/OutcomePill and the outcome-duplicate treatment
      (teal family, UI §3.3) — additive, every existing call site unaffected.
      Regroup CompletionSummary's stat tiles into the two labeled ledger
      sections (Group A 4-tile/Group B 3-tile, UI §3.2's exact CSS), the
      corrected reconciliation-line formula (4-term common case, 5th
      "interrupted" term only when skippedBySystem>0), and the topics-
      outside-invariant callout. Add the 4a (.error-state reuse)/4b/4c
      (.interrupt-banner, UI §3.5) interrupt states to TransferProgress.tsx,
      keyed off the new googleReauthRequired / session-401 signals; 4c's
      copy reads routine ("Time to reconnect Google... happens about once a
      week"), never alarmed. Extend the itemized log's filter (All /
      Transferred / Fallback / Already in course / Skipped by you) and CSV
      export through the SAME skipReason-aware label function (one
      implementation, three consumers, per UI §3.3).
    acceptance: >
      Component tests cover: duplicate list rendering + expand/collapse
      keyboard behavior; the 5-term reconciliation line only when
      skippedBySystem>0 (both branches tested); the outcome-duplicate pill
      renders "Already in course" with the teal treatment and is
      distinguishable from "Skipped — you chose to skip" in text alone
      (axe/DOM assertion, not just visual); the 4b vs 4c banners differ in
      heading, glyph, and CTA; CSV export and the on-screen log agree on
      every skipReason's label (same function, asserted by import, not by
      duplicated string literals in the test).

  - id: deployment-config
    title: .env.example, Render build commands, live-OAuth checklist as markdown
    dependsOn:
      - { id: build-restoration, runtimeDependency: false }
      - { id: google-auth-core, runtimeDependency: false }
      - { id: google-oauth-routes, runtimeDependency: false }
      - { id: real-classroom-provider, runtimeDependency: false }
    fileTargets:
      - .env.example
      - client/.env.example
      - docs/handoff/connecting-to-live-google.md
    intent: >
      Write root .env.example covering every var config.ts actually reads
      (DATABASE_URL, DATABASE_PROVIDER, SESSION_SECRET, TOKEN_ENCRYPTION_KEY,
      GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI,
      GOOGLE_PROVIDER_MODE, CORS_ORIGINS, NODE_ENV, PORT,
      FEATURE_MONETIZATION_ENABLED, GOOGLE_REAUTH_GRACE_MS — placeholders
      only). Confirm client/.env.example's VITE_API_BASE_URL guidance is
      still accurate. Produce docs/handoff/connecting-to-live-google.md — a
      NEW markdown checklist superseding (not deleting)
      docs/handoff/Connecting-To-Live-Google.docx as the source of truth
      (git-diffable, no proprietary tooling — resolves UX §7's flagged open
      question), following UX §7's exact shape (numbered parts, confirmation
      cue per step, inline troubleshooting from B1-B14, test-user pre-flight
      step covering the co-teacher persona, a concrete success checkpoint,
      the 7-day-reauth expectation-setting note, and the 100-test-user cap).
    acceptance: >
      Every env var name in .env.example is grep-confirmed present in
      config.ts's actual reads (a script or manual grep, checked-in as
      evidence in the PR description is sufficient — no new test file
      required for this documentation-only module). The checklist document
      is reviewed against UX §7's six required-shape criteria as a manual
      checklist item in the engineer's own report.

  - id: server-typecheck-clean
    title: Whole-tree server typecheck gate — the 0-errors criterion build-restoration cannot own
    dependsOn:
      - build-restoration
      - real-classroom-provider
      - google-oauth-routes
    fileTargets:
      - server/tsconfig.json
      - package.json
    intent: >
      The previous revision put a whole-tree "0 errors" gate on
      build-restoration, which cannot achieve it: 7 of the 19 baseline
      errors (inputs/verify-baseline.md lines 20-33) live in
      real-classroom-provider.ts and routes/auth.ts, both owned by LATER
      modules and both outside build-restoration's fileTargets. An engineer
      working module 1 would stall on errors they are not allowed to touch.
      This module is where the whole-tree gate actually belongs — after the
      two owning modules have landed. It adds no new source: it exists to
      hold the acceptance criterion and to add a root `typecheck` script
      (tsc --noEmit across the workspaces) so the gate is runnable rather
      than narrative. If any error remains at this point it belongs to a
      named upstream module and is reported as that module's defect, never
      patched from here.
    acceptance: >
      `npx tsc -p server/tsconfig.json --noEmit` exits 0 with zero errors
      across the whole server tree, down from the 19 baseline errors. `npm
      run typecheck` exists at the root and runs the same check for shared,
      server, and client.

  - id: quality-budgets-registration
    title: Register the five new quality-budget rows in the profile and wire their npm scripts
    dependsOn:
      - duplicate-topic-preflight
      - token-failure-resume-engine
      - signin-ui-rebuild
    fileTargets:
      - docs/project-profile.md
      - package.json
      - server/package.json
      - client/package.json
    intent: >
      §8.1 proposes five new quality-budget rows, and the previous revision
      bound NONE of them to a module: docs/project-profile.md (which
      actually holds the budgets table, under its `## Quality budgets`
      heading — see the selection_screen_call_cost row for the exact
      six-column shape) and the package.json script entries named in the
      rows' Check column were in no module's fileTargets, so the estimator
      priced no work for them and the engineer had no instruction to write
      them. Add the five rows to docs/project-profile.md's table in the
      existing format, and add each row's script: test:budget:dedupe,
      test:budget:preflight-scan-cost, test:budget:reauth-resume and
      test:budget:reauth-grace to server/package.json (delegating to
      test/quality/*.budget.test.ts per regression A4's convention), and
      test:budget:no-tailwind to client/package.json; each also gets a root
      package.json entry delegating to its workspace, matching the existing
      eight-server-plus-two-client pattern (§9.1). The TESTS themselves are
      written by the modules that own the behavior — this module owns only
      their registration and invocability, which is why it depends on all
      three of them. Also append to docs/project-profile.md's `## Lessons
      learned` the finding this revision was built on: an architecture stage
      asserted transfer-engine.ts's re-entrancy without reading the file,
      and two P0s followed from it.
    acceptance: >
      Every one of the five new rows appears in docs/project-profile.md's
      Quality budgets table with all six columns populated, and the script
      named in each row's Check column runs and exits non-zero on failure.
      The existing rows are unchanged. A single `npm run
      test:budget:no-tailwind` from the repo root reaches the client
      workspace's test.
```

## 4. Runtime behavior & key scenarios (revised)

The core batch-transfer scenario (v1 §4, steps 1–8) is **Keep** — persisted
scan → job creation from stored rows → per-item execute → sweep →
poll/reconnect → evidence-based reconciliation. Two scenarios are new.

### 4.1 Real sign-in, with the cold-start window honestly bounded (Decision E)

```
Browser                  Frontend (static, always warm)      Backend (may be cold)          Google
  |  click "Sign in"                |                                |                          |
  |------------------------------->|  GET /api/auth/google/url       |                          |
  |                                 |  (cold-start covered; BLOCKS    |                          |
  |                                 |   the redirect until resolved)  |                          |
  |                                 |------------------------------->|                          |
  |                                 |     sets cc_oauth_state cookie  |                          |
  |                                 |     returns {authUrl}           |                          |
  |                                 |<-------------------------------|                          |
  |  window.location = authUrl                                       |                          |
  |------------------------------------------------------------------------------------------->|
  |                                          [ user on Google's domain — unbounded, human-paced ] |
  |<-------------------------------------------------------------------------------------------|
  |  redirect to backend /api/auth/callback?code=...&state=...        |                          |
  |------------------------------------------------------------------->|                         |
  |                                    ############################   |                         |
  |                                    # THE UNCLOSABLE WINDOW:     #  |                         |
  |                                    # if the backend went back   #  |                         |
  |                                    # to sleep while the user    #  |                         |
  |                                    # was on Google's screen,    #  |                         |
  |                                    # THIS request pays the full #  |                         |
  |                                    # 30-50s wake cost with NO   #  |                         |
  |                                    # page loaded to render an   #  |                         |
  |                                    # overlay into.              #  |                         |
  |                                    ############################   |                         |
  |                                   exchanges code, verifies state,  |                         |
  |                                   creates GoogleAccount + Session  |                         |
  |  302 -> frontend origin (no code/token in the URL)                |                         |
  |<-------------------------------------------------------------------|                         |
  |  lands on frontend, GET /api/auth/me (cold-start covered)          |                         |
  |------------------------------->|-------------------------------->|                          |
  |                                 |  200 {account}                  |                          |
  |<--------------------------------|<---------------------------------|                          |
```

**Decision E, stated plainly.** The warm-up call closes the *pre-redirect*
leg completely (it is an ordinary cold-start-covered fetch), and routing the
callback's redirect target through the frontend closes the *post-callback
confirmation* leg completely (same mechanism). **Neither closes the callback
route's own processing time** — the single request from Google landing on
`/api/auth/callback` through that route's own 302 issuance. If the backend's
15-minute idle timer re-fires while the user is reading Google's consent
screen (a human-paced, unbounded interval the warm-up cannot see), that one
request pays the full wake cost with the browser mid-navigation and no page
loaded — this is architecturally unclosable by any client-side mechanism, a
page cannot render before it exists. Two mitigations, both already in the
design: the warm-up minimizes the *probability* of hitting a cold backend at
callback time (most users move through Google's screen in well under 15
minutes), and the landing screen's expectation-setting copy ("First sign-in
today can take up to a minute") pre-frames the worst case as normal rather
than broken. **MANUAL-VERIFY:** whether Render's health-check polling of
`/api/health` prevents free-tier dyno sleep is unresolved and carried
unchanged from v1's own backlog (DEFER-1) — do not rely on it as a third
mitigation; only the two above are treated as reliable here.

**Browser Back button after the redirect (UX open question, resolved).**
Because the OAuth authorization code never reaches the frontend's URL at all
(only a coarse `?authError=` flag does, on failure, immediately stripped via
`history.replaceState`), there is no stale code to replay and no session
mutation Back can trigger. This is **structurally moot**, not merely
handled: Back from Selection lands on an ordinary prior history entry (the
ex-landing screen) carrying no query parameters and no side effect.

### 4.2 Google token failure mid-transfer — pause-and-wait, DB-durable (Decision F)

```
transfer-engine (execute loop)         TransferJob row                job-reconciler (interval)     google-oauth-routes
  item N: provider call                                                                             
    -> AuthExpiredError                                                                              
  mark item N skipped/provider_error --> outcome=skipped                                            
  set pause, release lease ----------->  googleReauthRequiredAt=now()                               
                                          executorId=null                                            
                                          activeAccountId UNCHANGED           (job stays "active")   
  return (no in-process wait)                                                                        
                                          items N+1..k stay outcome=pending                          
                                                                        [ every interval tick: ]      
                                                                        SKIP jobs with
                                                                        googleReauthRequiredAt
                                                                        younger than
                                                                        GOOGLE_REAUTH_GRACE_MS
                                                                                                       user clicks "Reconnect"
                                                                                                       -> full OAuth redirect
                                                                                                       -> callback succeeds
                                                                                                       -> clears pause field
                                                                                                       -> calls resume(jobId)
  execute() re-entered: resumes from                                                                
  first outcome='pending' item ------->  ...continues normally...
```

**If the user never reconnects:** once `googleReauthRequiredAt` exceeds
`GOOGLE_REAUTH_GRACE_MS` (default 30 minutes), the interval reconciler
treats the job exactly like a stale/wedged one — same evidence-based branch
it already runs for any interrupted job (`attemptedAt IS NULL` → never
attempted → `skipped`/`server_interrupted`), landing the job at
`status='interrupted'`. **Zero new status values, zero new skip reasons.**

**Why pause-and-wait over fail-and-let-a-rerun-recover, given both were
legitimate per UX's own open question:** the deciding factor is durability,
not preference. A naive pause-and-wait (an in-process `await` sleeping until
a signal arrives) would violate driver 10 outright — a Render restart while
"waiting" loses the promise chain exactly the way v1's architecture already
rejected for job execution in general. This design isn't that: **the pause
IS a DB state, and the resume IS a fresh call into the same entry point job
creation already uses.** It costs one new nullable field, one new config
knob, and one reconciler branch — genuinely less new surface than
fail-and-rerun would have cost (which would have needed a *new* distinction
between "why did this job fail" states to keep the Completion Summary
honest, since the top-level catch's existing `failed` status was written for
unexpected exceptions, not a well-understood, recoverable credential gap).
Pause-and-wait also matches what UX actually designed for and wrote an
acceptance scenario against ("the job resumes") — Acceptance Scenario 9
holds **exactly as written**, no supersession note needed here (contrast
with v1's own D29 precedent, where a scenario precondition genuinely had to
be superseded; that isn't the case here).

**`AuthExpiredError` before the item loop (the pre-loop phase).**
`buildTopicMap` and `enumeratePosts` both run **before** the item loop and
therefore **outside** `processItem`'s try/catch — verified at
`transfer-engine.ts:453–474`. An `AuthExpiredError` thrown there today would
reach `run()`'s top-level catch and mark the job `failed`, with no
`googleReauthRequiredAt`, no 4c banner, and no resume path. That is not an
exotic case: the 7-day authorization expiry is guaranteed, and job start is
precisely when a near-expiry token is most likely to be spent. **The pause
handler must therefore be reachable from the pre-loop phase too.** Wrap
`buildTopicMap` and `enumeratePosts` in a catch that, on `AuthExpiredError`
*only*, invokes the same `pauseForReauth(lease)` routine the per-item branch
uses — with no item to mark, because none was attempted. Every other error
from the pre-loop phase keeps its existing behavior (`run()`'s catch →
`failed`), unchanged. The distinction is `AuthExpiredError`'s alone.

**Resuming mid-job must be safe — and today it is NOT.** See **§4.3**, which
replaces this section's previous claim.

### 4.3 Re-entrancy of `execute()` — designed, not assumed (P0-B, resolved NEGATIVE)

> **This section supersedes the v1-revision claim that `execute()` "already
> iterates only over `outcome='pending'` items."** That claim was written
> without reading `transfer-engine.ts` and is **false**. It is corrected here
> because two separate features — Decision C (duplicate prevention) and
> Decision F (pause-and-resume) — were both designed on top of it.

**What the code actually does** (`server/src/services/transfer-engine.ts`,
read at commit `06c3d05`):

```ts
// transfer-engine.ts:476-489 — the item query, verbatim in shape
const items = (await this.prisma.transferJobItem.findMany({
  where: { jobId },                       // <-- NO outcome filter
  orderBy: { createdOrder: 'asc' },
  select: { id: true, scanItemId: true, sourceType: true,
            sourceId: true, title: true, createdOrder: true },
            // <-- `outcome` is not even SELECTED
})) as ItemRow[]
```

The loop that follows calls `processItem` for **every row returned**.
`processItem` branches only on `resolution?.skipsPost` and on whether the
source post still exists; an item that is already `transferred` or already
`skipped` matches neither branch and **falls straight through to
`transferPost`**, which issues a real `createCourseWork` /
`createCourseWorkMaterial` against the destination course.

**Why the corruption is invisible in the app.** `finish()`
(`transfer-engine.ts:1147-1168`) writes through
`updateMany({ where: { id: itemId, outcome: 'pending' } })`. For an
already-terminal item that predicate matches zero rows, so the write is
**refused** and an ERROR is logged — the item row keeps its original
outcome, the `GROUP BY` in `reconciliation.ts` keeps summing to
`count(items)`, and `checkInvariant` keeps returning `holds: true`. The
ledger is perfectly balanced. **The duplicate post exists only in the
teacher's actual Google Classroom, where this application never looks.**

That is the worst available failure shape for this product: the one thing
the teacher can see that the system cannot, in the destination course this
entire feature exists to protect.

**Two independent defects fall out of the one missing filter:**

| | Trigger | Effect |
|---|---|---|
| **P0 #1** | Decision F's `resume(jobId)` after a reauth pause | Every item already `transferred` in pass 1 is re-`transferPost`ed in pass 2 → real duplicate posts, invariant still balanced |
| **P0 #2** | Decision C's pre-resolved duplicates, **on the very first run** | Items inserted at job creation as `skipped`/`duplicate_title` enter the loop, have no resolution and a live source post, and are **created** → the headline feature of this phase copies every duplicate while reporting it skipped |

P0 #2 needs no pause, no resume, and no second run. It fires on the
first transfer of any course that has a single title collision.

**The fix — four changes, all inside `token-failure-resume-engine`'s
`fileTargets`.**

**(1) Filter and select the outcome.** The item query becomes:

```ts
where: { jobId, outcome: 'pending' },
select: { …, outcome: true, attemptedAt: true, claimedTargetPostId: true },
```

This one change closes **both** P0s. It is what the previous revision
believed was already true, and it is the whole of the mechanism that makes
"only touch pending rows" the single rule serving both features. `finish()`'s
pending-predicate stays exactly as it is, but it is demoted from *the*
duplicate-prevention mechanism (which it never was — it guards the ledger
write, which happens *after* the provider call) to what it has always
actually been: a last-line-of-defence assertion.

**(2) Make the topic map re-entrant — `topicReuseJson` cannot do this.**
`buildTopicMap` (`transfer-engine.ts:604-625`) calls `createTopic` for
**every** source topic, unconditionally, on every entry. Decision D's
`topicReuseJson` does not close this, because that map is a **pre-flight-time
snapshot of the destination course**: it is structurally blind to the topics
*pass 1 itself created*. A resume would re-create every topic pass 1 made.

So the job must carry its **own** accumulated map, not only the pre-flight
one. Add `TransferJob.topicMapJson` (nullable `String`, JSON
`Record<sourceTopicId, destinationTopicId>`), and change `buildTopicMap` to:

1. Seed the in-memory map from `topicMapJson` (this job's own prior work),
   then from `topicReuseJson` (pre-flight destination matches) for keys not
   already present.
2. For each source topic **already in the map**, skip the `createTopic` call
   entirely.
3. For each source topic **not** in the map, `createTopic`, add the entry,
   and persist the updated map to `TransferJob.topicMapJson` in the same
   lease-checked `updateMany` as the existing per-topic `heartbeat` — so the
   map is durable at every step, not only at the end of the phase. A crash
   between two `createTopic` calls therefore loses at most zero topics on
   re-entry.

`topicsCreatedCount` increments only on branch 3; `topicsReusedCount` only
on a `topicReuseJson` hit. Neither increments for a branch-2 skip — a topic
this job already created is not a *new* creation and not a *pre-existing*
reuse, and double-counting it would inflate the summary the teacher reads.

**(3) Never re-attempt an evidence-ambiguous item.** With change (1) in
place, a terminal item can no longer re-enter. The one remaining exposure is
an item that was **mid-flight** when the process died: `outcome='pending'`
with `attemptedAt` set, and possibly `claimedTargetPostId` set (written
immediately after the provider create returns, per the existing D14/P0-1
machinery). Blindly re-running that item is exactly how
`copyAttachmentToMyDrive` (`transfer-engine.ts:838`) re-copies a Drive file
and how a post gets created twice. Rule: on entry, an item with
`outcome='pending' AND attemptedAt IS NOT NULL` is **not dispatched**. It is
resolved from the evidence already on the row, using the branch
`recordItemFailure` already implements — `claimedTargetPostId` present →
`finish()` as `transferred` with that id; absent → `skipped`/
`server_interrupted`. This adds no new vocabulary and no new evidence field;
it reuses the durable evidence v1 already writes for precisely this purpose.

**(4) Assert on provider calls, not on outcomes.** See §6.1's acceptance
rule — an outcome assertion passes today *while the bug is live*, and is
therefore not evidence of anything.

**Post-pause `TransferJob.status` (stated, not left to be derived).** The
pause path sets `googleReauthRequiredAt` and nulls `executorId`; it
**leaves `status` at `'running'`** and leaves `activeAccountId` set. This is
deliberate and load-bearing: the lease claim at the top of `execute()` is
`where: { id, status: { in: ['queued','running'] }, executorId: null }`, so
`'running'` + a null `executorId` is exactly the state a `resume()` can
re-claim. `'interrupted'` would be terminal and would make the job
unresumable; a new status value would break the single-active-job partial
unique index and `/active`, both of which derive from `status` alone.
`status` becomes `'interrupted'` only if the reconciler's grace period
lapses.

## 5. Data model & state (revised)

v1's core model — `TransferJob`/`TransferJobItem`/`PreflightScan`/
`PreflightScanItem`, the `Mock*` world, reconciliation-by-construction — is
**Keep**, unchanged in shape except the additive columns below.

### 5.1 Token custody (Decisions A & B)

**Decision A — no `access_type=offline`, no refresh token, ever.** Stated
explicitly: transfers are interactive (the user is present, watching a
progress screen) and complete in minutes; a standard access token (~1 hour)
covers any realistic batch, including one slowed by rate-limit backoff. In
Google's Testing status, a stored refresh token would *also* expire on the
same fixed 7-day cycle the access-token-only design already accepts as
routine — so requesting `offline` access buys nothing (the "long-lived"
credential is not actually long-lived at this deployment posture) while
costing a second stored secret, refresh-token-rotation logic, and a larger
blast radius if the session store is ever compromised. **The resumability
guarantee and the token lifetime now agree by construction**: resumability
after a *browser* disconnect needs nothing from the token at all (the job
runs server-side, unbound to the HTTP connection, exactly as v1 already
guarantees); resumability after a *token* expiry is Decision F's
pause-and-wait, which explicitly does not assume a refresh token exists —
it assumes a human will re-consent, which is the only thing that was ever
going to work reliably in Testing status regardless of this choice.

**Correction — "~1h covers any batch" is the wrong quantity, and
`accessTokenExpiresAt` must actually be read.** The sentence above compares
a batch's duration against the token's **full** lifetime. What a job actually
has is the token's **remaining** lifetime at job start, which is
`accessTokenExpiresAt − now()` and can be any value from ~60 minutes down to
seconds — a teacher who signs in, browses courses, runs a pre-flight, works
through the Action Sheet, and then starts a large transfer is the *normal*
case, not an edge case. As designed in the previous revision, late-session
jobs pause mid-transfer **by construction**, and the field
`accessTokenExpiresAt` — added to the schema, populated at callback — was
**read by nothing**. Corrected:

**`run(jobId)` reads `accessTokenExpiresAt` before claiming the lease.** If
the remaining lifetime is below `GOOGLE_TOKEN_MIN_REMAINING_MS` (new config
knob, default 10 minutes), the job does **not** start: it sets
`googleReauthRequiredAt = now()` immediately and returns, landing the teacher
on the *same* 4c "Time to reconnect Google" banner they would otherwise have
hit halfway through — except now no items have been attempted, nothing is
half-copied, and the reconnect is a clean pre-start action rather than a
mid-flight interruption. On `resume()`, the identical check runs again
before re-claiming.

This is a strict improvement in three ways and costs one field read: it turns
a mid-transfer stall into a pre-transfer prompt, it gives the stored field
a consumer (an unread column is a maintenance trap and a false signal of
rigor), and it makes the guarantee honest — the design no longer claims a
budget it never checked.

**Decisions A and F still agree, and are not re-litigated.** The threshold is
a *floor*, not a promise that any job fits: a genuinely long transfer started
with 55 minutes left can still exhaust the token, and Decision F's
pause-and-resume remains the answer for that — unchanged, and still the only
answer, since Decision A means there is no refresh token to silently renew
with. `fixture_f12_reconnect_fidelity` holds as written. What changes is only
that the *common* late-session case stops relying on the mid-transfer path.

**Decision B — token storage.** New `GoogleAccount` model:

```
model GoogleAccount {
  id                    String   @id   // Google's stable "sub" claim
  email                 String   @unique
  displayName           String
  pictureUrl            String?
  accessTokenCiphertext String          // AES-256-GCM, base64
  accessTokenIv         String          // base64, random per encryption
  accessTokenTag        String          // base64 auth tag
  accessTokenExpiresAt  DateTime
  scopesGranted         String          // space-separated, as Google returns — audit trail
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}
```

Encrypted with `TOKEN_ENCRYPTION_KEY` (a dedicated 32-byte key, **separate
from `SESSION_SECRET`** — a compromise of the JWT-signing key must not also
expose Google tokens). `Session.accountId` stays a plain `String` with its
Prisma relation to `MockAccount` **removed** — it may reference either
`MockAccount.id` (test) or `GoogleAccount.id` (production), resolved by
`account-directory`'s provider-mode gate, the same idiom `MockAttachment`'s
`parentType`/`parentId` already uses elsewhere in this schema for exactly
this reason (a column that means different things depending on a
discriminator, deliberately not FK-enforced).

**Session cookie itself is unchanged from v1** — signed JWT, httpOnly,
`SameSite=None; Secure` in production / `Lax` in dev, revocable via the
`Session` table. This is the carried-forward v1 ADR ("the real-API follow-on
swaps this module for actual Google OAuth... behind the same Session
concept") — confirmed here, not re-litigated.

**CSRF (`X-Classroom-Copier` header) interaction:** unaffected.
`requireCsrfHeader()` continues to guard POST/PATCH/DELETE only. The new
`GET /api/auth/google/url` and `GET /api/auth/callback` routes are both GETs
(Google's callback is a top-level cross-site navigation that will never
carry our custom header, nor should it need to), so they fall outside the
protected-method set exactly as every other read already does. Sign-out
stays `POST` and still requires the header — unchanged.

**Sign-out (UX open question, resolved):** clears the session cookie and
revokes the `Session` row (unchanged from v1) **and** makes a best-effort,
fire-and-forget call to Google's token revocation endpoint. Failure of that
call is logged at `WARN` and never fails the sign-out response — it is
defense-in-depth (the token expires within the hour regardless), not a hard
dependency, so it introduces no new user-facing failure mode for a routine
action.

### 5.2 Duplicate-prevention fields (Decision G)

`TransferJobStatus` gains:

- `skippedDuplicate: number` — the exact field UI's Delta asked for.
  Computed via `GROUP BY outcome, skipReason` aggregation (never an
  independently-incremented counter, per v1's own anti-drift rule).
  `skippedTotal = skippedByUser + skippedBySystem + skippedDuplicate` by
  construction; the item-count reconciliation invariant
  (`transferred + fallback_shell + skippedTotal == count(items)`) is
  **unchanged in shape** — only `skippedTotal`'s internal composition grows
  from two parts to three.
- `topicsCreated: number` / `topicsReused: number` — replace v1's single
  `topicsCreatedOrMapped`. Same incrementing-counter pattern v1 already
  accepted for this specific non-item concept (topics aren't
  `TransferJobItem` rows, so there's no aggregate to `GROUP BY`), just
  split in two.
- `googleReauthRequired: boolean` — derived from
  `TransferJob.googleReauthRequiredAt != null`. The raw timestamp is not
  exposed on the wire; the client needs only the boolean signal to render
  the 4c interrupt banner.

`SkipReasonSchema` gains exactly one new closed-vocabulary value:
`'duplicate_title'`. It is **neither** a user skip nor a system skip for
labelling purposes — it gets its own bucket (`skippedDuplicate`), which is
precisely why it needs its own field rather than folding into
`skippedBySystem` (whose `systemSkipLine` copy — "N posts were interrupted
before we could confirm they copied" — would be actively false for a
duplicate, exactly as UI's Delta identified).

#### 5.2a Where the split is actually implemented — `reconciliation.ts`

`server/src/services/reconciliation.ts` holds **the one implementation of
the reconciliation arithmetic in the system** (its own file comment says so),
and it is the module that must change for Decision G to exist at all. The
previous revision of this document did not mention the file, and no module
owned it. Corrected here and in the MDB.

**The defect the current code would produce, verbatim** (`reconciliation.ts:64`):

```ts
case 'skipped': {
  counts.skippedTotal += 1
  if (USER_SKIP_REASONS.includes(row.skipReason as SkipReason)) counts.skippedByUser += 1
  else counts.skippedBySystem += 1     // <-- duplicate_title lands HERE
  break
}
```

The split is a **two-way if/else**, so a `duplicate_title` row — absent from
`USER_SKIP_REASONS` — falls into `skippedBySystem`. That single line breaks
three things at once: `skippedDuplicate` never leaves zero, the
`skippedTotal = byUser + bySystem + duplicate` identity over-counts,
and `CompletionSummary`'s 5-term interrupted line fires on a run whose only
"system skip" was a perfectly ordinary duplicate — which is the exact
failure UI's own P0 Delta raised. **The invariant's *shape* in §5.2 is
right; the mechanism was unowned.**

**The change:**

```ts
case 'skipped': {
  counts.skippedTotal += 1
  if (row.skipReason === 'duplicate_title') counts.skippedDuplicate += 1
  else if (USER_SKIP_REASONS.includes(row.skipReason as SkipReason)) counts.skippedByUser += 1
  else counts.skippedBySystem += 1
  break
}
```

`duplicate_title` is added to **neither** `USER_SKIP_REASONS` nor
`SYSTEM_SKIP_REASONS`. It is a third partition, and the ordering above makes
that structural rather than conventional — the `duplicate_title` test runs
first, so no future addition to either list can silently capture it.
`OutcomeCounts` gains `skippedDuplicate: number`.

**One existing test must change, and it is not optional.**
`shared/src/api-types.test.ts:59-65` asserts
`[...USER_SKIP_REASONS, ...SYSTEM_SKIP_REASONS]` has length 6 under the
heading *"classifies every reason as exactly one of user or system"*. That
test never enumerates `SkipReasonSchema.options`, so after
`duplicate_title` lands the enum has **seven** values, only six are
classified, and the test **still passes while its own stated claim is
false**. Rewrite it to derive from `SkipReasonSchema.options` and assert an
exhaustive three-way partition:

> `USER_SKIP_REASONS ∪ SYSTEM_SKIP_REASONS ∪ {'duplicate_title'}` equals
> `new Set(SkipReasonSchema.options)`, the three sets are pairwise disjoint,
> and their sizes sum to `SkipReasonSchema.options.length`. Adding an eighth
> skip reason later without classifying it then fails loudly instead of
> quietly landing in `skippedBySystem`.

`checkInvariant`'s `holds` predicate is **unchanged** —
`transferred + fallback_shell + skippedTotal == totalItems ==
scan.totalPostsScanned` still holds term-for-term, because only
`skippedTotal`'s internal composition grew. **This is exactly why the P0 in
§4.3 was invisible: a balanced invariant is not evidence that the
destination course is correct**, and QA must not treat it as such.

`OutcomePill`/`OutcomeIcon` gain the additive `skipReason?: SkipReason |
null` prop UI §3.3 specified — backward-compatible, every existing call
site (no prop passed) unaffected.

### 5.3 New nullable fields on `TransferJob`

```
googleReauthRequiredAt DateTime?   // field, not a status — mirrors rateLimitPause (D5's precedent)
topicReuseJson         String?     // copied from PreflightScan.topicReuseJson at job creation
topicsCreatedCount      Int      @default(0)
topicsReusedCount       Int      @default(0)
// topicsCreatedOrMapped removed — replaced by the pair above
```

### 5.4 Persistence engine (Decision I)

**Choice: Postgres in production, SQLite in dev/test, driven by one
templated schema, not two hand-maintained ones.**

Prisma requires `datasource.provider` to be a compile-time literal, not an
env-driven value — so a single `schema.prisma` cannot itself target both
providers. The model bodies, however, are **already provider-portable**: v1
made every closed vocabulary a plain `String` column specifically because
SQLite has no native `enum`, which means nothing in the current schema
depends on a Postgres-only or SQLite-only feature. This is exploited
directly: `server/prisma/schema.template.prisma` becomes the single source
of truth for every model (everything except the `datasource` block); a
`scripts/prisma-datasource.mjs` pre-step writes the concrete, gitignored
`schema.prisma` by concatenating the template with a `datasource` block
selected by `DATABASE_PROVIDER` (`sqlite` default, `postgresql` in
production). This is the project's own documented lesson applied to itself
("cross-references must resolve... a shorthand invented once and never
reconciled is how drift happens") — one model definition, not two files a
future contributor could let disagree.

**Test isolation is fully preserved.** `server/test/helpers/db.ts`'s
per-test-file SQLite-copy pattern is completely unaffected — dev and test
both stay on the `sqlite` branch, and nothing about that pattern references
Postgres at all.

**Boot behavior in production: `prisma db push`, not `prisma migrate
deploy`.** This is a genuine, explicitly-accepted trade-off, not an
oversight: Prisma Migrate's migration SQL files are provider-specific, so a
migration history generated against SQLite is invalid against Postgres —
supporting both would mean maintaining **two parallel migration
directories**, a second place for the "one source of truth" discipline
above to be undermined. Given this project's existing norm ("no CI/CD
build-out beyond what deploy needs," carried from v1) and a single-operator,
single-tenant deployment, `db push` on boot — the same idempotent,
self-healing-on-redeploy pattern v1's fixture-reseed already uses (D3) — is
judged the better fit. **F15 — `db push`'s actual failure mode on a non-empty production database,
stated.** `prisma db push` is not unconditionally idempotent. On a change it
judges **destructive** (dropping a column, narrowing a type, adding a
required column without a default to a table that already has rows) it
either **refuses** or **prompts for interactive confirmation** — and on a
Render boot there is no operator at that prompt. The realistic outcome is a
boot that hangs or exits non-zero, taking the service down on deploy rather
than corrupting data, which is the safer of the two failure directions but
is still an outage with a non-obvious cause. Three consequences the engineer
must build to: (a) **never pass `--accept-data-loss`** in the boot path — it
converts a refused deploy into silent production data loss; (b) the boot
script must **fail loudly** with the `db push` output in the log rather than
swallowing a non-zero exit; (c) additive-only schema changes (new nullable
columns, new tables — which is all this phase actually introduces) are safe
and will apply without prompting. Anything destructive is an operator-run,
manually-reviewed step, and the day one is genuinely needed is the day the
`migrate deploy` upgrade path below stops being optional.

**Alternative considered and rejected:** `prisma
migrate deploy` with a second, Postgres-specific migrations folder,
generated once via `prisma migrate dev` against a real Postgres instance —
rejected for now on the "no CI/CD build-out beyond what's needed" norm; this
is the correct upgrade path the day this app gets a second production
consumer whose schema changes need rollback safety, and it is named here so
it isn't rediscovered from scratch.

## 6. Interfaces & contracts (revised)

**A. `ClassroomProvider` port is unchanged (Keep).** It already has the
state filters, batch-shaped health checks, and pagination this phase needs
— nothing here required editing `classroom-provider.interface.ts`.

**New port: `AccountDirectory`** (`server/src/services/account-directory.ts`):

```
interface AccountDirectory {
  getAccountSummary(accountId: string): Promise<AccountSummary | null>
}
```

Selected by `config.googleProviderMode`, the same discriminator that
already selects `ClassroomProvider`'s concrete implementation — one
selector, two ports gated by it, not two independent mode checks that could
drift apart.

**New error class:** `AuthExpiredError extends ProviderError`
(`server/src/adapters/types.ts`) — distinct from `PermissionError` (a
permission problem on *this resource*) and thrown when Google rejects the
credential *itself* (401/`invalid_grant`). `MockClassroomProvider` never
throws it (the mock has no real token to expire); its handling is exercised
via direct unit injection into `transfer-engine`, the same pattern already
used for `PermissionError`/`NotFoundError`.

### 6.1 The duplicate-detection query (Decision C)

**Exact calls**, both against the **destination** course, both explicit
about state (per the verified fact that the unfiltered default returns
`PUBLISHED` only):

```
listCourseWork(targetCourseId, { courseWorkStates: ['DRAFT','PUBLISHED'] })       // paginated, follows nextPageToken
listCourseWorkMaterials(targetCourseId, { courseWorkMaterialStates: ['DRAFT','PUBLISHED'] })  // paginated, separate surface
listTopics(targetCourseId)                                                         // paginated
```

All three reuse `post-enumerator`'s existing pagination-loop helper against
the target course instead of a second hand-rolled paginator —
`post-enumerator` becomes "the single owner of enumerating a course's
posts," source **or** destination, matching the project's own stated
discipline ("never open-code a merge").

**Same-surface matching, structurally, not by convention.** The match map's
key is `sourceType + ':' + normalizeTitle(title)` — `CourseWork` and
`CourseWorkMaterial` land in different key spaces by construction, so an
Assignment and a Material sharing a title never collide. No separate
precedence check is needed; the key composition **is** the rule.

**Normalization (PM §6.2, implemented once):** `shared/src/normalize.ts`
exports `normalizeTitle(s)`: Unicode NFC → trim → collapse internal
whitespace runs → case-fold. One function, imported by the match-map
builder — never re-implemented at a second call site.

**Multiple destination matches for one key (unaddressed by PM for
coursework — extended here for consistency with §6.2's topic rule):** the
first match by the destination's own return order is used for disclosure
purposes (which destination item + state the teacher sees named); ambiguity
here has no functional consequence (unlike topics, nothing is *written*
against "the matched item"), so the source item still resolves as exactly
one `duplicate_title` skip regardless of which candidate is shown.

**Precedence with the attachment health check (PM §6.3, decided):**
duplicate classification runs **first**, and duplicate items' attachments
are **excluded** from the batched `getAttachmentHealth` call entirely —
strictly cheaper (a smaller batch), and they can never enter `findings[]`
regardless of what health-checking them would have found.

**Persistence:** `PreflightScanItem.duplicateOfTitle` / `.duplicateOfState`
(new, nullable) carry enough for the Ready-to-Transfer disclosure list
without a second query. `PreflightResponse` gains `duplicates[]` and
`topicReuse[]` — disclosure-only, structurally separate from `findings[]`
(which stays exactly as today: actionable rows only, per PM §6.3).

**At job creation** (`POST /transfer-jobs`), items whose
`PreflightScanItem.duplicateOfTitle IS NOT NULL` are inserted as
`TransferJobItem{outcome:'skipped', skipReason:'duplicate_title'}`
**pre-resolved**.

> **This is a no-op against the engine as it stands today, and it is a P0.**
> Pre-resolving the row prevents nothing, because `execute()`'s item query
> does not filter on `outcome` — the row enters the loop, has no resolution
> and a live source post, falls through to `transferPost`, and **the
> duplicate is created**. `finish()` then refuses the ledger write and logs
> an ERROR per duplicate, so the summary still reads "skipped". **Decision C
> is inert until §4.3's fix (1) lands.** The engine change is a hard
> prerequisite of this decision, not a companion to it — which is why
> `token-failure-resume-engine` (which owns the fix) and
> `duplicate-topic-preflight` (which owns the pre-resolution) are now
> dependency-linked in both directions of reasoning, and why the
> zero-provider-call assertion below is the acceptance criterion rather than
> an outcome check.

With §4.3's fix in place, the pre-resolved row never reaches the loop, and
"only touch pending rows" becomes one real rule serving two features.

**Acceptance must be a zero-provider-call assertion, never an outcome
assertion.** An assertion of the form *"the duplicate item's outcome is
`skipped`/`duplicate_title`"* **passes against the unfixed engine** — the
row is written that way at job creation and `finish()`'s pending-predicate
refuses to overwrite it, so the assertion is satisfied by the very
mechanism that hides the bug. The criterion is therefore stated against the
provider double:

> A counting `ClassroomProvider` double records every
> `createCourseWork` / `createCourseWorkMaterial` / `createTopic` /
> `copyAttachmentToMyDrive` call with its arguments. For a job containing a
> `duplicate_title` item, the assertion is **zero calls carrying that
> item's title**, and **`totalCreateCalls === count(items where outcome
> = 'pending' at job start)`**. The same double, applied across a
> pause-and-resume pair, asserts **zero create calls in pass 2 for any item
> already terminal after pass 1**.

Written red-first against the current engine: both assertions must be
**observed failing** before fix (1) lands, and passing after. A guard that
has never been seen to fail is not evidence — the same discipline Decision J
already applies to the no-Tailwind test, applied to the defect that made
this whole section necessary.

**Cost against `selection_screen_call_cost` (existing budget, unaffected):**
that budget guards `GET /courses` — zero post enumerations, one count per
course. The new destination reads happen exclusively inside
`POST /courses/:sourceId/preflight`, a different endpoint entirely; the
existing budget's assertion is untouched. A **new** advisory row is added
instead (§8.1) for the pre-flight destination-scan's own call cost, bounded
by pagination (not a per-item round trip).

**Write-time re-check (PM open question — decided):** **no.** A
concurrently-editing co-teacher creating a colliding title between pre-flight
and write time is a real but narrow race, and re-checking at write time
would mean a second, unbatched destination read per item — directly working
against the driver that made batching the health check matter in the first
place. The pre-flight-time check, disclosed before commit, is judged
sufficient at this product's scale (one teacher, one job at a time per the
existing single-active-job guard); if the race is ever hit in practice, the
NEXT re-run's own duplicate detection recovers it for free (the general
"a miss recreates v1's disclosed behavior for one item" bias PM §6.2 already
accepted for normalization).

### 6.2 Topic dedupe (Decision D)

Matching rule exactly as PM §6.8 specified: name-normalized (§6.2's rule,
no state/surface clause — topics have neither). Multiple destination
matches: reuse the first by API return order, flag `ambiguous: true` in the
disclosure. Reuse mapping persisted as `PreflightScan.topicReuseJson` (a
JSON map, same idiom as the existing `findingsJson` column — not a new
pattern) and copied onto `TransferJob.topicReuseJson` at job creation, so
`transfer-engine`'s existing "build the topic ID map first" step consults it
directly: a mapped source topic reuses the destination id
(`topicsReusedCount++`, no `createTopic` call); an unmapped one creates as
today (`topicsCreatedCount++`).

> **`topicReuseJson` alone does not make topic-building re-entrant.** It is a
> pre-flight-time snapshot of the *destination course*, so it cannot see the
> topics **this job itself** created in pass 1 — a resumed job would
> re-create every one of them. The accumulated `TransferJob.topicMapJson`
> added in §4.3 fix (2) is what closes that, and the two maps are
> consulted in order (own work first, then pre-flight matches). Do not
> collapse them into one column: they answer different questions and are
> written at different times by different components.

Tracked outside the item totality invariant
exactly as PM §6.8 requires — `topicsCreated`/`topicsReused` are their own
pair, never terms in `transferred + fallback_shell + skippedTotal`.

**MANUAL-VERIFY (carried, unresolved by this stage):** whether Google
Classroom permits two same-named topics in one course. Not resolvable
without a live API call against a real course; if Google *forbids* it, the
"ambiguous multi-match" branch of this design simply never fires in
practice (harmless — the code path stays correct, just unreachable), so
this is not a blocking gap, only an honestly-flagged unknown for the
engineer to confirm during the live-OAuth checklist's first real transfer.

### 6.3 Token-failure interrupt (Decision F) — wire contract

`TransferJobStatus.googleReauthRequired: boolean` is the client-facing
signal (§5.2). The client's existing ~1.5s poll already reads this field
alongside `rateLimitPause`; when true, `TransferProgress.tsx` renders the
4c `.interrupt-banner` (frozen progress bar, "Reconnect Google account" CTA
triggering the same full-page OAuth redirect sign-in already uses). No new
endpoint is needed for the client to *observe* the pause — only the existing
callback route needs the new resume-trigger logic (§4.2), which is entirely
server-side.

**No new skip reason.** Directly answering UX's open question: the item
that triggered `AuthExpiredError` resolves `skipped`/`provider_error`
(it *was* attempted); items abandoned only if the grace period lapses
resolve `skipped`/`server_interrupted` via the reconciler's existing
evidence-based branch. Both values already exist in the closed vocabulary
and already carry the correct meaning for what actually happened to each
item — no new value, and therefore no new P0-3-style distinguishability
requirement either.

**B. REST API — additions only** (all existing v1 routes are Keep):

| Method & path | Purpose |
|---|---|
| `GET /api/auth/google/url` | Returns `{authUrl}`; sets the short-lived `cc_oauth_state` cookie (CSRF-for-the-redirect-leg, standard OAuth pattern) |
| `GET /api/auth/callback` | Google's redirect target; exchanges code, creates session, triggers Decision F's resume if applicable, 302s to the frontend |
| ~~`GET /api/auth/mock-accounts`~~ / ~~`POST /api/auth/sign-in`~~ | **Unregistered** when `GOOGLE_PROVIDER_MODE=google` (§8.4) |

`POST /api/auth/sign-out`, `GET /api/auth/me`, and every course/pre-flight/
transfer-job route are unchanged in path and payload shape beyond the
additive `TransferJobStatus`/`PreflightResponse` fields above.

## 7. Key technical decisions (ADR)

| Decision | Choice | Rationale | Alternatives considered | Consequences |
|---|---|---|---|---|
| **A — Refresh-token strategy** | Access-token-only; no `access_type=offline`, no refresh token stored | Testing-mode 7-day refresh-token expiry means "offline" access isn't actually long-lived here; a ~1h access token covers any realistic interactive transfer; resumability comes from Decision F, not the token | `access_type=offline` + refresh-token storage: rejected — buys no durability advantage at this deployment posture, adds a second stored secret and refresh machinery for zero benefit | Every credential interruption (however caused) looks identical to the system: "the access token is no longer valid" → Decision F's one pause-and-wait path handles all of them uniformly. Smaller blast radius if the session store is compromised. |
| **B — Token storage** | New `GoogleAccount` model, AES-256-GCM at rest with a dedicated key, `Session.accountId` un-FK'd (polymorphic, matching the existing `MockAttachment` idiom) | Server-side-only custody (PM C7, binding); a dedicated encryption key limits blast radius of a `SESSION_SECRET` leak; the polymorphic accountId avoids a schema union Prisma can't express | A shared `Account` table with a `kind` discriminator column: rejected — would force `MockAccount`'s course-ownership relations onto a row type (`GoogleAccount`) that has no equivalent, mixing two genuinely different concepts | `account-directory` is the one new indirection the codebase pays for this; every other consumer of "who is this session" is unaffected. |
| **C — Duplicate query mechanics** | Two paginated destination reads with explicit state filters, same-surface match keys, shared enumerator | Matches the verified Google default (`PUBLISHED`-only) exactly; reuses `post-enumerator` rather than a second paginator | Fetch destination posts once, unfiltered, and filter client-side: rejected — the unfiltered call silently drops drafts, which is the precise bug this feature exists to prevent | New advisory budget needed (destination-scan call cost); `selection_screen_call_cost` is provably unaffected in what it measures (though it would not have RUN — see §8.1). **Depends on the §4.3 engine fix to have any effect at all**: pre-resolving a duplicate row prevents nothing while `execute()` iterates every row regardless of outcome. |
| **D — Topic dedupe** | Name-normalized match, first-by-return-order on ambiguity, persisted reuse map, parallel accounting | Matches PM §6.8 exactly; reuses §6.2's normalization function rather than a bespoke topic rule | A separate, stricter topic-matching rule (e.g. requiring exact case match): rejected — no stated reason to diverge from the coursework normalization rule PM already justified | `topicsCreated`/`topicsReused` never enter the item invariant — a second, smaller reconciliation exists for topics alone. |
| **E — OAuth cold-start window** | Front-loaded blocking warm-up + frontend-routed callback confirmation; the callback route's own processing time is named as structurally unclosable | The two coverable legs are fully covered by the existing cold-start machine; claiming the third leg is fixed would be false | A server-side keep-alive ping (self-cron) to prevent sleep entirely: rejected — unverified whether Render's free tier even honors this (MANUAL-VERIFY, carried), and relying on an unverified mitigation is worse than naming the honest gap | The one real "waking up the server... dead screen" incident the assignment named can still occur, at reduced probability, with better-set expectations. |
| **F — Token-failure mechanism** | Pause-and-wait, DB-durable (nullable field + explicit resume trigger), reconciler-bounded grace period | Preserves driver 10 (durability lives in the DB, not process memory) while matching UX's own acceptance scenario and wireframe language ("the job resumes") | Fail-outright + rely on a rerun's duplicate-skip to recover: legitimate, offered by UX as an option, and would have needed a NEW distinction in the `failed`-status Completion Summary to stay honest about "why" — rejected as strictly more new surface for a worse UX outcome (a full manual rerun vs. one reconnect click) | Three new nullable fields (`googleReauthRequiredAt`, `topicReuseJson`, `topicMapJson`), two new config knobs (`GOOGLE_REAUTH_GRACE_MS`, `GOOGLE_TOKEN_MIN_REMAINING_MS`), one reconciler branch. Zero new statuses, zero new skip reasons. **Costs more than the previous revision claimed**, because `execute()` is not re-entrant and had to be made so (§4.3) — that work is a prerequisite of this decision, not a companion to it. |
| **G — Duplicate count field** | `skippedDuplicate` on `TransferJobStatus`; additive `skipReason` prop on `OutcomePill`/`OutcomeIcon` | Exactly what UI's Delta specified; `GROUP BY`-derived, preserving v1's anti-drift discipline | Folding into `skippedBySystem`: rejected outright — makes the existing `systemSkipLine` copy false for duplicates, the precise failure UI flagged | `skippedTotal`'s composition grows from 2 to 3 parts; the item-invariant's *shape* is unchanged. Implemented in `reconciliation.ts`'s `countOutcomes`, whose current two-way if/else would put `duplicate_title` in `skippedBySystem` — the split must be three-way with the duplicate test first (§5.2a), and `shared/src/api-types.test.ts`'s partition test must be rewritten to derive from `SkipReasonSchema.options` or it keeps passing while its own claim goes false. |
| **H — Build restoration** | Restore root+server `package.json`, `app.ts`, `config.ts` from `0694779`; apply Phase 2 deltas (`googleapis`, `google-auth-library`, restored root build script) on top; regenerate and commit the lockfile | The lockfile is an intact, uncorrupted record of the v1 tree (never successfully hand-edited) — restoring makes `package.json` and the lockfile agree with near-zero dependency churn | Patching `06c3d05` forward: rejected (kickoff, binding) — would mean regenerating the lockfile against downgraded majors (Prisma 5/Express 4/zod 3) never QC-certified | `npm ci` becomes viable again; a green root build once again means what it claims (server included). |
| **I — Postgres/dev-test mapping** | Templated single-source-of-truth schema, provider selected by env var at generate time; production boots via `db push`, not `migrate deploy` | Every model is already provider-portable (no Prisma `enum` usage, by v1's own SQLite constraint); one schema body avoids the two-hand-maintained-files drift risk this project has already been burned by | `prisma migrate deploy` with parallel SQLite/Postgres migration folders: rejected for now — a second migration-history surface to keep in sync, against a "no CI/CD build-out beyond what's needed" norm | No production migration rollback history — an accepted, explicit trade-off at this project's current stakes, not an oversight. |
| **J — No-Tailwind guard** | Shape-based regex (common Tailwind prefixes), `client/src/test/quality/no-tailwind.quality.test.ts`, proven red against `AuthFlow.tsx` before the fix | A literal-substring guard (the diagnosis doc's original pattern) demonstrably misses a second real instance; a guard that wouldn't have caught what it exists to catch is not a guard | A build-time lint rule (ESLint custom rule) instead of a test: rejected — this project's `test/quality/` convention already exists and is where budgets live; a second enforcement mechanism (lint) for one rule adds tooling surface for no real gain | Runs on every `npm test`, not only in CI/lint — cannot be silently skipped by a `--no-lint` flag. |
| **K — Render topology** | Two services, each with its **own scoped** build command (never the root script for either); `npm ci` post-lockfile-regen | The root build script (shared→server→client, restored per H) is the *local verification* recipe; each Render service needs only its own subset — conflating the two is exactly how the backend's build command ended up building the client (bug-inventory, verify-baseline addendum) | Both services running the root `npm run build`: rejected — wastes build minutes building the unused workspace on each service, and is the literal shape of the bug already hit once | Explicit, different Build Commands per service, stated precisely in §9.2 — nothing left for a non-developer to infer. |
| **L — `execute()` re-entrancy** *(new this revision — P0)* | Filter the item query on `outcome='pending'`; accumulate the job's own `topicMapJson`; never dispatch an `attemptedAt IS NOT NULL` pending item; assert on **provider calls**, not outcomes | Verified against `transfer-engine.ts` at `06c3d05`: the query filters on `jobId` alone, so terminal items re-enter and are re-created in the destination course while `finish()`'s pending-predicate keeps the ledger balanced. Both Decision C and Decision F were designed on the false premise that this filter existed | (a) Rely on `finish()`'s pending-predicate: rejected — it guards the *ledger write*, which happens **after** the provider call, so it hides the defect instead of preventing it. (b) De-duplicate at the provider adapter: rejected — pushes a job-level concern into the port and would need destination reads per item, defeating Decision C's batching. (c) Use `topicReuseJson` for topic re-entrancy: **impossible** — it is a pre-flight snapshot, structurally blind to the topics pass 1 itself created | One `where` clause, three extra `select` fields, one new nullable column, one reused evidence branch. Makes Decision C functional for the first time and Decision F safe. Every acceptance criterion on the owning module becomes a zero-provider-call assertion, observed failing first. |
| **M — PKCE on the OAuth flow** *(new this revision — security S1)* | Add PKCE `S256`; carry `{nonce, verifier}` in the single existing `cc_oauth_state` cookie | `state` alone protects the redirect leg against CSRF but does nothing about authorization-code interception; `google-auth-library` supports PKCE natively, so the cost is a few lines | (a) `state` cookie only (the previous revision): rejected — leaves the code exchange unbound to the client that requested it. (b) A second dedicated cookie for the verifier: rejected — two cookies is two sets of flags to get wrong, and they share a lifetime anyway | One extra cookie *value*, not one extra cookie. The callback fails closed on a missing cookie, a nonce mismatch, **or** a verifier the exchange rejects — all three take the same `?authError=expired` branch. |

## 8. Cross-cutting concerns (revised)

**Auth/security:** real OAuth 2.0 authorization-code flow (Decisions A, B,
E). Tokens never reach the client bundle — the browser holds only the
HttpOnly session cookie (PM C7, unchanged carrier). `prompt=select_account`
semantics preserved (v1's forced-picker requirement, now satisfied by
Google's real chooser rather than an in-app one). CSRF defense
(`X-Classroom-Copier`) unchanged and unaffected by the new routes (§5.1).

### 8.0 Security review findings, folded in

The `security-architect` review
(`security-reports/2026-08-23-security-architect.md`) returned **nine
findings, none critical or high**, and judged the overall posture
**proportionate** for a single-tenant, school-scoped, Testing-mode app. All
nine are applied below; none required re-opening a binding decision.

**S1 (medium) — PKCE is required, not optional.** The previous revision
specified only the `state` cookie, which defends the *redirect leg* against
CSRF but does nothing about authorization-code interception. Add **PKCE
(RFC 7636, `S256`)** to the authorization-code flow.
`google-auth-library`'s `OAuth2Client` supports it natively
(`generateCodeVerifierAsync()` → pass `code_challenge` +
`code_challenge_method: 'S256'` to `generateAuthUrl()`, then `codeVerifier`
to `getToken()`), so this is a few lines and one more short-lived cookie
value, not a new mechanism. **The verifier is stored alongside the nonce in
the same `cc_oauth_state` cookie** (an HttpOnly JSON payload of
`{nonce, verifier}`), so there is exactly one cookie to set, read, and
clear — a second cookie would be a second thing to get the flags wrong on.
The callback fails closed: a missing or unparseable cookie, a nonce
mismatch, **or** a token exchange the verifier does not satisfy all take the
`?authError=expired` branch, with no session created.

**S2 (medium) — the callback's redirect target is a fixed config value, never
derived from the request.** "302 to the frontend origin" named no source,
which is an open-redirect waiting to be built if a future implementer reads
it as `req.headers.referer` / `req.query.returnTo` / an `Origin` echo. Named
explicitly: the target is **`config.frontendOrigin`**, read once at boot from
the `FRONTEND_ORIGIN` env var and falling back to `CORS_ORIGINS[0]` when
unset (both already boot-time constants, both already in the operator's
checklist). The callback constructs its `Location` as
`` `${config.frontendOrigin}${path}${authErrorQuery}` `` and **no part of the
request contributes to the origin**. Acceptance: a test drives the callback
with a hostile `Referer`, a hostile `Origin`, a `returnTo` query parameter,
and an absolute-URL `state` payload, and asserts the response `Location`
header is byte-identical to the configured origin in **all four** cases.

**S3 (medium) — `TOKEN_ENCRYPTION_KEY` needs a generation command, not a
presence check.** Presence-only validation is all AES-256-GCM's length check
can give you: any 32 bytes passes, including `"aaaaaaaa…"` or a passphrase
someone typed. The audience is explicitly non-technical (driver 9), so the
mitigation is documentary and belongs where they will actually see it —
**`.env.example` and `docs/handoff/connecting-to-live-google.md` must both
carry the literal command**:

```
# Generate with:  openssl rand -base64 32
TOKEN_ENCRYPTION_KEY=
```

with a one-line note that it must differ from `SESSION_SECRET` and must never
be committed or reused between environments. `config.ts` additionally rejects
a value that base64-decodes to anything other than exactly 32 bytes, so a
truncated paste fails at boot rather than at first encrypt.

**S4 (medium) — `token-crypto` decrypt failure is a reconnect, not a crash.**
A rotated or corrupted `TOKEN_ENCRYPTION_KEY` makes
`decipher.final()` throw an authentication-tag error. Left alone, that
surfaces as a raw 500 mid-transfer. It is operationally identical to an
expired credential — the stored token is unusable and the fix is for the
teacher to sign in again — so it must take the identical path:
`token-crypto.decrypt()` catches any cipher error and throws
**`AuthExpiredError`**, which §4.2/§4.3's pause handler already routes to
`googleReauthRequiredAt` and the routine 4c banner. Acceptance: a test
encrypts under key A, swaps `config` to key B, and asserts the job **pauses**
with `googleReauthRequiredAt` set rather than failing. Log the event at
`WARN` with the account id and **never** the ciphertext.

**S5 (low) — pin the cross-account isolation that the FK removal un-pins.**
Dropping `Session.accountId`'s FK to `MockAccount` (§5.1, required for the
polymorphic account id) deletes the database's own cross-account safety net.
The review verified the application-level scoping is correct **today** — but
nothing pins it, so a future query that forgets its `accountId` clause
regresses silently. Add a **cross-account isolation contract test** as a
named acceptance criterion on `google-auth-core`: seed two accounts, each
with a course, a scan, and a job; assert that every account-scoped read
(`/api/auth/me`, `GET /courses`, `GET /transfer-jobs/:id`,
`GET /transfer-jobs/active`, the pre-flight routes) returns **404/403, never
200**, when driven with account B's session against account A's resource ids.

**S6 (low) — an explicit no-log rule for credential material.** Stated so
`security-engineer` can verify it at code review rather than infer it: **never
log a decrypted access token, a token ciphertext/iv/tag, a `code_verifier`,
an authorization `code`, or a raw provider error payload.** The last one is
the non-obvious member — `googleapis` error objects routinely carry
`config.headers.Authorization` with the live bearer token, so
`logger.error({ error })` on a provider failure writes the credential to
disk. The existing logging convention (`error.name: error.message`, already
used at `transfer-engine.ts`'s item catch) is the correct shape and must be
the *only* shape used for provider errors; `real-classroom-provider` maps
provider errors into the existing typed error classes **before** anything is
logged, and never passes the raw object through.

**S7 (low) — `cc_oauth_state` cookie flags, stated.** Mirror the session
cookie's environment-conditional behavior exactly: `HttpOnly`, `Path=/api/auth`,
`SameSite=Lax` (it must survive Google's top-level cross-site redirect back —
`Strict` would drop it and break every sign-in), **`Secure` in production**
and off in dev, and `Max-Age` **600 seconds**. Ten minutes bounds the window
in which a captured nonce+verifier pair is worth anything, and is comfortably
longer than a human takes on a consent screen. The callback clears the cookie
on **every** exit path — success, mismatch, and denial alike.

**S8 (low) — `resume(jobId)` account-scoping is an acceptance criterion, not
just a diagram arrow.** The sequence diagram shows the callback finding
"*this account's* paused job", but nothing tested it. Named: `resume` resolves
its job by `where: { accountId: <session account>, googleReauthRequiredAt: { not: null } }`
— it is never given a job id from the request. Acceptance: a test pauses a job
under account A, completes a full OAuth callback as account B, and asserts
account A's job is **untouched** (`googleReauthRequiredAt` still set,
`executorId` still null, no items advanced) and that B's callback resumed
nothing.

**S9 (low) — `drive.metadata.readonly`'s real exposure, stated plainly.**
This scope grants metadata read over the teacher's **entire** Drive — every
file name, folder structure, owner, and sharing state — not merely the files
this app touches, for the lifetime of any live token. The scope choice is
**reaffirmed** (Decision 12): attachment health checks genuinely need
metadata for files the app has not been granted individually, and
`drive.file` alone cannot provide it. But the exposure is now stated rather
than implied, and it goes in two places the teacher and operator will see:
the consent screen's own scope description is Google's, but
`docs/handoff/connecting-to-live-google.md` must include a plain-language
line — *"Google will tell you this app can see information about all your
Drive files. It reads file names and sharing settings to check whether an
attachment will copy; it never opens or downloads their contents."* — and
this document records it as an accepted, bounded trade, not an oversight.

### 8.1 Quality budgets (proposed additions)

All existing v1 rows are **Keep**. New advisory rows.

**These rows are owned by `quality-budgets-registration`** (MDB), which
writes them into `docs/project-profile.md`'s `## Quality budgets` table —
the file that actually holds the budgets — and adds each row's npm script to
the relevant `package.json`. The previous revision proposed all five with
none of those files in any module's `fileTargets`, so the estimator priced
no work for them and the engineer had no instruction to create them.

| Dimension | Key | Metric | Target | Tier | Check |
|---|---|---|---|---|---|
| correctness | `duplicate_dedupe_fixture` | New F-fixture: draft/published/normalization/near-miss/cross-surface/combined-case matches resolve exactly as PM §6.6 specifies, measured as **provider create calls**, not item outcomes (§6.1) | `0 create calls carrying a duplicate's title, on the FIRST run and across a pause/resume pair; totalCreateCalls == count(pending items at job start)` | **blocking** | `npm run test:budget:dedupe` |
| performance | `preflight_destination_scan_call_cost` | Provider calls behind `POST /courses/:id/preflight`'s new destination reads | `paginated only — no per-item round trips; call count bounded by ⌈destinationItemCount / pageSize⌉` | advisory | `npm run test:budget:preflight-scan-cost` |
| resilience | `token_failure_pause_resume_fidelity` | Item N fails with `AuthExpiredError`; job pauses; `resume()` completes items N+1..k — asserted on the **provider call log**, because a balanced reconciliation sum is satisfied by the broken engine too (§4.3) | `0 create calls in pass 2 for any item terminal after pass 1; 0 createTopic calls for topics pass 1 created; sum still balances` | **blocking** | `npm run test:budget:reauth-resume` |
| resilience | `reauth_grace_period_boundary` | Reconciler exempts a job younger than `GOOGLE_REAUTH_GRACE_MS` from staleness; resolves one older than the ceiling | `both bounds hold; status='interrupted' only past the ceiling` | advisory | `npm run test:budget:reauth-grace` |
| design-system | `no_tailwind_under_client_src` | Shape-based scan of `client/src` for Tailwind-class-pattern matches | `0 matches` | advisory | `npm run test:budget:no-tailwind` |

**Two rows are `blocking`, not `advisory`** — the two that cover the P0s in
§4.3. An advisory tier on the assertion that distinguishes "the teacher's
course is correct" from "the teacher's course has duplicate posts" would let
the exact defect this revision exists to fix ship green. Every other new row
stays advisory.

`selection_screen_call_cost` (existing row) is **re-asserted unchanged** —
its own test gains one new case confirming the destination-dedupe reads
never occur on the `GET /courses` path. **That new case is written into
`server/test/quality/courses-list.budget.test.ts`, which is now in
`google-oauth-routes`'s `fileTargets`** — the previous revision promised the
case while no module owned any test file, making it undeliverable. Note also
that `courses-list.budget.test.ts` is one of the four files that
authenticate via `POST /api/auth/sign-in`: the budget is unaffected in *what
it measures*, but it would not have **run** at all under an unconditional
removal of that route (§ MDB, `google-oauth-routes`).

### 8.2 Configuration (env vars — full inventory)

New: `TOKEN_ENCRYPTION_KEY` (required when `GOOGLE_PROVIDER_MODE=google` in
a production-like `NODE_ENV`, fail-fast per config.ts's existing
`SESSION_SECRET` pattern, **plus the 32-byte base64 length check and the
`openssl rand -base64 32` guidance from §8.0/S3**), `DATABASE_PROVIDER`
(`sqlite`|`postgresql`, default `sqlite`), `GOOGLE_REAUTH_GRACE_MS`
(default 30 minutes), `GOOGLE_TOKEN_MIN_REMAINING_MS` (default 10 minutes,
§5.1/F9's pre-start token-lifetime floor), and `FRONTEND_ORIGIN` (§8.0/S2's
fixed redirect target; falls back to `CORS_ORIGINS[0]` when unset). Carried
unchanged: `DATABASE_URL`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_PROVIDER_MODE`,
`CORS_ORIGINS`, `NODE_ENV`, `PORT`, `FEATURE_MONETIZATION_ENABLED`, plus the
existing harness-only knobs. Full enumeration lands in `.env.example` per
the `deployment-config` module.

### 8.3 Production mock-unreachability (PM §7.1a–d, mechanism confirmed)

Unchanged design from the PM brief, now concretely locatable: `config.ts`'s
existing `GOOGLE_PROVIDER_MODE` fail-fast (restored per Decision H) refuses
boot on `mock` (or unset) under a production-like `NODE_ENV`, naming
`google` as the sole accepted value. `google-oauth-routes` simply **does
not define** the mock-account routes at all — there is no runtime `if
(mode === 'mock')` branch to audit, because the code doesn't exist in that
file; `mock-classroom-provider.ts` and its routes stay reachable only
through `MockAccountDirectory`/`MockClassroomProvider`'s own test-only
wiring in `composition-root`, gated by the identical `GOOGLE_PROVIDER_MODE`
check that already selects `ClassroomProvider`.

### 8.4 The no-Tailwind guard (Decision J)

Lives at `client/src/test/quality/no-tailwind.quality.test.ts`, matching
this project's existing `test/quality/` convention (previously
server-only; this is its first client-side instance). **Shape-based, not a
literal list:** it asserts zero matches for a Tailwind-class-prefix pattern
(`\b(bg|text|border|rounded|shadow|flex|items|justify|w|h|p|m|px|py|mx|my|
gap|min-h|max-w)-`) across every `.ts`/`.tsx` file under `client/src`,
**excluding** the two deliberately-scoped Google-button classes
(`.google-signin-btn`/`.google-g-logo` — these are custom class *names*
this product defines, not Tailwind utilities, so no exclusion actually
collides with real content). Must be proven **red** against the current
`AuthFlow.tsx` before the fix lands (TDD discipline, matching this
project's own norm) — a guard that has never been observed to fail is not
evidence of anything.

#### 8.4a The a11y budget vs. Google's brand-mandated button (F14) — ruled in scope, with one documented exemption

The existing `a11y` budget (client, axe, 0 critical/serious) applies to the
new sign-in screen **unchanged and in scope** — the previous revision left
this unruled while specifying a button whose colors are dictated by Google's
branding guidelines rather than by this product's token system, which is
exactly the collision that produces an unexplained red budget on the
engineer's first run.

**The ruling:** Google's own sign-in button, built to their published
specification, is a **documented exemption from this product's contrast
tokens** — and *only* from those, and *only* for the button's own
foreground/background pair. It is not an exemption from anything else. The
button must still have an accessible name, be a real `<button>`, be
keyboard-reachable with a visible focus ring meeting 3:1 against its
adjacent colors, and carry no `aria-hidden` on its label. If axe reports a
contrast violation confined to `.google-signin-btn`'s own text-on-fill pair,
that single rule is suppressed **by selector, with a comment naming this
section** — never by lowering the budget's tier, never by disabling the
`color-contrast` rule globally, and never by an unexplained
`axe.configure` exclusion. Any other critical/serious finding on this screen
is a real failure.

**Why exempt rather than deviate:** using Google's exact button is not a
stylistic choice — a recognizably-Google button is what makes an
unfamiliar teacher trust the credential prompt, and Google's branding terms
constrain it. The alternative (a token-compliant button that merely says
"Sign in with Google") trades a real security-UX property for a contrast
delta on one element. **MANUAL-VERIFY:** whether Google's current button
spec actually *fails* WCAG AA at the sizes used here is unconfirmed at this
stage — it may well pass, in which case no suppression is needed and none
should be added. The engineer runs axe first and adds the exemption only if
it is genuinely triggered; a suppression for a violation that never fires is
its own kind of lie.

## 9. Deployment, distribution & operations (revised)

### 9.1 Build restoration, precisely (Decision H)

**Root `package.json`** — restore from `0694779` verbatim (workspaces
order `shared, server, client`; `engines.node >= 20`; `type: module`; all
scripts including `setup`, `dev:server`, `dev:client`, `test`, `lint`,
`test:e2e`, `check:citations`, `test:perf`, `test:lease-mp`, and all
**ten** root `test:budget:*` scripts — of which **eight delegate to the
server** (`reconciliation`, `totality`, `f1`, `f13`, `f12`, `reconcile`,
`lease`, `courses`) and **two to the client** (`a11y`, `coldstart`).
The previous revision said "all ten `test:budget:*` scripts" of the *server*
package; the server has **eight**. Restoring ten server scripts is not
possible and the engineer should not go looking for the missing two;
devDependencies restored: `@axe-core/playwright`, `@eslint/js`,
`@playwright/test`, `eslint`, `globals`, `typescript`,
`typescript-eslint`), **then** the one deliberate delta: the `build` script
becomes `npm run -w shared build && npm run -w server build && npm run -w
client build` — server included, closing the exact gap that let a green
root build hide a broken backend.

**Server `package.json`** — restore dependencies from `0694779`
(`@classroom-copier/shared: *`, `@prisma/client 6.19.3`, `express ^5.2.1`,
`zod ^4.4.3`, `jsonwebtoken ^9.0.2`; devDependencies including `prisma
6.19.3`, `supertest ^7.1.1`, `@types/jsonwebtoken`, `@types/supertest`),
restore the **eight** server `test:budget:*` scripts (plus `test:perf` and
`test:lease-mp`) pointing at `test/quality/*.budget.
test.ts` (not `src/__tests__/*`, per regression A4), restore `seed` pointing
at `prisma/seed.ts` (not `src/db/seed.ts`, per A5), restore `db:push`'s `&&
prisma generate` coupling (per A6/B6) — **then** add exactly two new
dependencies: `googleapis` (already present in HEAD's `package.json` but
never installed/locked — this restoration finally locks it) and
`google-auth-library` (new, for the `oauth-client` module's `OAuth2Client`).

**`server/src/app.ts`** — restore the `buildApp` composition-root shape
from `0694779` (not the current `createApp`): the `AppDeps`/`BuiltApp`
export shape, `MockClassroomProvider` imported from
`./adapters/mock/mock-classroom-provider.js` (not `./adapters/google/...`,
per regression A/B-class import bug), `classroom-provider.interface.ts`
imported from `./adapters/classroom-provider.interface.js` (one directory
up from where the broken `RealClassroomProvider` currently reaches),
`coursesRouter` (not `createCoursesRouter`), `requireCsrfHeader()` mounted
ahead of all routers, the one Express error-handling middleware normalizing
`RateLimitError`/`PermissionError`/`NotFoundError`/`LicenseBlockedError`.
**Then** add: `RealClassroomProvider`/`GoogleAccountDirectory` selection
alongside the existing mock selection, both gated by the identical
`config.googleProviderMode` check, and `authRouter`'s new
`google-oauth-routes` shape mounted at the same `/api` prefix.

**`server/src/config.ts`** — restore the `SESSION_SECRET` fail-fast
pattern (already present at HEAD, confirmed unregressed) **plus** the new
`TOKEN_ENCRYPTION_KEY` / `DATABASE_PROVIDER` / `GOOGLE_REAUTH_GRACE_MS` /
`GOOGLE_TOKEN_MIN_REMAINING_MS` / `FRONTEND_ORIGIN` reads described in §8.2.
This file is now in `build-restoration`'s `fileTargets` — the previous
revision named it twice in the module's `intent` while omitting it from the
target list.

#### 9.1a The build-output path — three sources, all three wrong

The previous revision's acceptance criterion checked for
**`server/dist/index.js`**. That file does not exist and cannot. Read from
the repo rather than assumed:

| Source | Claims the entry point is | Correct? |
|---|---|---|
| Previous revision of this doc | `server/dist/index.js` | No |
| `0694779`'s `server/package.json` `start` | `dist/server/src/index.js` | No |
| HEAD's `server/package.json` `start` | `dist/index.js` | No |
| **`tsc -p server/tsconfig.json` actually emits** | **`server/dist/src/index.js`** | — |

`server/tsconfig.json` sets `rootDir: "."` with `outDir: "dist"` and
`include: ["src/**/*.ts", "prisma/**/*.ts", "test/**/*.ts"]`, so the emitted
tree mirrors the server package root: `dist/src/`, `dist/prisma/`,
`dist/test/`. This is confirmed on disk — `server/dist/src/index.js` exists
at HEAD; `server/dist/server/` does not.

**The restoration must therefore fix the `start` script, not copy it.**
`server/package.json`'s `start` becomes
`node --env-file-if-exists=.env dist/src/index.js`. Note the `include` also
compiles `test/**`, so `dist/test/` is emitted in production builds — ugly
but harmless and **out of scope for this phase**; changing `include` or
`rootDir` would move every emitted path and is exactly the kind of
incidental churn that produced this confusion. Recorded as backlog, not
done here.

**And the acceptance criterion must derive the path, never hard-code it.** A
literal in a doc is what got this wrong three times. The check is:

> After `npm run build --workspace=server`, parse `server/package.json`'s
> `start` script, extract its entry-point argument, and assert that file
> exists and that `node <that path> --version`-style import resolves (or
> simply that the process boots and `/api/health` answers). The assertion is
> *"the start script points at something the build actually produced"* — a
> property, not a path.

Render's Start Command (`npm run start --workspace=server`, §9.2) then
inherits the correction for free, which is the point: the deployed service
and the local acceptance check read the same single source.

**`server/src/index.ts`, `server/src/logger.ts`,
`server/src/adapters/classroom-provider.interface.ts`,
`server/src/adapters/mock/mock-classroom-provider.ts`,
`server/src/middleware/csrf.ts`** — **confirmed unregressed at HEAD**;
restoration touches none of these.

### 9.2 Render topology (Decision K)

**`classroom-copier-api`** (Node Web Service):
- Build Command: `npm ci && npm run build --workspace=shared && npm run
  build --workspace=server`
- Start Command: `npm run start --workspace=server`
- Health Check Path: `/api/health`
- Root Directory: repo root
- Env vars: the full inventory in §8.2/`.env.example`, set in the Render
  dashboard (never committed)

**`classroom-copier-web`** (Static Site):
- Build Command: `npm ci && npm run build --workspace=shared && npm run
  build --workspace=client`
- Publish Directory: `client/dist`
- Env vars: `VITE_API_BASE_URL` (baked in **at build time** — any change
  requires a rebuild, not a restart, per B14; stated explicitly in the
  checklist)

**Neither service runs the root `npm run build` script.** That script
(restored per §9.1 to include the server) is the **local verification**
recipe — what a developer or this run's own verify step uses to confirm
nothing is silently excluded. Each Render service uses its own scoped
subset. This distinction is stated explicitly because conflating the two is
exactly the shape of the bug already hit once (the backend's build command
building the client instead of the server).

**`npm ci`, not `npm install`, on both services** — viable specifically
because Decision H's lockfile regeneration makes `package.json` and
`package-lock.json` agree again; this is a **sequencing dependency**
worth naming (the lockfile commit must land before either service's build
command is set to `npm ci`, or both builds fail immediately).

**CORS is already correctly shaped** for the CSRF header's preflight — the
existing `cors({ origin: config.corsOrigins, credentials: true })` call
carries no explicit `allowedHeaders` list, so the `cors` package's default
behavior (reflecting the request's own `Access-Control-Request-Headers`)
already permits `X-Classroom-Copier` without any code change. The actual
B11 failure was never a CORS *configuration* bug — it was `CORS_ORIGINS`
pointing at the wrong deployed origin because the two Render services
tracked different GitHub repositories. No architectural fix closes that
class of error; only the checklist's explicit "verify both services point
at the same repo" step does (UX §7, already specified).

### 9.3 Cold-start reality — unchanged from v1, restated

Only `classroom-copier-api` sleeps; the static site does not. The OAuth
warm-up call (§4.1) is one more thing that keeps the dyno awake at exactly
the moment it matters most — the very first authenticated action of a
session, which was already v1's stated highest-risk cold-start moment.

## Risks, NFR gaps & open technical questions

1. **The callback-processing cold-start window (Decision E) is real and
   unclosed.** Named honestly, not mitigated to zero. Residual risk: a slow
   or distracted user on Google's consent screen after a long-idle backend
   still sees the "dead screen" the assignment named. Mitigations
   (warm-up, expectation copy) reduce likelihood and perceived severity, not
   probability to zero.
2. **Postgres migration has no rollback history in production** (Decision
   I's accepted trade-off). At this project's current single-tenant stakes
   this is judged acceptable; revisit if a second production consumer ever
   appears.
3. **Test-user-block and "authorization expired" are indistinguishable to
   this app** — both surface as a generic Google-side denial on return, per
   UX's own carried assumption. Mitigated entirely by the live-OAuth
   checklist's pre-emptive test-user step (§7 of UX, unchanged).
4. **`classroom.topics` scope sufficiency for reads is not independently
   confirmed** — the verified-facts doc confirmed only the *create*
   requirement. **MANUAL-VERIFY:** engineer confirms `listTopics` succeeds
   under this single scope during the live-OAuth checklist's first real
   transfer; if it does not, `classroom.topics.readonly` needs adding to
   the consent-screen scope list — a checklist-discoverable, not
   architecture-blocking, gap.
5. **MANUAL-VERIFY (carried, unresolved):** whether Google permits two
   same-named topics in one course (§6.2) — code path exists either way,
   harmless if unreachable.
6. **MANUAL-VERIFY (carried, unresolved):** the ~100 test-user cap — now
   independently confirmed against Google's own current documentation per
   `inputs/google-api-facts-verified.md` (100, confirmed) — no longer open.
7. **MANUAL-VERIFY (carried from v1 backlog, DEFER-1, unresolved):**
   whether Render's health-check polling prevents free-tier dyno sleep.
   Explicitly NOT relied upon anywhere in this design (§4.1).
8. **Open question for QA:** the three new mid-wizard/mid-transfer auth
   interrupt states (session-expired mid-wizard, session-expired
   mid-transfer, Google-reconnect mid-transfer) have **no dedicated
   fixture** — UX already flagged this (P1 Delta) and it stands unchanged.
   `token_failure_pause_resume_fidelity` (§8.1) covers the *engine*
   mechanism at the unit level; a full fixture exercising the *UI* states
   end-to-end remains a backlog item, carried forward, not closed by this
   stage.
9. **CLOSED — and the answer was no.** The previous revision listed
   `execute()`'s re-entrancy as an open question and shipped a design on top
   of the optimistic answer. It has now been verified by reading
   `transfer-engine.ts`: **`execute()` is not re-entrant**, and the same
   defect independently breaks Decision C on the first run. See §4.3 and
   Deltas P0-B / P0-C. **The residual risk is no longer "is this true?" but
   "was the fix actually built?"** — which is why every acceptance criterion
   on `token-failure-resume-engine` is a zero-provider-call assertion
   observed failing first.

   **Process note, recorded because it is the actual root cause:** both P0s
   existed because an architecture stage asserted a source file's behavior
   without reading it. `docs/project-profile.md`'s `## Lessons learned` now
   records the pattern (written by `quality-budgets-registration`). QA and
   QC should treat any claim in this document of the form "*X already
   does Y*" as unverified unless a line reference accompanies it.

## Diagrams

Two Mermaid sequence diagrams produced, one per new runtime scenario (§4):

- `diagrams/oauth-cold-start-sequence.md` — the sign-in flow, with the
  unclosable window called out explicitly (Decision E).
- `diagrams/token-failure-pause-resume-sequence.md` — the pause-and-wait
  mechanism end to end, including the reconciler's grace-period branch
  (Decision F).

## Deltas (required quality improvements)

| Risk (P0/P1) | Recommendation | Rationale | Prerequisite for next stage? |
|---|---|---|---|
| **P0-A** — The OAuth callback route's own processing time (the gap between Google's redirect landing on the backend and that route's own redirect to the frontend) cannot be covered by any client-side mechanism, and is the exact "dead screen" incident named in the assignment. | Engineer must build the pre-redirect warm-up as a *blocking* call (not fire-and-forget) and the callback's redirect target as the frontend origin, exactly as specified in §4.1 — getting either backwards reintroduces the incident structurally, not just in degree. | Directly named in the assignment as the incident to fix; the residual risk is honestly unclosable, so the two mitigations that DO exist must be built correctly or the design has zero effect. | **Yes** — this is a technical prerequisite for the `signin-ui-rebuild` and `google-oauth-routes` modules; getting the redirect target wrong is not a bug to catch later, it's the whole mechanism. |
| **P0-B (RESOLVED, NEGATIVE — `execute()` is NOT re-entrant)** — Verified by reading `transfer-engine.ts` at `06c3d05`. The item query (`:476-489`) filters on `jobId` alone and does not select `outcome`, so **every already-terminal item re-enters the loop and is re-created in the destination course**. `finish()`'s pending-predicate refuses the ledger write, so the reconciliation invariant stays balanced and **the duplicate posts are invisible in the app — visible only in the teacher's actual Google Classroom.** `buildTopicMap` (`:604-625`) re-creates every topic; `copyAttachmentToMyDrive` (`:838`) re-copies. | Build §4.3's four fixes — filter+select `outcome`; accumulate `TransferJob.topicMapJson` (`topicReuseJson` is a pre-flight snapshot and structurally cannot close this); never dispatch an `attemptedAt IS NOT NULL` pending item; assert on **provider calls, not outcomes**. All four red-first against the current tree. | This is the failure mode the entire feature exists to prevent, occurring silently, in the one place the product cannot see. A balanced invariant is **not** evidence the destination course is correct. | **Yes** — blocks `token-failure-resume-engine`, and through it Decision C (see P0-C). |
| **P0-C (NEW)** — Decision C's duplicate prevention is a **no-op on the first run**, from the same missing filter. Items inserted at job creation as `skipped`/`duplicate_title` still enter the execute loop, have no resolution and a live source post, fall through to `transferPost`, and **are created**. `finish()` refuses the write and logs an ERROR per duplicate. | Same fix (§4.3 fix 1). Acceptance is a **zero-provider-call assertion** — the duplicate must never reach `transferPost` — plus an assertion that `finish()`'s "refused to overwrite" ERROR never fires. An outcome assertion **passes today while the bug is live** and is not evidence. | **As designed, the headline feature of this entire phase copies every duplicate while reporting it as skipped.** It needs no pause, no resume, and no second run: it fires on the first transfer of any course with one title collision. | **Yes** — `duplicate-topic-preflight`'s pre-resolution is inert without `token-failure-resume-engine`'s engine fix; the dependency edge between them is real and now stated. |
| **P1** — Decision I's `db push`-on-boot production strategy has no migration rollback history. | Documented explicitly as an accepted trade-off (§5.4); revisit with `prisma migrate deploy` + a parallel Postgres migration folder if a second production consumer ever appears. | Named risk, not a silent gap — QA/QC should not discover this and treat it as an oversight. | No — explicitly decided, not deferred. |
| **P1** — Three new auth-interrupt states remain fixture-uncovered at the UI/E2E level (Risk #8), matching UX's own already-flagged P1. | A future pass adds a fixture (or simulated-provider harness) covering session-expired-mid-wizard, session-expired-mid-transfer, and Google-reconnect-mid-transfer end to end. | Carried unchanged from UX; the engine-level unit coverage this stage specifies (`token_failure_pause_resume_fidelity`) is real but narrower than a full UI fixture. | No — doesn't block engineer; QC must not treat these three states as fixture-certified. |

---

## Decisions (confirmed)

Recorded via `stage_record_decisions` with `source: "beast-mode-auto"`
(batch call, this session). All choices are the architect's own recommended
option, self-accepted per Beast Mode (stage-protocol §10); none crossed the
repository boundary.

1. **Decision A** — no `access_type=offline`, access-token-only; the
   resumability guarantee is satisfied entirely by Decision F, not by a
   long-lived refresh token that Testing status would expire on the same
   cycle regardless.
2. **Decision B** — new `GoogleAccount` model, AES-256-GCM at rest with a
   dedicated `TOKEN_ENCRYPTION_KEY`, `Session.accountId` un-FK'd
   (polymorphic, matching the existing `MockAttachment` idiom), sign-out
   best-effort-revokes the Google token.
3. **Decision C** — two paginated, explicitly-state-filtered destination
   reads, same-surface match keys via key composition (not a separate
   precedence rule), shared enumerator, no write-time re-check.
4. **Decision D** — name-normalized topic match, first-by-return-order on
   ambiguity, persisted reuse map, parallel accounting outside the item
   invariant.
5. **Decision E** — blocking pre-redirect warm-up + frontend-routed
   callback confirmation close two of three legs; the callback route's own
   processing time is named as structurally unclosable, not claimed fixed.
6. **Decision F** — pause-and-wait, DB-durable (not in-process), explicit
   resume trigger re-entering the same execution entry point job creation
   uses, reconciler-bounded grace period; zero new statuses, zero new skip
   reasons.
7. **Decision G** — `skippedDuplicate` field, additive `skipReason` prop,
   `skippedTotal` grows from two to three GROUP-BY-derived parts.
8. **Decision H** — restore root/server `package.json`, `app.ts`,
   `config.ts` from `0694779` precisely as enumerated in §9.1; add
   `googleapis`/`google-auth-library` and the restored root build script as
   the only deltas; regenerate and commit the lockfile.
9. **Decision I** — templated single-source-of-truth Prisma schema,
   provider selected at generate time; `db push` on production boot,
   explicitly not `migrate deploy`, with the trade-off named.
10. **Decision J** — shape-based regex guard at
    `client/src/test/quality/no-tailwind.quality.test.ts`, proven red
    against `AuthFlow.tsx` before the fix.
11. **Decision K** — two Render services, each with its own scoped build
    command (never the root script for either), `npm ci` sequenced after
    the lockfile regeneration.
12. **Scope reconciliation (PM §8's scope list):** confirmed against actual
    provider calls with zero drops — every scope PM listed is used by a
    named method; `drive.metadata.readonly` reaffirmed on pure
    least-privilege/fidelity grounds (the verification-burden rationale is
    struck per the verified-facts correction, but the scope choice itself
    survives on its remaining merits).
13. **Live-OAuth checklist delivery surface (UX's flagged open question,
    resolved):** a new markdown document
    (`docs/handoff/connecting-to-live-google.md`) supersedes the existing
    `.docx` as the source of truth — git-diffable, no proprietary tooling
    needed to edit or review it.
14. **Diagrams:** offered and accepted — two Mermaid sequence diagrams
    produced (§ Diagrams); both revised in revision 2 to show the fixed
    engine and the added security controls rather than the assumed ones.
15. **Decision L (revision 2)** — `execute()` is made re-entrant by an
    explicit `outcome='pending'` filter, a job-owned accumulated
    `topicMapJson`, and a no-redispatch rule for evidence-ambiguous items.
    This corrects a verified-false premise that both Decision C and
    Decision F were built on; neither C nor F is re-litigated, but both
    now name L as a prerequisite.
16. **Decision M (revision 2)** — PKCE `S256` added to the authorization-code
    flow, verifier carried in the existing `cc_oauth_state` cookie.
17. **Security review folded in (revision 2)** — all nine
    `security-architect` findings applied (§8.0). No critical or high; the
    review judged the posture proportionate for a single-tenant,
    school-scoped, Testing-mode app. `drive.metadata.readonly`'s
    whole-Drive metadata exposure is **reaffirmed and now stated
    explicitly** rather than left implicit (S9).
18. **F13/F14/F15 dispositions (revision 2)** — F13 applied as a downgrade
    (`prisma validate` under both providers, no live Postgres needed;
    the real `db push` is MANUAL-VERIFY at first deploy); F14 applied as an
    in-scope ruling with a narrowly-bounded, conditional exemption
    (§8.4a); F15 applied as an explicit statement of `db push`'s
    refuse-or-prompt failure mode and a ban on `--accept-data-loss` in the
    boot path (§5.4).

## Assumptions

- Google's `classroom.topics` scope, requested for `topics.create`, is
  assumed sufficient for `topics.list` reads too — MANUAL-VERIFY, named as
  Risk #4, not blocking.
- ~~`transfer-engine.ts`'s `execute()` is assumed to already be safe to
  re-enter mid-job~~ — **struck. Verified false** (§4.3). `execute()`
  iterates *every* item row regardless of outcome. This is no longer an
  assumption of any kind; it is a defect with a specified fix and a
  zero-provider-call acceptance gate.
- Render's Postgres free/low tier is assumed provisionable by the user
  without further paperwork (carried from the PM brief's own assumption,
  unchanged).
- The existing `cors` package's default header-reflection behavior (no
  explicit `allowedHeaders` set) is assumed to already permit the
  `X-Classroom-Copier` preflight without a code change — read directly from
  the restored `app.ts`'s `cors()` call, not independently tested against a
  live browser at this stage.

## Open questions

- Whether Render's health-check polling of `/api/health` prevents free-tier
  dyno sleep — MANUAL-VERIFY, carried unchanged from v1 backlog DEFER-1,
  explicitly not relied upon by this design.
- Whether Google permits two same-named topics in one course — MANUAL-VERIFY,
  carried from the PM brief; the multi-match code path is harmless either
  way.
- Whether `classroom.topics` alone (vs. requiring `.readonly` too) is
  sufficient for `topics.list` — MANUAL-VERIFY, named as Risk #4 and
  Assumption above, resolvable only during the live-OAuth checklist.
- The exact bounded value of `GOOGLE_REAUTH_GRACE_MS` (default proposed:
  30 minutes) is a judgment call, not derived from any measured constraint
  — engineer/QA may tune it based on how the live-OAuth checklist's first
  real transfer actually behaves.

## Next handoff

Engineer → reads `01`/`02`/`03`/`04` (this doc) and implements per the
Module declarations block above. Two things engineer should weight
heaviest, both named as P0 Deltas:

- **P0-A** (§4.1, Decision E): the OAuth redirect/callback wiring must be
  built exactly as specified — the warm-up blocking, the callback
  redirecting to the frontend origin, not a backend-rendered landing page.
- **P0-B / P0-C** (§4.3): `execute()` is **not** re-entrant — this is
  settled, not a check to run. Build the four fixes in §4.3 **first**,
  red-first, before any pause/resume machinery, and assert on **provider
  calls, not outcomes**. Until fix (1) lands, Decision C's duplicate
  prevention is inert and Decision F's resume creates duplicate posts in the
  teacher's real course while the app's own ledger reads clean.

The `duplicate-topic-preflight` module has **no dependency** on the auth
modules and can be built and tested entirely against the existing mock
provider in parallel with `google-auth-core`/`google-oauth-routes`/
`real-classroom-provider` — the Module declarations block's dependency
edges make this parallelism explicit, not merely possible in principle.
Note, however, that its *user-visible effect* does not exist until
`token-failure-resume-engine`'s engine fix lands; the two are independent to
**build** and coupled to **demonstrate**.

**Module count: twelve.** The MDB declares twelve modules — the original ten
plus `server-typecheck-clean` (F3: the whole-tree 0-errors gate that
`build-restoration` structurally cannot satisfy) and
`quality-budgets-registration` (F8: the five new budget rows and their npm
scripts, previously unbound to any module and therefore unpriced and
unbuilt). The previous revision said "nine" here and "the other eight" in
Delta P0-B while declaring ten; all three now agree at twelve.

**Implementation timeline (from architect handoff):**
- **Standard Mode (with approval gates):** ~2–3 weeks — matches the PM
  brief's own estimate; twelve modules across two largely-independent tracks
  (auth/provider vs. dedupe/UI) with real internal parallelism. The two
  modules added in this revision are small and late-sequenced
  (`server-typecheck-clean` adds a script and a gate;
  `quality-budgets-registration` adds table rows and script entries), so
  they widen the graph without extending the critical path — but the P0 fix
  in `token-failure-resume-engine` is genuinely new engine work with
  red-first test scaffolding, and this estimate now includes it.
- **Beast Mode (auto-accept, no inter-stage gates):** ~3–5 days of stage
  runtime through QC, per the PM brief's own estimate — unaffected by this
  stage's design, since the module count and dependency shape were sized
  with parallel dispatch in mind from the start.
