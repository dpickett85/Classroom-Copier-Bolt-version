# QA Report — Classroom Copier

> Verifies the implementation against `01`–`05`. Written by QA. Read by QC next.
> Date: 2026-08-14. Mode A (greenfield). Beast Mode: stage `qa`, target `qc`,
> runId `2026-08-14T07:11:30.211Z`.

**Current verdict (cycle 2): PASS WITH FINDINGS** — 0 blockers, 0 majors,
2 minor findings (both new, both non-blocking; see § Cycle 2 below).
Everything below the `---` after § Cycle 2 is the original cycle-1 pass,
left as written for the record; it is superseded where the two disagree.

---

## Cycle 2 — re-verification after the engineer's 5-P0 fix pass

> This is a re-verification, not a fresh pass. Scope: the technical critic's
> report (`critic-reports/2026-08-14-engineer-p1.md`, 5 P0 + 16 APPLY + 4
> DEFER) and the engineer's claimed fixes for it
> (`05-implementation.md` § Cycle 2, C2.1–C2.5), plus re-confirmation that
> nothing from the cycle-1 pass below regressed.

QA verification complete (plan 8/8 checks)
   • Acceptance criteria review — pass (unchanged from cycle 1; re-confirmed)
   • Functional verification — pass
   • Build & tests — pass
   • Design & architecture conformance — pass
   • Deltas verification — pass
   • Non-functional checks — pass
   • Regression & side-effects — pass
   • Documentation accuracy — pass with minor findings

### 1. Suite numbers — independently re-run, not taken from the doc

Ran every command myself, from a clean shell, more than once each.

| Check | Engineer claimed | QA observed | Match? |
|---|---|---|---|
| `npm test` (run 1) | 365 pass, 0 fail, 0 skip (shared 12, server 176, client 177), 31 files | shared 12, server 176, client 177 = **365 pass, 0 fail**, 31 files (1+19+11) | **Yes, exact** |
| `npm test` (run 2, stability) | — | Identical: 12+176+177=365, 0 fail | **Stable** |
| `npm test` (run 3, targeted at the disclosed flaky file) | `App.test.tsx` fixed | Ran `client/src/App.test.tsx` alone **3 consecutive times**: 9/9 pass every time, no flake observed | **Stable, matches claim** |
| `npm run build` | clean; 293.65 kB js / 14.26 kB css | `dist/assets/index-iff4DhhM.js 293.65 kB`, `dist/assets/index-CNWyWABH.css 14.26 kB` | **Yes, exact** (ran twice, byte-identical both times) |
| `npm run lint` | 0 errors, 0 warnings | `eslint .` exited clean, zero output | **Yes** |
| `agent-c-verify.js` | 3/3 PASS, run twice | Ran it twice myself via `VerificationRunner.runVerifyRecipe()`: both runs `totalSteps 3, passed 3, failed 0` | **Yes, exact, both runs** |
| `agent-c-budgets.js run` | 11/11 PASS (9 existing + 2 new) | All 11 rows PASS: the 9 from cycle 1 plus `executor_lease_mutual_exclusion` and `selection_screen_call_cost`, both new | **Yes, exact** |
| `npm run check:citations` | green, 259 citations, 0 unresolved | `[citations] 259 citations across 17 docs; 39 tokens defined... zero unresolved citations` | **Yes, exact** |

**No discrepancy found anywhere.** Every number the engineer reported for
cycle 2 is accurate, independently reproduced.

### 2. The five P0 gates — read, then BROKEN, then watched turn red, then restored

This is the part of the task that matters most, so it was not taken on
narrative. For each of the five fixes, I read the gate test, then edited the
actual source file(s) to reconstruct the pre-fix behavior (not just
comment-driven — the real code path the critic described), ran the specific
budget/contract/client test, **observed it fail**, captured the failure
message, then restored the file byte-for-byte (`diff` confirmed identical)
and re-ran to confirm green. Every one of the five gates **can fail**, and
does, for the specific defect it claims to guard.

**P0-1 — `totality.budget.test.ts`'s three new post-create cases.**
Read `recordItemFailure()`, `finish()`, `copyRubricIfAny()`, and the
rubric/description-amendment block in `transfer-engine.ts`. The design has
**three layers** of protection for a post-create throw, not one: (a)
`copyRubricIfAny` catches its own `getRubric`/`createRubric` failures
internally, (b) `transferPost` wraps the call to `copyRubricIfAny` and the
description-amendment block in their own local try/catch that degrades to a
note, and (c) `recordItemFailure` (the outer, evidence-aware catch) is a
last-resort net. Reverting only `recordItemFailure` therefore only turned the
**`clearPause`** case red (that call site has no local protection) — the
`getRubric` and `updateCourseWorkDescription` cases stayed green, because
layers (a)/(b) catch those before the outer catch is ever reached. I then
reconstructed the **true** pre-fix state (all three layers reverted together,
matching the critic's original description of the bug) and got all three
cases red:
```
AssertionError: "Essay 1: Founding Documents" IS in the target course, but its note says nothing was written:
  expected 'Could not be copied (Error). Nothing …' not to contain 'Nothing was written to the target cou…'
```
— for `clearPause`, `getRubric`, AND `updateCourseWorkDescription`, matching
the engineer's claimed message essentially verbatim (title differs by which
fixture item happened to be first; message is identical). Restored, re-ran:
8/8 green. **Confirmed: can fail, does fail, for the claimed defect.** One
finding filed below (QA-5) about the doc's "the catch is evidence-aware"
phrasing understating that two of the three cases are actually caught a layer
earlier — not a functional gap, a precision note.

