# TECHNICAL CRITIC REPORT — Architect — Pickett Classroom (Classroom Copier)

Artifact: `docs/product/04-architecture.md` (1123 lines), `docs/product/diagrams/{03-components,04-transfer-sequence,05-data-model,09-deployment}.md`
Upstream reviewed: `01-pm-brief.md` (rev 2), `02-ux-workflow.md` (rev 2), `03-ui-direction.md`, `wireframes/`, `docs/project-profile.md`, `state.json` (17 architect decisions), `backlog.md`
`stages.architect.artifactKind`: `architecture` → criteria 2/3 apply as written.
Pass: 1 (single pass — engineer auto-applies; no second pass)
Status: **ISSUES FOUND**

Issues found: **5 P0**, 21 significant/minor APPLY, 6 DEFER.

Action:
  Engineer auto-applies all APPLY findings without HITL review.
  DEFER findings go to `backlog.md`.
  HITL reviews the final result at QA.

---

## Verdict on the three claims this review was asked to verify

| Claim | Verdict |
|---|---|
| Zero-silent-drop enforced structurally (NOT-NULL single-valued enum, pending-row-before-attempt, GROUP BY, orthogonal `rubricDegraded`) | **Half true.** The schema genuinely makes *double-counting* unrepresentable. It does **not** make *fall-through* unrepresentable — `pending` is a fourth representable state with no declared exit for non-429 failures (P0-3), and the identity `count(items) == totalPostsScanned` rests on two separate scans in two separate requests (P0-2). The guarantee is structural against one failure mode and prose against three. |
| `CourseWork` / `CourseWorkMaterial` as separate Prisma tables | **True and correctly implemented.** ER diagram, module intent, acceptance gate (`a unit test asserts CourseWorkMaterial has no dueDate/maxPoints columns at the type level`), and the provider's separate `create*` methods all agree. Driver 5 is honoured. No finding. |
| Fixture honesty (F12 = F4 + slow-mode flag, F13 new, cold-start = harness not fixture) | **True for F12/F13/cold-start — and the cold-start disclosure is exemplary.** But the *recurring defect recurred elsewhere in the same document*: see P0-1. Also two real fixture gaps (F1 rubric-success path, F12's flag has no schema home). |

**The recurring defect is present, for the fourth time.** It did not reappear where it was being watched for. It reappeared as a cross-reference scheme (P0-1) and as an arithmetic identity that is asserted "by definition" while being produced by two independent measurements (P0-2).

---

# P0 findings (blocking)

## P0-1 — The `D1`–`D10` citation scheme references nothing. **APPLY**

*Criterion 5 (completeness), 6 (seam integrity), 9 (oversights). This is the recurring defect, fourth occurrence.*

`04-architecture.md` cites delta labels `D1`–`D10` **26 times**, including **8 times inside the machine-parsed `agent-c:modules` YAML block** that feeds the engineer's dispatch planner:

| Cite | Line | Context |
|---|---|---|
| D2 | 192, 324, 593 | `data-model`, `transfer-engine` intents; §4 |
| D1 | 194, 428 | `data-model`, `composition-root` intents |
| D5 | 196, 345, 589, 642, 756, 75 | `data-model`, `transfer-job-api` intents; §4; §6 REST table |
| D3 | 219, 879 | `fixture-seed-data` intent; §9 |
| D9 | 234 | `classroom-provider-interface` intent |
| D10 | 238 | `classroom-provider-interface` intent |
| D6 | 322, 951 | `transfer-engine` intent; Risks |
| D4 | 449, 635 | `frontend-api-client` intent; §4 |
| D7 | 786 | ADR consequences |
| D8 | 835 | §8 Testability, cited as "UI's carried-forward Delta D8" |

**Neither this document's Deltas table nor `03-ui-direction.md`'s Deltas table carries any `D`-identifiers.** Both are unlabeled `| P0/P1 | … |` rows (5 rows here, 3 rows in the UI doc). `state.json` contains no `D`-labels either — verified by grep across all three sources. Six of the ten labels (`D1`, `D2`, `D4`, `D5`, `D9`, `D10`) do not correspond to any Deltas row anywhere; they are inline design decisions never enumerated under those names. `D8` cites a UI-doc row number that does not exist.

This is exactly the phantom-`F: cold-start sim` defect in new clothing, and it is materially worse than its predecessors because the citations sit **inside the module declarations**, which are dispatched verbatim to sub-agents. A sub-agent building `data-model` receives the instruction "TransferJobItem is inserted at pending before any provider call is attempted (D2) … A partial unique index enforces at most one non-terminal TransferJob per accountId (D5)" with no resolvable referent for either label, in a context where the *specifics* (which statuses count as non-terminal — see P0/APPLY-J) are exactly what the label was standing in for.

**Fix:** Add a numbered **Design Decision Register** section (D1–D10) immediately before the Deltas table, giving each label one sentence and a pointer to its governing §, and renumber the Deltas table rows with their own distinct prefix (e.g. `Δ1`–`Δ5`) so architecture deltas and inline design decisions do not share a namespace. Re-label `D7`/`D8` as `UI-Δ1`/`UI-Δ2` since they refer to another document's rows. Every citation must resolve, including the eight inside the YAML block.

---

## P0-2 — `totalPostsScanned` and `count(items)` are produced by two separate scans, in two separate HTTP requests. **APPLY**

*Criterion 4 (correctness), 6 (seams). This invalidates the headline structural claim.*

The document's load-bearing sentence (§4 step 1, repeated in §5 and the reconciliation ADR):

> inserts one `TransferJobItem` row per scanned post as `pending` **in the same transaction, before any provider call is attempted** (D2 — this ordering is what makes "total posts scanned = count(items)" true by definition, not by convention)

The ordering claim is correct but is **not the claim that matters**. Inserting-before-attempting makes `count(items)` stable against a *crash*. It does nothing about the fact that the two numbers come from two different measurements:

- `totalPostsScanned` is produced by `POST /api/courses/:sourceId/preflight` (§6 REST table: "returns findings + `totalPostsScanned`"), executed by `preflight-engine` against `listCourseWork` / `listCourseWorkMaterials`.
- `count(items)` is produced later by `POST /api/transfer-jobs`, which must re-enumerate the source course to know how many rows to insert. Nothing persists the pre-flight scan; there is no `scanId` in the request body (`{sourceCourseId, targetCourseId, resolutions[]}`), no `PreflightScan` table in the ER diagram, and no module owns carrying one scan's result to the other.

So `count(items) == totalPostsScanned` is **true by convention** — the convention being "we ran the same query twice and expected the same answer." It is falsified by any pagination inconsistency between the two calls, and — per §6's own warning about `nextPageToken` — a scan that under-counts is "a scan-time silent drop the reconciliation invariant (item-level) cannot itself detect, because a post never scanned never gets a row." The architecture identifies this hazard, then builds the system so that it happens twice with no cross-check.

The `transfer-engine` acceptance gate asserts `count(items) == totalPostsScanned`, but with both sides derived from the same in-process fixture read inside a unit test, the assertion cannot fail. It is a tautology in the test and an unenforced assumption in production.

**Fix:** Persist the pre-flight scan. Add a `PreflightScan` table (`id`, `accountId`, `sourceCourseId`, `targetCourseId`, `totalPostsScanned`, `scannedAt`) plus a `PreflightScanItem` row per enumerated post (`sourceType`, `sourceId`, `title`, `type`, `topicId`, `createdOrder`). `POST /api/transfer-jobs` takes `{scanId, resolutions[]}`; the job's `TransferJobItem` rows are inserted **from the stored scan rows**, not from a fresh provider enumeration. Then `count(items) == totalPostsScanned` really is definitional — one measurement, two readers. Add `scanId` to the REST contract, add the table to `data-model`'s intent and ER diagram, and add an acceptance gate asserting that a job created from a scan has exactly `scan.totalPostsScanned` items even when the underlying course changes between the two calls.

---

## P0-3 — No declared exit from `pending` for any failure that is not a 429. The job can hang forever. **APPLY**

*Criterion 4 (correctness), 7 (risk/operability). This is the fall-through the enum does not close.*

`transfer-engine`'s intent enumerates exactly three exits from `pending`:

1. provider write succeeds → `transferred`
2. 429, backoff exhausted after 5 attempts → `fallback_shell`
3. pre-flight resolution says skip → `skipped`

The provider interface declares four error types (§6-A): `RateLimitError`, `PermissionError`, `NotFoundError`, `LicenseBlockedError`. **Only `RateLimitError` has a declared outcome path.** A `PermissionError` or `NotFoundError` thrown from `createCourseWork` — or any unexpected exception (a Prisma `SQLITE_BUSY`, a null deref in the per-type payload builder, a JSON parse failure on `answerConfig`) — has no specified handling. The item stays `pending` and the three terminal buckets sum to less than `count(items)`. The claimed invariant does not hold, and the sequence diagram confirms it: the `alt` block at `04-transfer-sequence.md` lines 28–46 has branches for success, 429, and pre-resolved-unhealthy, and **no `else`**.

Worse, the containment is only at boot. If the async promise chain rejects, `TransferJob.status` stays `running` with a stale `lastHeartbeatAt` **while the process is still alive**. The boot-time reconciliation pass (`composition-root`) never fires because there is no boot. There is no in-process watchdog, no `.catch()` contract on the executor, and no cancel control (UX Decision 13: "No mid-transfer cancel in v1"). The client polls a frozen counter indefinitely; `frontend-api-client`'s 60s ceiling only covers an *unresolved HTTP call*, not a *successfully-answered poll reporting no progress*. The user is stuck on a progress bar that will never move and cannot be dismissed.

`TransferJob.status` includes `failed` in the ER diagram — a value **nothing in the document ever assigns**. It is the obvious home for this.

**Fix, three parts:**
1. **Total the outcome function.** State in `transfer-engine`'s intent that the per-item executor is wrapped in a `try/catch` whose catch clause resolves the item to a terminal outcome — `fallback_shell` for anything where a shell post was successfully created, `skipped` with a distinct reason (`provider_error`, carrying the error class) otherwise — and that **no code path may leave an item `pending` after the job's item loop completes**. Add an acceptance gate: inject a `PermissionError` and an arbitrary `Error` from the mock and assert both items reach a terminal outcome and the reconciliation sum closes.
2. **Sweep before completing.** Before writing `job.status=completed`, assert `count(items WHERE outcome='pending') == 0`; if not zero, resolve the stragglers and log. This is the last line of defence that makes the invariant hold for real.
3. **In-process watchdog.** The executor's top level gets a `.catch()` that marks the job `failed` and resolves all remaining `pending` items. Additionally, run the stale-heartbeat reconciliation on an interval (not only at boot) so a wedged job self-heals, and define what the client renders for `status=failed` (UX's generic catch-all error state, §5 — currently wired only to non-2xx responses).

