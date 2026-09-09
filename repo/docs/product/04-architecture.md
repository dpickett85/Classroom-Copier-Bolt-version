# Architecture — Classroom Copier

> The product's technical architecture — structure and key decisions, not code.
> Written by the architect from 01-pm-brief.md, 02-ux-workflow.md, and
> 03-ui-direction.md. Read by the engineer next (implementation).
> Product type: GUI app (responsive web) — React/Vite frontend + Node/Express
> backend. Date: 2026-08-14
>
> Produced under Beast Mode (full elicitation run; every choice question
> auto-accepted at its recommended option; recorded via `stage_record_decisions`
> with `source: "beast-mode-auto"`). No human was asked; every decision below
> is the architect's own recommendation, self-accepted per stage-protocol §10.

## 1. Architectural drivers & constraints

Ranked drivers this architecture optimizes for and trades against — every
decision below points back to one or more of these by name.

1. **Swappable integration boundary (highest priority).** The mock Google
   Classroom + Drive layer is a standing user directive, not a stopgap: "mock
   any test users and google apis that are blocking… we will revisit the APIs
   later." A future `RealClassroomProvider` must satisfy the *same* interface
   as today's mock, so the real-API follow-on (backlog, high severity) is a
   swap, not a rewrite.
2. **Zero silent drops / resilience.** Every scanned post must resolve to
   exactly one of transferred / fallback-shell / skipped; exponential backoff
   capped at 5 attempts then a guaranteed draft-shell fallback; the
   reconciliation formula `(transferred) + (fallback shells) + (skips) =
   (total posts scanned)` must hold **by construction**, not by convention —
   topics created/mapped is a separate count that never enters that sum, and
   "rubric notes added" is a non-additive subset tag that can co-occur with
   any of the three primary outcomes without ever adding a fourth term.
3. **Resumability across interruption.** A server-side transfer job with an
   id and a pollable status endpoint (binding P0 from UX), so a browser
   refresh or close mid-transfer reconnects and shows accurate progress
   instead of losing or duplicating the job.
4. **Cold-start tolerance.** Render's free-tier 30–50s wake is a first-class
   UX state ("Waking up server…"), not an ops footnote — it must be
   deterministically triggerable and testable, not just hoped for.
5. **Per-type fidelity.** `CourseWork` (Assignment / Quiz assignment /
   Question) and `CourseWorkMaterial` (Material) must be genuinely distinct
   shapes end to end — data model, API, and UI — never one generic "post"
   record with nullable fields. This exact defect class (a per-type claim
   with no per-type implementation) has already recurred and been corrected
   in all three upstream artifacts; this architecture must not reintroduce it
   a fourth time.
6. **Simplicity/velocity for a single-purpose v1.** No speculative scale
   engineering — realistic v1 load is one teacher running effectively one job
   at a time. Avoid infrastructure (queues, Redis, multi-service topologies)
   that buys capabilities nothing in this brief needs yet.
7. **Testability against a fixture manifest.** The mock is a first-class
   deliverable; every named behavior must be exercisable by a deterministic
   seed (F1–F13, below) so QC certifies against something real, not prose.
8. **Accessibility (WCAG AA).** Carried from UX/UI — drives API *shapes*
   specifically: the server must not hand the client an unthrottled
   per-item event stream, because the aria-live progress region cannot
   responsibly announce up to 50 individual events.
9. **Trust/safety.** Everything lands as a Draft; nothing this tool does is
   ever visible to students. No architectural decision may create a path
   where a post becomes visible without an explicit teacher publish action
   outside this product.

**Hard constraints:** Node/Express as a **persistent** backend (never
serverless-style — a 50-post transfer plus retries must not hit ~10s request
timeouts) deployed on Render; React static frontend on Render; no live Google
integration in v1; monetization present only as feature-flagged no-op
middleware; WCAG AA; the real-API follow-on's scopes must include
`classroom.courseworkmaterials` and `drive.file` (write, for "Copy to My
Drive"); English-only UI.

**Explicit trade-off:** this architecture optimizes for correctness-by-
construction and swap-ability over raw scale. There is no multi-tenant,
high-concurrency requirement — so a single SQLite-backed Node process is
chosen over a queue/worker-fleet topology (driver 6). This is revisited only
if usage data ever shows real concurrent-job contention (see Design Decision
Register **D5** for the one place this trade-off needed an explicit guard
rail).

> **Citation discipline (standing, added at engineer stage per critic P0-1).**
> Every `D<n>` token in this document resolves to a numbered row in the
> **Design Decision Register** (§ immediately before the Deltas table).
> Architecture deltas carry a distinct `Δ<n>` prefix; deltas inherited from
> `03-ui-direction.md` carry `UI-Δ<n>`. The three namespaces do not overlap, so
> a citation can never silently point at the wrong table.

## 2. System context & boundaries

**In-boundary (this build):**
- Web frontend (React/Vite, static)
- API backend (Node/Express): auth, course listing, pre-flight scan, transfer
  job engine, job-status API, monetization stub
- Persistence (SQLite via Prisma) holding **both** the simulated "Google
  world" (mock accounts, courses, topics, coursework, materials, attachments,
  rubrics) **and** application state (sessions, transfer jobs/items, the
  credit-ledger stub)
- The `ClassroomProvider` adapter boundary and its mock implementation

**Out-of-boundary in v1 (referenced only for interface parity / follow-on
planning):**
- Real Google OAuth / Identity
- Real Google Classroom API, real Google Drive API
- Stripe
- Any analytics vendor
- Render itself (external hosting platform, not app-owned code — a
  deployment target, covered in §9)

**External actor:** the teacher, via browser only. No student-facing surface,
no admin console, no IT/district-facing surface (per brief non-goals).

## 3. Architecture style & major components

**Style: modular monolith**, single Express process, with **ports-and-
adapters (hexagonal)** applied specifically at the Google-integration
boundary — not microservices (each Render free service sleeps
independently; splitting services would multiply 30–50s cold starts, driver
4) and not a queue/worker-fleet (Redis/BullMQ etc. — realistic v1 load is one
job at a time per teacher; that entire category of infrastructure buys
capability nothing here needs, driver 6). The "background job" is simulated
in-process as an async, non-blocking promise chain that checkpoints a
`TransferJobItem` row to the database after every item — durability comes
from the database write, not from process memory, so resumability (driver 3)
is a *read* concern (poll the rows), not a worker-runtime concern.