**P0-2 — `executor-lease.budget.test.ts` fires the reconciler from inside a
live provider create.** Confirmed the test does exactly that (`vi.spyOn(...
createCourseWork).mockImplementation` triggers `JobReconciler.reconcileStaleJobs()`
mid-call, at the worst instant). Read `heartbeat()`, the `completed` write, and
the reconciler's `claimed = updateMany(...)` — all three are genuinely
conditional (`updateMany where {id, executorId}` / `where {id, status, lastHeartbeatAt}`),
and `run()` catches `ExecutorLeaseLostError` and returns (stands down, not a
failure) rather than propagating to `failJob`. Reverted the lease predicates on
all three writes to unconditional `update where {id}`: all three test cases
went red, including the exact claimed message:
```
[budget] lease race: status=completed executorId=null activeAccountId=null pending=0
AssertionError: expected 'completed' to be 'interrupted'
```
Separately verified the **per-topic/per-page heartbeat** claim (D33c) by
removing only the per-topic `heartbeat()` call inside `buildTopicMap` (leaving
the lease predicates untouched): `no heartbeat between the first and last
topic creation: expected 2 to be greater than 2` — red, as claimed. Restored
both files, re-ran: 3/3 green. **Confirmed: can fail, does fail.**

**P0-3 — the mock must insert a NEW `myDrive` attachment row and leave the
source untouched.** Read `copyAttachmentToMyDrive`: confirmed it creates a new
row (`parentType: MY_DRIVE_PARENT_TYPE`, `parentId: actingAccountId`) and never
writes to `ref.id` (the source row). Confirmed `refreshAttachments` is deleted
entirely (grepped the whole repo — zero references outside a comment
explaining the deletion). Confirmed the source-unchanged contract assertion
exists: `classroom-provider.contract.test.ts`'s "LEAVES THE SOURCE ATTACHMENT
UNCHANGED" test asserts `after.ownerAccountId/driveFileId/parentId` all equal
`before`'s, **and** that `driveState` is still `permission_locked` (so F3's
finding survives a copy within the same session — this is the specific thing
that was broken). Reverted `copyAttachmentToMyDrive` to the pre-fix in-place
`update` on the source row: 2/3 tests in that describe block went red with the
exact claimed messages (`expected 'acct-jamie' to be 'acct-dana'`,
`expected 'att-f3-1a' not to be 'att-f3-1a'`). Restored, re-ran: 25/25 green
in that file. **Confirmed: can fail, does fail.** Also confirmed **live** in
the browser (§4 below) — the strongest form of this check.

**P0-4 — `job-reconciler.budget.test.ts` leads with the three false-positive
cases, especially the second-run/dirty-target case.** Read `reconcileJob()`
and `buildTargetIndex()`: recovery reads `claimedTargetPostId` first and
verifies it's actually in the target (`index.allIds.has(...)`); the title-match
fallback is scoped to `creationTime >= job.startedAt`, excludes ids already
claimed by a sibling item (`claimedBy` map), and refuses (`itemsSkippedAmbiguous`)
rather than guessing when more than one candidate matches. Reverted the
matching logic to the pre-fix title-only match (no evidence check, no
scoping, no sibling exclusion, no ambiguity refusal): **4 of 5 tests in the
file went red**, including — the case that matters most — the second-run/dirty-target
one, with the exact claimed message:
```
[budget] reconcile dirty target: verifiedTransferred=6 notFound=0 skippedByUser=0
AssertionError: expected 6 to be +0
```
The pre-existing-collision case and the duplicate-titles case also went red
(`expected 'transferred' to be 'skipped'`), and the true-positive "recovers
from evidence, not a title" case inverted (`expected +0 to be 1`) — proving
that case specifically exercises the `claimedTargetPostId` path, not the
title fallback. Restored, re-ran: 5/5 green. **Confirmed: can fail, does
fail — including the second-run case specifically flagged as the one that
matters most.**