---

## P0-4 — F13's definition makes the "guaranteed draft-shell fallback" unreachable, and its own quality budget unsatisfiable. **APPLY**

*Criterion 4 (correctness), 2 (upstream consistency). A capability asserted in prose with no mechanism behind it.*

`fixture-seed-data` defines F13 as:

> a course containing one item whose **mock provider call ALWAYS returns 429 regardless of attempt count**, exhausting all 5 backoff attempts

`transfer-engine` and §4 step 2 then specify the terminal behaviour:

> on exhaustion (F13) the item falls through to the **guaranteed draft-shell fallback** … and resolves `fallback_shell`

And `04-transfer-sequence.md` line 41 makes the mechanism explicit: `TE->>MP: createCourseWork (guaranteed draft-shell fallback)`.

**The fallback is executed by the same provider call that just refused five times, on a fixture defined to always refuse it.** The sixth call 429s exactly like the first five. The item cannot reach `fallback_shell`, and the declared quality budget `fixture_f13_exhaustion_terminal` (`attemptCount == 5, outcome == fallback_shell`) is unsatisfiable as specified. "Guaranteed" is a word in a paragraph; there is no mechanism under it.

This also exposes an unstated conflation: the draft-shell fallback is well-defined for *attachment* failures (drop the attachment, create the post with a note — the post still succeeds) but incoherent for *API-level* failures (the thing that failed is post creation itself). The document uses one term for both.

