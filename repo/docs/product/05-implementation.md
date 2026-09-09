# Implementation — Classroom Copier

> What was built, how to run it, and what the tests actually prove.
> Written by the engineer from `01`–`04` and the technical critic's pass-1
> report. Read by QA next. Date: 2026-08-14

## Orientation (recorded at orientation, not rewritten to match what shipped)

- **Mode A — greenfield.** Read `01-pm-brief.md` (rev 2), `02-ux-workflow.md`
  (rev 2), `03-ui-direction.md`, `mockups/ui-mockups.html`, `wireframes/`,
  `04-architecture.md` (23-module MDB after correction), `diagrams/`,
  `docs/project-profile.md`, `state.json`, and — mandatorily —
  `critic-reports/2026-08-14-architect-p1.md`. `pendingFeedback.source ==
  "critic"`, so this ran in auto-apply mode with no orientation confirmation.
- **Conventions committed to going in.** TypeScript everywhere; npm workspaces;
  modular monolith with ports-and-adapters at the Google boundary; the type-only
  provider port emitting no JS; Prisma/SQLite holding both the mock world and app
  state; Vitest; the design tokens from `03-ui-direction.md` §2 verbatim; TDD by
  default with the acceptance scenarios in `02` as the outer loop.
- **Lessons learned answered** (`docs/project-profile.md` § Lessons learned —
  both applied, neither "none apply"):
  1. *Cross-references must resolve.* Before writing code I added a **Design
     Decision Register (D1–D31)** to `04` and renumbered the Deltas under a
     distinct `Δ` prefix, then grepped every `[A-Z]\d+` token in the document and
     confirmed each resolves. It does. **Corrected at cycle 2 (QA-4):** at the time
     this was written the check was a grep I ran by hand — the *result* was true,
     the claim of a committed repeatable script was not. It is one now:
     `scripts/check-doc-citations.mjs`, wired as `npm run check:citations`.
  2. *A guarantee is structural only if the failure it forbids is
     unrepresentable.* I enumerated how the reconciliation guarantee could fail
     and checked each against the schema. Two of the four are now genuinely
     structural (double-counting; the single-active-job guard). Two are **not**
     schema properties and are enforced by code with their own gates — the
     totality of the outcome function and the identity between the two counts.
     §5 of `04` now says so in those words rather than implying more enforcement
     than exists.