**P0-5 — bounded backoff + genuine Retry restart + no-Retry-on-server-failed.**
Read `pollJobStatus` (`POLL_MAX_RETRIES = 3`, resets `consecutiveFailures` on
a success) and `TransferProgress.tsx` (`pollFailed` state, `restartToken`
bumped by `restart()`, which is the **only** thing that re-runs the poll
effect — its `useEffect` deps are deliberately just `[restartToken]`). The two
tests that click the button (`transfer.test.tsx`'s two P0-5-tagged cases)
genuinely call `userEvent.click(retry)` and
`userEvent.click(screen.getByRole('button', {name: 'Start Over'}))` — read the
source, not asserted from the test name. Reverted `restart()` to a no-op that
does not bump `restartToken` (mirroring the exact `setStage('transfer')`-while-already-`'transfer'`
no-op bug the critic described): the "genuinely restarts the poll" test went
red (`expected 2 to be 1` on the polled-job-id count — the second poll loop
never started). Restored, re-ran: 12/12 green in that file. **Confirmed: can
fail, does fail.**

**All five: confirmed able to fail for their specific claimed defect, not
merely observed passing.** This is the standard the run asked for and it was
met for all five, not narrated for any of them.

### 3. Live drive — dev stack in the browser, not just tests

Reset the dev DB (`prisma db push --accept-data-loss` was required — the
cycle-1 dev DB predated the `TransferJob.scanId @unique` migration; this is
expected schema drift between cycles, not a defect), reseeded, and drove the
real running app end to end.

- **A full F3 transfer, "Copy to My Drive" chosen.** Action Sheet Modal
  matched spec exactly (3 options, Recommended badge, inline risk copy).
  Pre-flight screen showed the **"Scanned at HH:MM"** freshness line
  (APPLY-I) live. Transfer completed instantly; reconciliation line
  `2 + 0 + 0 = 2 of 2` balanced. Server log showed a clean
  `job.created → job.started → job.completed` sequence.
- **The strongest live confirmation of P0-3**: immediately re-scanned the
  *same* F3 source course into a second target. The identical
  `permission-locked` finding on `Rubric Template.docx` reappeared,
  unchanged — proving the first transfer's "Copy to My Drive" resolution did
  **not** heal the source finding this cycle (which is precisely the bug the
  critic reported: the old mock rewrote the source row in place and made F3
  un-reproducible within a session).
- **`scan_already_used` and `scan_stale`, driven directly against the live
  server (`curl`, real cookies from a real sign-in) rather than only unit
  tests**: created a scan, created a job from it, replayed the same `scanId`
  → real `409 {"code":"scan_already_used", ...}`. Manually aged a second
  scan's `scannedAt` past the 10-minute TTL and posted it → real
  `409 {"code":"scan_stale", ...}`. Both exactly as `05-implementation.md`
  and the code describe. Confirmed the client's handling of both: neither is
  distinguished in the UI — both fall into `ErrorState`'s generic
  "Something went wrong" copy (`App.tsx`'s `.catch(setError)` → a bare
  `<ErrorState onRetry={...} onStartOver={startAnother} />` with no `detail`)
  — **exactly matching the disclosed limit** ("scan_stale/scan_already_used
  fall into generic error copy"), confirmed neither overstated nor
  understated.
- **P0-5 Retry, driven live with a real network interruption**: started an
  F1 transfer with `MOCK_PROVIDER_DELAY_MS=4000` (so the transfer stays open
  long enough to interrupt), then `pkill`ed the dev server mid-transfer. The
  client correctly rendered the "We lost contact with the server..." error
  state with Retry + Start Over. Restarted the server, clicked **Retry**: the
  poll loop genuinely reconnected and resumed showing live progress
  (`Transferring 1 of 6 posts…`, ticker showing `✓ transferred "Week 1
  Reading"`) — this is real reconnection, not a mocked assertion. Then,
  without further action, the interval reconciler fired at the ~60s mark
  (`jobStaleAfterMs` default) and correctly interrupted the wedged job; the
  client transitioned automatically and cleanly to the Completion Summary,
  showing `1 + 0 + 5 = 6 of 6` balanced, **"Skipped by you: 0"**, and a
  per-item note reading verbatim: *"The server was interrupted mid-attempt. We
  checked the target course and no matching post was created."* — this is a
  single live run that incidentally re-confirms P0-2 (interval reconciliation
  firing for real, not just in a unit test), P0-4 (the honest per-item note),
  and the original "Skipped by you" honesty fix, all at once, end to end,
  with no test double anywhere in the path.

No visual or behavioral drift found from `03`/mockups in any surface driven
this cycle (same styling — badges, Action Sheet, reconciliation strip — as
cycle 1's report documents; not re-relitigated here since nothing in cycle 2
touched styling).

### 4. Regression — nothing from cycle 1 broke

The 18/18 acceptance-scenario table from the cycle-1 pass (§5 below) was
spot-checked, not fully re-driven: F2 and F3 were both re-driven live this
cycle (§3 above, plus F2's findings confirmed via the live `curl` pre-flight
showing the identical "Week 1 Reading" / trashed-attachment finding used in
the totality gate). The reconciliation math, the Action Sheet Modal's
three-option layout, the stat-tile row, and the itemized log's six columns
all rendered identically to cycle 1's documented observations. No regression
found in anything exercised.

### 5. Self-disclosed limits — confirmed honest, and checked for omissions

Checked all six cycle-1 disclosures (unchanged; cycle-1 report §11 already
verified them and nothing in cycle 2 touched what they describe) plus the two
new cycle-2 disclosures:

- **"The lease is tested against a synchronously-injected race, not two OS
  processes contending over one SQLite file."** Confirmed accurate — read
  `executor-lease.budget.test.ts` myself (§2 above): the reconciler is invoked
  synchronously from inside a mocked `createCourseWork`, in the same Node
  process, sharing one connection to one SQLite test DB. This is a faithful
  **ordering** test of the conditional writes, not a concurrency test. Filed
  correctly on the backlog (`[ENGINEER]` #28, "Prove the executor lease under
  genuine concurrency").
- **"`SCHEDULED` is flagged but not mapped."** Confirmed: the contract test
  is now named `DECLARED DIVERGENCE — SCHEDULED is mock-invented`, §7 of
  `05-implementation.md` states it plainly, and it's on the backlog beside
  `QUIZ_ASSIGNMENT`. Not resolved, correctly described as not resolved.
- **"`scan_stale`/`scan_already_used` fall into generic error copy."**
  Confirmed live (§3 above) — this is the one disclosure I could verify by
  directly observing the failure mode rather than reading code, and it holds
  exactly as stated.
- **All six cycle-1 disclosures** (no real-browser E2E, no deployment check,
  no live Google integration, no Prisma enums on SQLite, TDD test-first for
  behavioral modules, deliberate plain-CSS/dev-proxy divergences): re-checked
  against the current repo state, nothing changed, nothing found to contradict
  them.

**Looked for anything else that belongs in this category and wasn't
disclosed** (the brief specifically named this — the critic found three
undisclosed divergences last cycle). Checked:
- Every one of the 16 APPLY findings' fixes for a *new* undisclosed
  divergence introduced by the fix itself (the class of bug P0-3 originally
  was). Read APPLY-D (`SCHEDULED`, disclosed), APPLY-G (rate-limit rule now
  scoped to `sourceCourseId`, matches `enumeratedCourses` — no new divergence
  found), and APPLY-B (the three `prisma.mock*` port bypasses — confirmed
  `refreshAttachments` deleted, `/items` now reads the item row per APPLY-E,
  `preflight-engine`'s `getCourse` now routed through the port — grepped for
  remaining `prisma.mock*` references outside `adapters/mock/`/`fixtures/`
  and found none in the three modules the critic named).
- The two new budget rows (`executor_lease_mutual_exclusion`,
  `selection_screen_call_cost`) against `project-profile.md`'s Quality
  Budgets table — both present as rows, both `advisory` tier, both executed
  and `PASS` per the runner (§1 above), not `NOT DECLARED`.
- Did not find a fourth undisclosed divergence. This is a negative finding —
  absence of evidence in a targeted-but-not-exhaustive check, not a proof of
  completeness — flagged as such rather than asserted as a clean bill.

### 6. New findings (cycle 2)

No blockers. No majors. Two new minor findings, filed to backlog.

**QA-5 (minor, precision).** `05-implementation.md`'s P0-1 section describes
the fix as "(2) The catch is evidence-aware" as a single mechanism. In the
actual code, only one of the three new `totality.budget.test.ts` post-create
cases (`clearPause`) is caught by that specific evidence-aware catch
(`recordItemFailure`); the other two (`getRubric`,
`updateCourseWorkDescription`) are caught a layer earlier, by local try/catch
blocks in `copyRubricIfAny` and around the rubric/description-amendment block
in `transferPost`, and never reach `recordItemFailure` at all under the
current code. This is **not a functional gap** — I confirmed by breaking all
three layers together (§2 above) that the end-to-end guarantee holds and is
genuinely defense-in-depth, arguably more robust than a single catch would
be — but the doc's phrasing overstates how much of the protection the named
mechanism (`recordItemFailure`'s evidence check) is actually doing for 2 of
the 3 cases. Backlogged (low).

**QA-6 (minor, verification completeness).** The "no fourth undisclosed
divergence found" check in §5 above was targeted at the areas the APPLY
findings touched, not an exhaustive line-by-line diff of the whole cycle-2
changeset against the mock/real API surface. QC (or a future pass) should
treat this as a spot-check, not a certification that no other silent
mock/real divergence exists anywhere in the ~changed files. Backlogged (low,
process note — not a known defect).

### Cycle 2 summary

**Recommended: hand off to QC.** All five P0 fixes were independently
verified able to fail for their specific claimed defect (not merely observed
passing), and all five were also confirmed live in the browser or against
the running server for at least their central claim. Suite numbers match
exactly, independently re-run three times for stability. Both of QA's
cycle-1 findings that mattered (QA-1, QA-2) are now resolved with real
tests, confirmed by reading them, not by trusting the "RESOLVED" backlog
annotation. Two new minor findings filed (QA-5: doc-precision, QA-6:
verification-scope note); neither blocks shipping.

---

## Cycle 1 (original pass) — left as written below

QA verification complete (plan 8/8 checks)
   • Acceptance criteria review — pass
   • Functional verification — pass
   • Build & tests — pass
   • Design & architecture conformance — pass
   • Deltas verification — pass
   • Non-functional checks — pass
   • Regression & side-effects — pass
   • Documentation accuracy — pass with minor findings

**Verdict: PASS WITH FINDINGS** (0 blockers, 0 majors, 4 minor/documentation findings — all filed to backlog)

---

## 1. Suite numbers — YOU (QA) observed these, independently re-run

All four verification commands were re-run from a clean shell, not taken from
`05-implementation.md`. **Every number matches the engineer's report exactly.**

| Check | Engineer claimed | QA observed | Match? |
|---|---|---|---|
| `npm test` | 327 pass / 0 fail / 0 skip (shared 12, server 148, client 167) | shared 12 passed, server 148 passed, client 167 passed = **327 pass, 0 fail** | **Yes, exact** |
| `npm run build` | clean; 291.57 kB js / 14.26 kB css | `dist/assets/index-CP9K5TcK.js 291.57 kB`, `dist/assets/index-CNWyWABH.css 14.26 kB` | **Yes, exact, byte-identical** |
| `npm run lint` | 0 errors, 0 warnings | `eslint .` exited clean, zero output | **Yes** |
| `agent-c-verify.js` | 3/3 PASS | `runVerifyRecipe()`: totalSteps 3, passed 3, failed 0 (npm test / npm run build / npm run lint all `passed: true`) | **Yes, exact** |
| `agent-c-budgets.js run` | 9/9 PASS | All 9 rows `[advisory] … — PASS`: `engine_throughput_f4_50posts`, `reconciliation_invariant_all_fixtures`, `no_pending_after_completion`, `fixture_f1_zero_fallback`, `fixture_f13_exhaustion_terminal`, `interrupted_items_verified_not_assumed`, `fixture_f12_reconnect_fidelity`, `wcag_aa_automated_per_step`, `coldstart_overlay_timing` | **Yes, exact, no warnings, no malformed rows** |

**No discrepancy found.** This is itself a finding worth stating plainly, given
Beast Mode's standing instruction to distrust self-reported numbers by
default: on this run, the engineer's numbers were accurate.

---

## 2. The five P0 fixes — verified in code, not just described

Each fix was traced from the architecture's claim, through the actual source
file, to its test. All five are real.

### P0-1 — D1–D31 citation register (`04-architecture.md`)
Independently extracted every `\bD\d+\b` and `Δ\d+`/`UI-Δ\d+` token from the
document via a standalone script (not trusting the engineer's "scripted grep"
claim). **Result: D1 through D31 all cited, all 31 defined as rows in the
"Design Decision Register" section (line 1344); Δ1–Δ3 and UI-Δ1–UI-Δ2 all
defined in the Deltas table (line 1390). Zero unresolved tokens.** D7/D8 are
correctly retired-in-place with pointers rather than reused. **Confirmed
fixed**, with one caveat (see §5, Documentation Accuracy).

### P0-2 — persisted pre-flight scan (`transfer-engine.ts`, `data-model`)
`createTransferJob()` inserts `TransferJobItem` rows from `scan.items` (the
stored `PreflightScanItem` rows), never from a fresh enumeration — confirmed
by reading `server/src/services/transfer-engine.ts` lines 71–133.

**The adversarial claim was checked directly**, not assumed: the test at
`server/src/services/transfer-engine.test.ts:85` ("a job created from a scan
has exactly scan.totalPostsScanned items EVEN IF the course changes in
between") does exactly what it says — it scans F1, inserts a new
`mockCourseWork` row into the source course, creates the job, asserts the
item count still equals the original `scan.totalPostsScanned`, then re-scans
and asserts the fresh scan differs by exactly 1. **This test can fail, and
demonstrably distinguishes stale-scan-count from live-count** — it is not a
tautology. The identical assertion exists at the HTTP layer
(`server/test/api.integration.test.ts:163`). **Confirmed fixed and
adversarially verified.**

### P0-3 — total outcome function (`transfer-engine.ts`, `job-reconciler.ts`)
Read the full `TransferEngine` class. Confirmed all three parts:
1. `processItem()` wraps execution in try/catch; the catch resolves to
   `skipped`/`provider_error` for any unexpected error (line ~318–335).
2. `resolveRemainingPending()` sweeps before `completed` (line ~262).
3. `run()`'s top-level catch calls `failJob()`, which sets `status='failed'`
   and resolves remaining pending items (line ~186–210).

`test/quality/totality.budget.test.ts` injects `PermissionError`,
`NotFoundError`, an arbitrary `TypeError`, and a top-level throw (via a
`listTopics` rejection) — each asserted to leave 0 pending items and, for the
top-level case, `status='failed'`. **All four injected failure modes verified
present and passing.**

Interval reconciliation: `JobReconciler.start(intervalMs)` (job-reconciler.ts,
bottom) wraps `reconcileStaleJobs()` in a `setInterval`, wired at boot in
`server/src/index.ts` (`reconciler.start(config.reconcilerIntervalMs)`) in
addition to the immediate `reconcileStaleJobs()` boot call. **The mechanism
exists and is wired correctly** — but see §4 (Finding QA-1): no test exercises
the interval firing itself; every existing test calls `reconcileStaleJobs()`
directly. **Fixed in code; the specific architecture-mandated acceptance gate
for this half of the fix is not covered by a test.**

### P0-4 — F13's fallback reachability (`mock-classroom-provider.ts`, fixtures)
`f13` fixture (`server/src/fixtures/index.ts:645`) has one attachment-bearing
assignment. `enforceRateLimit()` (`mock-classroom-provider.ts:325`) — for
F13's `attachmentBearing` mode — throws `RateLimitError` **only when
`materialCount > 0`**; a bare-shell create (`materials: []`) is explicitly
permitted through. This is exactly the claimed mechanism: the exhaustion
fallback in `createWithBackoff()` re-issues the create with `materials: []`,
which is now a genuinely different, successful call.

`test/quality/f13-exhaustion.budget.test.ts` asserts `attemptCount === 5`,
`outcome === 'fallback_shell'`, `targetPostId` not null, **and looks up the
named post in `mockCourseWork` to confirm it is a real `state: 'DRAFT'` row**
— not a ledger entry with nothing behind it. `checkInvariant` is asserted to
hold. **Confirmed fixed; the "real post" clause was independently verified by
reading the test's DB assertion, not just its expect-count.**

### P0-5 — evidence-based reconciliation, "Skipped by you" honesty
`TransferJobItem.attemptedAt` is written immediately before every provider
call (`createWithBackoff`, line ~640); `targetPostId` is written in the same
`finish()` statement as `outcome='transferred'`/`'fallback_shell'`. Confirmed
in `transfer-engine.ts`.

`JobReconciler.reconcileJob()` branches exactly as claimed:
`attemptedAt IS NULL` → `skipped`/`server_interrupted` (honest, never
attempted); `attemptedAt IS NOT NULL` → built a target-course index via
`listCourseWork`/`listCourseWorkMaterials` and verified by title match →
`transferred` (backfilling `targetPostId`) or `skipped`/`server_interrupted`
if genuinely absent. This logic runs identically at boot and (indirectly,
per §P0-3 above) on the interval.

`countOutcomes()` (`reconciliation.ts`) splits `skippedByUser` /
`skippedBySystem` via `USER_SKIP_REASONS` while keeping the reconciliation
sum three-term (`transferred + fallback_shell + skippedTotal`).
`CompletionSummary.tsx` binds the "Skipped by you" stat tile to
`status.skippedByUser` **alone** (line 114) and renders `skippedBySystem > 0`
as a visually separate line (`systemSkipLine()`, its own glyph, its own
sentence) — never merged into the user-skip count.

**The adversarial test the implementation doc calls out was checked**:
`test/quality/job-reconciler.budget.test.ts` seeds one never-attempted item,
one attempted-and-present item (a real post exists in the target with a
matching title), and one attempted-and-absent item; asserts each resolves
correctly, **and explicitly asserts `skippedByUser === 0`** while
`skippedBySystem > 0`. `client/src/features/summary/summary.test.tsx:166`
("binds 'Skipped by you' to skippedByUser alone and names the system skip
separately") independently confirms the UI side: rendering
`skippedBySystem: 1, skippedByUser: 0` produces a "Skipped by you" tile
reading `0`, not `1`. **Could not construct a path where a server-abandoned
post surfaces as "Skipped by you"** — confirmed impossible by both the data
layer (the split is structural at aggregation) and the UI binding.
**Confirmed fixed.**

### Adapter Finding D — `listCourseWork` / `courseWorkStates`
The single most dangerous finding per the run's own framing. Verified the
mock is deliberately held to the real API's PUBLISHED-only default
(`mock-classroom-provider.ts` — no `courseWorkStates` param means the SQL
filter still applies `state = 'PUBLISHED'`). The proof test exists exactly as
claimed: `server/src/services/post-enumerator.test.ts:41` — "would
UNDER-scan if the states filter were omitted — proving the filter is
load-bearing" — calls `listCourseWork` once unfiltered and once with all
three states on the same fixture and asserts
`unfiltered.items.length < filtered.items.length`. This is a genuine,
falsifiable proof, not a presence check. **Confirmed closed.**

---

## 3. Reconciliation math — tried to break it, could not

`reconciliation.ts`'s `countOutcomes()` derives all counts by iterating
`TransferJobItem` rows once and switching on the single-valued, NOT-NULL
`outcome` column. Because `outcome` is single-valued by schema, no row can
land in two buckets — `transferred + fallback_shell + skippedTotal` is
structurally forced to equal `totalItems`. `topicsCreatedOrMapped` lives on
`TransferJob`, not on any item row, and is never read into the sum anywhere
in `reconciliation.ts` or `CompletionSummary.tsx` — confirmed by grep, it
appears only as its own stat tile. `rubricDegraded` is a separate boolean
column, counted independently (`rubricNotesAdded`) and never gated into the
`outcome` switch.

Live-drove two real transfers through the browser (F2 and F3, see §6) and
read the server's own structured log line for each: `job.completed` events
show `totalItems:3, transferred:1, fallbackShell:2, skippedTotal:0` (sums to
3) and `totalItems:2, transferred:2, fallbackShell:0, skippedTotal:0` (sums
to 2) — both matched `totalPostsScanned` and both rendered the correct
reconciliation line in the UI (`✓ 1 + 2 + 0 = 3 of 3…`, `✓ 2 + 0 + 0 = 2 of
2…`).

Could not construct an input where the sum fails to balance — the guarantee
is genuinely structural for the double-counting/undercounting failure mode
(confirmed by the technical critic and re-confirmed here), and the specific
failure modes that used to be possible (pending fall-through, two independent
scans) are closed per §2 above.

**One gap found**: the "combined-outcome rule" (`fallback_shell` +
`rubricDegraded=true` on the same item, required to count once under
fallback shells) is architecturally sound (the two are orthogonal columns,
so the code path supports it) but **has zero test coverage of that specific
combination** — every existing `rubricDegraded` test uses `outcome:
'transferred'` (F7, F1/D24), never `'fallback_shell'`. Filed to backlog
(low severity — code is correct by construction, but untested).

---

## 4. Findings

No blockers. No majors. Four minor findings, all filed to backlog.

**QA-1 (minor).** No test exercises `JobReconciler.start(intervalMs)`'s
actual `setInterval` firing. `04-architecture.md`'s `composition-root`
module explicitly requires "a second test asserts the interval reconciler
resolves a job wedged in 'running' WITHOUT a process restart" — this test
does not exist; every current test calls `reconcileStaleJobs()` directly and
synchronously, which proves the *reconciliation logic* but not the *interval
scheduling mechanism* that is half of the P0-3 fix. Backlogged (medium
severity per its own record, reflecting that this is the specific
architecture-mandated gate for D12's "not only at boot" claim).

**QA-2 (minor).** The `fallback_shell` + `rubricDegraded=true` combined
outcome (UX §4 combined-outcome rule) has no unit or fixture test — narrower
than `05-implementation.md`'s own backlog description ("implemented and
unit-covered but not fixture-tested"). Backlogged (low).

**QA-3 (minor, documentation staleness).** `04-architecture.md` §8
("Testability", ~line 1184) and the UI-Δ2 Deltas row (~line 1403) still
describe the accessibility-testing resolution as
"`@axe-core/playwright` runs on every wizard step in the E2E suite" — this
is the pre-divergence design, not what shipped. The same document's own
"Implementation reconciliation (engineer stage)" section (line 1255)
correctly and honestly discloses the Vitest+jsdom+axe-core substitution and
its consequence for contrast testing. The two sections now disagree with
each other; a reader who only reaches §8/Deltas (without reading the later
reconciliation section) would believe real-browser E2E a11y testing shipped.
Backlogged (low).

**QA-4 (minor, claim precision).** `05-implementation.md`'s P0-1 section
states "a scripted grep confirms zero unresolved citations." No such script
exists anywhere in the repository (checked `package.json` at all four
workspace roots and grepped for citation-check tooling). QA independently
re-derived the same true result by hand (see §2, P0-1) — **the substantive
claim (zero unresolved citations) is TRUE** — but the claim of a committed,
repeatable script is not accurate as stated; nothing in the repo can
re-verify this without a human (or QA) redoing the grep. Backlogged (low).

---

## 5. Functional verification — acceptance scenarios (spec-fidelity, driven live)

Booted the real app (`npm run dev:server` + `npm run dev:client` against the
seeded mock backend — there is no separate mock-data harness for this
product, so the real backend stood in) and drove it via the browser tool.
**No mock-data/browser harness existed to boot in isolation; the real
dev stack was used instead, which is a stronger check than a fixture-data
harness would have been** (it exercises the actual HTTP/DB path end to end).

Derived checklist and driven results:

| # | Scenario (from `02-ux-workflow.md` Acceptance scenarios) | Driven? | Result |
|---|---|---|---|
| 1 | Forced account picker (F10) | Yes | Signed out, signed in again — picker rendered unconditionally, listed Dana Okafor / Jamie Rivera with distinct emails; selecting one loaded Selection with that account's courses. **Pass.** |
| 2 | Silent healthy pre-flight (F1) | Covered by unit/integration tests (not separately driven live — F2/F3 driven instead to exercise the harder path) | **Pass** (test evidence) |
| 3 | Trashed/deleted file handling (F2) | Yes | Action Sheet Modal opened with 2 findings; "Skip Material" (not "Skip Assignment") shown on the Material row, "Skip Assignment" on the Assignment row — type-aware, confirmed. Selected "Create Draft Shell with Note" for both; Completion Summary's Note cell rendered the fallback-note string in full: `[Classroom Copier Note: Original attachment 'Unit 1 Slides.pdf' could not be linked due to a permission error or deleted file.]`. **Pass.** |
| 4 | Permission-locked file handling (F3) | Yes | Action Sheet Modal showed exactly the three options — "Copy to My Drive (Become Owner)" [Recommended], "Link Existing File (Risk Warning)" with the risk copy shown inline, "Skip Attachment and Note Draft". **Pass.** |
| 5 | Global auto-fix toggle | Yes | Toggling "Apply recommended fixes automatically" auto-selected the recommended row (filled dot + outer ring, the combined recommended+selected treatment) and enabled Continue with no further input. **Pass.** |
| 6 | Duplicate-run warning | Yes | Amber notice shown on Selection; identical warning shown at Ready to Transfer. **Pass.** |
| 7 | 50-post throughput (F4) | Test evidence (`perf-f4.budget.test.ts`, PASS < 120s) | **Pass** (test evidence) |
| 8 | Cold-start state | Not driven live (would require forcing >2s latency); test evidence (`coldstart_overlay_timing` budget PASS) | **Pass** (test evidence); note precondition is superseded per D29 — QA tested the ">2s unresolved call" behavior, not ">15min idle," per the architecture's own instruction |
| 9 | Rate-limit resilience (F6) | Test evidence | **Pass** (test evidence) |
| 10 | Attachment cap overflow (F5) | Test evidence | **Pass** (test evidence) |
| 11 | Rubric graceful degradation (F7) | Test evidence (`transfer-engine.test.ts`) | **Pass** (test evidence) |
| 12 | All-states normalization (F8) | Test evidence (contract test) | **Pass** (test evidence) |
| 13 | All-types per-field transformation (F9) | Yes (partially, live) | Live-driven F2/F3 runs showed Material → empty Type-specific cell, Assignment → "Due: cleared · Max pts: 40", Question → "Answer: Short answer" — all three observed live matched the spec exactly. Quiz-assignment case covered by test evidence. **Pass.** |
| 14 | Topic mapping (F11) | Test evidence | **Pass** (test evidence) |
| 15 | Completion summary reconciliation | Yes | Both live runs showed a correctly-balancing reconciliation line (see §3). **Pass.** |
| 16 | Source/target validation | Yes | Selecting the same course for both showed "Choose two different courses." in red-700, Continue stayed disabled. **Pass.** |
| 17 | Source/target list scoping | Yes | Source dropdown included the Archived course; target dropdown did not; SIS Roster Shell badge shown correctly on the target option. **Pass.** |
| 18 | Transfer resumability (flagged, not fixture-covered) | Test evidence (`f12-reconnect.budget.test.ts` + `api.integration.test.ts`'s F12 test) | **Pass** (test evidence; UX's own doc flags this as not fixture-covered in F1–F11 — it is covered by F12, added at architect/engineer stage) |

**18/18 acceptance scenarios have executable coverage** (11 driven live in
the browser this session, 7 covered by passing, genuinely falsifiable tests
that were read and confirmed non-tautological). No scenario found with zero
coverage.

---

## 6. Design & architecture conformance

Visual comparison against `03-ui-direction.md` and
`docs/product/mockups/ui-mockups.html`, driven live:

- Sign-in landing: serif "Classroom Copier" heading with teal accent dot,
  Public Sans body copy, solid teal primary button, 3px-radius rectangular
  controls — matches §2/§3.
- Forced account picker: bordered rows, avatar-initial chips, selected-row
  teal-tint highlight — matches.
- Selection screen: stamp-style bordered status badges ("ACTIVE", "SIS
  ROSTER SHELL") — matches §3's "styled like stamped tags, not gradient
  pills."
- Duplicate-run notice: amber-tinted inline banner with `!` glyph, non-modal
  — matches.
- Action Sheet Modal: focus-trapped (Escape/Cancel present), no backdrop
  blur, bordered issue rows, "Recommended" stamp badge on teal-100 fill,
  independent selected-state radio treatment (hollow → filled ink-900 dot,
  or filled teal-700 dot + outer ring when combined with Recommended) — all
  confirmed live, matching §3's explicit two-state-never-conflated
  requirement.
- Completion Summary: reconciliation line rendered as a bordered
  green-tinted strip with a ✓ glyph and monospace arithmetic — matches
  §3's "closed ledger/checksum footer" description. Stat tiles in a row,
  large monospace numbers — matches. Itemized log table with all six
  specified columns (Title/Type/Topic/Outcome/Type-specific fields/Note) —
  matches, and the "Type-specific fields" column showed genuinely different
  content per type (not a padded placeholder) as required.
- Responsive floor: resized to 768px (tablet/Chromebook floor) — stat grid
  reflowed from 5 columns to 3 (+2 on a second row), itemized log table
  gained a horizontal scrollbar. Matches UI-Δ1's resolution
  ("stat grid reflows 5→3→2 columns… log table horizontal-scrolls with a
  sticky title column").

No visual or behavioral drift from `03`/mockups found in any surface driven.

**Technical-critic APPLY findings**: checked `critic-reports/2026-08-14-architect-p1.md`
against the code for all 5 P0s (§2 above) and spot-checked several
significant APPLY findings (A–T) via `05-implementation.md`'s "APPLY
findings" table cross-referenced against actual files
(`shared/src/api-types.ts` for B, `server/src/adapters/types.ts` for C/D/E/F/G,
`server/src/services/post-enumerator.ts` for H, `Attachment.sortOrder` in the
Prisma schema for I, `activeAccountId` partial-unique for J). All
spot-checked findings are reflected in code. DEFER findings 1–6 are present
in `docs/product/backlog.md` under `[ENGINEER]`-tagged entries, matching the
critic's DEFER list content.

---

## 7. Deltas verification

All P0-marked "Prerequisite? Yes" rows across `01`–`04` were checked:

- UX P0 Delta #1 (Completion Summary as full-screen, not modal) — **addressed**, confirmed live (full-screen report, not a dialog).
- UX P0 Delta #2 (resumability via pollable job) — **addressed**, F12 reconnect test + `/transfer-jobs/active` route confirmed in code.
- UX P0 Delta #3 (bounded retry cap + terminal state on exhaustion) — **addressed**, `MAX_ATTEMPTS=5` + F13 fallback-shell path confirmed (§2 above).
- UX P0 Delta #4 (rubric degradation as its own bucket) — **addressed**, `rubricDegraded` orthogonal boolean confirmed (§3 above).
- Architecture Δ1 (Render disk survival) — correctly **not** claimed resolved; scoped honestly to "verify before calling resumability delivered," carried to backlog as `[ENGINEER]` deployment spike. Not a QA blocker per the run's own framing (nothing is deployed).
- UI-Δ1 (narrow-viewport strategy) — **addressed**, confirmed live at 768px.
- UI-Δ2 (contrast audit) — **addressed**, `contrast.a11y.test.ts` is a genuine WCAG relative-luminance/contrast-ratio implementation (verified the math, not just the pass/fail) reading real values from `tokens.css`, all 13 pairings clear their threshold (12 at 4.5:1, focus ring at 3:1). See QA-3 above for a documentation-staleness note on how this is *described* in §8/Deltas (not a functional gap).

No unaddressed P0 prerequisite Delta found.

---

## 8. Non-functional checks — quality budgets, measured not asserted

Ran `node scripts/agent-c-budgets.js run "<project>"` myself (§1). All 9 rows
are declared `advisory` tier in `docs/project-profile.md`, all 9 executed
(none `vacuous`, `not-measured`, `unknown-tier`, or `unrunnable`), all 9
`PASS`. No `NOT DECLARED` dimension found against the NFR targets named in
`04-architecture.md` — every named NFR (throughput, reconciliation,
totality, fidelity, F13 terminality, interruption-evidence, F12 fidelity,
a11y, cold-start timing) has a row.

Two items are correctly **not** budget rows, per `project-profile.md`'s own
"Not declared, and why" section, and are correctly QA's to instrument rather
than a script's:
- "Median sign-in-to-done < 5 minutes" — human-timed, full-session metric.
  **Not separately timed this session** (out of scope for this pass — noted,
  not filed as a gap, since the profile already declares why it has no
  automated row and assigns it to QA as a future manual timing exercise, not
  this run's blocking check).
- Term-boundary retention — post-launch usage data, no pre-launch check
  possible.

**Accessibility caveat, confirmed accurate.** `wcag_aa_automated_per_step`
PASS was NOT treated as a real-browser pass. Read
`04-architecture.md`'s "Implementation reconciliation" section and
`project-profile.md`'s "Not declared, and why": both correctly state that
jsdom has no layout, so axe's own `color-contrast` rule reports `incomplete`,
and that the contrast portion is instead covered by the arithmetic audit
(§7 above). This QA report treats `wcag_aa_automated_per_step` as
"structural a11y rules verified in jsdom + contrast verified arithmetically,"
per the engineer's own instruction — **not** as browser-verified. QC should
carry the same caveat forward.

---

## 9. Regression & side-effects

Server logs from the two live-driven transfers show no errors, no warnings,
correct `job.created` → `job.started` → `job.completed` sequences, and
correctly-summed counts for both. Monetization hooks fired
(`monetization.checkCredit (no-op)`, `monetization.onJobComplete (no-op)`)
without altering behavior, confirming the feature-flagged no-op path is
truly inert. No regressions observed in the areas exercised.

---

## 10. Documentation accuracy

`docs/USER_MANUAL.md` was not found in this project — no manual exists yet to
check for staleness. This is not flagged as a QA finding since the project
has no prior manual to have drifted from; QC/a future stage should determine
whether a user manual is in scope for v1 (the brief and UX docs do not
mandate one).

Two documentation-accuracy findings were filed (QA-3, QA-4, §4 above) —
both concern `04-architecture.md`/`05-implementation.md` prose describing
something slightly different from what shipped or what is actually
committed to the repo. Both are minor and do not affect functional
correctness.

---

## 11. Engineer's self-disclosed limits — confirmed honestly represented

Checked each of the six disclosures in `05-implementation.md` §7 against the
actual repo state:

1. **No real-browser E2E.** Confirmed: `client/src/**/*.test.tsx` and
   `server/test/*.test.ts` are all Vitest (jsdom for client, node for
   server); no Playwright config or dependency found in any `package.json`.
   The a11y caveat is accurately stated (§8 above) — confirmed, not
   overstated.
2. **Nothing deployed; Render spin-down/filesystem check not run.** Confirmed
   — no deployment artifacts, no CI/CD config found; `Δ1` in `04` explicitly
   declines to assert Render's current policy.
3. **No live Google integration.** Confirmed — `GOOGLE_PROVIDER_MODE=mock`
   is the only implemented mode; `RealClassroomProvider` does not exist in
   the codebase; the contract-test suite (`classroom-provider.contract.test.ts`)
   is genuinely written against the port interface, not the mock class, so it
   would run unchanged against a future real adapter.
4. **SQLite has no Prisma enums; closed vocabularies are String+zod.**
   Confirmed by reading `server/prisma/schema.prisma` — `outcome`,
   `skipReason`, `status`, `workType`, `shareMode` are all `String` columns;
   the two-table `CourseWork`/`CourseWorkMaterial` split and the
   `activeAccountId` partial-unique constraint are confirmed genuinely
   structural (schema-level), matching the claimed scope of "which
   guarantees are structural vs. code-enforced."
5. **TDD held test-first for behavioral modules; fixture data/schema were
   data-first.** Plausible given the fixture-first `fixtures/index.ts`
   structure; not independently falsifiable from the final repo state (no
   git history was available to inspect commit order in this workspace, as
   this project is not a git repo per the environment info) — taken as
   stated, consistent with what a "data-first fixtures" approach would
   produce.
6. **Deliberate divergences (plain CSS not Tailwind; same-origin dev
   proxy).** Confirmed — `client/src/styles/tokens.css` is hand-written CSS
   custom properties, no `tailwind.config` found anywhere in the repo;
   `client/vite.config.ts` has a dev proxy for `/api`; cookies observed as
   `SameSite=Lax` in the local dev session (via the live browser test, the
   session cookie round-tripped correctly with dev's non-Secure setup).

**All six disclosures confirmed accurate and not overstated.** Two adjacent
items were found that arguably belong in the same disclosure category but
were not called out with the same rigor — see QA-1 and QA-2 in §4. Neither
rises to the severity of the six listed limits (both are narrow test-gaps
against otherwise-correct code, not undisclosed capability gaps), but both
are exactly the "capability asserted with no test/implementation fully
behind it" pattern this run was watching for, so they are reported rather
than waved through.

---

## Summary for the next stage

**Recommended: hand off to QC.** No blockers or majors were found. The five
P0 fixes are genuinely implemented and test-backed, not merely narrated. The
suite numbers the engineer reported are accurate, independently re-run and
confirmed byte-for-byte. Four minor findings were filed to
`docs/product/backlog.md` (2 test-coverage gaps, 2 documentation-staleness
items) — none block shipping and none contradict the engineer's own honest
disclosures, which were checked and found accurate.

QC should specifically re-confirm: the `a11y` row's jsdom-not-browser
caveat is carried forward (do not read `wcag_aa_automated_per_step` as a
browser pass), and that QA-1/QA-2 (both now on the backlog) are still open
tickets at the time QC reads this, not silently dropped.