**Fix — pick one and state it explicitly in both `fixture-seed-data` and `transfer-engine`:**
- **(a) Scope F13's 429 to attachment-bearing creates.** Redefine F13: the mock 429s any `createCourseWork` call carrying `materials[]`, but permits a bare-shell create (no attachments). The fallback then genuinely succeeds and produces a real post with the rate-limit-exhaustion note. This preserves both the "guaranteed shell" promise and the brief's zero-silent-drop semantics, and it is the recommended option — a real Classroom 429 is a quota condition, not a permanent per-item refusal, so a lighter retry succeeding is also the more faithful simulation.
- **(b) Accept that no post can be created** and give the item a terminal outcome that says so honestly. This requires a skip reason (`rate_limit_exhausted`) under the `skipped` bucket and a correction to `fixture_f13_exhaustion_terminal`, to §4 step 2, to the sequence diagram, and to UX Delta P0-3's settled behaviour ("resolve that single item as a fallback/skip").

Whichever is chosen, the shell-creation call must be described distinctly from the primary create (different payload, stated retry policy), and the sequence diagram must show what happens if *it* fails.

---

## P0-5 — A crash after the provider write succeeds but before the checkpoint records `skipped` for a post that exists. The ledger lies, and the UI says "Skipped by you." **APPLY**

*Criterion 4 (correctness), 2 (upstream consistency), 9 (oversights).*

`state.json` architect decision 13 shows the window was seen and consciously accepted:

> Auto-resume was rejected as risking duplicate draft creation for items whose **provider call succeeded but whose checkpoint write did not**.

The chosen remedy marks those items `skipped` / `server_interrupted`. The arithmetic closes. The **fact** does not: a draft that exists in the target course is recorded as never created.

Three consequences, in ascending severity:

1. **The reconciliation sum's purpose is defeated while its arithmetic holds.** The brief's zero-silent-drop metric (§5) is "100% of source classwork posts produce either a faithful copy, a fallback draft shell with note, or an **explicit user-chosen skip** recorded in the summary report." A `server_interrupted` item is none of those three. The formula balances by putting a fourth kind of thing into the third bucket.
2. **The UI states a falsehood.** `wireframes/05-completion-summary.md` line 14 renders the tile as **`[ Skipped by you: 1 ]`**, and UX Acceptance Scenario #15 spells the term out as "(user-chosen skips)". A post the server abandoned — and possibly created — is attributed on screen to a teacher who never chose it. `ui-completion-summary`'s intent lists five tiles with no skip-reason breakdown.
3. **It causes the duplicate it was designed to avoid.** A teacher reading "skipped" for a post that already exists in the target goes and re-creates it by hand. Auto-resume was rejected to prevent duplicate posts; marking-as-skipped produces them through the human instead of through the executor.