- **Conflicts with `04` flagged going in.** One, and it is real: `04` specifies
  Playwright + `@axe-core/playwright` for E2E. This run could not take on a
  browser download, so the suite is Vitest + jsdom + `axe-core`. I did not
  silently substitute — the divergence, what it still covers, and the one thing
  it genuinely does not (axe's own contrast rule needs layout) are recorded in
  `04` § Implementation reconciliation, in the project profile's *Not declared,
  and why*, and on the backlog.

---

## 1. What was built

A working, mock-backed Classroom Copier: sign in → pick an account → choose
source and target → pre-flight scan → resolve any flagged attachments → confirm
→ batch transfer → itemized reconciliation report.

```
shared/    zod DTOs + canonical note strings   (the ONE declaration of each payload)
server/    Express 5 + Prisma 6/SQLite         (23-module MDB's backend half)
client/    React 19 + Vite 7 + plain CSS       (5 wizard screens + shared components)
```

- **365 tests pass** (shared 12, server 176, client 177). 0 failing, 0 skipped.
  *(Cycle 1 shipped 327; cycle 2's review fixes added 38 — see the Cycle 2
  section below.)*
- **Build clean** (`shared` → `server` → `client`), **lint clean** (0 errors,
  0 warnings).
- **All 11 quality budgets PASS** via
  `node scripts/agent-c-budgets.js run "<project>"`.
- Verified by hand in a browser end to end (screenshots taken of the sign-in
  landing, forced account picker, selection, the Action Sheet Modal on F2, Ready
  to Transfer, and the Completion Summary).

## 2. The five P0 fixes, and where each one lives

Every one was folded in **before** the corresponding code existed — the design
doc was corrected first and the build followed it.

### P0-1 — the phantom `D1`–`D10` register
`04-architecture.md` cited `D1`–`D10` 26 times, 8 of them inside the
machine-parsed `agent-c:modules` YAML that is dispatched verbatim to sub-agents,
and the labels resolved to nothing.

**Fixed:** a numbered **Design Decision Register (D1–D31)** now defines every
label with a pointer to its governing §. Deltas were renumbered under a distinct
`Δ` prefix and the two rows that actually belonged to `03-ui-direction.md` are
`UI-Δ1` / `UI-Δ2`. `D7`/`D8` are retired in place with a pointer, rather than
reused, so an old citation cannot silently resolve to a new meaning. A scripted
grep confirms **zero unresolved citations**.

### P0-2 — `count(items) == totalPostsScanned` from two independent scans
**Fixed by persisting the scan.** `PreflightScan` + `PreflightScanItem` are real
tables; `POST /api/transfer-jobs` takes `{scanId, resolutions[]}` and inserts
`TransferJobItem` rows **from the stored scan rows**, never from a fresh
enumeration. One measurement, two readers.

The old acceptance gate could not fail — both sides came from one in-test read.
The new one can, and does the thing that would have caught this:

> `src/services/transfer-engine.test.ts` → *"a job created from a scan has
> exactly scan.totalPostsScanned items EVEN IF the course changes in between"* —
> it scans, **inserts a new post into the source course**, creates the job, and
> asserts the item count still matches the scan. It then re-scans and asserts the
> fresh count differs, proving the divergence the persisted scan removes is real.

The same assertion exists at the HTTP layer in `test/api.integration.test.ts`.

### P0-3 — no exit from `pending` for anything but a 429
**Fixed in three parts, each with its own gate.**
1. **The outcome function is total.** Every per-item execution is wrapped in
   `try/catch` whose catch resolves the item to a terminal outcome —
   `fallback_shell` where a shell was created, otherwise `skipped` with
   `skipReason='provider_error'` carrying the error class. `PermissionError`,
   `NotFoundError` and arbitrary exceptions all have an exit.
2. **A sweep before `completed`.** The engine asserts `count(pending) == 0`
   before writing `completed`; stragglers are resolved and logged at `[ERROR]`.
3. **A top-level catch and an interval watchdog.** The executor's `.catch()`
   assigns `status='failed'` — previously a value nothing in the system ever
   assigned — and `JobReconciler.start()` runs the stale-heartbeat sweep **on an
   interval, not only at boot**, so a job wedged while the process is still alive
   self-heals instead of polling a frozen counter forever.

Gate: `test/quality/totality.budget.test.ts` injects `PermissionError`,
`NotFoundError`, an arbitrary `TypeError`, and a top-level throw, and asserts
zero pending items and a closed sum in every case. The client renders
`ErrorState` for `status: 'failed'` rather than a frozen bar.

### P0-4 — F13's "guaranteed" shell was unreachable
F13 was defined as an item whose mock call *always* 429s — but the fallback was
issued through that same call, so the sixth attempt refused exactly like the
first five and `fixture_f13_exhaustion_terminal` was unsatisfiable as written.

**Fixed via the recommended option (a):** F13's 429 is **scoped to
attachment-bearing creates**. A bare-shell create (no `materials[]`) succeeds, so
the fallback is a genuinely *different call with a different payload* — which is
also the more faithful simulation, since a real Classroom 429 is a quota
condition, not a permanent per-item refusal. The doc's conflation of
attachment-level and API-level fallback is now spelled out as two distinct
concepts, and if the bare shell *also* fails the item resolves honestly to
`skipped` / `rate_limit_exhausted`.

The budget gained a third clause that is the point of the whole fix:
`targetPostId != null`, plus an assertion that the row it names exists as a real
DRAFT post. "Fallback shell" can no longer mean a ledger row with nothing behind
it.

### P0-5 — a post the server created reported as "Skipped by you"
**Fixed.** `TransferJobItem` gained `attemptedAt` (written immediately *before*
the provider call) and `targetPostId` (written in the *same statement* as
`outcome='transferred'`). Boot **and interval** reconciliation now branches on
evidence:

- `attemptedAt IS NULL` → never attempted → `skipped` / `server_interrupted`.
- `attemptedAt IS NOT NULL` → outcome unknown → **verify against the target
  course** via the port's existing list methods → found → `transferred` with
  `targetPostId` backfilled; not found → `skipped` / `server_interrupted`.

The API exposes `skippedByUser` and `skippedBySystem` as separate counts; the sum
stays three-term over `skippedTotal` — **only the labelling splits**. The
Completion Summary's "Skipped by you" tile binds to `skippedByUser` alone, and
any system skips render as a separate line naming what happened.

The old gate seeded 10 pending items and asserted all 10 became `skipped` — it
asserted the bug. The replacement
(`test/quality/job-reconciler.budget.test.ts`) seeds a **mix** of all three
classes and asserts each lands correctly, that the invariant still holds, and
that `skippedByUser == 0`.

## 3. The APPLY findings

| Finding | Where it landed |
|---|---|
| **A** `resolutions[]` undefined; the "Skip Attachment and Note Draft" bucket undecided | `Resolution` is a zod discriminated union in `shared`; the five-row mapping is code in `server/src/services/resolutions.ts`, each row with its own test. **Decided:** `skip_attachment_and_note_draft` → `fallback_shell`, because a note was injected and the credit rule keys off exactly that — the alternative would charge a teacher for a copy carrying a "could not be linked" note. |
| **B** no shared client/server DTOs | `shared-contracts` (21st module) — every payload declared once as a zod schema exported as validator + type. The client parses every response through it; a malformed payload surfaces as an error rather than rendering. |
| **C** provider payload types unspecified; `shareMode` had nowhere to travel | `CourseWorkPayload`, `CourseWorkMaterialPayload` and the four-way `Material` union are declared. `shareMode` is **required on `driveFile` and structurally absent on the other three kinds**, so defaulting it by omission is not expressible. `dueDate`/`scheduledTime` are likewise absent from the payload type — "everything lands as a Draft with dates cleared" is not something a caller can forget. |
| **D** `listCourseWork` lacked `courseWorkStates` — a real adapter would drop every Draft and Scheduled post | Added, **and the mock is held to the real API's default**: an unfiltered call returns `PUBLISHED` only. A contract test asserts that, and a `post-enumerator` test asserts the unfiltered call returns *fewer* items than the filtered one — so the filter is demonstrably load-bearing rather than decorative. |
| **E** `listCourses` lacked `courseStates` | Added; `courses-api` scopes source (ACTIVE+ARCHIVED) and target (ACTIVE) through the port. |
| **F** `copyRubric` had no real-API counterpart; `Rubric` had no criteria | Replaced by `getRubric` + `createRubric` (get-then-create, licence denial on the *create*). `RubricCriterion` / `RubricLevel` are modelled and copied verbatim — which **answers the PM brief's open question on rubric fidelity**, routed to this stage and previously unanswered. |
| **G** `getAttachmentHealth` was an N+1 | Batch-shaped: `refs[] → Map`, one query. |
| **H** the promised "all posts" merge module was absent | `post-enumerator` (22nd module) owns the pagination loop, the merge, and the total ordering key `(creationTime, sourceType, sourceId)` — with a test that reversing the input does not change the output, which is what "total" means. |
| **I** `Attachment` had no ordering column | `sortOrder` added, seeded contiguously in F5, and the cap applied by it. The F5 test asserts the surviving 20 are *Plate 01…Plate 20* by name — deterministic, not "whatever the planner returned". |
| **J** the single-active-job predicate was undefined; `rate_limited_pause` escaped it | Terminal set defined once as `{completed, interrupted, failed}`; rate-limit pause is a **field, not a status**. A test asserts a POST while an existing job is *rate-limit-paused* still returns the conflict — the exact double-submit window the guard exists for. |
| **K** `transfer-job-api` had no `data-model` edge; the monetization hook had no home | Edge declared. The completion hook is an **injected callback** on the engine, called with `cleanTransfer`, verified by spy. |
| **M** F1 seeded no rubric, so `copyRubric`'s success path was unfixtured | F1 now carries a rubric with two criteria and real levels on a licence-permitted path; a test asserts it copies with `rubricDegraded=false` and compares the copied body to the source. |
| **N** F12's slow-mode flag had no home and would corrupt F4's perf budget | It is a run-scoped `MockProviderOptions { perItemDelayMs }`, supplied by the F12 spec. The perf budget explicitly passes `providerOptions: {}` and says why. |
| **P** the budget rows had no owning module and nothing owned `test/quality/*` | `quality-budgets` (23rd module). Nine rows landed in `docs/project-profile.md`, each with an `npm run test:budget:*` command that exists; each prints a `[budget] …` line with the measured number. |
| **Q** two named WCAG AA requirements had no gate | `OutcomeIcon` has **no prop that suppresses its text label** and is tested for an accessible name on every outcome; focus-to-heading on the Completion Summary is asserted via `document.activeElement`. |
| **R** Δ1 wrongly scoped the Render disk risk to redeploy only | Rewritten. The "sleep/wake is not in question" claim is gone; the spin-down case is named; and — following the critic's own discipline — **this document does not assert Render's current policy**, because no instrument was available to verify it. What it states instead is the consequence *if* the filesystem is ephemeral: resumability would be intra-process only, boot reconciliation would have nothing to reconcile (a silent drop at the *job* level), the idempotent reseed restores the fixture world and **not** job state, and `fixture_f12_reconnect_fidelity` runs locally and therefore certifies nothing about the deployed environment. |

Also applied: **L** (the pagination loop now has a gate — F4 paged at 7 must
return 50), **O** (F14, the empty course), **S** and **T** (both diagrams
corrected: the F2/F3 branch now issues a real create before the DB write, and
`item.status` → `item.outcome` throughout), **U** (the cold-start mechanism is
relabelled *latency-triggered* and UX Acceptance Scenario #8's ">15 min idle"
precondition is explicitly superseded so QA tests the built behaviour).

**DEFER** findings 1–6 went to the backlog.


---

# Cycle 2 — the code review's five P0s and sixteen APPLY findings

> Everything above this line describes cycle 1 and is left as written. The
> technical critic's report (`critic-reports/2026-08-14-engineer-p1.md`) then
> found five P0s and sixteen APPLY items in that code, and QA
> (`06-qa-report.md`) added four minor findings. This section is what changed,
> and — the part that matters — **what input made each new test go red before
> it went green.** The recurring failure mode across this whole run has been a
> gate that cannot fail: `totality.budget.test.ts` injected only *before* the
> create, and `job-reconciler.budget.test.ts` constructed the happy case. Every
> gate below was run against the pre-fix code first and observed failing, with
> the failure message recorded here.

## C2.1 — The five P0s

### P0-1 — a created post recorded as "Nothing was written to the target course"

`processItem`'s catch was the clause that made the outcome function total. It
was also unconditional, so it fired for a throw *after* the provider create had
already succeeded, and `finish()` nulled `targetPostId` on the way past. Three
reachable post-create throws — `clearPause`, `getRubric` (which sat *outside*
`copyRubricIfAny`'s try), and `updateCourseWork*Description` on the
rubric-degraded path — turned a **created** post into `skipped`/`provider_error`
carrying a factual falsehood. The teacher reads "nothing was written", re-creates
the post by hand, and gets the duplicate that the whole no-auto-resume decision
exists to prevent.

**Fixed, in four parts.** (1) `TransferJobItem.claimedTargetPostId` is written
the instant `issueCreate` returns and before anything else can throw — evidence
the job owns. (2) The protection is
three layers deep, not one mechanism (QA-5 precision note, cycle 2): the
`clearPause` failure path is caught by the evidence-aware catch in
`recordItemFailure`; the `getRubric` and description-amendment failures are
caught a layer earlier, by local try/catch inside `copyRubricIfAny` and the
post-create amendment block, and under current code never reach
`recordItemFailure` at all. Whichever layer catches, the behaviour is the same:
an already-terminal item has the late failure *appended to its note*, never
re-bucketed; a `pending` item with a claimed post is finished as `transferred`
with that id. QA verified the three layers as genuine defense-in-depth by
breaking all three together and watching the gate go red. (3) `finish()` is now
`updateMany({ where: { id, outcome: 'pending' } })`, so overwriting a terminal
outcome is unrepresentable, and a zero-row update logs at ERROR. (4) `getRubric`
moved inside `copyRubricIfAny`'s try, and the whole post-create block (rubric
copy, description amendment) degrades to a note rather than propagating.

**Gate:** three new cases in `test/quality/totality.budget.test.ts`, one per
throw site, asserting against **the target course itself** rather than the
ledger — anything present in the target must not be reported as unwritten.
**Verified RED first**, all three:

```
AssertionError: "Week 1 Reading" IS in the target course, but its note says nothing was written:
  expected 'Could not be copied (Error). Nothing was written to the target course for this post.'
  not to contain 'Nothing was written to the target course'
```

The gate also asserts it checked something (`expect(checked).toBeGreaterThan(0)`),
because a gate that silently examined zero rows is the failure mode this cycle is
about.

### P0-2 — the reconciler racing a live executor

`reconcileStaleJobs` selected on a stale heartbeat and nothing else. There was no
lease, epoch or version column anywhere, and every executor write was an
unconditional `update where {id}`. So a live-but-slow executor got reconciled
underneath itself: its pending items were rewritten, `status` became
`interrupted`, and **`activeAccountId` was nulled while the job was still
running** — releasing the single-active-job guard and admitting a second executor
into the same target course. The executor then overwrote every verdict and wrote
`completed` on top. Reachable in practice: there was no heartbeat at all during
`buildTopicMap` or the hydration enumeration, and `jobStaleAfterMs` is 60s.

**Fixed, in three parts (D33).** (a) `TransferJob.executorId` is claimed at
`execute()` entry; every executor write to the job row goes through one
`heartbeat()` helper that is `updateMany where {id, executorId}` and raises
`ExecutorLeaseLostError` on zero rows, which `run()` treats as "stand down", not
"fail". (b) The reconciler CLAIMS a job in one conditional statement that also
nulls `executorId`, and skips any job whose claim affects zero rows — so an
executor that heartbeated between the SELECT and the UPDATE is left entirely
alone. (c) Heartbeats now fire per topic created, per topic page, and per
enumeration page (via a new `onPage` hook on `enumeratePosts`).

**Gate:** `test/quality/executor-lease.budget.test.ts` — a reconciler fired from
*inside* a provider create, i.e. at the worst possible instant.
**Verified RED first**, all three cases:

```
[budget] lease race: status=completed executorId=null activeAccountId=null pending=0
AssertionError: expected 'completed' to be 'interrupted'
AssertionError: no heartbeat between the first and last topic creation: expected 1 to be greater than 1
```

`status=completed` is the bug exactly: the executor overwriting the reconciler's
terminal verdict.

### P0-3 — the mock moved attachments instead of copying them

`copyAttachmentToMyDrive` **updated the source course's attachment row in place**
— `driveFileId`, `ownerAccountId`, `driveState`. That made the one method named
"copy" the only write to the source course anywhere in the system, in a product
whose central promise is that the source is never touched. It also healed F3's
`permission_locked` finding within a session, and the engine *depended* on the
move: `transferPost` discarded the returned `newDriveFileId` and re-read the same
source rows, so a faithful real adapter (`drive.files.copy` → a new file, source
untouched) would have linked the still-locked original. This was an **undisclosed
divergence**, discoverable without any live Google access, and it is not covered
by the "port fidelity is asserted, not verified" caveat.

**Fixed.** The mock inserts a **new** row with `parentType='myDrive'` — the
acting account's Drive, which is not a course post, so neither coursework surface
returns it and the source post's attachment list is unchanged. The engine
collects the returned ids into a map and substitutes them in `buildMaterials`;
`refreshAttachments` (and with it one of APPLY-B's three port bypasses) is
deleted outright, because there is no longer anything to re-read.

**Gate:** three contract-test cases whose headline is
`LEAVES THE SOURCE ATTACHMENT UNCHANGED`, plus an engine test asserting the
created post links the copy and not the original. **Verified RED first:**

```
AssertionError: expected 'att-f3-1a' not to be 'att-f3-1a'
AssertionError: expected 'acct-jamie' to be 'acct-dana'
```

### P0-4 — interruption evidence matched on title alone

The reconciler indexed the target course as `Map<"sourceType:title", postId>`.
Three ways that returns a false positive — reporting a post as copied that was
never copied, which is a silent drop produced by the anti-silent-drop mechanism:
a pre-existing post in a non-empty target whose title collides; a target left
dirty by a previous run (the seed never pruned), so the **second run of any
transfer** found every source title already present; and duplicate titles
collapsing through `index.set`, so N items shared one `targetPostId`.

**Fixed (D34).** Recovery now reads `claimedTargetPostId` — an id the job wrote
itself — and verifies that post exists in the target. The title match survives
only as a fallback for the narrow window between `attemptedAt` and the claim
write, and it is scoped to posts created at or after `job.startedAt`, excludes
ids any sibling item already claims, and **refuses on ambiguity** with a new
`itemsSkippedAmbiguous` counter rather than guessing. Both reconciler writes also
carry the `outcome: 'pending'` predicate.

**Gate:** `test/quality/job-reconciler.budget.test.ts` rewritten so the three
false-positive cases come *first*, plus an invariant (`assertNoSharedTargetPosts`)
that no two items in a job ever name the same target post. **Verified RED first**,
all four cases, including the one that matters most:

```
[budget] reconcile dirty target: verifiedTransferred=6 notFound=0 skippedByUser=0
AssertionError: expected 6 to be +0
[budget] reconcile duplicate titles: ambiguous=0 outcomes=transferred,transferred
```

Six items falsely verified as transferred on a second run; two items both
claiming one post.

### P0-5 — the failure state had no working recovery

`pollJobStatus` returned without rescheduling on **any** error, so one transient
blip killed progress updates permanently — and `api-client.test.ts` *asserted*
that behaviour rather than flagging it. `App.tsx` wired `TransferProgress`'s
`onRetry` to `setStage('transfer')` while the stage was already `'transfer'`: a
React no-op, so **Retry did nothing**, and no test clicked it. With no
mid-transfer cancel in v1, that is a frozen screen with a dead button.

**Fixed.** The poll retries with exponential backoff up to `POLL_MAX_RETRIES`
consecutive failures (a success resets the budget), then surfaces the error.
`TransferProgress` owns a local `pollFailed` state whose Retry bumps a
`restartToken` that genuinely re-runs the poll effect. A job that reached
`failed` **server-side** offers no Retry at all — polling it again returns
`failed` again — and routes to Selection instead; `ErrorState.onRetry` became
optional so "no retry" is expressible rather than faked with a dead handler.

**Gate:** five new client tests, three on the poll loop and two that **click the
button**. **Verified RED first:**

```
× survives a transient blip instead of dying on the first one
× offers a Retry that genuinely restarts the poll after it gives up (P0-5)
    TestingLibraryElementError: Unable to find role="button" and name "Retry"
× offers no Retry when the JOB failed server-side, and Start Over routes onward
    AssertionError: expected <button type="button" …/> to be null
```

## C2.2 — The sixteen APPLY findings

| # | What changed | Gate |
|---|---|---|
| **A** | `shareMode: a.shareMode ?? 'VIEW'` — the one substitution the brief forbids, under a comment asserting it could not happen. A `driveFile` with an unreadable `shareMode` is now a **finding**: the file is left unlinked, named in a note (`shareModeUnknownNote`), and the item lands in `fallback_shell`. Latent today (all ten fixtures set it), live the moment a real Drive file does not. | `apply-findings.test.ts` — a null-shareMode fixture; asserts the file is not linked and no VIEW is written |
| **B** | Three modules read `prisma.mock*` around the type-only port. `refreshAttachments` was the serious one: under a real adapter that query hits a table that no longer exists and **every post is created with zero attachments**. `getCourse` added to the port for `preflight-engine`; `/items` now reads the item row (APPLY-E); `refreshAttachments` deleted (P0-3). | A source scan asserting zero `prisma.mock{Course,CourseWork,CourseWorkMaterial,Attachment,Topic,Rubric}` references outside `adapters/mock/` and `fixtures/` |
| **C** | `TransferJob.scanId` is `@unique`. Back-then-confirm replayed a consumed scan into a whole second transfer, with no id collision to stop it. `409 scan_already_used`; the client no longer attaches to the job named in that body. | Integration test + an api-client test that a `scan_already_used` 409 rejects rather than attaching |
| **D** | `SCHEDULED` is a **mock-invented `CourseWorkState`** with no real-API counterpart, and a contract test had pinned it in place as though it were fidelity — the same class of thing `QUIZ_ASSIGNMENT` was correctly flagged for. It is now flagged in §7 below, on the backlog, and named as a divergence by its own test. The two surfaces also take differently-named state parameters (`courseWorkStates` / `courseWorkMaterialStates`), because they are different real endpoints. | Contract test renamed `DECLARED DIVERGENCE — SCHEDULED is mock-invented`, plus a parameter-split test |
| **E** | `/items` re-read live source rows for `workType`, `maxPoints` and `answerConfig` — the two-measurements pattern *inside the ledger this run is about*. A post deleted after the transfer lost its type and a Question was relabelled "Assignment". The fields are copied at scan time onto `PreflightScanItem` and carried to `TransferJobItem`. | Integration test that deletes the source posts after the transfer and asserts the log still reads `Question` / `multipleChoice` / `maxPoints: 100` |
| **F** | The rate-limit shell composed its description as `{ overflow: [], notes: [] }`, discarding the accumulated attachment notes **and the 21+ overflow URLs** — so it said "re-attach any files" without naming one. Both are carried through now. | `apply-findings.test.ts` — 25 attachments on the F13 post; asserts the shell's description carries the overflow header and the 25th URL |
| **G** | `enforceRateLimit` keyed on post **title, globally**, so any post anywhere with that name 429'd — including a copy of it in a target course from a previous run. Rules are now scoped to their fixture source course, checked against the courses the provider instance actually enumerated. | Contract test: a run that never read F13's course does **not** 429 on a post with F13's title |
| **H** | `?outcome=` was forwarded into a Prisma `where` unparsed. Not injectable, but a closed vocabulary crossing the application boundary in a codebase whose stated discipline is that zod *is* that boundary. `OutcomeSchema.safeParse` → 400. | Integration test |
| **I** | The scan is a snapshot and nothing said so. `scannedAt` is on the response and rendered on Ready-to-Transfer; `POST /transfer-jobs` refuses a scan older than `SCAN_TTL_MS` (10 min) with `409 scan_stale`. | Integration test + a client test asserting the freshness line |
| **J** | `orderingKey` tiebreaks on `sourceId` while the schema called `createdOrder` its "deterministic tiebreak companion". `createdOrder` is a per-table seed ordinal and is not comparable across the two surfaces, so it could never have been that. Removed from the port's read types; the schema comment now says what it is. | Existing `post-enumerator` totality test still holds |
| **K** | `GET /courses` ran a full two-surface paginated enumeration **per course** — the first authenticated call the app makes. `countPosts` added to the port. | New budget `selection_screen_call_cost`: zero enumerations, one count per course, **and** `postCount` equal to what the enumerator would produce |
| **L** | `seedOnBoot` defaulted **true in production** and had no inverse, so posts created by transfers accumulated forever — the accumulation that fired P0-4. It now defaults false under a production-like `NODE_ENV`, and `pruneGeneratedFixtureRows()` is an explicit reset path wired to `pruneGeneratedOnBoot`. | `apply-findings.test.ts` — prunes what a transfer created, leaves the manifest intact, re-seed still a no-op |
| **M** | In-flight requests were never aborted on unmount; components used `live` flags, so React was quiet while the fetch ran on and the global slow-request counter stayed incremented — the cold-start overlay could outlive its screen. Every effect-issued call now takes an `AbortSignal`. | Covered by the existing cold-start budget plus the client suite; `isAbortError` keeps an intentional abort out of the error surfaces |
| **N** | `me()` and `getActiveJob()` failures were swallowed indiscriminately: a 5xx parked the user on the sign-in screen with no feedback, and a blip during boot dropped them on Selection while a job was still running — silently defeating the F12 reconnect guarantee. Only 401 means "no session" now. | Two `App.test.tsx` cases, **verified RED first** |
| **O** | No React error boundary anywhere. A synchronous render-time throw was an unrecoverable white page, mid-batch-write, with no cancel. One boundary at the app shell, rendering `ErrorState` with a shell remount behind it. | `App.test.tsx`, **verified RED first** |
| **P** | Recorded, not changed: the 60s ceiling, zod parsing on all eleven body-carrying calls, timer cleanup in one `finally`, and the "Skipped by you" binding are clean and must not regress. | Existing tests, unchanged |

The four **DEFER** items are on the backlog. One of them (the per-attachment job
re-query) was resolved incidentally — the accountId now travels on the executor
lease, so the loop had nowhere left to re-query from.

## C2.3 — QA's four minor findings

- **QA-1** — a composition-root gate now exists: `test/composition-root.test.ts`
  builds the app via `buildApp`, wedges a job in `running`, starts the real
  interval, and asserts the job resolves **without a process restart** and that
  `activeAccountId` is released. A second case asserts the disposer stops it.
- **QA-2** — `fallback_shell` + `rubricDegraded=true` on one item now has a test.
  It was correct by construction and had zero coverage of that combination; the
  test asserts the item counts once, in `fallback_shell`, and that the shell's
  description carries the rubric note.
- **QA-3** — `04-architecture.md` §8 and the UI-Δ2 row said
  "`@axe-core/playwright` runs on every wizard step", contradicting the same
  document's own honest reconciliation section. Both rewritten to describe what
  shipped; the reader who stops at §8 is no longer misled.
- **One flaky test fixed in passing.** `App.test.tsx`'s selection cases waited on
  the `<select>`'s label, which exists before its `<option>`s do, and failed
  intermittently with `Value "c-source" not found in options` — including once
  under the verify runner while `npm test` passed on the same commit. A gate that
  fails at random is a gate nobody trusts, so it now waits for the options
  themselves. Verified stable across three consecutive suite runs and two
  consecutive `agent-c-verify` runs.

- **QA-4** — the claim of "a scripted grep" is now true of a committed script:
  `scripts/check-doc-citations.mjs` (`npm run check:citations`) resolves every
  `D<n>` / `Δ<n>` / `UI-Δ<n>` token in `docs/product` against
  `04-architecture.md`'s register and exits non-zero on any unresolved one. It
  prints its own exclusions (`critic-reports/`, `inputs/` — received documents
  this project does not maintain) so the scope is never a silent one.

```
[citations] 250 citations across 17 docs; 39 tokens defined in 04-architecture.md;
            not scanned: critic-reports, inputs (received documents)
[citations] zero unresolved citations
```

## C2.4 — Cycle-2 verification

```
npm test        → 12 + 176 + 177 = 365 passed, 0 failed, 0 skipped  (31 files)
npm run build   → shared ✓  server ✓  client ✓  (293.65 kB js / 14.26 kB css)
npm run lint    → 0 errors, 0 warnings
agent-c-verify  → 3/3 steps PASS
agent-c-budgets → 11/11 PASS  (9 existing + executor_lease_mutual_exclusion,
                               selection_screen_call_cost)
```

Cycle 1 was 327 tests; cycle 2 adds 38 (server 148 → 176, client 167 → 177) and
rewrites two budget gates that previously could not fail.

## C2.5 — What cycle 2 still could NOT do

Everything in §7 below still stands unchanged — no real-browser E2E, no
deployment, no live Google integration, no Prisma enums on SQLite. Two additions
specific to this cycle:

- **The lease is tested against a synchronously-injected race, not a genuinely
  concurrent one.** Node is single-threaded and the tests share one SQLite file,
  so the reconciler is invoked from inside a provider call at the exact instant
  of interest. That is a faithful *ordering* test and it does exercise the real
  conditional writes, but it is not two OS processes contending. Whether the
  `updateMany` claim holds under real concurrent connections is a property of
  SQLite's write locking, which this suite asserts by construction and does not
  measure.
- **The `SCHEDULED` and `QUIZ_ASSIGNMENT` divergences are flagged, not
  resolved.** Mapping `SCHEDULED` to `DRAFT + scheduledTime` at the port
  boundary is real-adapter work and is on the backlog. Until then the mock's
  vocabulary is knowingly wider than the real API's, and no test in this repo can
  discover that for itself.

---

## 4. How to run it

```bash
npm install
npm run -w server db:push        # apply schema + generate client
npm run -w server seed           # idempotent F1–F14 seed

npm run dev:server               # http://localhost:4000
npm run dev:client               # http://localhost:5173  (proxies /api)
```

`server/.env` needs `SESSION_SECRET` — the process **refuses to boot without
one** outside test, because a dev default that ships is the classic form of that
bug. `.env.example` documents every variable.

## 5. Tests, and what they actually prove

| Suite | Files | Tests | Result |
|---|---|---|---|
| `shared` | 1 | 12 | pass |
| `server` | 19 | 176 | pass |
| `client` | 11 | 177 | pass |
| **total** | **31** | **365** | **all pass** |

```
npm test        → 12 + 176 + 177, 0 failed
npm run build   → shared ✓  server ✓  client ✓ (293.65 kB js / 14.26 kB css)
npm run lint    → 0 errors, 0 warnings
```

Quality budgets (all `advisory`, all PASS; measured values printed by each run):

```
[advisory] engine_throughput_f4_50posts ............ PASS   (< 120s)
[advisory] reconciliation_invariant_all_fixtures ... PASS   (9 fixtures)
[advisory] no_pending_after_completion ............. PASS   (4 pre-create + 3 post-create injections)
[advisory] executor_lease_mutual_exclusion ......... PASS   (1 terminal writer, heartbeats in both gaps)
[advisory] selection_screen_call_cost .............. PASS   (0 enumerations, 1 count/course)
[advisory] fixture_f1_zero_fallback ................ PASS   (0 fallback, 100% fidelity)
[advisory] fixture_f13_exhaustion_terminal ......... PASS   (attempts=5, fallback_shell, real post)
[advisory] interrupted_items_verified_not_assumed .. PASS   (3 false-positive gates + 2 true positives)
[advisory] fixture_f12_reconnect_fidelity .......... PASS   (0 duplicated, 0 missing)
[advisory] wcag_aa_automated_per_step .............. PASS   (0 critical/serious + contrast audit)
[advisory] coldstart_overlay_timing ................ PASS   (2s appearance, 60s ceiling)
```

**Contrast audit (closes UI-Δ2).** The palette was "contrast-designed by
construction" and had never been measured. It has now been, arithmetically:
ink-900/paper-0 **15.42**, ink-700/paper-0 **8.84**, ink-500/paper-0 **5.33**,
teal-700/paper-0 **7.43**, white-on-teal-700 **7.82**, amber-700/amber-100
**5.12**, green-700/green-100 **4.64**, red-700/red-100 **5.91**,
slate-600/paper-1 **4.84**, focus-blue/paper-0 **6.15**. Every pairing clears its
threshold; nothing is skipped. The two tightest are green-700/green-100 at 4.64
and slate-600/paper-1 at 4.84 — both pass, both with little headroom, so any
future darkening of `--paper-1` would break them.

**Visual-only surfaces, flagged not faked.** Exact spacing, the hatched
progress-bar gradient, zebra striping, hover states and the radio shape changes
are not meaningfully unit-testable and no tests pretend otherwise. The token
values and the contrast ratios are tested; the `.recommended` / `.selected`
split is tested at the class level (both classes applied independently, which is
the behaviour that matters); the look itself is QA's visual pass against the
mockup.

## 6. Deliberate divergences from `04` (also recorded in `04` itself)

1. **Vitest + jsdom + `axe-core` instead of Playwright + `@axe-core/playwright`.**
   Covered above and backlogged. The one real loss is that jsdom has no layout,
   so axe's own `color-contrast` rule cannot evaluate — replaced by the
   arithmetic audit, which is stronger for contrast specifically and weaker as
   an end-to-end statement.
2. **Plain CSS with design tokens, not Tailwind.** `03-ui-direction.md` calls
   Tailwind a PRD constraint but also specifies bespoke tokens as CSS custom
   properties and a mockup written in plain CSS. Porting the mockup's stylesheet
   verbatim keeps the single source of truth the doc asks for; adding Tailwind on
   top would have meant two styling systems for one screen set.
3. **`updateCourseWork*Description` added to the port** — a real Classroom
   method (`patch` with `updateMask=description`), needed because the rubric
   licence denial arrives after the post exists.
4. **Note strings canonical in `shared`**, re-exported by
   `server/src/services/notes.ts`, so the client can assert the fallback note
   renders untruncated against the same constant the server writes.
5. **Dev is same-origin** via a Vite proxy, with `SameSite=Lax` cookies in
   dev/test and `SameSite=None; Secure` in production.

## 7. What I could NOT do, stated plainly

- **No real-browser E2E.** See above. QA should treat the a11y row as
  "structural rules verified in jsdom + contrast verified arithmetically", not
  as a browser pass.
- **No deployment, and no verification of Render's behaviour.** Nothing was
  deployed (Beast Mode never ships). Δ1's empirical check — deploy, create a
  job, let the instance spin down, wake it, look for the row — has **not** been
  run, and this document does not guess its outcome.
- **No live Google integration.** By constraint. The contract test suite is the
  seam that will catch drift when `RealClassroomProvider` is written; until then
  the port's fidelity to the real API is asserted, not verified.
- **Prisma enums are unavailable on SQLite**, so the closed vocabularies are
  `String` columns validated by zod at the application boundary. The load-bearing
  per-type split (two tables) and the single-active-job guard (a nullable unique
  column) *are* structural; the rest is enforced by code, and §5 of `04` now says
  which is which.
- **`QUIZ_ASSIGNMENT`** remains a mock-only `workType` with no real-API
  equivalent — modelled, flagged, backlogged, as the architecture decided.
- **`SCHEDULED` is a mock-invented `CourseWorkState`** with no real-API
  counterpart, flagged at cycle 2 (APPLY-D) because it is exactly the same kind
  of thing as `QUIZ_ASSIGNMENT` and cycle 1 did not flag it — a contract test had
  in fact pinned it in place as though it were fidelity. Google models a
  scheduled post as a `DRAFT` carrying `scheduledTime`, which `MockCourseWork`
  also stores, so the same fact lives in two columns. Mapping it at the port
  boundary is real-adapter work and is on the backlog.
- **The executor lease is tested against an injected ordering, not real
  concurrency.** See the Cycle 2 section for the full statement of what that
  does and does not establish.

## 8. Progress and timeline

```
✅ Implementation complete (23/23 modules)
   • shared-contracts, data-model, classroom-provider-interface ✓
   • fixture-seed-data (F1–F14), mock-classroom-provider, post-enumerator ✓
   • auth-module, preflight-engine, transfer-engine ✓
   • transfer-job-api, courses-api, monetization-middleware, cold-start-health ✓
   • composition-root (+ job-reconciler), quality-budgets ✓
   • frontend-api-client, ui-shared-components ✓
   • ui-sign-in-account-picker, ui-selection, ui-preflight-actionsheet ✓
   • ui-transfer-progress, ui-completion-summary, app-shell ✓
   • Full verify recipe: npm test ✓  npm run build ✓  npm run lint ✓
```

**QA & QC timeline (from engineer handoff):**
- Standard Mode (with approval gates): ~1–1.5 weeks to ship (QA → gate → QC → ship)
- Beast Mode (auto-accept): ~2–3 days of stage runtime (QA and QC back-to-back,
  no inter-stage gates; the final ship decision still needs a human)
- **Variance factors:** the architecture's estimate assumed a Playwright E2E
  suite; QA will need to drive the browser itself for the flows that would have
  covered, which is the main way this could run long. Offsetting that, the
  reconciliation invariant, the totality of the outcome function, and the
  evidence-based interruption recovery all now have executable gates, so QA can
  corroborate rather than re-derive them.

## 9. Next handoff

QA → verifies the implementation against `01`–`04` and the 18 acceptance
scenarios in `02`. Notes for QA:

- **Start with the three gates that carry the run's promise**, all runnable
  directly: `npm run test:budget:reconciliation`, `test:budget:totality`,
  `test:budget:reconcile`. If those hold, "zero silent drops" holds structurally
  and not just in prose.
- **Acceptance Scenario #8's ">15 min idle" precondition is superseded** by "any
  unresolved call exceeding 2s" (D29). Test the built behaviour.
- **The fixture manifest is F1–F14.** F8/F9/F11 are properties of F1; F10 is the
  two seeded accounts; F12 is F4 plus a run-scoped provider option. Cold start
  still has **no fixture** and must not be treated as fixture-certified.
- The one thing worth adversarial attention: the itemized log's "Skipped by you"
  tile. It should be impossible to make it count a system skip — try.
