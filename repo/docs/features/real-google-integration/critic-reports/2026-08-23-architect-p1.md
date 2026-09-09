TECHNICAL CRITIC REPORT — Architect — Pickett Classroom / real-google-integration

Artifact: docs/features/real-google-integration/04-architecture.md (artifactKind: architecture)
Also reviewed: diagrams/oauth-cold-start-sequence.md, diagrams/token-failure-pause-resume-sequence.md
Code read: server/src/services/transfer-engine.ts, reconciliation.ts, job-reconciler.ts,
  config.ts, session.ts, server/test/quality/courses-list.budget.test.ts,
  f12-reconnect.budget.test.ts, shared/src/api-types.ts, server/tsconfig.json,
  git show 0694779:{package.json,server/package.json,server/tsconfig.json}
Pass: 1 (single pass — owning stage auto-applies; no second pass)
Status: ISSUES FOUND

Issues found: 14 (2 P0 APPLY, 6 significant APPLY, 3 minor APPLY, 3 DEFER)

Action:
  Architect auto-applies all APPLY findings without HITL review.
  DEFER findings go to backlog.md.
  HITL reviews the final result at QA.

Headline: **Delta P0-B is resolved, and the answer is negative.** `execute()` is not
re-entrant, and the same false premise is load-bearing under Decision F *and*
Decision C. Decision C's duplicate pre-resolution fails on the FIRST run, not only
on resume — the feature's headline promise is currently a no-op that logs an ERROR
per duplicate. Decision H is accurate about `0694779`'s contents but its module
boundary cannot deliver its own acceptance gate.

---

## Criterion-by-criterion