The design is **one column away** from being able to tell the truth. `TransferJobItem` has `attemptCount` and `nextAttemptAt` but **no field recording the created target post's id**. Note that §7's persistence ADR justifies co-locating the mock world with app state precisely on this ground — it rejects the two-store alternative because "integration tests could no longer assert *the draft the item claims it created actually exists*." With no `targetPostId` column, the item never claims to have created anything, and the assertion the ADR is arguing for is unimplementable. The rationale outruns the schema.

**Fix:**
1. Add `targetPostId` (nullable) and `attemptedAt` (nullable) to `TransferJobItem`, in both `data-model`'s intent and the ER diagram. Write `attemptedAt` immediately *before* the provider call and `targetPostId` in the same write as `outcome='transferred'`.
2. Change the boot-time reconciliation in `composition-root` to branch on evidence rather than blanket-skipping:
   - `attemptedAt IS NULL` → never attempted → `skipped` / `server_interrupted`. Honest.
   - `attemptedAt IS NOT NULL` → outcome unknown → **verify against the target**: call `listCourseWork` / `listCourseWorkMaterials` on the target course and match on title + `createdOrder`. Found → `transferred` (backfill `targetPostId`). Not found → `skipped` / `server_interrupted`. Both list methods already exist on the port and the mock world is in the same database, so this costs one query.
3. Split the skip bucket in the API and the UI. `GET /:id/status` and `/items` expose `skippedByUser` and `skippedBySystem` (with reason); the Completion Summary keeps the "Skipped by you" tile bound to `skippedByUser` only and renders system skips as a separate, visually distinct line that names what happened. The reconciliation sum stays three-term (`transferred + fallback_shell + skipped_total`); only the *labelling* splits. Update `ui-completion-summary`'s intent and acceptance gate.
4. Update the corresponding acceptance gate: `composition-root`'s current test seeds 10 pending items and asserts all 10 become `skipped`. It must instead seed a mix — some with `attemptedAt IS NULL`, some with `attemptedAt` set and a matching post present in the target, some with `attemptedAt` set and no matching post — and assert each lands correctly. **As currently written, that gate asserts the buggy behaviour.**

---

# Significant findings — APPLY

## Criterion 6 — Seam & interface integrity

**A. The `resolutions[]` contract is undefined, and no resolution→outcome mapping exists.** `resolutions[]` appears in the REST table, §4 step 1, and the sequence diagram, and its shape is never specified anywhere. Three modules sit on it: `ui-preflight-actionsheet` produces it, `transfer-job-api` accepts it, `transfer-engine` consumes it. None declares the type. Worse, the **outcome mapping is unstated**, which leaves the exactly-once trace genuinely ambiguous for two of the five action-sheet options:

| Pre-flight resolution (UX §5) | Outcome bucket | Stated in 04? |
|---|---|---|
| Scenario 2 — Create Draft Shell with Note | `fallback_shell` | implied, not stated |
| Scenario 2 — Skip \<Type\> | `skipped` (user) | implied, not stated |
| Scenario 3 — Copy to My Drive | `transferred` | **not stated** |
| Scenario 3 — Link Existing File (risk) | `transferred` | **not stated** |
| Scenario 3 — Skip Attachment and Note Draft | **`transferred` or `fallback_shell`?** | **undecided** |

The last row is the one the review was asked to trace, and the document cannot answer it. The post *is* created, so "transferred" is arguable; but the brief §6.8 attaches the exact fallback-note string (`Original attachment '<name>' could not be linked due to a permission error or deleted file.`) to precisely this situation, which reads as `fallback_shell`. The choice moves the `fixture_f1_zero_fallback` budget and the brief's ≥95%-fidelity metric. **Add a typed `Resolution` discriminated union to `classroom-provider-interface`'s `types.ts` (or a shared DTO module — see B), and add the five-row mapping table above to `transfer-engine`'s intent with the ambiguous row decided.** Recommended: "Skip Attachment and Note Draft" → `fallback_shell`, since a note was injected and the credit rule ("auto-refund on any fallback injection") keys off exactly that.

**B. No shared client/server types — four cross-tier edges typed twice.** `frontend-api-client` declares `dependsOn: [courses-api, transfer-job-api, auth-module, cold-start-health]` — legitimate contract dependencies (ground (c)), but there is no `shared/` types package and no runtime schema. Every payload shape is hand-redeclared in `client/src/lib/api-client.ts`, and drift between what `transfer-job-api` returns and what the client expects is invisible to the compiler. This directly contradicts the document's own governing principle — §5 insists the reconciliation line is "rendered directly from server-provided counts, deliberately never recomputed client-side, so there is exactly one implementation of that arithmetic in the whole system" — while permitting the *type* of that payload to have two implementations. **Add a 21st module `shared-contracts` (`shared/src/api-types.ts`, zod schemas exported as both TS types and runtime validators), `dependsOn: []`, consumed type-only by `transfer-job-api`, `courses-api`, `auth-module`, and `frontend-api-client`.** Acceptance: the status payload's type is imported, not redeclared, on both sides.