**Frontend:** React + Vite, TypeScript, organized feature-folder-per-wizard-
step (mirrors UX's five-step linear flow 1:1 — the file tree is the flow),
plus a small shared-components layer for the two cross-screen narration
components UI specified once (cold-start overlay, duplicate-run/rate-limit
banner).

### Component inventory (see diagram: `docs/product/diagrams/03-components.md`)

**Shared (both tiers):**
- `shared-contracts` — the single declaration of every client↔server DTO
  (zod schemas exported as both runtime validators and TypeScript types). No
  payload shape is hand-redeclared on the client (D17).

**Backend:**
- `data-model` — Prisma schema/migrations for both the mock-world and
  application-state tables, including the persisted pre-flight scan (D11).
- `post-enumerator` — the single owner of "all posts": paginated enumeration
  of both coursework surfaces, the merge, and the deterministic total
  ordering key. `preflight-engine` and `transfer-engine` both consume it;
  neither open-codes a merge (D16).
- `fixture-seed-data` — F1–F13 fixture definitions + idempotent seed script.
- `classroom-provider-interface` — the adapter contract; pure TypeScript
  types, no runtime code.
- `mock-classroom-provider` — implements the interface against the SQLite
  mock-world tables; simulates rate limits, trashed/permission-locked files,
  and license-blocked rubrics deterministically per fixture.
- `auth-module` — mock sign-in, forced account picker endpoint, session
  (JWT + revocable `Session` row), switch-account, sign-out.
- `preflight-engine` — health-check scan (topic presence, attachment health/
  permission checks) producing Action Sheet findings.
- `transfer-engine` — topic-map build, oldest-first per-type post creation,
  attachment linking + 20-cap handling, rubric-copy attempt with graceful
  degradation, exponential backoff with guaranteed fallback, reconciliation-
  safe outcome recording.
- `courses-api` — REST endpoints for course listing and pre-flight.
- `transfer-job-api` — REST endpoints for job creation, status polling,
  active-job lookup (reconnect), and the full itemized log.
- `monetization-middleware` — feature-flagged no-op credit/subscription
  checks + stub ledger.
- `cold-start-health` — `/api/health` readiness endpoint (doubles as
  Render's own health check and the frontend's cold-start detection target).
- `composition-root` — wires the concrete provider (mock today) into
  `preflight-engine`/`transfer-engine`, mounts routes/middleware, starts the
  server, and runs the evidence-based job reconciliation pass at boot **and on
  an interval** (D12, D14). **This is the only module allowed a runtime
  dependency on `mock-classroom-provider`.**
- `quality-budgets` — owns `test/quality/*`, the `test:perf` script, and
  landing the §8.1 rows into `docs/project-profile.md` so every declared
  budget has a command that produces its number (D21).

**Frontend:**
- `frontend-api-client` — typed fetch wrapper, poll loop, cold-start
  detection state machine (§4/§8).
- `ui-sign-in-account-picker`, `ui-selection`, `ui-preflight-actionsheet`,
  `ui-transfer-progress`, `ui-completion-summary` — one module per wizard
  screen.
- `ui-shared-components` — cold-start overlay, narration banner, step
  indicator, design tokens (CSS custom properties from `03-ui-direction.md`
  §2).
- `app-shell` — top-level routing/layout, persistent header (account,
  switch-account, sign-out), assembles the five screen modules into the
  linear wizard.

## Module declarations

Every module's dependencies, file targets, intent, and acceptance gate — the
canonical, machine-parsed record (`scripts/agent-c-modules.js`) that feeds the
engineer's dispatch planner. `classroom-provider-interface` is a pure
type-definition module (no runtime code); every module that depends on it for
typing alone uses the type-only edge form (`runtimeDependency: false`) —
concrete runtime wiring to `mock-classroom-provider` happens *only* in
`composition-root`.

```yaml agent-c:modules
kind: architecture
schemaVersion: 1
featureSlug: classroom-copier
modules:
  - id: shared-contracts
    title: Single-declaration client/server DTOs (zod schemas + inferred types)
    dependsOn: []
    fileTargets:
      - shared/src/api-types.ts
      - shared/src/index.ts
    intent: >
      D17. Every cross-tier payload is declared exactly once here as a zod
      schema and exported as both a runtime validator and an inferred
      TypeScript type: SignInRequest/AccountSummary, CourseSummary,
      PreflightResponse (scanId, totalPostsScanned, findings[]), Resolution
      (discriminated union over the five Action-Sheet options — D15),
      CreateTransferJobRequest {scanId, resolutions[]}, TransferJobStatus
      (status, counts incl. skippedByUser/skippedBySystem, currentItem,
      rateLimitPause), TransferJobItemRow, and the error envelope. The client
      imports these types; it never redeclares a payload shape.
    acceptance: >
      A test asserts every REST payload type used by frontend-api-client is
      imported from shared-contracts (no locally-declared duplicate
      interfaces); a test asserts Resolution's discriminated union rejects an
      unknown kind at runtime.
  - id: data-model
    title: Prisma schema for the mock-world and application-state tables
    dependsOn: []
    fileTargets:
      - server/prisma/schema.prisma
      - server/src/db/client.ts
    intent: >
      Define Account, Course, Topic, CourseWork, CourseWorkMaterial,
      Attachment, Rubric, RubricCriterion, RubricLevel (mock-world) and
      Session, PreflightScan, PreflightScanItem, TransferJob, TransferJobItem,
      CreditLedger (app-state) as SEPARATE tables per §5 — CourseWork and
      CourseWorkMaterial never share a table. PreflightScan/PreflightScanItem
      persist one scan so count(items) and totalPostsScanned are one
      measurement read twice (D11). TransferJobItem rows are inserted pending
      FROM THE STORED SCAN ROWS before any provider call (D2), and carry
      attemptedAt + targetPostId so an interrupted item's true fate is
      recoverable (D14). TransferJob.status is the lifecycle enum
      queued|running|completed|interrupted|failed; rate-limit pause is a
      nullable rateLimitPause field, NOT a status (D5). TransferJobItem
      skipReason vocabulary: user_skip_post, user_skip_attachment,
      provider_error, server_interrupted, rate_limit_exhausted (D1, D12).
      Attachment carries sortOrder (D22) and shareMode (never defaulted).
      A partial unique index enforces at most one TransferJob per accountId
      outside the terminal set {completed, interrupted, failed} (D5).
    acceptance: >
      Prisma migration applies cleanly; a unit test asserts CourseWorkMaterial
      has no dueDate/maxPoints columns at the type level; a unit test asserts
      the partial unique index rejects a second non-terminal job for the same
      account, INCLUDING when the existing job carries a non-null
      rateLimitPause; a unit test asserts TransferJobItem has non-null
      attemptedAt/targetPostId columns available.
  - id: classroom-provider-interface
    title: ClassroomProvider adapter contract (types only)
    dependsOn: []
    fileTargets:
      - server/src/adapters/classroom-provider.interface.ts
      - server/src/adapters/types.ts
    intent: >
      Define listCourses(accountId, {courseStates?, pageToken?, pageSize?}) —
      D19/E — listTopics, createTopic, listCourseWork/listCourseWorkMaterials
      (both take courseWorkStates? and are pagination-shaped per D9 — a real
      adapter returns PUBLISHED only unless the states are passed explicitly,
      so omitting the filter would silently drop every Draft and Scheduled
      post, D19/D), createCourseWork, createCourseWorkMaterial,
      getAttachmentHealth(refs[]) -> Map (batch-shaped from day one, D20/G),
      copyAttachmentToMyDrive, getRubric, createRubric (get-then-create, the
      real API's actual shape — D23/F). Payload types are DECLARED, not left
      to the mock: CourseWorkPayload, CourseWorkMaterialPayload and the
      four-way Material union (driveFile | youTubeVideo | link | form) where
      driveFile REQUIRES an explicit non-defaulted shareMode and the other
      three kinds have no shareMode field at all (D18/C). Error types:
      RateLimitError{retryAfterMs?}, PermissionError, NotFoundError,
      LicenseBlockedError — every one has a declared terminal outcome path in
      transfer-engine (D10, D12). Pure types — no runtime code.
    acceptance: >
      Compiles with zero emitted runtime JS beyond type declarations; a
      contract-test harness exists that any implementation (mock or future
      real) runs against; a type-level test asserts a driveFile material
      cannot be constructed without an explicit shareMode.
  - id: fixture-seed-data
    title: F1-F13 fixture definitions and idempotent seed script
    dependsOn:
      - data-model
    fileTargets:
      - server/src/fixtures/
      - server/prisma/seed.ts
    intent: >
      Seed F1 (healthy — INCLUDING at least one rubric-bearing assignment on a
      license-permitted course so copyRubric's SUCCESS path is fixtured, D24/M),
      F2 (trashed/deleted), F3 (permission-locked), F4 (exactly 50 posts), F5
      (21+ attachments with deterministic sortOrder so "attachments 1-20" is a
      total order, D22/I), F6 (single 429, retry succeeds), F7 (rubric license
      denial, with real criteria/levels rows), F8 (all 3 source states), F9
      (all 4 types), F10 (>=2 mock accounts with distinct course lists), F11
      (>=2 topics + >=1 untopiced post), F12 (interrupt-and-reconnect — reuses
      F4's course; the slow-mode delay is a RUN-SCOPED PROVIDER OPTION, never
      seeded course data, so F4's own perf budget is not measuring the
      harness, D25/N), F13 (persistent 429 scoped to ATTACHMENT-BEARING
      creates only, so the bare draft-shell fallback genuinely succeeds —
      D13/P0-4), and F14 (empty course, 0 posts — D26/O). Seeding is
      idempotent and safe to re-run on every boot (D3).
    acceptance: >
      Running the seed script twice produces identical row counts; a test
      asserts each fixture is queryable by a stable fixture key and matches
      its named shape (F4 has exactly 50 CourseWork+CourseWorkMaterial rows;
      F1 has >=1 rubric with >=1 criterion and >=1 level; F5's attachments
      have contiguous distinct sortOrder values; F14 has 0 posts).
  - id: mock-classroom-provider
    title: SQLite-backed mock implementation of ClassroomProvider
    dependsOn:
      - { id: classroom-provider-interface, runtimeDependency: false }
      - data-model
      - fixture-seed-data
    fileTargets:
      - server/src/adapters/mock/
    intent: >
      Implement every ClassroomProvider method against the seeded mock-world
      tables, honouring courseStates/courseWorkStates filters exactly as the
      real API would (an unfiltered listCourseWork returns PUBLISHED only —
      the mock must NOT be more permissive than the real API, or the contract
      test certifies nothing, D19/D). Simulate F6's transient 429 vs F13's
      persistent 429, which is scoped to creates carrying materials[] so a
      bare-shell create still succeeds (D13). MockProviderOptions
      {perItemDelayMs} is a run-scoped constructor option for F12, not fixture
      data (D25). getAttachmentHealth takes an array and issues one query.
    acceptance: >
      The shared ClassroomProvider contract-test suite passes for all
      fixtures; a test asserts listCourseWork WITHOUT courseWorkStates returns
      only PUBLISHED and WITH all three states returns Draft+Published+
      Scheduled (F8); F6 vs F13 are asserted to diverge; a test asserts F13
      429s an attachment-bearing create and PERMITS a bare-shell create.
  - id: post-enumerator
    title: The single "all posts" merge, pagination loop, and total ordering
    dependsOn:
      - { id: classroom-provider-interface, runtimeDependency: false }
    fileTargets:
      - server/src/services/post-enumerator.ts
    intent: >
      D16. Owns paginated enumeration of BOTH coursework surfaces (looping
      until nextPageToken is exhausted, passing all three courseWorkStates),
      the merge into one sequence, and the deterministic oldest-first ordering
      key (creationTime ASC, sourceType ASC, sourceId ASC) — creationTime
      alone is not a total order across two tables and seeded fixtures
      routinely share timestamps. preflight-engine and transfer-engine both
      consume this; neither re-implements the merge, which is how the two
      counts diverged in the first place.
    acceptance: >
      With the mock configured to page F4 at pageSize=7, the enumerator
      returns exactly 50 posts and issues 8 list calls per surface (D27/L —
      the one silent-drop the architecture says it cannot detect after the
      fact is now tested); a test asserts the ordering key is a total order by
      enumerating a fixture whose posts share a creationTime twice and
      asserting byte-identical order.
  - id: auth-module
    title: Mock sign-in, forced account picker, session, switch-account
    dependsOn:
      - data-model
      - fixture-seed-data
      - { id: shared-contracts, runtimeDependency: false }
    fileTargets:
      - server/src/routes/auth.ts
      - server/src/middleware/auth.ts
      - server/src/services/session.ts
    intent: >
      GET/POST endpoints backing the mock account picker (F10, >=2 accounts);
      sign-in ALWAYS renders the picker (never short-circuited by an existing
      valid session). Issues a signed JWT in an httpOnly, SameSite=None,
      Secure cookie scoped to a mock account id; a Session row backs
      revocation for switch-account/sign-out. Refuses to boot without
      SESSION_SECRET outside test.
    acceptance: >
      Integration test: signing in twice in the same browser session still
      renders the picker both times; switching accounts invalidates the prior
      session on the next request; a revoked session returns 401.
  - id: preflight-engine
    title: Pre-flight health-check scan, persisted
    dependsOn:
      - { id: classroom-provider-interface, runtimeDependency: false }
      - post-enumerator
      - data-model
    fileTargets:
      - server/src/services/preflight-engine.ts
    intent: >
      Enumerate via post-enumerator, batch-check attachment health, and
      PERSIST the result as one PreflightScan + one PreflightScanItem per
      enumerated post (D11) — totalPostsScanned is count(PreflightScanItem),
      written once. Produce findings (trashed/deleted -> Scenario 2 options,
      permission-locked -> Scenario 3 options) with type-aware labels ("Skip
      Material", never hardcoded "Skip Assignment") and recommended-option
      defaults (Scenario 2: Create Draft Shell with Note; Scenario 3: Copy to
      My Drive). Empty findings on an all-healthy course (F1/F4). A zero-post
      course produces a scan with totalPostsScanned=0 and zero findings
      (D26/O).
    acceptance: >
      F1 produces zero findings and a persisted scan whose
      totalPostsScanned equals the fixture's post count; F2 produces a finding
      whose skip label matches the flagged item's actual coursework type; F3
      produces the three-option finding with the correct recommended flag;
      F14 produces a scan with totalPostsScanned == 0.
  - id: transfer-engine
    title: Batch transfer job orchestrator
    dependsOn:
      - { id: classroom-provider-interface, runtimeDependency: false }
      - data-model
      - post-enumerator
    fileTargets:
      - server/src/services/transfer-engine.ts
      - server/src/services/backoff.ts
      - server/src/services/reconciliation.ts
      - server/src/services/notes.ts
      - server/src/services/resolutions.ts
    intent: >
      Build the old->new topic ID map first; process the job's items in the
      order stored on the scan (oldest-first, D16); build per-type payloads
      (never a generic transform); link up to 20 attachments BY sortOrder,
      append 21+ as URL links in the description; attempt rubric copy via
      getRubric+createRubric with graceful degradation to a note
      (rubricDegraded=true, outcome unchanged). Resolution->outcome mapping is
      explicit (D15): Create Draft Shell with Note -> fallback_shell; Skip
      <Type> -> skipped/user_skip_post; Copy to My Drive -> transferred; Link
      Existing File -> transferred; Skip Attachment and Note Draft ->
      fallback_shell (a note was injected, which is what the credit
      auto-refund rule keys off). THE OUTCOME FUNCTION IS TOTAL (D12): every
      per-item execution is wrapped in try/catch whose catch resolves the item
      to a terminal outcome — fallback_shell where a shell post was
      successfully created, otherwise skipped with skipReason=provider_error
      carrying the error class. On 429, exponential backoff capped at 5
      attempts honouring retryAfterMs, then a DISTINCT bare-shell fallback
      create (no materials[]) with the rate-limit-exhaustion note — a
      different call with a different payload from the primary create, which
      is what makes the "guaranteed shell" reachable on F13 (D13). attemptedAt
      is written immediately BEFORE each provider call; targetPostId is
      written in the same statement as outcome='transferred' (D14). Before
      writing status=completed the engine SWEEPS any remaining pending items
      and logs; the executor's top level catches and marks the job 'failed',
      resolving all remaining pending items (D12). Monetization completion is
      an injected callback, not a dependency edge (D28/K).
    acceptance: >
      For every fixture, an invariant test asserts
      count(transferred)+count(fallback_shell)+count(skipped) == count(items)
      == scan.totalPostsScanned READ FROM THE PERSISTED SCAN ROW (not
      recomputed in the test), topicsCreatedOrMapped is asserted NOT to appear
      in the sum, and rubricDegraded co-occurs with any outcome without
      changing it. A test injects a PermissionError and an arbitrary Error
      from the mock and asserts both items reach a terminal outcome and the
      sum still closes. A test asserts a job whose executor throws at the top
      level lands status='failed' with zero pending items. F13 asserts the
      item exhausts exactly 5 attempts and lands fallback_shell with the
      rate-limit-exhaustion note (distinct string from the attachment note)
      AND that a real target post was created for it. F14 asserts a zero-item
      job completes immediately with 0+0+0 == 0.
  - id: transfer-job-api
    title: REST endpoints for job creation, polling, and the itemized log
    dependsOn:
      - transfer-engine
      - auth-module
      - data-model
      - { id: shared-contracts, runtimeDependency: false }
    fileTargets:
      - server/src/routes/transfer-jobs.ts
    intent: >
      POST /api/transfer-jobs {scanId, resolutions[]} returns 202 {jobId}
      immediately; items are inserted FROM THE STORED SCAN ROWS, never
      re-enumerated (D11). If a non-terminal job already exists for the
      account, return 409 with the existing jobId (D5 — terminal set is
      {completed, interrupted, failed}, so a rate-limit-paused job is still
      guarded). GET /:id/status returns the compact poll payload including
      skippedByUser and skippedBySystem as separate counts (D14). GET
      /transfer-jobs/active lets a reloaded tab rediscover its in-flight job.
      GET /:id/items returns the full itemized log with per-item skipReason,
      never streamed per-item.
    acceptance: >
      Integration test simulates F12: start a job against the slow-mode F4
      fixture, stop polling, call /active from a fresh client context, resume,
      and assert the final state matches a never-disconnected client. A
      double-POST test asserts the second call returns 409 with the first
      jobId. A test creates a scan, MUTATES the underlying course between the
      scan and the job creation, and asserts the job still has exactly
      scan.totalPostsScanned items (D11 — this is the assertion the old
      tautological gate could not make). A test asserts a job POSTed while an
      existing job is rate-limit-paused returns 409, not a second job.
  - id: courses-api
    title: REST endpoints for course listing and pre-flight
    dependsOn:
      - preflight-engine
      - auth-module
      - data-model
      - { id: classroom-provider-interface, runtimeDependency: false }
      - { id: shared-contracts, runtimeDependency: false }
    fileTargets:
      - server/src/routes/courses.ts
    intent: >
      GET /api/courses?role=source|target scoped via the port's courseStates
      filter (source: ACTIVE+ARCHIVED; target: ACTIVE only, incl. SIS-shell
      flag). POST /api/courses/:sourceId/preflight {targetId} runs
      preflight-engine and returns {scanId, totalPostsScanned, findings[]}.
    acceptance: >
      Integration test: target-role listing for an account with an archived
      course never includes it; source-role listing includes it with an
      Archived badge flag; the preflight response carries a scanId that
      resolves to a persisted PreflightScan row.
  - id: monetization-middleware
    title: Feature-flagged no-op credit/subscription middleware
    dependsOn:
      - data-model
    fileTargets:
      - server/src/middleware/monetization.ts
      - server/src/services/monetization.ts
    intent: >
      A MonetizationService interface with NoOpMonetizationService (v1,
      FEATURE_MONETIZATION_ENABLED=false always calls next()) and a stub
      CreditLedger table. Hooks: credit check at job creation, and an
      onJobComplete(summary) hook INJECTED INTO transfer-engine as a callback
      (D28/K) implementing deduct-on-100%-clean / auto-refund-on-any-fallback
      — both no-ops while the flag is off, but the hook points exist and are
      called.
    acceptance: >
      With the flag off, job creation and completion never touch CreditLedger
      balances; both hook functions are called (verifiable via spy) but
      produce no state change; the status endpoint is never gated by the
      credit check.
  - id: cold-start-health
    title: Health/readiness endpoint and cold-start test harness
    dependsOn: []
    fileTargets:
      - server/src/routes/health.ts
    intent: >
      GET /api/health for Render's health check and the frontend's cold-start
      detection target. Supports env-gated COLD_START_SIMULATE_DELAY_MS and
      MOCK_PROVIDER_DELAY_MS test/dev flags (both inert by default and both
      inert in a production-like NODE_ENV, D25).
    acceptance: >
      /api/health responds <50ms with the flags unset; with the flag set the
      configured delay is honoured; with NODE_ENV=production the flag has no
      effect (guards both harness flags against leaking into production).
  - id: composition-root
    title: App wiring, provider injection, boot + interval reconciliation
    dependsOn:
      - mock-classroom-provider
      - post-enumerator
      - preflight-engine
      - transfer-engine
      - courses-api
      - transfer-job-api
      - auth-module
      - monetization-middleware
      - cold-start-health
    fileTargets:
      - server/src/app.ts
      - server/src/index.ts
      - server/src/services/job-reconciler.ts
    intent: >
      The ONLY module with a runtime dependency on mock-classroom-provider
      (selected via GOOGLE_PROVIDER_MODE). Mounts routes/middleware in order
      (monetization never blocks /api/health or auth routes). Runs the
      reconciliation pass at boot AND on an interval (D12) so a job wedged
      while the process is still alive self-heals rather than polling
      forever. Reconciliation branches on EVIDENCE, never blanket-skips (D14):
      attemptedAt IS NULL -> skipped/server_interrupted; attemptedAt IS NOT
      NULL -> list the target course and match on title + createdOrder; found
      -> transferred with targetPostId backfilled; not found -> skipped/
      server_interrupted. Jobs whose executor is gone are marked 'interrupted'
      (stale heartbeat at boot) or 'failed' (top-level throw).
    acceptance: >
      Integration test seeds a MIX before boot — items with attemptedAt NULL,
      items with attemptedAt set and a matching post present in the target,
      and items with attemptedAt set and no matching post — and asserts each
      lands correctly (skipped / transferred+targetPostId / skipped), that the
      reconciliation invariant holds, and that skippedBySystem is non-zero
      while skippedByUser stays zero. A second test asserts the interval
      reconciler resolves a job wedged in 'running' WITHOUT a process restart.
  - id: quality-budgets
    title: Quality-budget tests, the test:perf command, and the profile rows
    dependsOn:
      - transfer-engine
      - composition-root
    fileTargets:
      - server/test/quality/
      - docs/project-profile.md
    intent: >
      D21. Every §8.1 row gets a real command that produces its number, and
      the rows are landed into docs/project-profile.md's Quality budgets table
      at tier `advisory`. Owns `npm run test:perf`.
    acceptance: >
      `node scripts/agent-c-budgets.js run "<project>"` executes every
      declared row and reports a number for each; no row names a command that
      does not exist.
  - id: frontend-api-client
    title: Typed fetch client, poll loop, cold-start state machine
    dependsOn:
      - courses-api
      - transfer-job-api
      - auth-module
      - cold-start-health
      - { id: shared-contracts, runtimeDependency: false }
    fileTargets:
      - client/src/lib/api-client.ts
    intent: >
      Every backend call wrapped with the LATENCY-TRIGGERED cold-start state
      machine (D4, and see D29/U — this is neither a client idle clock nor a
      server cold-start flag): show the overlay if no response within 2s, hold
      to a 60s ceiling, then a distinct error state. Owns the ~1.5s poll loop
      and the /transfer-jobs/active reconnect call on mount. Every payload
      type is IMPORTED from shared-contracts, never redeclared (D17).
      credentials:'include' on every request.
    acceptance: >
      Unit test with a mocked delayed fetch: overlay appears after 2s, clears
      on response; a second test asserts the 60s ceiling produces the distinct
      error state; a third asserts a status payload that fails the
      shared-contracts schema is surfaced as an error, not silently rendered.
  - id: ui-shared-components
    title: Cold-start overlay, narration banner, step indicator, tokens
    dependsOn: []
    fileTargets:
      - client/src/components/shared/
      - client/src/styles/tokens.css
    intent: >
      One cold-start overlay and one narration-banner component (styling
      reused verbatim across Selection/Ready-to-Transfer/Progress; duplicate-
      run copy identical at its two touchpoints; rate-limit banner has its own
      copy), a non-interactive step indicator, an OutcomeIcon component that
      ALWAYS pairs its glyph with a visible or sr-only text label (D30/Q), and
      the design tokens as CSS custom properties matching 03-ui-direction.md
      §2 exactly. Narrow-viewport strategy (UI-Δ1): stat grid reflows 5->3->2;
      the log table horizontal-scrolls with a sticky title column.
    acceptance: >
      A test asserts every token in tokens.css matches the mockup's value; an
      a11y test asserts the overlay and banner are aria-live="polite" with a
      single announcement; a test asserts OutcomeIcon renders an accessible
      name for all four outcome kinds and cannot render glyph-only.
  - id: ui-sign-in-account-picker
    title: Sign-in landing and mock account picker screens
    dependsOn:
      - frontend-api-client
      - ui-shared-components
    fileTargets:
      - client/src/features/auth/
    intent: >
      Sign-in landing CTA; forced account picker listing >=2 mock accounts
      (F10) with distinct emails; reachable at first sign-in and via the
      header's "Switch account" control.
    acceptance: >
      Component test: picker renders both seeded accounts; selecting one
      navigates to Selection with that account's course list loaded.
  - id: ui-selection
    title: Source & Target Selection screen
    dependsOn:
      - frontend-api-client
      - ui-shared-components
    fileTargets:
      - client/src/features/selection/
    intent: >
      Two dropdowns (source: active+archived; target: active only, SIS badge);
      persistent duplicate-run notice; Continue disabled until both chosen and
      distinct; inline error when source==target.
    acceptance: >
      Component test: Continue stays disabled with source==target and shows
      the inline error; two distinct values enable Continue.
  - id: ui-preflight-actionsheet
    title: Pre-flight scan, Action Sheet Modal, Ready to Transfer
    dependsOn:
      - frontend-api-client
      - ui-shared-components
    fileTargets:
      - client/src/features/preflight/
    intent: >
      Silent auto-advance on empty findings (F1/F4); Action Sheet Modal on
      F2/F3 findings with type-aware skip labels, global auto-fix toggle
      (default OFF), focus-trapped/keyboard-operable per WCAG AA; Ready to
      Transfer confirmation restating the duplicate-run warning and, for a
      zero-post source, stating "0 posts to copy" (D26/O). Emits the typed
      Resolution[] from shared-contracts.
    acceptance: >
      Component test: an F2 finding on a Material shows "Skip Material", not
      "Skip Assignment"; toggling auto-fix selects every row's recommended
      option and enables Continue; a zero-post scan renders the 0-posts Ready
      state.
  - id: ui-transfer-progress
    title: Batch Transfer Progress screen
    dependsOn:
      - frontend-api-client
      - ui-shared-components
    fileTargets:
      - client/src/features/transfer/
    intent: >
      Live fraction counter + progress bar + recent-activity ticker; rate-
      limit pause banner with countdown; aria-live throttled to periodic
      counts (~every 5 items or ~3s) plus one completion announcement, never
      per-item; reconnects via /active on mount (F12); renders the generic
      catch-all error state for status='failed' (D12).
    acceptance: >
      E2E (Playwright) against the F12 slow-mode fixture: start a transfer,
      reload the tab mid-batch, assert progress resumes with accurate counts
      and no duplicated items. A component test asserts every ticker row's
      outcome icon carries a text alternative (D30/Q). A component test
      asserts status='failed' renders the error state, not a frozen bar.
  - id: ui-completion-summary
    title: Completion Summary full-screen report
    dependsOn:
      - frontend-api-client
      - ui-shared-components
    fileTargets:
      - client/src/features/summary/
    intent: >
      Five stat tiles (topics, transferred, fallback, "Skipped by you", rubric
      notes) where the skip tile is bound to skippedByUser ONLY; system skips
      render as a separate, visually distinct line naming what happened, never
      attributed to the teacher (D14). Reconciliation line rendered directly
      from server-provided counts (three-term sum over skipped_total). Six-
      column itemized log filterable by outcome; Type-specific fields column
      renders per-type. Focus moves to the main heading on mount (D30/Q).
    acceptance: >
      Component test against F9 data: a Material row's Type-specific cell is
      empty; a Question row shows its answer config; the reconciliation line
      matches transferred+fallback+skipped_total exactly with topics and
      rubric-notes excluded. A test renders a summary with skippedBySystem>0
      and asserts the "Skipped by you" tile does NOT include it and the system
      line is present. A test asserts focus lands on the main heading when the
      summary mounts.
  - id: app-shell
    title: Top-level wizard routing, layout, persistent header
    dependsOn:
      - ui-sign-in-account-picker
      - ui-selection
      - ui-preflight-actionsheet
      - ui-transfer-progress
      - ui-completion-summary
    fileTargets:
      - client/src/App.tsx
      - client/src/main.tsx
    intent: >
      Assembles the five screens into the linear wizard with the non-
      interactive step indicator; persistent header (account, switch-account,
      sign-out); Back enabled through Ready-to-Transfer, disabled once
      transfer starts.
    acceptance: >
      E2E walks the full happy path (F1) sign-in through Completion Summary
      and asserts each step-indicator state and Back availability at the
      correct points.
```

## 4. Runtime behavior & key scenarios

Diagram: `docs/product/diagrams/04-transfer-sequence.md`.

**Core scenario — batch transfer, end to end:**

0. **Pre-flight, persisted.** `POST /api/courses/:sourceId/preflight
   {targetId}` runs `preflight-engine`, which enumerates the source course
   through `post-enumerator` (one paginated loop over both coursework
   surfaces, all three `courseWorkStates` passed explicitly, merged and sorted
   by the total ordering key) and **writes the result down**: one
   `PreflightScan` row plus one `PreflightScanItem` per enumerated post
   (D11). The response carries `{scanId, totalPostsScanned, findings[]}`,
   where `totalPostsScanned` is `count(PreflightScanItem)` for that scan —
   not a separately-maintained integer.

1. Client `POST /api/transfer-jobs {scanId, resolutions[]}` after the
   Ready-to-Transfer confirm. Server validates session + scan ownership, and
   if a **non-terminal** job already exists for the account, returns
   `409 {jobId: <existing>}` (D5 — the terminal set is exactly
   `{completed, interrupted, failed}`, so a job paused for rate limiting is
   still guarded; a double-click during a *visible rate-limit pause* is the
   precise scenario this exists for). Server creates the `TransferJob` row
   (`status=queued`) and inserts one `TransferJobItem` row per stored
   `PreflightScanItem`, as `pending`, **in the same transaction and from the
   stored scan rows — never from a fresh re-enumeration** (D2 + D11). This is
   what makes `count(items) == scan.totalPostsScanned` a property of *one*
   measurement read twice, rather than a hope that two independent scans
   agree. Returns `202 {jobId}`.

2. Execution proceeds server-side, unbound to any HTTP connection: build the
   old→new topic ID map first, then process the items **in the order stored on
   the scan** (oldest-first by `(creationTime, sourceType, sourceId)`). For
   each item:
   - Write `attemptedAt` **immediately before** the provider call (D14) — this
     is the evidence that lets an interrupted item's real fate be recovered
     instead of guessed.
   - Build the per-type payload (§5); attach up to 20 attachments **ordered by
     `Attachment.sortOrder`** (D22 — `creationTime` is not a total order and
     "attachments 1–20" must be deterministic), appending 21+ as description
     links; attempt the rubric copy as `getRubric` then `createRubric`
     (D23), degrading to a note on `LicenseBlockedError` with
     `rubricDegraded=true` and the outcome unchanged.
   - Write via `createCourseWork` / `createCourseWorkMaterial`. On success the
     item resolves `transferred` and `targetPostId` is written **in the same
     statement as the outcome** (D14).
   - On `429`, exponential backoff (pinned constants in `backoff.ts`) up to 5
     attempts, honouring `retryAfterMs` when present. **On exhaustion the
     engine issues a different call**: a bare draft-shell create carrying **no
     `materials[]`**, with the rate-limit-exhaustion note appended, resolving
     `fallback_shell` (D13). This is what makes "guaranteed draft shell"
     reachable — the old design re-issued the same failing call and could
     never succeed. If the shell create *itself* fails, the item resolves
     `skipped` with `skipReason='rate_limit_exhausted'`; the sum still closes.
   - **The outcome function is total** (D12). The per-item executor is wrapped
     in `try/catch`; the catch resolves the item to a terminal outcome —
     `fallback_shell` where a shell post was successfully created, otherwise
     `skipped` with `skipReason='provider_error'` carrying the error class.
     `PermissionError`, `NotFoundError` and any unexpected exception all have
     an exit. **No code path may leave an item `pending` after the item loop
     completes.**

   Each transition is persisted immediately (the heartbeat), so the job's true
   state is always readable from the database.

3. **Before writing `status=completed`, the engine sweeps.** It asserts
   `count(items WHERE outcome='pending') == 0`; if not, it resolves the
   stragglers (`skipped` / `provider_error`) and logs at `[ERROR]`. The
   executor's top level carries a `.catch()` that marks the job `failed` and
   resolves every remaining `pending` item (D12) — `'failed'` is no longer a
   status nothing assigns.

4. Client polls `GET /transfer-jobs/:id/status` roughly every 1.5s — a compact
   payload (`status`, aggregate counts including `skippedByUser` and
   `skippedBySystem` **as separate numbers** (D14), `currentItem`,
   `rateLimitPause`). This polling traffic is also what keeps the Render dyno
   from sleeping mid-transfer.

5. **Interrupt & reconnect (F12).** If the client stops polling, server-side
   execution is unaffected. On reconnect the client calls
   `GET /transfer-jobs/active` (scoped to the signed-in account) to rediscover
   the `jobId` without depending on `localStorage`, then resumes polling.

6. **Wedge recovery (D12).** A stale-heartbeat reconciliation pass runs at
   boot **and on an interval while the process lives**. Without the interval,
   a job whose promise chain rejected while the process stayed up would poll a
   frozen counter forever: boot reconciliation never fires because there is no
   boot, and the client's 60s ceiling covers an *unresolved* call, not an
   answered poll reporting no progress.

7. **Evidence-based reconciliation (D14).** When the reconciler resolves an
   interrupted job's `pending` items it branches on evidence rather than
   blanket-skipping:
   - `attemptedAt IS NULL` → never attempted → `skipped` /
     `server_interrupted`. Honest.
   - `attemptedAt IS NOT NULL` → outcome unknown → **verify against the
     target**: list the target course's coursework and match on title +
     `createdOrder`. Found → `transferred`, backfilling `targetPostId`. Not
     found → `skipped` / `server_interrupted`.

   This is the difference between a ledger that balances and a ledger that is
   *true*. Marking a post the server may actually have created as "skipped"
   makes the teacher re-create it by hand — producing exactly the duplicate
   auto-resume was rejected to avoid.

8. On completion, the client fetches `GET /transfer-jobs/:id/items` **once**
   for the full itemized log — deliberately separate from the frequent status
   payload, so the aria-live throttling requirement is satisfied by the
   protocol shape itself.

**Resolution → outcome mapping (D15).** The Action Sheet's five options map to
buckets explicitly; nothing here is left to a reader's inference:

| Pre-flight resolution | Outcome bucket | Skip reason |
|---|---|---|
| Scenario 2 — Create Draft Shell with Note | `fallback_shell` | — |
| Scenario 2 — Skip \<Type\> | `skipped` | `user_skip_post` |
| Scenario 3 — Copy to My Drive | `transferred` | — |
| Scenario 3 — Link Existing File (risk) | `transferred` | — |
| Scenario 3 — Skip Attachment and Note Draft | `fallback_shell` | — |

The last row was the genuinely undecided one. It resolves to `fallback_shell`
because a note *was* injected into the post, and the credit rule
("auto-refund on any fallback injection") keys off exactly that event. Under
the alternative reading (`transferred`) a teacher would be charged for a copy
carrying a "could not be linked" note, which the business rule forbids. This
choice moves `fixture_f1_zero_fallback` and the brief's ≥95%-fidelity metric
— both are measured on **healthy** courses, where no resolution is produced at
all, so neither budget is affected in practice.

**Cold start:** every call through `frontend-api-client` starts a 2-second
timer; if unresolved, the Cold Start Overlay renders; it holds until either a
response arrives or a 60-second ceiling passes (transitioning to a distinct,
retry-offering error state — a genuinely down backend and a waking one must
never be indistinguishable, D4). **This mechanism is latency-triggered — it is
neither of the two options UX asked architecture to choose between** (D29): it
uses no client idle clock and no server cold-start flag, only actual response
latency. Consequently, UX Acceptance Scenario #8's precondition ("Given the
backend has been idle >15 minutes") is **superseded** by "any unresolved call
exceeding 2s"; QA should test the built behaviour, not the superseded
precondition.

**Concurrency model:** one active `TransferJob` per account, enforced by a
partial unique index over the non-terminal statuses (D5) and surfaced as a
409-with-existing-jobId.

## 5. Data model & state

Diagram: `docs/product/diagrams/05-data-model.md`.

**Two structurally separate coursework tables — not one generic "post"
table:**

- **`CourseWork`** (Assignment, Quiz assignment, Question via a `workType`
  enum: `ASSIGNMENT | QUIZ_ASSIGNMENT | SHORT_ANSWER_QUESTION |
  MULTIPLE_CHOICE_QUESTION`) carries `dueDate` (nullable — cleared on
  transfer), `maxPoints` (nullable, preserved), `answerConfig` (question
  types only), `quizFormLink` (quiz assignments only), `rubricId` (nullable),
  and `state` (`DRAFT | PUBLISHED | SCHEDULED`).
  *Note on `QUIZ_ASSIGNMENT`:* the real Classroom API does not expose a
  distinct `workType` for quizzes — this mock introduces one because the brief
  and UX/UI treat it as a fourth first-class type throughout. Flagged in Open
  Questions for the real-API follow-on.
- **`CourseWorkMaterial`** (Material) has **no `dueDate` column, no
  `maxPoints` column at all** — not nulled-out fields on a shared table.

**The persisted pre-flight scan (D11) — new at engineer stage:**

- **`PreflightScan`** `{id, accountId, sourceCourseId, targetCourseId,
  totalPostsScanned, scannedAt}`.
- **`PreflightScanItem`** `{id, scanId, sourceType, sourceId, title,
  workType, topicId, createdOrder}` — one row per enumerated post, in the
  total order `post-enumerator` produced.

`totalPostsScanned` is `count(PreflightScanItem)` for the scan, written once at
scan time. `POST /api/transfer-jobs` takes `{scanId}` and inserts
`TransferJobItem` rows **from those stored rows**. The identity
`count(items) == totalPostsScanned` is therefore definitional in the only sense
that matters — **one measurement, two readers** — rather than "we ran the same
query twice and expected the same answer." A test can now falsify it: mutate
the underlying course between the scan and the job creation and the job must
still carry exactly `scan.totalPostsScanned` items.

**Reconciliation-by-construction (driver 2, made structural):**
`TransferJobItem.outcome` is a single-valued, NOT-NULL enum
(`pending | transferred | fallback_shell | skipped`) — no representable state
lands an item in two buckets. **`pending` is a fourth representable state, and
the schema alone does not forbid fall-through** — that gap is closed by D12's
three mechanisms (total outcome function, pre-completion sweep, top-level
catch + interval watchdog), which are code obligations with their own
acceptance gates, not schema properties. Stating that plainly is the point: a
guarantee is structural only where the failure it forbids is unrepresentable,
and this one is half schema and half enforced code.

`rubricDegraded` is a strictly orthogonal boolean that never touches `outcome`,
which is what makes "non-additive subset tag" a schema fact and the
combined-outcome rule fall out for free. Client-facing counts are served via
`GROUP BY outcome` aggregation over `TransferJobItem` — never
independently-incremented counters.

**`TransferJobItem`** carries `{jobId, scanItemId, sourceType, sourceId,
outcome, skipReason?, rubricDegraded, note?, attemptCount, nextAttemptAt?,
attemptedAt?, targetPostId?}`. `attemptedAt` and `targetPostId` (D14) are what
make the persistence ADR's own stated rationale — "assert the draft the item
claims it created actually exists" — implementable at all; without them the
item never claims to have created anything.

**Skip reasons** are a closed vocabulary: `user_skip_post`,
`user_skip_attachment` (both **user** skips), `provider_error`,
`server_interrupted`, `rate_limit_exhausted` (all **system** skips). The API
exposes `skippedByUser` and `skippedBySystem` as separate counts; the
reconciliation sum stays three-term over `skipped_total`. **Only the labelling
splits** — the Completion Summary's "Skipped by you" tile binds to
`skippedByUser` alone, so a post the server abandoned is never attributed on
screen to a teacher who never chose it.

**`TransferJob`** `{id, accountId, scanId, status, rateLimitPause?,
lastHeartbeatAt, topicsCreatedOrMapped, startedAt, finishedAt}`. `status` is a
clean lifecycle enum — `queued | running | completed | interrupted | failed` —
and rate-limit pause is a **nullable field, not a status** (D5), so the
non-terminal predicate the unique index and `/active` both derive from is a
single definition: `status NOT IN ('completed','interrupted','failed')`.

**Other entities:** `Account`, `Course` (`state: ACTIVE|ARCHIVED`, SIS-shell
flag), `Topic`, `Attachment` (polymorphic parent via `parentType`+`parentId`,
carries **`sortOrder`** (D22), `shareMode` copied from source — never defaulted
to VIEW — `kind` (`driveFile|youTubeVideo|link|form`), and `driveState` for
pre-flight simulation), `Rubric` (`licenseBlocked` flag) with
**`RubricCriterion`** and **`RubricLevel`** child tables so criteria/levels are
copied verbatim rather than flattened (D23 — this answers the PM brief's open
question "rubric fidelity details beyond copy-or-note", which was routed to
this stage and previously went unanswered), `Session`, `CreditLedger` (stub).

**`TransferJob.resolutionsJson`** persists the teacher's Action-Sheet choices at
job creation, so a restart applies the same decisions rather than silently
transferring without them.

**What the schema enforces, and what it does not (added at engineer stage).**
The Prisma SQLite provider does not support `enum`, so the closed vocabularies
(`outcome`, `skipReason`, `status`, `workType`, `shareMode`, …) are `String`
columns whose single source of truth is the zod schema in
`shared/src/api-types.ts`. The vocabulary is closed **at the application
boundary, by code** — not by the database. The `CourseWork` /
`CourseWorkMaterial` split, which is the load-bearing per-type guarantee, IS
structural (two tables, and Prisma's generated types give a Material no
`maxPoints` property at all). The single-active-job guard is also genuinely
structural: `TransferJob.activeAccountId` holds the account id while the job is
non-terminal and `NULL` once it is terminal, and SQLite treats NULLs as distinct
in a unique index — which is a partial unique index expressed the way this
engine can enforce one. Stating the split plainly matters more than claiming
more enforcement than exists.

**Cycle-2 structural changes (P0-1 to P0-4, APPLY-C/E).** Four more guarantees
were one schema word away in cycle 1 and were not taken; each of them was the
direct cause of a defect, so each is now a column rather than a convention.

| Column | Guarantee it makes unrepresentable | Was |
|---|---|---|
| `TransferJobItem.claimedTargetPostId` (D32/D34) | "a post was created but the ledger says nothing was written", and "recovery guessed which post was ours from a title" | The item-level catch had no evidence to read, so it re-bucketed a created post as `skipped`/`provider_error` and nulled `targetPostId`. Recovery matched `sourceType:title` against the target course's whole namespace. |
| `TransferJob.executorId` (D33) | "the reconciler and a live executor both write this job" | Staleness was the reconciler's only predicate and every executor write was an unconditional `update where {id}`. The reconciler could null `activeAccountId` mid-run, releasing the single-active-job guard. |
| `TransferJob.scanId @unique` (APPLY-C) | "one scan produced two transfers" | Back-then-confirm re-POSTed a consumed scan and copied every post again; item ids are `${jobId}-i${n}`, so there was not even a collision to stop it. |
| `PreflightScanItem.maxPoints` / `.answerConfig`, mirrored onto `TransferJobItem` (APPLY-E) | "the completion log re-reads live source rows" | `/items` hydrated per-type fields from `MockCourseWork`, so a post deleted after the transfer lost its `workType` and a Question was relabelled "Assignment" in the log. |

`finish()` additionally carries an optimistic `outcome: 'pending'` predicate and
the reconciler's writes carry the same one, so **no writer can overwrite a
terminal outcome another writer recorded on evidence** — the ordering hazard
that made totality and honesty pull against each other.

**The mock's `copyAttachmentToMyDrive` is a copy, not a move (P0-3).** It
inserts a new `Attachment` row with `parentType='myDrive'` — the acting
account's Drive, not any course post — and leaves the source row byte-for-byte
as it was. It previously `update`d the source course's attachment in place,
which made the one method named "copy" the only write to the source course
anywhere in the system, healed F3's `permission_locked` finding within a
session, and let the engine depend on a mutation a faithful real adapter would
never perform. The engine now consumes the returned `newDriveFileId` and
substitutes it into the materials payload.

**Source of truth:** SQLite (single file) via Prisma is authoritative for both
the simulated Google world and application state.

## 6. Interfaces & contracts

**A. `ClassroomProvider` adapter interface** (pure types,
`server/src/adapters/classroom-provider.interface.ts`):

```
listCourses(accountId, {courseStates?, pageToken?, pageSize?}): {courses[], nextPageToken?}
listTopics(courseId, {pageToken?, pageSize?}): {topics[], nextPageToken?}
createTopic(courseId, name): {topicId}
listCourseWork(courseId, {courseWorkStates?, pageToken?, pageSize?}): {items[], nextPageToken?}
listCourseWorkMaterials(courseId, {courseWorkStates?, pageToken?, pageSize?}): {items[], nextPageToken?}
createCourseWork(courseId, payload: CourseWorkPayload): {id} | throws
createCourseWorkMaterial(courseId, payload: CourseWorkMaterialPayload): {id} | throws
getAttachmentHealth(refs: AttachmentRef[]): Map<refKey, HealthState>
copyAttachmentToMyDrive(ref, actingAccountId): {newDriveFileId}
getRubric(courseWorkId): Rubric | null
createRubric(targetCourseWorkId, rubric): {id} | throws LicenseBlockedError
updateCourseWorkDescription(courseWorkId, description): void
updateCourseWorkMaterialDescription(materialId, description): void
```

`updateCourseWork*Description` was **added during implementation** and mirrors
`courses.courseWork.patch` with `updateMask=description` — a real API method,
not a mock convenience. The engine needs it because the rubric licence denial
arrives on `createRubric`, i.e. *after* the post exists, and the brief mandates
graceful degradation to a note **in the description**. Without it the note could
only live in the summary ledger, which is a quieter place than the brief
specifies.

Throws are `RateLimitError{retryAfterMs?} | PermissionError | NotFoundError |
LicenseBlockedError` (D10) — **and every one of them has a declared terminal
outcome path** in `transfer-engine` (D12). A declared error class with no
declared outcome is how an item gets stuck in `pending`.

**Payload types are declared, not left to the mock (D18).** Everything
carrying real API fidelity used to live inside the undefined word `payload`:

```
type Material =
  | { kind: 'driveFile'; driveFileId: string; shareMode: 'VIEW'|'EDIT'|'STUDENT_COPY' }   // shareMode REQUIRED
  | { kind: 'youTubeVideo'; videoId: string }        // no shareMode field exists
  | { kind: 'link'; url: string; title?: string }    // no shareMode field exists
  | { kind: 'form'; formUrl: string }                // no shareMode field exists

type CourseWorkPayload = {
  title; description?; workType; state: 'DRAFT';     // literal — everything lands as a Draft
  topicId?; maxPoints?; answerConfig?; quizFormLink?;
  materials: Material[];                              // <= 20
  assigneeMode: 'ALL_STUDENTS';
  // dueDate and scheduledTime are structurally ABSENT — they cannot be set
}

type CourseWorkMaterialPayload = {
  title; description?; state: 'DRAFT'; topicId?; materials: Material[];
  // no maxPoints, no dueDate, no answerConfig — the fields do not exist
}
```

`shareMode` being **required and non-defaultable on `driveFile`, and
structurally absent on the other three kinds**, is what gives the brief's
binding "never default `shareMode` to VIEW" a carrier. It had a column in the
schema and nowhere to travel. Modelling `shareMode` uniformly on `Attachment`
is a small mock-shaped divergence from real Classroom (which accepts it only on
`driveFile`) and is commented as such in the schema.

**Filters are on the port, not bolted on after the fact.** `listCourseWork` /
`listCourseWorkMaterials` take `courseWorkStates` (D19) because real
`courses.courseWork.list` returns **PUBLISHED only** unless the parameter is
passed — F8 mandates Draft, Published and Scheduled source posts, so a real
adapter without this filter would silently drop two-thirds of them **while
every mock test passed**. The mock is therefore held to the same rule: an
unfiltered call returns PUBLISHED only. `listCourses` takes `courseStates`
because `courses-api` must scope source (ACTIVE+ARCHIVED) and target (ACTIVE)
differently, and post-hoc filtering against fields the port does not promise is
not a contract.

`getAttachmentHealth` is **batch-shaped from day one** (D20), for exactly the
reason the list methods are pagination-shaped: a 50-post course with several
attachments each would otherwise issue hundreds of sequential round-trips
against real Drive — and a 429 storm *during pre-flight*, on a path with no
backoff specified.

`copyRubric(source, target)` is **gone** (D23). It had no real-API counterpart:
real Classroom is `rubrics.get` then `rubrics.create` with a full criteria →
levels body, two calls with two failure surfaces, the licence denial arriving
on the *create*. A single boolean-returning method could not decompose into
that without the signature change driver 1 exists to prevent.

List methods are pagination-shaped from day one (D9); `post-enumerator` owns
the loop, and its acceptance gate pages F4 at `pageSize=7` and asserts 50 posts
from 8 calls (D27) — the one silent drop §6 says the item-level invariant
cannot detect after the fact is now the subject of a test.

**B. REST API** (frontend ↔ backend, all authenticated calls
`credentials: 'include'`):

| Method & path | Purpose |
|---|---|
| `GET /api/auth/mock-accounts` | List the seeded accounts (F10) for the picker |
| `POST /api/auth/sign-in {accountId}` | Always issues a fresh session — never short-circuited |
| `POST /api/auth/sign-out` | Revokes the session |
| `GET /api/auth/me` | Current account, or 401 |
| `GET /api/courses?role=source\|target` | Source: active+archived; target: active only + SIS badge |
| `POST /api/courses/:sourceId/preflight {targetId}` | Runs `preflight-engine`; persists the scan; returns `{scanId, totalPostsScanned, findings[]}` |
| `POST /api/transfer-jobs {scanId, resolutions[]}` | `202 {jobId}`, or `409 {jobId}` if a non-terminal job exists (D5) |
| `GET /api/transfer-jobs/active` | `200 {jobId}` or `204` — reconnect discovery (F12) |
| `GET /api/transfer-jobs/:id/status` | Compact poll payload, incl. `skippedByUser` / `skippedBySystem` |
| `GET /api/transfer-jobs/:id/items?outcome=` | Full itemized log with per-item `skipReason` |
| `GET /api/health` | Readiness ping; cold-start detection target; Render's health check |

**Every payload above is declared exactly once**, in `shared-contracts`
(`shared/src/api-types.ts`) as a zod schema exported as both a runtime
validator and an inferred TypeScript type (D17). The client imports those
types; it does not redeclare them. The previous design left four cross-tier
edges typed twice, which contradicted this document's own governing principle:
§5 insists the reconciliation line has exactly one implementation in the
system, while permitting the *type* of the payload carrying it to have two.

**C. Fixture manifest format:** each fixture is a typed `FixtureSeed` module
(`server/src/fixtures/f01-healthy.ts` … `f14-empty-course.ts`) consumed by the
idempotent seed script.

**D. Design-token contract:** `client/src/styles/tokens.css` consumes the CSS
custom properties from `03-ui-direction.md` §2 verbatim.

## 7. Key technical decisions

> Decisions and Deltas synthesized by: Opus 5 decision core (Code)

| Decision | Choice | Rationale | Alternatives considered | Consequences |
|---|---|---|---|---|
| Overall system style and "background job" execution model | Modular monolith: one Express process, hexagonal only at the Google boundary; the transfer job runs in-process as an async promise chain that checkpoints a `TransferJobItem` row after every item | Serves driver 6 (simplicity/velocity) and driver 4 (cold-start tolerance) directly: one service means one cold start, not N sequential ones on a wake. Serves driver 3 because durability of progress comes from the per-item DB checkpoint, not from the process's memory — resumability is a *read* concern (poll the rows), so it does not require a worker runtime. Real load is one teacher, one job, ≤50 items — a queue's entire value proposition (fan-out, backpressure, multi-consumer fairness) is unpurchased here. | (1) **Microservices** (api / preflight / transfer): rejected — each Render free service sleeps independently, so a wake would serialize 30-50s cold starts and driver 4 gets multiplicatively worse; also introduces cross-service auth and a distributed-transaction problem around the reconciliation invariant for zero benefit at this scale. (2) **Redis + BullMQ worker fleet**: genuinely the right answer at multi-tenant scale and rejected only on scale grounds — it adds a paid Render Redis instance (free tier has no Redis), a second always-on process, and job-state that now lives in *two* stores (Redis + SQLite) which is precisely how reconciliation counts drift. (3) **Render Cron Job / background worker polling a `pending` jobs table**: rejected because it adds ≥1 poll-interval of latency before a transfer visibly starts, which reads to the user as the app being broken, and background workers are not on Render's free tier. (4) **Serverless functions**: excluded by hard constraint — a 50-post transfer exceeds ~10s wall clock trivially. | Job execution is bound to process lifetime, which is exactly the residual risk in Delta D1 — the monolith buys simplicity by *converting* a durability problem into a boot-time-reconciliation problem, and that reconciliation is designed in (see §4/composition-root). Horizontal scaling is foreclosed without refactor: two Render instances would both run `/transfer-jobs/active` and both could execute the same job, so if scaling is ever added, the promise-chain executor must move behind a real lock or queue first. Node's single event loop means a slow-mode fixture (F12) and a real transfer share one thread — acceptable at 1 job, misleading as a load signal. |
| Persistence engine and the decision to co-locate the mock Google world with app state | SQLite (single file) via Prisma, holding both the simulated-Google tables (Account/Course/Topic/CourseWork/CourseWorkMaterial/Attachment/Rubric) and app tables (Session/TransferJob/TransferJobItem/CreditLedger) | Driver 2 requires the reconciliation sum to hold over durable rows, and driver 3 requires those rows to outlive the browser tab — both demand a real store, not memory. Driver 6 and driver 7: zero-ops, file-copyable, and a fixture manifest becomes a seed script plus a checked-in `.db` snapshot, which makes F1-F13 reproducible byte-for-byte and makes a failing E2E run debuggable by opening the file. Writes to the *target* course persisting like a real backend's writes is what makes the mock a faithful stand-in (driver 1) rather than a stub. | (1) **Postgres on Render**: the more operationally correct choice and rejected on cost/ops for v1 — Render's free Postgres expires after 30 days (then requires a paid plan or re-provisioning), which for a single-teacher demo trades a real ops chore for durability the product does not yet need. Notably this is the *upgrade path* if Δ1 resolves badly. (2) **In-memory store with JSON fixture files**: rejected — a process restart evaporates in-flight `TransferJob` rows, which breaks F12's reconnect assertion the moment Render's free tier sleeps or restarts the dyno. (3) **Two stores** (in-memory mock world + SQLite app state): superficially cleaner separation, rejected because the mock's created posts and the job items that reference them would then live in different stores with no referential integrity, and integration tests could no longer assert "the draft the item claims it created actually exists." (4) **Raw `better-sqlite3` without an ORM**: rejected because Prisma's migration history plus generated types is what makes the CourseWork/CourseWorkMaterial split a *compile-time* guarantee rather than a convention. | Concurrency ceiling: SQLite is single-writer; fine at one job, but the per-item checkpoint plus a 1.5s poll means the write lock is contended lightly and constantly — WAL mode is enabled explicitly, and Prisma's `SQLITE_BUSY` behavior under WAL should be pinned by a test rather than assumed. Durability is coupled to Render's local disk semantics (Δ1). Because the mock world is in the same schema as app state, the Google-world tables are kept in a clearly namespaced block (a `Mock*` prefix) so the "swappable" claim in driver 1 doesn't quietly acquire a dead-table liability once a real provider ships. |
| Job-progress transport | HTTP polling: `POST /api/transfer-jobs` → 202 `{jobId}`; `GET /:id/status` (compact) polled ~1.5s; `GET /transfer-jobs/active` for tab rediscovery; `GET /:id/items` fetched once at completion | Driver 4 is the decisive argument and it is counter-intuitive: the poll traffic itself is the keep-alive that stops Render's 15-min idle timer from firing mid-transfer, and a poll transparently survives a wake (it just takes 30-50s to answer) whereas a dropped socket needs reconnect/backoff logic the client would have to own. Driver 3: `/active` makes rediscovery a *server* fact, so recovery does not depend on `localStorage` surviving a hard refresh or a different tab. Driver 8: splitting the compact status payload from the itemized log solves aria-live flooding at the protocol layer — the client physically cannot receive 50 per-item events to announce, so accessibility does not rest on client debounce discipline. | (1) **SSE**: the natural fit for one-way progress and rejected reluctantly — Render's proxy and the sleep/wake cycle make long-lived connections a fragility source, and an SSE stream that drops mid-transfer needs `Last-Event-ID` replay to avoid gaps, which is more state than the poll design has anywhere. (2) **WebSockets**: rejected as strictly more machinery (upgrade handling, heartbeats, reconnect/backoff) for a strictly one-way, 1.5s-granularity, ≤50-event stream. (3) **Long-polling / `?wait=30`**: rejected because it re-inherits the connection-hold fragility while keeping polling's overhead. (4) **Doing the work inline in the POST and streaming a chunked response**: rejected outright — it makes browser-refresh-mid-transfer unrecoverable, killing driver 3. | ~40 requests per minute per active transfer, each waking a Prisma `GROUP BY` — negligible, but the status endpoint must stay outside the monetization middleware's credit-check path. Progress granularity is capped at the poll interval: a fast item can be born and completed between polls and never appear as "current item," so the UI treats `currentItem` as advisory and the final `/items` fetch as authoritative. The 202 pattern means a client that fires `POST` and never polls leaves a job running with nobody watching — harmless, but it is also the exact shape of accidental double-submit, guarded by the D5 unique-index + 409 pattern. `/items` at completion only is a real limitation: a user who wants detail mid-transfer cannot have it; if that requirement appears later, it becomes a paginated `/items?since=` rather than a change of transport. |
| Making the reconciliation invariant structural | `TransferJobItem.outcome` is a single-value enum `'pending' \| 'transferred' \| 'fallback_shell' \| 'skipped'`; rows are inserted `pending` before any provider call (D2); `rubricDegraded` is a separate boolean; all client-facing counts are `GROUP BY outcome` aggregates over the item rows, never independently-maintained counters | This is driver 2 expressed as a schema rather than a promise. A single-valued NOT NULL column makes the sum `(transferred)+(fallback)+(skips) = (rows)` a property of the type system: there is no representable state in which an item lands in two buckets, so "zero silent drops" cannot be violated by a multi-bucket coding mistake. Inserting rows `pending` before any attempt closes the complementary failure mode (under-counting from a crash between "scan" and "attempt") — the invariant is only as strong as row creation, and this ordering is what makes `total posts scanned = count(items)` true by definition rather than by hoping every code path remembers to write a row. Deriving counts by aggregation eliminates the classic drift bug where a counter is incremented on a path that later throws. `rubricDegraded` as an orthogonal boolean makes "non-additive subset tag" mechanically true, and makes "fallback shell + rubric-degraded counts once, under fallback shells" fall out for free rather than needing a precedence rule. | (1) **A `tags` string array / set-valued outcome**: the design that *causes* this defect class — rejected because any set-valued outcome makes the reconciliation sum a runtime property requiring a precedence rule, and precedence rules are where a "4th bucket" bug is born. (2) **Denormalized counters on `TransferJob`**: genuinely faster to read and rejected because it creates two sources of truth for the same number — the exact drift the driver forbids; if poll cost ever demands it, the correct form is a cached column plus a test-asserted equality against the aggregate, not a replacement for it. (3) **Nullable `outcome` meaning "in progress," with items inserted only on resolution**: rejected — this is precisely the under-counting hole D2 closes; a `pending` value inserted up front is preferred over a null inserted late. | Adding a genuinely new outcome later is a migration plus an audit of every aggregate — correctly expensive, since a 4th bucket is a product decision. The invariant needs one enforcing test that is the load-bearing artifact of driver 2: for each fixture, `count(items) == posts scanned` AND the three grouped counts sum to it AND `topicsCreated` is asserted *not* to appear in that sum (module `transfer-engine`'s acceptance gate, above). |
| Per-type data modeling for classwork | Two structurally separate tables: `CourseWork` (with `workType` enum, `dueDate`, `maxPoints`, answer-config) and `CourseWorkMaterial` (title/description/topic/attachments only — the `dueDate` and `maxPoints` columns do not exist) | Driver 5, and specifically the fact that this exact defect has been introduced and corrected three times upstream. A shared table with nullable columns makes "Materials have no due date" a runtime convention that any future contributor can violate silently; two tables make it a compile error and a schema error simultaneously. It also mirrors the real API's two distinct surfaces (`courseWork` vs `courseWorkMaterials`), which serves driver 1: the `ClassroomProvider` interface already has separate `createCourseWork`/`createCourseWorkMaterial` methods, and matching that split in the data model means the future `RealClassroomProvider` maps 1:1 with no shape-reconciliation layer. | (1) **Single `Post` table with nullable `dueDate`/`maxPoints` and a `type` discriminator**: the conventional ORM answer, rejected precisely because nullability is not a constraint — nothing stops a Material row from carrying `maxPoints: 100`, and nothing in the type system tells a developer which fields are legal for which type. (2) **Single table + a DB `CHECK` constraint** enforcing null-ness by type: better, still rejected — the constraint fires at write time, not compile time, so the failure surfaces as a runtime 500 in a transfer rather than as a red squiggle, and TypeScript still hands developers a `maxPoints` property on a Material. (3) **Prisma's polymorphic/inheritance patterns**: rejected as needless indirection for two concrete types that differ in more than a couple of fields. | Deliberate duplication: shared concerns (title, description, topic FK, attachment relation, state) exist twice, and shared logic is written against a narrow TS union or shared helper rather than one ORM model. Any code that must handle "all posts" — the preflight scanner, the itemized log, the sort order of the transfer queue — needs an explicit merge step with an explicit ordering key; `TransferJobItem` references a source post polymorphically (`sourceType` + `sourceId`, no FK), named as a single reviewed module rather than open-coded per call site. **That module now exists and is named: `post-enumerator` (D16).** It was promised in this column and absent from the module list, which is how `preflight-engine` and `transfer-engine` came to be two independent merge implementations that had to agree — and therefore how the two post counts could diverge. |
| Google-integration boundary | Ports-and-adapters: a type-only `ClassroomProvider` interface module (no runtime code), `MockClassroomProvider` today, `RealClassroomProvider` later, concrete wiring confined to one composition-root module | Driver 1 is the highest-ranked constraint, and a type-only port is what makes it enforceable: because the interface module emits no JavaScript, no downstream module can accidentally import a concrete provider through it, and the dependency graph makes "who talks to Google" answerable by inspection. Driver 7 follows: the same Vitest suite becomes a *contract test* runnable against either implementation, the only mechanism that will actually catch drift when the real adapter arrives. The interface's method set is deliberately shaped to Classroom's real surface (separate courseWork/courseWorkMaterials calls, a discrete `copyAttachmentToMyDrive` for the `drive.file` scope, `getAttachmentHealth` for trashed/permission-locked pre-flight, and pagination shape per D9) rather than to the mock's convenience. | (1) **Direct googleapis calls behind a thin `if (mock)` branch**: rejected — conditionals scatter, and the branch inevitably grows mock-only behavior that has no real counterpart. (2) **Full anti-corruption layer with its own domain model distinct from Classroom's**: rejected as over-abstraction for a tool whose domain *is* Classroom's model; a translation layer would add a mapping to maintain and would blur driver 5's per-type fidelity. (3) **Runtime DI container**: rejected — one composition root and constructor injection achieves the same swap with zero framework. (4) **`nock`/MSW-style HTTP-level interception of Google endpoints**: genuinely the highest-fidelity mock and rejected for v1 because it demands modeling Google's wire format, pagination, and error envelopes before any product value exists; it is the right *complement* later, because the interface-level mock cannot catch wire-level surprises. | The interface's fidelity is unverified until the real adapter is written — this is the honest limit of driver 1, and it is why the contract-test seam matters more than the interface itself. Real 429s arrive with `Retry-After` and structured `reason` fields the mock's boolean-ish simulation won't produce, so the backoff policy consumes an optional `retryAfterMs` from the port rather than computing purely from attempt count (built into `RateLimitError`, above); Classroom write endpoints are asynchronously consistent, so a created draft may not appear in an immediate list — the mock's synchronous writes will hide that, flagged in Open Questions. |
| Mock authentication | Signed JWT in an httpOnly, `SameSite=None; Secure` cookie scoped to a mock account id, plus a minimal `Session` table for revocation; the account picker renders on every sign-in and is never short-circuited by an existing valid session | The `Session` table is not ceremony: pure stateless JWT has no revocation, so "switch account" and "sign out" would leave a still-valid token that a copied cookie could replay — with F10's two accounts, mis-scoped writes would land classwork in the wrong teacher's course, a data-integrity bug, not merely a security abstraction. httpOnly denies JS access to the token. Always-render-the-picker is a UX requirement, implemented as "sign-in always mints a fresh session" (a route property) rather than "hide the picker if a session exists" (a conditional someone could later optimize away). | (1) **Pure stateless JWT, no table**: rejected for the revocation gap above. (2) **Opaque session id + server-side lookup only (no JWT)**: arguably simpler and marginally more correct, rejected only because the signed-JWT shape is the closer analogue to the real OAuth flow that replaces it, so driver 1's swap discipline extends to auth rather than being re-litigated. (3) **`localStorage` token**: rejected — XSS-readable, and would make `/transfer-jobs/active` rediscovery depend on client storage surviving the refresh, undercutting driver 3. (4) **No auth at all in v1** (mock account via query param): rejected because F10's forced-picker and per-account scoping are fixture requirements, and retrofitting auth after the transfer engine assumes an ambient account is a wide refactor. | Every authenticated request costs a `Session` lookup — the JWT is a signature check plus a DB hit, so the "stateless" benefit is mostly forfeited; that is the deliberate price of revocation. Session expiry is a fixed TTL with lazy delete. Because the picker always renders, the real OAuth swap preserves that behavior via `prompt=select_account`. `SameSite=None; Secure` is required specifically because frontend and backend are split-origin Render services (see §9) — this is resolved here, not left as an open CORS question. |
| Frontend stack | React + Vite + TypeScript, feature-folder-per-wizard-step, Tailwind implementing the UI direction's CSS custom properties verbatim | Vite's static output deploys as a Render static site with no server, so the frontend does not sleep — only the API does, which sharpens driver 4: the "Waking up server…" overlay is always able to render because the shell is already loaded and cached. Feature-folder-per-screen maps 1:1 onto UX's 5-step linear wizard, so the file tree is the flow. Tailwind consuming the design tokens as CSS custom properties (rather than hard-coded palette values in the config) keeps a single source of truth with the UI doc and keeps the token layer available to the aria-live and focus-state styling driver 8 needs. | (1) **Next.js**: rejected — SSR/RSC buys nothing for a single-user authenticated wizard with no SEO surface, and it would add a *second* sleeping Node service on Render, making driver 4 worse. (2) **CRA**: effectively deprecated. (3) **Plain CSS Modules or vanilla-extract**: defensible and rejected because Tailwind is a PRD constraint; the token-via-custom-property approach recovers most of the theming discipline CSS Modules would have given. (4) **A component library (MUI/Chakra)**: rejected because the UI direction specifies bespoke tokens and a bespoke stat-tile/log-table layout — a library would be fought more than used, and its accessibility defaults do not cover the custom aria-live progress region anyway. | Split-origin (frontend and API on separate Render services) means CORS and cross-origin cookie handling must be configured deliberately — resolved above (`SameSite=None; Secure` cookies plus a pinned CORS origin allowlist, never `*` with credentials); this is the single most common day-one breakage in this deployment shape and is settled here rather than discovered later. No SSR means a fully client-side loading path, so the wake overlay and `/transfer-jobs/active` rediscovery both run after hydration. Tailwind's utility strings make the narrow-viewport question (Delta D7) a real decision, not something responsive-by-default. |
| Testing stack | Vitest for unit + integration on the backend, written against the `ClassroomProvider` interface so the suite doubles as a contract test; Playwright for E2E against the seeded fixtures, including `@axe-core/playwright` per step | Driver 7 makes the mock a deliverable, which means the mock needs tests of its own, and the fixtures need to be exercised end-to-end or F1-F13 degrade into seed data nobody asserts against. Vitest shares Vite's transform pipeline and TS config, so there is one toolchain. Playwright is the right layer for assertions that only exist in the browser: F12's interrupt-and-reconnect genuinely requires killing and re-establishing a real polling client, and driver 8's aria-live/focus behavior is only observable through an accessibility tree. | (1) **Jest**: rejected — separate transform config against a Vite project, slower, no upside here. (2) **Cypress**: rejected — weaker multi-tab/multi-context control, exactly what F12's disconnect-reconnect and F10's account-switching need. (3) **Unit tests only, no E2E**: rejected because the reconciliation invariant and the resumability guarantee are *system* properties spanning HTTP, the poll loop, and the DB — a unit test of the transfer engine cannot fail when `/active` returns the wrong job. (4) **Per-test hand-rolled fakes instead of the shared mock**: rejected because per-test fakes drift from the fixture manifest and would let the suite pass while F1-F13 rot. | Two runners, two mental models, and a real risk that Playwright tests become the slow suite everyone skips — F1-F13 coverage is pinned to specific named E2E spec files so a missing fixture is a missing file, not an oversight. Test isolation needs an explicit per-test-file database copy (or a transactional rollback wrapper), because a shared SQLite file plus parallel Vitest workers plus SQLite's single writer produces flaky `SQLITE_BUSY` failures that look like product bugs otherwise. F12's slow-mode delay flag and the cold-start simulated-delay flag are both env-gated test affordances shipping in production code — inert by default, covered by the `cold-start-health` module's acceptance test asserting they're off without the env var. |

## 8. Cross-cutting concerns

**Auth/security:** mock sign-in issues a signed JWT (httpOnly,
`SameSite=None; Secure` cookie, required because frontend/backend are
split-origin Render services) scoped to the mock account id; no real
credentials are ever handled. The forced picker is a property of the
sign-in route itself (always mints a fresh session) rather than a
conditional on an existing one, per UX's "never skipped, never remembered"
requirement. "Switch account" revokes the current `Session` row and
re-triggers the picker. **CORS:** a pinned origin allowlist (the deployed
frontend origin(s) only — never `*` with credentials) plus
`Access-Control-Allow-Credentials: true`; every frontend fetch sets
`credentials: 'include'`. The real-API follow-on swaps this module for
actual Google OAuth (authorization code flow, `prompt=select_account`)
behind the same `Session` concept — the session shape doesn't change, only
how it's populated.

**Error handling:** a single Express error-handling middleware normalizes
provider errors (`RateLimitError`, `PermissionError`, `NotFoundError`,
`LicenseBlockedError`) into consistent HTTP responses; the frontend's
generic catch-all error state (UX P1 Delta, not fixture-covered) subscribes
to any non-2xx or network failure from `frontend-api-client`.

**Configuration (env vars):** `DATABASE_URL`, `SESSION_SECRET`,
`FEATURE_MONETIZATION_ENABLED` (default `false`), `GOOGLE_PROVIDER_MODE`
(`mock` — only mode implemented in v1), `COLD_START_SIMULATE_DELAY_MS`
(test/dev only, unset in production, guarded by its own acceptance test).

**Observability:** structured JSON logging (request id, `jobId` where
applicable) to stdout — Render captures logs natively; no external log
vendor in v1 (matches the "no analytics vendor" non-goal). Each
`TransferJob` lifecycle event (created / rate-limited-pause /
resumed / completed / interrupted) is logged, satisfying the brief's
"metric events instrumented (logged/counted) even though no analytics
vendor is wired."

**Performance:** the 50-post course (F4) must complete engine-side work in
under ~2 minutes; enforced via the §8.1 quality budget below.

**Testability:** the `ClassroomProvider` interface is the seam for contract
tests (the same suite runs against `MockClassroomProvider` now, and later
`RealClassroomProvider`, asserting behavioral parity); `preflight-engine`
and `transfer-engine` take a provider + fixture data as pure-ish services,
testable without an HTTP server; fixture-driven integration tests cover
each F1–F13 scenario end to end against the mock.

**Accessibility testing — as built, not as designed (QA-3).** The design above
called for `@axe-core/playwright` on every wizard step in a real-browser E2E
suite. That is **not what shipped**, and this paragraph used to say otherwise
while the "Implementation reconciliation" section below said the truth — two
sections of one document disagreeing, with the optimistic one first. What ships
is `axe-core` under **Vitest + jsdom** on the wizard surfaces
(`client/src/**/*.a11y.test.tsx`), plus a deterministic arithmetic WCAG
contrast audit over every token pairing
(`client/src/styles/contrast.a11y.test.ts`) — because jsdom has no layout, so
axe's own `color-contrast` rule reports *incomplete* rather than *pass*. The
substitution and its cost are recorded in the reconciliation table below and on
the backlog; nothing in this repository performs a real-browser accessibility
pass, and no reader of this section should conclude otherwise.

## 8.1 Quality budgets

Every row names an **owning module** (D21). Previously the seven rows had
falsifiable targets and commands but no owner, and nothing owned
`test/quality/*` or `npm run test:perf` — a budget with no owner is measured by
nobody. `quality-budgets` owns landing these rows into
`docs/project-profile.md` and creating the commands they name.

| Dimension | Key | Metric | Target | Tier | Owner | Check |
|---|---|---|---|---|---|---|
| performance | `engine_throughput_f4_50posts` | Server-side engine time to complete F4's 50-post transfer, excluding client poll overhead and with the F12 slow-mode option OFF | `< 120s` | advisory | `quality-budgets` | `npm run test:perf` |
| correctness | `reconciliation_invariant_all_fixtures` | `transferred + fallback_shell + skipped == count(items) == scan.totalPostsScanned` read from the persisted scan row, `topicsCreatedOrMapped` absent from the sum, for every fixture | `100% pass, 0 failures` | advisory | `transfer-engine` | `npm run test:budget:reconciliation` |
| correctness | `no_pending_after_completion` | No job reaches `completed` with any item still `pending`, across injected `PermissionError` / `NotFoundError` / arbitrary-`Error` fixtures (D12) | `0 pending items, 0 stuck jobs` | advisory | `transfer-engine` | `npm run test:budget:totality` |
| fidelity | `fixture_f1_zero_fallback` | Fallback-shell rate on the healthy F1 course | `0 fallback shells (>=95% product bar over any healthy source)` | advisory | `transfer-engine` | `npm run test:budget:f1` |
| resilience | `fixture_f13_exhaustion_terminal` | F13's persistently-429'd item resolves to `fallback_shell` **with a real target post created by the bare-shell fallback call** and the rate-limit-exhaustion note, after exactly 5 attempts (D13) | `attemptCount == 5, outcome == fallback_shell, targetPostId != null` | advisory | `transfer-engine` | `npm run test:budget:f13` |
| integrity | `interrupted_items_verified_not_assumed` | Boot/interval reconciliation of a mixed set (attempted+present / attempted+absent / never-attempted) resolves each on evidence; `skippedByUser` stays 0 (D14) | `all three classes correct, skippedByUser == 0` | advisory | `composition-root` | `npm run test:budget:reconcile` |
| resumability | `fixture_f12_reconnect_fidelity` | Disconnect/reconnect polling mid-batch on F12's slow-mode run; final item count matches a never-disconnected run | `0 duplicated or missing items` | advisory | `transfer-job-api` | `npm run test:budget:f12` |
| accessibility | `wcag_aa_automated_per_step` | axe violations across all wizard screens | `0 critical/serious violations` | advisory | `ui-shared-components` | `npm run test:budget:a11y` |
| cold start | `coldstart_overlay_timing` | Overlay appears within [1.8s, 2.2s] of an unresolved call; error state at the 60s ceiling | `both bounds hold` | advisory | `frontend-api-client` | `npm run test:budget:coldstart` |

Every row enters as `advisory`. Promotion to `blocking` is QA's proposal and
the human's call at the gate, after the row has held at least once.

### Not declared, and why

- **"Median sign-in-to-done < 5 minutes"** (brief §5 leading indicator) is
  not given a row here — it's a human-timed, full-session UX metric rather
  than an engine-time budget a script cleanly isolates; QA is the right stage
  to instrument it.
- **Term-boundary retention** (brief §5 lagging indicator) is a post-launch
  usage metric with no pre-launch check possible.

## 9. Deployment, distribution & operations

Diagram: `docs/product/diagrams/09-deployment.md`.

**Two Render services**, per the source PRD's deployment guide (carried
forward as architect-stage input, not re-litigated — confirmed by UI's
frontend-stack ADR above, which explicitly weighs and keeps this split
despite the CORS cost):

- `classroom-copier-api` — persistent Node/Express web service (free tier).
  `prisma migrate deploy` plus the idempotent fixture-reseed script run as
  part of the boot sequence, so a wiped or fresh disk on redeploy self-heals
  to a known-good fixture state (D3; see Δ1 for what this does NOT restore — job state). `GET /api/health` also
  serves as Render's configured health-check path.
- `classroom-copier-web` — React/Vite static site (`npm run build`, publish
  `dist/`). No server process; does not sleep.

**Environments:** local dev (`.env`, SQLite file in a repo-ignored
`server/data/` directory) and Render (env vars set in the dashboard, per
the PRD's deployment guide).

**Cold start reality:** only `classroom-copier-api` sleeps (15 min with no
inbound traffic); `classroom-copier-web` has no server to sleep. During an
active transfer, the client's ~1.5s status-poll cadence is itself
continuous inbound traffic, so the dyno cannot sleep mid-job — cold start
realistically occurs only at a session's first action, or after a user
leaves an idle screen (e.g., Ready-to-Transfer, unattended) for >15 minutes
before the next call.

**Real-API follow-on operational note:** flipping `GOOGLE_PROVIDER_MODE` to
`real` additionally requires OAuth consent-screen setup, Google app
verification, and secrets (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) — out
of v1 scope, already tracked on the backlog per the PM brief.

## Implementation reconciliation (engineer stage)

This document was corrected before the code was written, so the design below is
what was built. Six places where the *implementation* still moved the design
are recorded here rather than left to be discovered by reading the diff — a
silent divergence is a bug in the artifact chain.

| What changed | Why | Where it lives now |
|---|---|---|
| **The testing stack is Vitest + jsdom + `axe-core`, not Playwright + `@axe-core/playwright`.** | Real-browser E2E needs a browser download this run could not take on. Everything Playwright was chosen *for* is still covered, but at a different layer: F12's disconnect/reconnect is an HTTP-level integration test that abandons one client context and reconnects with a fresh one (`test/quality/f12-reconnect.budget.test.ts`), and the wizard walk-through is a jsdom integration test. **The honest cost:** jsdom has no layout, so axe's own `color-contrast` rule cannot evaluate and reports as *incomplete*, not *pass*. That half of `wcag_aa_automated_per_step` is covered instead by a deterministic arithmetic WCAG contrast audit over every token pairing (`client/src/styles/contrast.a11y.test.ts`), which is a stronger check than a jsdom axe run that silently skips contrast — but it is not a real-browser pass, and QC must not read it as one. Backlogged. | `server/test/`, `client/src/**/*.a11y.test.tsx`, `client/src/styles/contrast.a11y.test.ts` |
| **The canonical note strings live in `shared/src/notes.ts`; `server/src/services/notes.ts` re-exports them.** | The client must be able to assert that the fallback note renders *in full, untruncated* against the same constant the server injects — one string, two readers. `notes.ts` remains the engine's named home for it (D6) and a content change is still a one-line edit. | `shared/src/notes.ts`, re-exported by `server/src/services/notes.ts` |
| **`createTransferJob()` lives in `transfer-engine.ts`, not in the route.** | §4 had the API layer inserting the rows, which would have put the from-the-stored-scan-rows rule (D11) in a route handler where a second caller could bypass it. It is one exported function the route calls, so there is exactly one implementation of "how a job's items come into existence". `transfer-job-api` still declares its `data-model` edge (D31). | `server/src/services/transfer-engine.ts` |
| **Local development is same-origin.** | The production cookie is `SameSite=None; Secure`, which a browser will not send over plain `http`. Shipping that in dev means no cookie is ever sent and every local run looks like a broken-auth bug. Dev and test use `SameSite=Lax` without `Secure`, and the Vite dev server proxies `/api` to the backend. Production behaviour is unchanged and is what §8 describes. | `server/src/services/session.ts`, `client/vite.config.ts` |
| **`ClassroomProvider` gained `getCourse` and `countPosts`; the two coursework surfaces take differently-named state parameters (APPLY-B, APPLY-D, APPLY-K).** | Three application modules were reading `prisma.mock*` directly, around the type-only port. The worst was `refreshAttachments` in `transfer-engine`, which is how every attachment reached `materials[]` — under a real adapter that query hits a table that no longer exists and **every post is created with zero attachments**. `getCourse` replaces `preflight-engine`'s direct course lookup; `countPosts` replaces the full two-surface enumeration `GET /courses` was running **per course** on the first authenticated call; `refreshAttachments` is deleted outright, because once the mock stopped mutating the source there is nothing to re-read. `listCourseWorkMaterials` now takes `courseWorkMaterialStates`, because it is a different real endpoint and one shared request type was asserting one vocabulary for two of them. A test asserts no `prisma.mock*` reference survives outside `adapters/mock/` and `fixtures/`. | `server/src/adapters/`, `server/test/apply-findings.test.ts` |
| **F14 (empty course) was added to the fixture manifest.** | D26 — UX §5 requires the flow to reach Ready-to-Transfer stating "0 posts to copy". The manifest is now F1–F14; F10 remains the two seeded accounts rather than a course, and F8/F9/F11 remain properties of F1 (the distribution the PM brief explicitly sanctions). | `server/src/fixtures/index.ts` |

**Cycle-2 review corrections (five P0s, sixteen APPLY findings).** The full list
and its evidence live in `05-implementation.md` §"Cycle 2"; the four that changed
this document's own design are D32–D34 in the register above and the Cycle-2
data-model section in §5. Two of the corrections are worth naming here because
they are lessons about the *method*, not the code: **a total function is not the
same as an honest one** (the catch-all that closed the arithmetic overwrote
correct terminal outcomes on its way past), and **recovery-by-inference needs
evidence the job owns, not evidence the world happens to contain** (the
interruption check matched titles in a namespace shared with pre-existing posts,
prior runs, and duplicates — and its gate constructed the happy case, proving
the mechanism rather than the key).

**One defect the build found in this design and fixed:** `createTopic` derived a
topic's id from a truncated hex encoding of its name. "Semester 1" and
"Semester 2" share their first 16 hex characters, so the second `createTopic`
threw a unique-constraint error that failed the whole job — caught by the F12
reconnect test, fixed by hashing the name. Worth recording because it is the
same class of defect as the ordering-key tiebreak (D16): an identifier derived
from a prefix is not an identifier.

## Risks, NFR gaps & open technical questions

**Mock-to-real gap (standing, brief-level risk, carried forward):** every
behavior validated in v1 is validated against the mock, not live Google
semantics. Mitigation baked into this architecture: the
`ClassroomProvider` interface's method shapes mirror the real API's actual
surface (separate courseWork/courseWorkMaterials calls, pagination fields,
a `retryAfterMs`-capable rate-limit error, a discrete "copy to My Drive"
method) specifically so the real adapter is a implementation swap against
an already-realistic contract, not a redesign. Residual gaps the mock
cannot itself catch are named explicitly in the ADR consequences above
(Google's asynchronous write consistency; real 429 error envelope
richness) and are Open Questions for the real-API follow-on, not silently
assumed away.

**F12 / F13 / F14 — how the mandated fixtures are modeled (stated plainly):**
- **F12 (interrupt-and-reconnect)** reuses the F4 50-post course. Its
  "slow-mode" delay is a **run-scoped provider option**
  (`MockProviderOptions { perItemDelayMs }`) supplied when the F12 spec
  constructs the provider — **not fixture data on the course** (D25). Seeding
  it as course data would mean `engine_throughput_f4_50posts` runs against a
  deliberately-slowed course and the perf budget would be measuring its own
  harness.
- **F13 (persistent/exhausting 429)** is a distinct course from F6. Its 429 is
  **scoped to creates carrying `materials[]`**; a bare-shell create (no
  attachments) succeeds (D13). This is what makes the "guaranteed draft shell"
  reachable at all — the previous definition ("always returns 429 regardless of
  attempt count") made the fallback execute through the very call that was
  refusing, so the sixth attempt 429'd exactly like the first five, the item
  could never reach `fallback_shell`, and
  `fixture_f13_exhaustion_terminal` was unsatisfiable as written. Scoping the
  refusal to attachment-bearing creates is also the more faithful simulation: a
  real Classroom 429 is a quota condition, not a permanent per-item refusal, so
  a lighter retry succeeding is what really happens.

  The doc previously used one term, "draft-shell fallback", for two different
  things: **attachment-level** fallback (the post succeeds, the attachment is
  dropped and a note added) and **API-level** fallback (post creation itself is
  failing). They are now distinct calls with distinct payloads. If the
  bare-shell create *also* fails, the item resolves `skipped` /
  `rate_limit_exhausted` — an honest terminal outcome, not a hang.
- **F14 (empty course, 0 posts)** — added at engineer stage (D26). UX §5
  requires the flow to reach Ready-to-Transfer stating "0 posts to copy"; a
  zero-item job completes immediately and still satisfies the invariant
  (`0 + 0 + 0 == 0`).

**Rate-limit-exhaustion note text** is architect-proposed (no exact string
existed upstream) and centralized in `notes.ts` specifically so a later
content-pass correction is a one-line change; F13's own test asserts
*distinctness* from the attachment-failure note rather than a hard-coded
literal, decoupling the build from the pending copy decision (D6, Δ2).

**QUIZ_ASSIGNMENT modeling divergence from the real API** (§5) is an open
question for the engineer and the real-API follow-on: the real Classroom
API has no distinct `workType` for quizzes; this mock introduces one
because the brief/UX/UI treat "Quiz assignment" as a fourth first-class
type throughout. Reconciling this (likely: detect a Form attachment on a
real `ASSIGNMENT`) is real-API follow-on work, not a v1 blocker.

## Diagrams

- `docs/product/diagrams/03-components.md` — component/container diagram (theme 3)
- `docs/product/diagrams/04-transfer-sequence.md` — batch-transfer, rate-limit, and interrupt/reconnect sequence (theme 4)
- `docs/product/diagrams/05-data-model.md` — entity-relationship diagram (theme 5)
- `docs/product/diagrams/09-deployment.md` — deployment diagram (theme 9)

## Design Decision Register (D1–D34)

Every `D<n>` cited anywhere in this document — including the citations inside
the machine-parsed `agent-c:modules` block, which are dispatched verbatim to
sub-agents — resolves to a row here. Before this register existed the labels
were cited 26 times and defined nowhere; a worker building `data-model` was
told "inserted at pending before any provider call is attempted (D2)" with no
resolvable referent for the label standing in for the specifics.

Architecture deltas use a **separate** `Δ` prefix (below) and deltas inherited
from `03-ui-direction.md` use `UI-Δ`, so the namespaces cannot collide.

| ID | Decision | Governing § |
|---|---|---|
| **D1** | Interrupted-job vocabulary: `TransferJob.status` includes `interrupted` and `failed`; `TransferJobItem.skipReason` includes `server_interrupted`. | §4.6–4.7, §5 |
| **D2** | `TransferJobItem` rows are inserted `pending` **before** any provider call is attempted, in one transaction. Makes the count crash-stable. | §4.1, §5 |
| **D3** | Fixture seeding is idempotent and re-runs on every boot, so a wiped disk self-heals to a known-good state. | §9, Δ1 |
| **D4** | Cold start: overlay at 2s unresolved, held to a 60s ceiling, then a **distinct** error state — never an indefinite overlay. | §4 (Cold start), §8 |
| **D5** | One active `TransferJob` per account. Terminal set is exactly `{completed, interrupted, failed}`; a partial unique index and `/active` both derive from that one definition; rate-limit pause is a **field, not a status**. Double-submit returns `409` with the existing `jobId`. | §4.1, §5 |
| **D6** | All note strings live in `notes.ts`; the rate-limit-exhaustion note is a distinct string from the canonical attachment-failure note, and F13's test asserts distinctness rather than a literal. | §7, Risks, Δ2 |
| **D7** | *(retired — was a mis-citation of a `03-ui-direction.md` row; see **UI-Δ1**)* | — |
| **D8** | *(retired — was a mis-citation of a `03-ui-direction.md` row; see **UI-Δ2**)* | — |
| **D9** | All list methods are pagination-shaped from day one (`pageToken`/`pageSize` in, `nextPageToken` out), even where the mock serves one page. | §6-A |
| **D10** | Provider error taxonomy: `RateLimitError{retryAfterMs?}`, `PermissionError`, `NotFoundError`, `LicenseBlockedError` — **each with a declared terminal outcome path**. | §6-A, §4.2 |
| **D11** | The pre-flight scan is **persisted** (`PreflightScan` + `PreflightScanItem`); `POST /transfer-jobs` takes `{scanId}` and inserts items from the stored rows. One measurement, two readers. | §4.0–4.1, §5 |
| **D12** | The outcome function is **total**: per-item `try/catch` resolving to a terminal outcome; a pending-sweep before `completed`; an executor top-level `.catch()` assigning `failed`; stale-heartbeat reconciliation on an **interval**, not only at boot. | §4.2–4.3, §4.6 |
| **D13** | F13's 429 is scoped to attachment-bearing creates; the exhaustion fallback is a **different call with a different payload** (bare shell, no `materials[]`), so the guaranteed shell is reachable. Attachment-level and API-level fallback are distinct concepts. | Risks, §4.2 |
| **D14** | `TransferJobItem` carries `attemptedAt` and `targetPostId`; reconciliation branches on evidence and verifies unknowns against the target; `skippedByUser` / `skippedBySystem` split through the API and the UI. | §4.7, §5 |
| **D15** | Explicit resolution→outcome mapping for all five Action-Sheet options; "Skip Attachment and Note Draft" → `fallback_shell`. | §4 (mapping table) |
| **D16** | `post-enumerator` is the single owner of the "all posts" merge, the pagination loop, and the total ordering key `(creationTime, sourceType, sourceId)`. | §3, MDB |
| **D17** | `shared-contracts`: every cross-tier DTO declared once as a zod schema, exported as validator + type; the client never redeclares a payload shape. | §6-B, MDB |
| **D18** | Provider payload types are declared: `CourseWorkPayload`, `CourseWorkMaterialPayload`, and the four-way `Material` union with `shareMode` **required** on `driveFile` and structurally absent elsewhere. | §6-A |
| **D19** | `listCourseWork`/`listCourseWorkMaterials` take `courseWorkStates`; `listCourses` takes `courseStates`. The mock is held to the real API's default (PUBLISHED only) so the contract test certifies something. | §6-A |
| **D20** | `getAttachmentHealth` is batch-shaped (`refs[] → Map`) from day one, for the same reason the list methods are pagination-shaped. | §6-A |
| **D21** | Every quality-budget row names an owning module; `quality-budgets` owns `test/quality/*`, `npm run test:perf`, and landing the rows into `docs/project-profile.md`. | §8.1, MDB |
| **D22** | `Attachment.sortOrder` makes "attachments 1–20" a total order; F5 seeds it deterministically and `transfer-engine` orders by it explicitly. | §5, §4.2 |
| **D23** | `copyRubric` is replaced by `getRubric` + `createRubric` (the real API's get-then-create shape); `RubricCriterion` / `RubricLevel` are modelled so criteria and levels copy verbatim. **This answers the PM brief's open question on rubric fidelity**, which was routed to this stage. | §5, §6-A |
| **D24** | F1 seeds ≥1 rubric-bearing assignment on a licence-permitted course, so `createRubric`'s success path is fixtured and `rubricDegraded=false` is asserted against a rubric that actually copied. | MDB (`fixture-seed-data`) |
| **D25** | F12's slow-mode delay and `COLD_START_SIMULATE_DELAY_MS` are run-scoped/env-gated harness affordances, inert by default and inert under a production-like `NODE_ENV` — never fixture data. | Risks, MDB |
| **D26** | The empty-course path (F14) is specified: a scan with `totalPostsScanned=0`, a Ready-to-Transfer "0 posts to copy" state, and a zero-item job that completes immediately and satisfies the invariant. | Risks, MDB |
| **D27** | The pre-flight pagination loop has an acceptance gate: F4 paged at `pageSize=7` must return 50 posts from 8 calls per surface. | MDB (`post-enumerator`) |
| **D28** | The monetization completion hook is an **injected callback** on `transfer-engine`, keeping the dependency edge pointing the right way while giving the hook a real code path. | MDB |
| **D29** | The cold-start mechanism is **latency-triggered** — neither client-idle-clock nor server-flag. UX Acceptance Scenario #8's ">15 min idle" precondition is superseded by "any unresolved call >2s". | §4 (Cold start) |
| **D30** | Two named WCAG AA requirements get explicit acceptance gates: outcome-icon text alternatives on the ticker, and focus-to-heading on the Completion Summary. | MDB |
| **D31** | `transfer-job-api` and `courses-api` declare their `data-model` edges (they write rows); no module writes to a table it has no declared edge to. | MDB |
| **D32** | **The outcome function is HONEST as well as total.** `TransferJobItem.claimedTargetPostId` is written the instant `issueCreate` returns and before any follow-up step can throw, and `finish()` carries an optimistic `outcome: 'pending'` predicate. The item-level catch therefore reads evidence the job owns before it re-buckets, and overwriting an already-terminal outcome is unrepresentable rather than merely unintended. Added at cycle 2 (P0-1): totality alone closed the arithmetic and re-opened the lie the arithmetic existed to prevent — a created post reported as `skipped`/`provider_error` with the note "Nothing was written to the target course". | §5, `transfer-engine` |
| **D33** | **The executor holds a LEASE.** `TransferJob.executorId` is claimed at `execute()` entry; every executor write to the job row is `updateMany where {id, executorId}` and a zero-row result aborts the run. The reconciler CLAIMS a stale job in one conditional statement that also nulls `executorId`, and skips any job it cannot claim. Added at cycle 2 (P0-2): staleness was the reconciler's only predicate, so it could rewrite a live executor's items and release `activeAccountId` mid-run — admitting a second executor into the same target course. The executor also heartbeats through topic creation and the hydration enumeration, the two gaps where a slow-but-alive run used to look dead. | §5, `transfer-engine`, `job-reconciler` |
| **D34** | **Recovery reads an id, not a name.** Interruption recovery resolves from `claimedTargetPostId`; the title match survives only as a fallback, scoped to posts created at or after `job.startedAt`, excluding ids already claimed by a sibling item, and refusing on ambiguity. Added at cycle 2 (P0-4): title-only matching against the target course's whole namespace manufactured "transferred" verdicts for posts that were never copied. | `job-reconciler` |

## Deltas (Δ1–Δ3 + UI-Δ1–UI-Δ2, required quality improvements)

Renumbered under a `Δ` prefix at the engineer stage so architecture deltas and
the inline design decisions above cannot share a namespace (the two previously
did, and six of the ten cited `D` labels matched no row anywhere). Rows carried
in from `03-ui-direction.md` keep a `UI-Δ` prefix, marking them as another
document's.

| ID | Risk (P0/P1) | Recommendation | Rationale | Prerequisite? |
|---|---|---|---|---|
| **Δ1** | P1 — SQLite file survival on Render free tier. **The previous wording scoped this to redeploys and declared sleep/wake "not in question"; that scoping was the risky part.** Free instances are documented as having an ephemeral filesystem with persistent disks unavailable on the free plan, which would mean job state does not survive a **spin-down**, not merely a redeploy. **This document does not assert Render's current policy** — the finding is about this doc's confidence, not a verified fact, and no instrument was available to verify it. | Verify empirically in the first deployment spike, covering **spin-down as well as redeploy** (deploy, create a job, let the instance idle down, wake it, check for the row). Elevate this check to run **before** the resumability guarantee is stated as delivered. The pre-decided remedy if it comes back negative is Postgres. | The code is written identically either way, and the idempotent seed-on-boot restores the **fixture world** regardless — but it does **not** restore **job state**. If the disk is ephemeral, then honestly: resumability is intra-process only, boot reconciliation has nothing to reconcile (interrupted jobs vanish rather than being marked `interrupted` — a silent drop at the *job* level), and `fixture_f12_reconnect_fidelity` runs locally against a normal filesystem and therefore certifies nothing about the deployed environment. | No for code; **yes** before the resumability guarantee is called delivered. |
| **Δ2** | P1 — The rate-limit-exhaustion fallback-note string is architect-proposed, not confirmed by a content pass. | Centralized in `notes.ts`; F13's test asserts distinctness from the attachment note rather than a literal (D6). Route the string to whoever owns copy before ship. | The decoupling is what keeps this minor. | No. |
| **UI-Δ1** | P1 (from `03-ui-direction.md`) — Narrow-viewport behaviour for the 5-tile stat grid and the itemized log table. | **Decided at engineer stage:** stat grid reflows 5→3→2 columns at defined breakpoints; the log table horizontal-scrolls with a sticky title column (closer to the ledger/manifest concept than a card collapse). Implemented in `ui-shared-components`. | Was left improvised-per-component; now chosen once. | Resolved. |
| **UI-Δ2** | P1 (from `03-ui-direction.md`) — The palette is contrast-designed by construction but was never run through an automated contrast tool. | **As built (QA-3):** `axe-core` under Vitest + jsdom on every wizard surface, plus an arithmetic WCAG contrast audit over all 13 token pairings (`wcag_aa_automated_per_step`, owner `ui-shared-components`) — *not* `@axe-core/playwright` in a real browser, which is what this row used to claim. See §8's accessibility note and the reconciliation row below. | Makes the check continuous at ~zero marginal cost, and the arithmetic audit is stronger than a jsdom axe run that silently skips contrast. It is still not a real-browser pass. | No — but the real-browser gap is on the backlog. |
| **Δ3** | P1 — Real Classroom's asynchronous write consistency is not modelled by the mock's synchronous writes, and the mock's 429 is a deterministic condition rather than Google's structured error envelope. | Named as an Open Question for the real-API follow-on; `RateLimitError{retryAfterMs}` is already shaped to accept richer data. | The honest limit of the swappable-boundary driver. | No — real-API follow-on. |


---

## Decisions (confirmed)

Recorded via `stage_record_decisions` with `source: "beast-mode-auto"` (batch
call at end of stage). All choices below are the architect's own recommended
option, self-accepted per Beast Mode (stage-protocol §10); none crossed the
repository boundary.

1. **Architecture style:** modular monolith with ports-and-adapters at the
   Google-integration boundary, over microservices or a queue/worker-fleet —
   matches driver 6 (simplicity) and driver 4 (cold-start tolerance); a queue
   buys capability nothing in v1's realistic load needs.
2. **Persistence:** SQLite via Prisma, single file, holding both the
   simulated Google world and application state — over Postgres (cost/ops
   for a free-tier single instance) and over in-memory storage (fails F12's
   resumability requirement outright).
3. **Job/poll contract:** `POST` returns `202 {jobId}` immediately; async
   execution checkpoints per item; `GET .../status` polled ~1.5s; `GET
   .../active` for reconnect discovery; `GET .../items` fetched once at
   completion — over WebSockets/SSE (fragile across Render's sleep/wake) and
   over doing the work inline in the request (kills refresh-resumability).
4. **Reconciliation-by-construction:** `TransferJobItem.outcome` is a
   single-valued NOT-NULL enum, rows inserted `pending` before any provider
   attempt, counts served via `GROUP BY` aggregation — over a set-valued
   outcome or independently-incremented counters, both of which are exactly
   the defect class (an assertion with no enforced implementation) this run
   was warned about.
5. **Per-type data model:** `CourseWork` and `CourseWorkMaterial` as
   structurally separate tables (no shared nullable-field table) — over a
   single generic `Post` table, the exact defect already corrected three
   times upstream.
6. **Google-integration boundary:** a type-only `ClassroomProvider`
   interface, mock implementation now, concrete wiring confined to one
   composition-root module — over direct `if (mock)` branching or a full
   anti-corruption layer.
7. **Auth:** signed JWT + revocable `Session` row, `SameSite=None; Secure`
   cookie for the split-origin deployment, forced picker on every sign-in —
   over stateless-JWT-only (no revocation) or `localStorage` tokens
   (XSS-readable, breaks reconnect).
8. **Frontend stack:** React + Vite + TypeScript + Tailwind on design-token
   CSS custom properties — over Next.js (unneeded SSR, a second sleeping
   service) or a component library (would fight the bespoke UI direction).
9. **Testing stack:** Vitest (contract tests against the provider interface)
   + Playwright (+ `@axe-core/playwright`) — over Jest/Cypress, and over
   unit-tests-only (the reconciliation and resumability guarantees are
   system properties, not unit properties).
10. **F12 fixture modeling:** reuse F4's 50-post course with an added
    deterministic slow-mode delay flag, rather than an entirely new course —
    gives a reliable interruption window without inventing new seed data
    unrelated to what F12 is actually testing (the reconnect mechanism, not
    a new course shape).
11. **F13 fixture modeling:** a new, distinct course from F6 where one
    item's provider call always 429s regardless of attempt count — F6 stays
    scoped to "retry succeeds," F13 exclusively exercises "retries exhaust."
12. **Cold-start coverage:** honestly flagged as outside the F1–F13
    manifest; a non-fixture, env-gated test harness is provided instead, and
    a future formal fixture is recommended to the backlog rather than
    retroactively claimed.
13. **Rate-limit-exhaustion note text:** architect-proposed and centralized
    in a constants module, with the fixture test asserting distinctness
    (not a literal match) — decouples the build from a pending content-pass
    confirmation.
14. **Single-active-job-per-account enforcement:** a partial unique index
    plus a `409`-with-existing-`jobId` response, over silently allowing
    concurrent jobs or hard-erroring a double-submit — makes an accidental
    double-click self-healing rather than either silently wrong or
    confusing.
15. **Boot-time job reconciliation:** on process start, `running` jobs with
    a stale heartbeat are marked `interrupted` (never silently resumed, to
    avoid duplicate-post risk); their pending items are marked
    `skipped`/`server_interrupted` so the reconciliation sum still closes —
    over either silent auto-resume (duplicate-post risk) or leaving the job
    permanently stuck (breaks the zero-silent-drop guarantee at the process
    level).
16. **Deployment topology:** two Render services (persistent API + static
    frontend) per the source PRD's deployment guide, with the resulting
    CORS/cookie configuration resolved explicitly (`SameSite=None; Secure`,
    pinned origin allowlist) — over collapsing to a single same-origin
    service, which would lose the always-awake static shell that makes the
    cold-start overlay reliably renderable.
17. **QUIZ_ASSIGNMENT as an explicit mock `workType`:** modeled as a
    distinct enum value despite no equivalent in the real Classroom API's
    literal `workType` enum — matches the brief/UX/UI's treatment of Quiz
    assignment as a fourth first-class coursework type; flagged as an Open
    Question for the real-API follow-on to reconcile (likely: `ASSIGNMENT` +
    detected Form attachment).
18. **Decision-core synthesis:** the theme-7 ADR table and Deltas table were
    produced by a dispatched Opus 5 subagent per the architect skill's
    optional decision-core step (Claude Code path), given the full elicited
    context from themes 1–6/8/9; folded in verbatim per stage protocol.

## Assumptions

- Render's free-tier local disk persists across sleep/wake cycles within a
  single deploy (not verified this stage — see Delta, "SQLite-on-redeploy
  persistence").
- A single teacher realistically runs one transfer job at a time; the
  single-active-job-per-account enforcement (Decision 14) is sized to that
  assumption, not to any anticipated multi-job workload.
- The ~1.5s poll interval is assumed sufficient both for perceived
  responsiveness and for keeping the Render dyno awake during an active
  transfer; not load-tested this stage.
- The rate-limit-exhaustion fallback-note string proposed in `notes.ts` is
  provisional pending a content-pass confirmation (Delta).
- `QUIZ_ASSIGNMENT` as a mock-only `workType` value is assumed acceptable
  for v1 and is flagged, not silently carried, as a real-API reconciliation
  point.

## Open questions

- How should `QUIZ_ASSIGNMENT` map onto the real Classroom API's actual
  `workType` enum (which has no distinct quiz value) when the real-API
  follow-on ships? (Likely: `ASSIGNMENT` + detected Google Form attachment —
  needs confirmation against real API behavior, not assumption.)
- Should `/api/transfer-jobs/:id/items` gain a `?since=` param for mid-
  transfer detail access, if a future requirement needs it? (Not needed by
  any current fixture or UX requirement — noted, not built.)
- Exact session TTL for the mock JWT (a fixed value is assumed sufficient;
  no product requirement names a duration) — left for the engineer to pick
  a reasonable default (e.g., 24h) unless UX/QA surfaces a reason otherwise.
- Whether Render's free-tier Postgres (30-day expiry) or a paid persistent
  disk should be the pre-planned remedy if the SQLite-on-redeploy
  verification (Delta) comes back negative — both are viable, no strong
  signal yet since the verification hasn't run.

## Next handoff

Engineer → reads 01/02/03/04, implements the system per this architecture.
Notes for the engineer:

- Start with `data-model` and `classroom-provider-interface` (both have zero
  dependencies) in parallel, then `fixture-seed-data` and
  `mock-classroom-provider` — this unblocks the widest fan-out of the
  remaining 16 modules, most of which depend only on these four plus each
  other along the edges declared in the Module declarations block above.
- The five `ui-*` screen modules and most backend route modules are mutually
  independent siblings once their shared dependencies
  (`frontend-api-client`/`ui-shared-components` on the frontend;
  `classroom-provider-interface`/`data-model` on the backend) exist — a
  strong parallelization opportunity for sub-agent dispatch.
- Two module acceptance gates carry the run's core promise and should not be
  treated as routine: `transfer-engine`'s reconciliation invariant test (all
  13 fixtures) and `composition-root`'s boot-time-reconciliation test
  (Decision 15) — these are where "zero silent drops" either holds or
  doesn't, structurally, not just in prose.