| # | Dimension | Verdict |
|---|---|---|
| 1 | Engineering best practices | Pass — ADR table is genuinely justified against named drivers; alternatives are real and rejected with reasons |
| 2 | Upstream consistency (01/02/03 + verified facts) | Pass with one gap (F5) — no contradiction with `google-api-facts-verified.md`; Decision C passes explicit `courseWorkStates` AND `courseWorkMaterialStates` correctly |
| 3 | Prior-artifact coherence | Issue — F6 (UI P0 Delta's field is designed but its only mechanism is unowned) |
| 4 | Correctness & soundness | **Issue (P0)** — F1, F2 |
| 5 | Completeness | Issue — F3, F6, F8 |
| 6 | Seam & interface integrity | **Issue** — F3, F5, F6, F7 |
| 7 | Risk, operability & quality budgets | Issue — F8 (5 unbound rows), F9 |
| 8 | Accessibility | Pass at the budget level (`wcag_aa_automated_per_step` exists and is arithmetic); F14 deferred |
| 9 | Oversights | Issue — F7, F9 |

**Edge-basis check (always-on): PASS.** All 14 `dependsOn` edges across the 10
modules carry an admissible correctness basis — file-target overlap (e.g.
`datasource-postgres` → `build-restoration` via `server/package.json`;
`transfer-ui-extensions` → `signin-ui-rebuild` via `tokens.css`/`api-client.ts`)
or a contract dependency stated in the dependent module's own `intent`
(`real-classroom-provider` → `google-auth-core` for `token-crypto` decryption;
`token-failure-resume-engine` → `real-classroom-provider` for the `AuthExpiredError`
class; `deployment-config`'s four `runtimeDependency: false` edges for env-var
enumeration). No unsupported edges.

---

## F1 — [P0 · APPLY] `execute()` is NOT re-entrant. Delta P0-B is answered: negative.

The architect flagged this as unverified (Risk #9, Delta P0-B, Assumptions bullet 2)
and asked for it to be checked. Checked. **Three independent non-idempotent
behaviors** in `server/src/services/transfer-engine.ts`:

**(a) The item loop has no `outcome` filter.** Lines 476–489:

```ts
const items = (await this.prisma.transferJobItem.findMany({
  where: { jobId },                       // <-- no `outcome: 'pending'`
  orderBy: { createdOrder: 'asc' },
  select: { id, scanItemId, sourceType, sourceId, title, createdOrder },
})) as ItemRow[]
```

`outcome` is not even selected. On re-entry, every already-`transferred` item is
re-fed to `processItem()` → `transferPost()` → `createWithBackoff()` and **a real
duplicate post is created in the teacher's destination course.** `finish()`'s
`where: { id, outcome: 'pending' }` predicate (line 1147) then refuses the write and
logs `refused to overwrite an already-terminal item outcome` at ERROR.

This is the worst available failure shape: **the reconciliation ledger stays
balanced** (no item row changes) **while the destination course silently accumulates
duplicates.** `checkInvariant()` passes. Only the teacher sees it.

**(b) `buildTopicMap()` re-creates every topic.** Lines ~604–625 call
`this.provider.createTopic(targetCourseId, topic.name)` unconditionally for every
source topic, on every entry to `execute()`.

**Decision F's own fix does not close this.** The `token-failure-resume-engine`
module says to consult `topicReuseJson` before calling `createTopic` — but
`topicReuseJson` is copied from `PreflightScan` **at job creation**, i.e. a snapshot
of the destination as it stood at pre-flight time. Topics created by *this job's own
first pass* are absent from that map, so on resume they classify as *unmapped* →
`createTopic` again → duplicate topic, and `topicsCreatedCount` double-increments.

**(c) `copyAttachmentToMyDrive` re-runs.** `transferPost()` (line ~838) iterates
`resolution.copyToMyDriveIds` before any outcome check, so a resumed run re-copies
Drive files for every already-processed item.

### Required changes

1. Add `outcome: 'pending'` to the item `findMany` where-clause, and state it as an
   explicit build step in `token-failure-resume-engine`'s `intent` — not as an
   acceptance criterion the engineer is asked to *discover*.
2. Make topic-building resumable: either have `buildTopicMap` read the **live**
   destination topic list, or persist this job's own created-topic map back to
   `TransferJob.topicReuseJson` as topics are created so pass 2 sees pass 1's work.
   Specify `topicsCreatedCount` as set-from-map, not `increment` (the current code
   already sets: `heartbeat(lease, { topicsCreatedOrMapped: topicMap.size })`).
3. Correct **four** places that assert the false premise:
   - §4.2 "Resuming mid-job must be safe": *"`execute()` already iterates only over
     `outcome='pending'` items"* — false.
   - §6.1: *"which already only iterates `outcome='pending'` rows"* — false.
   - Assumptions bullet 2 and Delta P0-B — restate as a **found defect with a
     specified fix**, not an open verification task.
   - `diagrams/token-failure-pause-resume-sequence.md`: `execute() re-entered:
     resumes from<br/>first outcome='pending' item` and `...continues normally, no
     re-attempt of terminal items...` — both describe behavior the code does not have.

---

## F2 — [P0 · APPLY] Decision C creates the duplicates it exists to prevent, on the first run.

Same root cause as F1(a), but it bites on the **primary path**, not only on resume —
which makes it the more urgent half.

§6.1 and `token-failure-resume-engine`'s intent both specify that items whose
`PreflightScanItem.duplicateOfTitle IS NOT NULL` are inserted at job creation as
`TransferJobItem{ outcome:'skipped', skipReason:'duplicate_title' }`, "**pre-resolved
— they never reach `transfer-engine`'s per-item execute loop at all.**"

They reach it. Tracing a pre-resolved duplicate through `processItem()`:

- `resolution?.skipsPost` — a duplicate has no entry in `perPost` (built from
  `findingsJson`/`resolutionsJson`, and §6.1 explicitly keeps duplicates **out** of
  `findings[]`) → falsy, no early return.
- `if (!post)` — the source post exists → falsy, no early return.
- → `transferPost()` → **creates the duplicate in the destination course.**
- → `finish()` refuses (already terminal) and logs ERROR.

Net effect as specified: every duplicate is copied anyway, the counts still say
`skipped/duplicate_title`, and the only trace is an ERROR line. The feature reports
success while doing the exact thing it was built to prevent.

**Required change:** the `outcome: 'pending'` filter from F1(a) fixes both, but it
must be declared as an explicit, testable build step in `duplicate-topic-preflight`
*and* `token-failure-resume-engine`, and `duplicate-topic-preflight`'s acceptance
must add a case asserting that a pre-resolved duplicate item results in **zero
provider create calls** (call-count assertion, not an outcome assertion — the
outcome assertion passes today while the bug is live).

---

## F3 — [Significant · APPLY] `build-restoration`'s acceptance gate is unachievable inside its own fileTargets.

Acceptance: *"`npm run build --workspace=server` compiles with 0 errors."*
`server/tsconfig.json` (verified identical at `0694779` and HEAD) includes
`test/**/*.ts`, so all 19 baseline errors must clear. **Seven are in files this
module cannot touch:**

| Baseline error | File | Module that owns the file |
|---|---|---|
| `(10,8)` TS2307 interface path | `real-classroom-provider.ts` | `real-classroom-provider` (5th) |
| `(29/45/80/95/178)` TS7006 ×5 | `real-classroom-provider.ts` | `real-classroom-provider` (5th) |
| `(4,10)` TS2305 `sessionStore` | `routes/auth.ts` | `google-oauth-routes` (4th); `session.ts` is `google-auth-core`'s |

The other 12 do clear (`app.ts` ×4, `index.ts`, five test files' `buildApp`, and both
`googleapis` TS2307s via the dependency install) — Decision H is correct about those.

Separately: **`server/src/config.ts` is named twice in the intent** ("restore
`server/src/config.ts`'s SESSION_SECRET fail-fast pattern", "`TOKEN_ENCRYPTION_KEY`
and `DATABASE_PROVIDER` env vars threaded through config.ts") **but is absent from
`fileTargets`.**

**Required change (pick one):** add `server/src/adapters/google/real-classroom-provider.ts`,
`server/src/routes/auth.ts`, `server/src/services/session.ts` and
`server/src/config.ts` to `build-restoration`'s `fileTargets` with an explicit
compile-to-green instruction; **or** restate the acceptance as "12 of 19 errors clear
here (app.ts / index.ts / the five test files); the remaining 7 clear at
`google-auth-core`, `google-oauth-routes` and `real-classroom-provider`" and move the
zero-error gate onto `real-classroom-provider`. As written the engineer stalls on
module 1 with a gate it has no files to satisfy.

**Sequencing (checked, correct):** the lockfile regeneration *is* sequenced before
`npm ci` — `build-restoration`'s intent commits the regenerated lockfile, and §9.2
names the ordering explicitly ("the lockfile commit must land before either service's
build command is set to `npm ci`"). No finding.

**Root `build` script (checked, correct):** §9.1 restores it to
`shared → server → client`. Current HEAD is `shared → client` only. Correctly caught.

---

## F4 — [Significant · APPLY] `server/dist/index.js` is the wrong verification path.

`build-restoration` acceptance: *"verified by checking `server/dist/index.js` exists
after running it."*

`0694779`'s own `server/package.json` start script is
`node --env-file-if-exists=.env dist/server/src/index.js`, and `server/tsconfig.json`
sets `rootDir: "."` with `include: ["src/**/*.ts", "prisma/**/*.ts", "test/**/*.ts"]`
against a shared workspace — so the emitted entry point is
**`server/dist/server/src/index.js`**. An engineer checking `server/dist/index.js`
finds nothing and concludes the build failed.

**Required change:** use the same path the restored `start` script uses.

---

## F5 — [Significant · APPLY] Removing `POST /api/auth/sign-in` breaks four test files, two of them quality budgets — and `selection_screen_call_cost` is not "provably unaffected".

`google-oauth-routes`' intent: *"No `GET /api/auth/mock-accounts`, `POST
/api/auth/sign-in` (mock account picker), or account-picker routes in this file"*, and
§8.3 makes the unconditionality a deliberate feature: *"there is no runtime
`if (mode === 'mock')` branch to audit, because the code doesn't exist in that file."*

That removes the route in **test** mode too. `config.ts:48` defaults
`googleProviderMode` to `'mock'`, but no default resurrects a route that isn't
written, and §8.3's stated fallback ("`MockAccountDirectory`/`MockClassroomProvider`'s
own test-only wiring in composition-root") wires **providers**, not **routes**.

Verified callers of `POST /api/auth/sign-in`:

| File | Calls |
|---|---|
| `server/test/api.integration.test.ts` | 5 |
| `server/test/csrf.test.ts` | 1 |
| `server/test/quality/courses-list.budget.test.ts` | 2 |
| `server/test/quality/f12-reconnect.budget.test.ts` | 2 |

Both budget tests sign in on the **first line of every case**.

On the specific claim in Decision C's ADR row — *"`selection_screen_call_cost` is
provably unaffected"*: true of **what it measures** (I verified the new destination
reads live exclusively behind `POST /courses/:sourceId/preflight`; `GET /courses`
does zero post enumeration and the budget's assertions are untouched), but **false of
whether it runs**. §8.1's "re-asserted unchanged… its own test gains one new case" is
also undeliverable — **no module's `fileTargets` contains any test file.**

**Required change:** specify how mock sign-in survives for the test suite — a
test-only mounting path in the composition root, or an explicit
`config.googleProviderMode === 'mock'` route guard (which §8.3 currently rejects on
auditability grounds; if that rejection stands, the alternative must be named) — and
add the four test files to an owning module's `fileTargets`.

---

## F6 — [Significant · APPLY] Decision G's GROUP BY lives in `reconciliation.ts`, which no module owns and the doc never mentions.

`countOutcomes()` in `server/src/services/reconciliation.ts` is, by its own header
comment, *"the one implementation of the reconciliation arithmetic in the system."*
It computes the skip split as an **else-branch**:

```ts
counts.skippedTotal += 1
if (USER_SKIP_REASONS.includes(row.skipReason as SkipReason)) counts.skippedByUser += 1
else counts.skippedBySystem += 1
```

Adding `'duplicate_title'` to `SkipReasonSchema` without editing this file routes
every duplicate into **`skippedBySystem`**. Then
`skippedByUser + skippedBySystem + skippedDuplicate == skippedTotal + skippedDuplicate`
— the invariant UI §3.2 requires breaks, the 5-term `+ N interrupted` line
over-counts, and `systemSkipLine`'s copy ("N posts were interrupted before we could
confirm they copied") becomes false for duplicates — **the precise failure UI's P0
Delta was raised to prevent.** `OutcomeCounts` also has no `skippedDuplicate` field.

Neither `reconciliation.ts`, `countOutcomes`, nor `checkInvariant` appears anywhere in
`04-architecture.md` (grepped), nor in any module's `fileTargets`.

On the assignment's question — does `skippedDuplicate` hold
`transferred + fallback_shell + skipped == count(items)` including the 5-term form?
**The invariant's *shape* is correct as designed** (§5.2 is right that only
`skippedTotal`'s internal composition grows from two parts to three, and topics stay
outside it). **The mechanism to produce it does not exist in any module.**

**Required change:** add `server/src/services/reconciliation.ts` to
`token-failure-resume-engine`'s `fileTargets`; specify that `duplicate_title` is
carved out **before** the user/system split (not as a third `else`), that
`OutcomeCounts` gains `skippedDuplicate`, and that `skippedBySystem` continues to mean
exactly `provider_error` / `server_interrupted` / `rate_limit_exhausted` per UI §3.3.

---

## F7 — [Significant · APPLY] `AuthExpiredError` thrown outside the per-item catch lands the job in `failed`, not paused.

Decision F handles `AuthExpiredError` *"In the per-item catch"*. But two provider-call
phases run **before** the item loop and **outside** `processItem`'s try block:

- `buildTopicMap()` — `provider.listTopics()` and `provider.createTopic()`
- `enumeratePosts()` — the hydration enumeration

An `AuthExpiredError` from either propagates to `run()`'s top-level catch, which marks
the job **`failed`** — no `googleReauthRequiredAt`, no `googleReauthRequired` boolean,
no 4c interrupt banner, no resume path. The teacher gets a dead `failed` job with no
reconnect affordance.

This is not an edge case. Testing-status expiry is **guaranteed on a fixed 7-day
cycle** (verified facts §2), and job start is exactly when a near-expiry token is most
likely to be spent — see F9.

**Required change:** hoist pause-on-`AuthExpiredError` to cover the topic-build and
enumeration phases identically (they precede any item write, so the pause is strictly
simpler there: no item to mark `provider_error`), or state explicitly why they are
exempt and what the teacher sees when it happens.

---

## F8 — [Significant · APPLY] All five new quality-budget rows are unbound.

§8.1 adds five advisory rows, each naming a command:
`test:budget:dedupe`, `test:budget:preflight-scan-cost`, `test:budget:reauth-resume`,
`test:budget:reauth-grace`, `test:budget:no-tailwind`.

- `docs/project-profile.md` — which actually holds the `## Quality budgets` table
  (verified: 11 existing rows there) — is in **no module's `fileTargets`**. The rows
  never land in the table.
- The five `npm run test:budget:*` scripts are in no module's `fileTargets` either;
  `build-restoration`'s intent restores the v1 script set and adds none. **The five
  commands do not exist.**

That is criterion 7's exact "unbound row" failure — a measurement that will never
happen — five times over, plus the `selection_screen_call_cost` new case from F5.

**Required change:** add `docs/project-profile.md`, root `package.json`,
`server/package.json` and `client/package.json` to an owning module (most naturally
`deployment-config`, or a widened `build-restoration`), and say which module writes
each budget's test file.

---

## F9 — [P1 · APPLY] `accessTokenExpiresAt` is designed in and never read. Decision A guarantees a mid-transfer pause for any job started late in a session.

Decision A's justification is *"a standard access token (~1 hour) covers any realistic
batch."* The load-bearing quantity is not the token's full lifetime but its
**remaining** lifetime at job start — a job begun 55 minutes into a session has five
minutes. §5.1 designs `GoogleAccount.accessTokenExpiresAt` into the schema, and
**nothing in §4.2, §6.3, or any module reads it** (grepped: two mentions, both schema
declarations).

The result is that Decision F's pause-and-resume — correctly designed as an exception
path — becomes the *routine* outcome for late-session jobs, with the interrupt landing
at item 3 rather than before the teacher commits.

**Required change:** specify a pre-job token-lifetime check at `POST /transfer-jobs`
(or on the Ready-to-Transfer screen): if `accessTokenExpiresAt` is within N minutes,
surface the same "Reconnect Google account" affordance **before** the job starts. This
uses a column the design already pays for and converts a guaranteed mid-transfer
interrupt into a pre-flight one.

**On Decisions A and F agreeing (assignment question 4):** they do agree, and
`fixture_f12_reconnect_fidelity` still holds — I read the budget: F12 is a **client**
disconnect/reconnect against a job that continues server-side and never
re-authenticates, so it needs nothing from the token. Decision A does not remove a
credential Decision F assumes. **But §5.1 asserts this agreement without naming the
budget that tests it** — add the citation, because "resumability" means two different
things in v1's guarantee (browser disconnect) and Decision F (credential expiry), and
only the second is token-dependent.

---

## F10 — [Minor · APPLY] Decision H's server script count is off by two.

§9.1: *"restore all ten `test:budget:*` scripts pointing at
`test/quality/*.budget.test.ts`"* (server). `server/package.json` at `0694779` has
**eight**; the remaining two (`a11y`, `coldstart`) are **client** scripts. The **root**
has ten. An engineer restoring "ten" into the server hunts for two that never existed
there. Everything else in §9.1's dependency enumeration is accurate against the commit
(`@prisma/client 6.19.3`, `express ^5.2.1`, `zod ^4.4.3`, `jsonwebtoken ^9.0.2`,
`prisma 6.19.3`, `supertest ^7.1.1`, `engines.node >= 20`, `type: module`) — verified.

## F11 — [Minor · APPLY] Module count stated inconsistently.

The MDB declares **ten** modules. "Next handoff" says *"nine modules across two
largely-independent tracks"*; Delta P0-B says it *"does not block the other eight
modules"*. Should read ten and nine.

## F12 — [Minor · APPLY] Post-pause `TransferJob.status` is never specified.

Decision F says release `executorId`, keep `activeAccountId`, set
`googleReauthRequiredAt` — but never states what `status` becomes. It happens to work:
`status` stays `'running'`, and `execute()`'s lease claim is
`where: { id, status: { in: ['queued','running'] }, executorId: null }`
(transfer-engine.ts:434–436), so `resume()` re-claims cleanly. The engineer should not
have to derive that from the lease predicate. State it in §4.2.

---

## DEFER (→ backlog.md)

**F13 — `datasource-postgres` acceptance needs infrastructure the project has no norm
for.** *"`DATABASE_PROVIDER=postgresql npm run -w server db:push` (against a real or
dockerized Postgres)"* — against a documented "no CI/CD build-out beyond what deploy
needs" norm, with no Docker anywhere in the repo. Either name the provisioning step or
downgrade to "the generated `schema.prisma` parses under `prisma validate` for both
providers", which is checkable with no server.

**F14 — a11y budget vs. the brand-mandated Google button.**
`wcag_aa_automated_per_step` audits *"every token pairing"* arithmetically. §8.4 /
`signin-ui-rebuild` adds `.google-signin-btn` with *"Google's exact colors"* — brand-
mandated and not free to adjust. The design doesn't say whether that pairing is in
scope or carries a documented exemption. Not the critic's arithmetic to perform; the
budget's owner needs a stated answer before it runs.

**F15 — Decision I's `db push` trade-off is honestly stated but its failure mode is
not.** §5.4 names the trade-off clearly and cites the correct upgrade path — that part
is genuinely well done, and **per-file SQLite test isolation is preserved** (verified:
dev/test stay on the `sqlite` branch and `server/test/helpers/db.ts`'s per-test-file
copy pattern is untouched by the template split). What is missing is the *failure
mode*: `prisma db push` on a non-empty production database will refuse or prompt on a
destructive change, and on boot there is no operator at the prompt. Name what happens
when a column is dropped or narrowed against live Render Postgres data.

---

## What holds up well

- **Decision C's query mechanics are correct against the verified facts.** Both
  `courseWorkStates: ['DRAFT','PUBLISHED']` **and** `courseWorkMaterialStates:
  ['DRAFT','PUBLISHED']` are passed explicitly, on both surfaces, against the
  destination — the PUBLISHED-only default trap is closed on both API surfaces, not
  just the one most docs mention. Same-surface key composition
  (`sourceType + ':' + normalizeTitle(title)`) is a genuinely better answer than a
  precedence rule, because it makes cross-surface collision unrepresentable rather
  than merely checked.
- **Decision H's enumeration against `0694779` is accurate** on every dependency and
  version I checked, and correctly identifies the two real deltas (`googleapis`,
  `google-auth-library`) plus the root `build` script gap. The lockfile-before-`npm ci`
  sequencing is explicit. Its problem is module *boundary* (F3), not content.
- **Decision E is honest.** The unclosable callback-processing window is named rather
  than mitigated-to-zero on paper, the two closable legs are correctly identified, and
  the diagram shades exactly the right segment. The Back-button analysis ("structurally
  moot, not merely handled") is correct — the authorization code genuinely never
  reaches the frontend URL.
- **MDB acceptance criteria (assignment question 7): genuinely checkable, with three
  exceptions.** Most name a command, a fixture, or a specific assertion —
  `real-classroom-provider`'s *"passes with zero test-file changes beyond the
  instantiation line"* and `signin-ui-rebuild`'s *"fails against the pre-rewrite tree
  (proven, not asserted)"* are exemplary: falsifiable, and they'd catch the thing they
  exist to catch. The three that are restatements of intent rather than checks: F13
  (`datasource-postgres`), `deployment-config`'s self-attested *"reviewed… as a manual
  checklist item in the engineer's own report"*, and `signin-ui-rebuild`'s *"both SVGs
  at their intended small size (not 898px)"* — which names a failure value but no
  passing target and no command. The estimator can price against this block, with the
  caveat that F3/F6/F8's unowned files (`reconciliation.ts`, `docs/project-profile.md`,
  four test files, three package.json files) are real work the MDB does not currently
  declare.