**C. The provider interface's `payload` types are entirely unspecified — the boundary is name-shaped like Google and payload-shaped like nothing.** §6-A gives `createCourseWork(courseId, payload): {id}` with no definition of `payload`. Everything that carries real API fidelity lives in that word: the `materials[]` array and its four-way union (`driveFile` / `youTubeVideo` / `link` / `form`), `driveFile.shareMode` (VIEW/EDIT/STUDENT_COPY), `state: 'DRAFT'`, `assigneeMode`, `topicId`, `workType`, `multipleChoiceQuestion.choices`, `maxPoints`. The brief's binding requirement — "preserve each attachment's `shareMode` … **never default to VIEW**" — has an `Attachment.shareMode` column in the ER diagram and **no place in the interface to carry it**. A payload type that isn't declared is a payload type the mock will define by whatever it finds convenient, which is the failure mode driver 1 exists to prevent. **Declare `CourseWorkPayload`, `CourseWorkMaterialPayload`, and `Material` (the four-way attachment union) in `classroom-provider-interface`'s `types.ts`, with `shareMode` required and non-defaulted on `driveFile` and structurally absent on the other three kinds** (real Classroom only accepts `shareMode` on `driveFile` — modelling it on `Attachment` uniformly is already a small mock-shaped divergence worth a comment). Add an acceptance gate asserting a `driveFile` material cannot be constructed without an explicit `shareMode`.

**D. `listCourseWork` has no `courseWorkStates` filter — the real adapter would silently drop every Draft and Scheduled post.** Real `courses.courseWork.list` requires an explicit `courseWorkStates` parameter to return anything other than `PUBLISHED`; the default omits drafts. F8 mandates Draft, Published and Scheduled source posts, and UX Acceptance Scenario #12 asserts all three transfer. The mock reads from SQLite and will happily return all states, so **every test passes and the real swap silently under-scans** — the exact scan-time silent drop §6 warns about, and it survives precisely because the mock is the only implementation. This is the clearest instance of the boundary being shaped by the mock rather than by the real API. **Add `courseWorkStates?: CourseWorkState[]` to `listCourseWork` and `listCourseWorkMaterials`, require the scanner to pass all three states explicitly, and add a contract-test assertion that a state-filtered call returns only the requested states** (so the future real adapter is held to it).

**E. `listCourses` has no state or role filter, but `courses-api` must scope on both.** `courses-api`'s intent requires "source: active+archived; target: active only, incl. SIS-shell flag" — real `courses.list` takes `courseStates` and `teacherId`. The interface's `listCourses(accountId, {pageToken, pageSize})` provides neither, so the filtering must happen after the fact in `courses-api` against fields the port does not promise. **Add `courseStates?: CourseState[]` and make the teacher-role scoping explicit in the signature.**

**F. `copyRubric(courseWorkId, targetCourseWorkId)` is a mock-convenience method with no real-API counterpart, and it buries the brief's open question.** Real Classroom has no server-side rubric copy: the real adapter must `courses.courseWork.rubrics.get` the source rubric, then `rubrics.create` a full rubric body (criteria → levels → points) against the target — two calls, two failure surfaces, with the license denial arriving on the *create*. A single boolean-returning `copyRubric` cannot decompose into that without a signature change, which is the rewrite driver 1 exists to prevent. Compounding it: the `RUBRIC` table is `{id, courseWorkId, licenseBlocked}` with **no criteria or levels at all**, and the PM brief's open question — "Rubric fidelity details (criteria/levels mapping) beyond copy-or-note — architect/engineer to specify against the mock's rubric model" — was routed to this stage and is not answered anywhere in `04`. **Split into `getRubric(courseWorkId): Rubric | null` and `createRubric(targetCourseWorkId, rubric): {id} | throws LicenseBlockedError`; model `RubricCriterion` / `RubricLevel` in the ER diagram; and answer the brief's open question explicitly (recommended: criteria/levels copied verbatim, since a rubric that arrives with its structure flattened is a fidelity loss the summary would not report).**

**G. `getAttachmentHealth` is per-attachment — the one call shape that wasn't future-proofed.** §6 pagination-shapes all four list methods "from day one … retrofitting this signature after downstream consumers depend on it would be exactly the rewrite the swappable-boundary driver exists to prevent." That reasoning applies with equal force to the pre-flight scanner's N+1: a 50-post course with several attachments each issues hundreds of sequential `getAttachmentHealth` calls, which against real Drive means hundreds of round-trips (and, given real Drive quotas, a 429 storm *during pre-flight*, a path with no backoff specified at all). **Change to `getAttachmentHealth(refs: AttachmentRef[]): Map<ref, HealthState>`** — batch-shaped from day one, for the same stated reason pagination was.

**H. The ADR promises a shared "all posts" module that does not exist among the 20 — and it is the one place where two modules are coupled enough to be built twice.** §7's per-type ADR consequence column states:

> Any code that must handle "all posts" — the preflight scanner, the itemized log, the sort order of the transfer queue — needs an explicit merge step with an explicit ordering key … **named as a single reviewed module rather than open-coded per call site.**

No such module appears in the Module declarations block. The deliberate two-table split (correctly chosen) means merging `CourseWork` + `CourseWorkMaterial` into one oldest-first sequence is required in at least three places, and `preflight-engine` and `transfer-engine` — which share no dependency edge and no file target — will each implement it independently. Two independent merge implementations that must agree on ordering is how `totalPostsScanned` and `count(items)` diverge (P0-2). **Add module `post-enumerator` (`server/src/services/post-enumerator.ts`), `dependsOn: [{classroom-provider-interface, runtimeDependency: false}]`, owning: paginated enumeration of both surfaces, the merge, and the deterministic oldest-first ordering key. Make `preflight-engine` and `transfer-engine` both depend on it.** Specify the ordering key with an explicit tiebreak — `(creationTime ASC, sourceType ASC, sourceId ASC)` — because seeded fixtures routinely share timestamps and `creationTime` alone is not a total order.

**I. `Attachment` has no ordering column, so "attachments 1–20" is nondeterministic.** The brief and UX Acceptance Scenario #10 require "attachments 1–20 link directly, attachments 21+ appear as URL links in the description." The ER diagram's `ATTACHMENT` has `{id, parentType, parentId, kind, driveFileId, url, shareMode, driveState, ownerAccountId}` — no `position` or `sortOrder`. Which 20 survive depends on unspecified query ordering, so F5's assertion is flaky-by-construction and, on a real re-run, the overflow set could differ. **Add `sortOrder int` to `Attachment`, seed it deterministically in F5, and have `transfer-engine` order by it explicitly.**

**J. The single-active-job guard's predicate is undefined, and the two mechanisms that enforce it disagree.** `data-model`'s intent says "at most one **non-terminal** TransferJob per accountId"; `state.json` decision 12 says the index is `WHERE status IN ('queued','running')`; `transfer-job-api`'s `/active` finds "the **non-terminal** job." The ER diagram's status set is `queued|running|rate_limited_pause|completed|interrupted|failed`. **`rate_limited_pause` is in neither `('queued','running')` nor obviously terminal** — so a job paused for rate limiting is unguarded by the index while still being returned by `/active`, and the impatient double-submit *during a visible rate-limit pause* is precisely the scenario D5 was written for. (Separately, the ER diagram lists `rate_limited_pause` as a `status` value while the sequence diagram treats rate-limit pause as a `job.rateLimitPause` object field — these two diagrams contradict each other.) **Define the terminal set explicitly (`completed | interrupted | failed`), make the partial unique index and `/active` both derive from that one definition, and pick one representation for rate-limit pause — recommended: a `rateLimitPause` field, not a status, so status stays a clean lifecycle enum.**

**K. `transfer-job-api` writes rows but declares no `data-model` edge; the monetization completion hook has no declared home.** §4 step 1 has the API layer inserting `TransferJob` + all `TransferJobItem` rows, yet `transfer-job-api`'s `dependsOn` is `[transfer-engine, auth-module]`. Add `data-model` (and, once P0-2 lands, the scan tables). Separately, `monetization-middleware`'s intent declares a "deduct-on-100%-clean / auto-refund-on-any-fallback at job **completion**" hook, but completion happens inside `transfer-engine`, which has no monetization edge and no mention of the hook — so the hook point exists in one module's prose and in no module's code path. **Declare the hook as an injected callback on `transfer-engine` (keeping the dependency pointing the right way) and name it in `transfer-engine`'s intent.**

## Criterion 5 — Completeness

**L. The pre-flight pagination loop — named by the document as the one silent-drop it cannot detect — has no acceptance gate.** §6 states plainly that "the mock can page at a size smaller than 50 and the pre-flight scanner must loop until `nextPageToken` is exhausted, or the scan under-counts." `preflight-engine`'s acceptance gate tests F1 (zero findings), F2 (type-aware label) and F3 (three options). **Nothing tests the loop.** Add to `preflight-engine` (or `post-enumerator`, per H): "with the mock configured to page F4 at `pageSize=7`, the scan returns exactly 50 posts and issues 8 list calls." Without this, the single failure mode the architecture explicitly says is undetectable-after-the-fact is also untested.

**M. F1 seeds no rubric, so the successful `copyRubric` path is unfixtured.** The brief assigns it: "(A rubric-permitted course — **F1 may serve** — exercises the successful rubric-copy path.)" `fixture-seed-data` defines F1 as "healthy" (all attachments linkable) with no mention of a rubric, and F7 covers denial only. As written, `copyRubric`'s success branch is exercised by nothing, and `rubricDegraded=false` is never asserted against a rubric that actually copied. **Add ≥1 rubric-bearing assignment on a license-permitted course to F1's definition and an acceptance assertion that its rubric copies with `rubricDegraded=false`.**

**N. F12's slow-mode delay flag has no schema or config home, and if seeded onto F4's course it breaks F4's own perf budget.** F12 "reuses F4's course with a deterministic per-item slow-mode delay flag." No such flag exists on `COURSE`, `COURSE_WORK`, or `COURSE_WORK_MATERIAL` in the ER diagram, and it is not among the §8 env vars. If it is seeded as course/post data, then `engine_throughput_f4_50posts` (`< 120s`) runs against a deliberately-slowed course and the budget measures the harness. **Make it a run-scoped provider config (`MockProviderOptions { perItemDelayMs }`) passed when the F12 E2E spec constructs the provider — not fixture data — and say so in `mock-classroom-provider`'s intent.** Add it to the §8 env-var list alongside `COLD_START_SIMULATE_DELAY_MS` if it is env-gated, and cover it by the same "inert by default in production-like `NODE_ENV`" acceptance test.

**O. The empty-course (0 posts) path is unspecified.** UX §5 requires the flow to reach Ready-to-Transfer stating "0 posts to copy" rather than silently succeeding. Nothing in `04` addresses it: `POST /transfer-jobs` with zero items, a job that completes instantly, a Completion Summary rendering `0 + 0 + 0 = 0 of 0`, and the reconciliation line's copy in that case are all undefined. **Add the case to `ui-preflight-actionsheet`'s intent (Ready-to-Transfer zero state) and `transfer-engine`'s (a zero-item job completes immediately and still satisfies the invariant).**

**P. No module owns landing the §8.1 quality budgets into `docs/project-profile.md`, or creating the commands they name.** `docs/project-profile.md`'s budget table is empty by design (AGNTC-0064) and its policy is explicit: "The **engineer** scaffolds the quality tests … as part of building the thing being measured." §8.1 correctly defers to it — "`docs/project-profile.md` holds the values that actually get run once the engineer lands these rows" — but **no module declares `docs/project-profile.md` as a file target and no module owns `test/quality/*`**, so the seven proposed rows have no owner and `npm run test:perf` is a command nothing creates. A budget that never reaches the profile is measured by nobody. **Add `docs/project-profile.md` and `test/quality/` to `transfer-engine`'s file targets (it owns the two load-bearing rows) or declare a small `quality-budgets` module, with an acceptance gate that `node scripts/agent-c-budgets.js run "<project>"` executes all seven rows and reports.** All rows correctly enter `advisory` — no finding there.

## Criterion 2 — Upstream consistency

**Q. Two named WCAG AA requirements from UX §6 have no module acceptance gate.** (i) "Text alternatives for outcome icons: every outcome icon … carries a text label — never icon- or color-alone," specifically calling out the recent-activity ticker rows — `ui-transfer-progress`'s acceptance covers only the F12 reconnect E2E. (ii) "When the Completion Summary replaces the Progress screen, focus moves to the Completion Summary's main heading" — `ui-completion-summary`'s acceptance covers per-type fields and the reconciliation line only. Automated axe will not reliably catch either (an icon with no accessible name inside a live region, and focus placement after a route change). **Add both as explicit acceptance assertions on their owning modules.** The `wcag_aa_automated_per_step` budget row is the right answer for contrast and is correctly present — no finding there, and no contrast arithmetic is performed in this review.

**R. Render free-tier disk: Delta D3 scopes the risk to redeploys and declares sleep/wake "not in question." That scoping is the risky part.** Render's free instances are documented as having an ephemeral filesystem, with persistent disks unavailable on the free plan; a free service that spins down and back up generally restarts from its build image. If that holds, `TransferJob` / `TransferJobItem` rows do not survive a **spin-down**, not merely a redeploy — and then:
- The resumability guarantee (driver 3, UX P0 Delta #2) is real only within one uninterrupted process lifetime.
- The boot-time reconciliation pass (P0-5, decision 13) has nothing to reconcile: interrupted jobs vanish rather than being marked `interrupted`, which is a silent drop at the job level.
- The idempotent reseed correctly restores the *fixture world* — it does not restore *job state*, and the document's D3 mitigation covers only the former.
- `fixture_f12_reconnect_fidelity` runs locally against a normal filesystem and therefore certifies nothing about the deployed environment.

I have no instrument to verify Render's current free-tier behaviour and do not assert it as fact. **The finding is the document's confidence, not its conclusion:** remove "as distinct from sleep/wake, which is not in question" from the Delta, elevate the empirical check to run **before** the resumability guarantee is stated as delivered, and add the spin-down case (not only redeploy) to the deployment-spike checklist already on the backlog. The pre-decided remedy (Postgres) is correctly named.

## Criterion 3 — Prior-artifact coherence (diagrams vs. document)

**S. `04-transfer-sequence.md`'s F2/F3 branch records a fallback shell without creating one.** Lines 44–45:
```
else attachment unhealthy (F2/F3, pre-resolved by action sheet)
    TE->>DB: item.status=fallback_shell|skipped per resolution
```
There is **no provider call in that branch** — the item is marked `fallback_shell` and nothing is written to the target course. But UX Acceptance Scenario #3 requires "the resulting target post's description contains the exact fallback-note text," and the brief §6.8 mandates "**guaranteed draft-shell creation**." A "fallback shell" that exists only as a ledger row is a silent drop that the reconciliation sum reports as handled. If the engineer follows the diagram, F2 fails acceptance while the invariant test passes. **Fix the branch to show `TE->>MP: createCourseWork (shell payload, attachment omitted, note appended)` before the DB write, and place the resolution check *before* the provider call rather than as a sibling `alt` of its result.**

**T. Diagram/schema naming drift.** `04-transfer-sequence.md` writes `TransferJobItem(status=pending)` and `item.status=transferred` throughout; the schema field is `outcome` (`05-data-model.md`, §5). `TransferJob.status` values `failed` and `rate_limited_pause` appear only in the ER diagram and are assigned by nothing in the document (see P0-3, J). **Rename `item.status` → `item.outcome` in the sequence diagram and reconcile the `TransferJob.status` value set across §4, §5, and both diagrams.**

## Criterion 1 — Engineering best practices

**U. The cold-start mechanism is labelled "server-signaled" when it is neither of the two options UX asked the architect to choose between.** UX §6 asks: "client-clock-based … or server-signaled (the backend reports its own cold-start state)." §4 answers "This is **server-signaled** in the practical sense that matters (the client reacts to actual response latency…)" — which is a *third*, and better, answer: latency-triggered, requiring no idle clock and no server cold-start flag. The design is right; the label is wrong, and the mislabel matters because QA will test UX Acceptance Scenario #8 as written ("Given the backend has been idle >15 minutes…"), which this design does not implement — it shows the overlay on any call exceeding 2s regardless of idle history. **Restate as "latency-triggered (neither client-idle-clock nor a server cold-start flag)", and note explicitly that Acceptance Scenario #8's ">15 min idle" precondition is superseded by "any unresolved call >2s" so QA tests the built behaviour.**

---

# DEFER — record in `backlog.md`, do not block

1. **Render's own health check may prevent the free instance from ever idling.** `/api/health` is simultaneously Render's configured health-check path and the cold-start detection target (§9). If Render polls it on an interval, the 15-minute idle timer never fires and the product's first-class cold-start state is unobservable in the deployed environment — the harness would be the only way it is ever seen. Verify in the same deployment spike as R.
2. **CSRF surface.** `SameSite=None; Secure` + `credentials: 'include'` means cookies ride cross-origin. JSON bodies force a CORS preflight for the state-changing routes, and the origin allowlist is pinned — but a bodiless `POST /api/auth/sign-out` qualifies as a simple request and is cross-site triggerable. Low impact on a mock-only v1; add a CSRF token or require a custom header on state-changing routes when real auth lands.
3. **`SESSION_SECRET` has no fail-fast contract.** Nothing states the process refuses to boot when it is unset. A dev default that ships is the classic form of this bug.
4. **Session TTL** remains an open question; the doc's suggested 24h default is fine.
5. **`GET /:id/items?since=`** for mid-transfer detail — correctly noted-not-built.
6. **`QUIZ_ASSIGNMENT` divergence** — correctly modelled, correctly flagged, correctly backlogged. No action now.

---

# What is right, and worth not regressing

- The **`CourseWork` / `CourseWorkMaterial` split** is genuinely structural: separate tables, separate provider methods, a type-level acceptance gate. Driver 5 is delivered, not asserted.
- The **cold-start fixture disclosure** is a model of the honesty this run has been trying to reach: "cold start has **no fixture in F1–F13**, and this architecture does not retroactively claim otherwise … QC must not treat cold start as fixture-certified on the strength of it." That paragraph is the correct response to the recurring defect.
- The **type-only interface module** (no emitted JS, so nothing can import a concrete provider through it) is a real enforcement mechanism, not a naming convention.
- The **202 + poll + `/active`** shape makes resumability a server fact, and the reasoning that the poll cadence itself defeats Render's idle timer is correct and non-obvious.
- **Pagination-shaping the list methods from day one** is exactly right — findings D, E and G are asking for that same discipline to be applied to the three call shapes it was not applied to.
- The **ADR alternatives columns** are unusually good: each rejected option is rejected on a named driver, and several ("BullMQ is genuinely the right answer at multi-tenant scale") are honest about what is being given up.

## Note for `project-profile.md` → `## Lessons learned` (recurring pattern, not a one-off)

> **Cross-references must resolve, and identifiers must be assigned where they are defined, not where they are cited.** Four stages running, this project has shipped a citation to something that does not exist (`F: cold-start sim`; a nonexistent Deltas row; and now `D1`–`D10`, cited 26 times against tables that carry no identifiers). The pattern is always the same: the author invents a shorthand while writing, uses it consistently, and never goes back to define it. Before any artifact is handed off, grep it for every `[A-Z]\d+` token and confirm each one resolves to a labelled row in a named document.

> **A guarantee is structural only if the failure it forbids is unrepresentable — not merely undesirable.** "Reconciliation by construction" correctly made double-counting unrepresentable, then relied on prose for fall-through (`pending` with no exit), for the identity between two independent measurements, and for a "guaranteed" fallback executed through the very call that was failing. When claiming a guarantee is structural, enumerate the ways it could fail and check each one against the schema — the ones the schema does not forbid are the ones still living in the paragraph.
