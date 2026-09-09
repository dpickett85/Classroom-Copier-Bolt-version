# 05 — Implementation

**Feature:** real-google-integration
**Branch:** `phase2/real-google-integration` (not pushed, not merged)
**Spec:** `04-architecture.md` rev 1 — its Module Declaration Block declares 12 modules
**Status:** all 12 modules implemented and committed; **revised twice** — once
against a security-engineer report and a technical-critic report (§8), then
against QA's cycle-1 FAIL verdict (§9). Later sections supersede earlier ones
wherever they contradict; §9 is authoritative.

> **§1 and §8 contain a claim that was false when written.** Both assert the
> production boot fail-fasts on `GOOGLE_PROVIDER_MODE`. It did not, until §9.
> Left in place rather than quietly corrected: the comparison a reviewer needs
> is stated-premise against built-code, and a premise edited to match the code
> destroys exactly that.

---

## 1. Headline

The two P0s named in `04-architecture.md` §4.3 are **fixed and proven fixed**.
Both were real, both were live in the tree when this stage started, and both
were invisible from inside the application.

**P0-B — `execute()` was not re-entrant.** Its item query filtered on `jobId`
alone and did not even select `outcome`. On any second entry — a resume after a
token failure, a hand-back from the reconciler — every already-terminal item
fell straight through `processItem` into `transferPost` and created a **second
real post in the teacher's destination course**. `finish()`'s pending-predicate
then refused the duplicate ledger write, so the reconciliation sum still
balanced, every item still read `transferred`, and nothing in the app looked
wrong. The only witness was Google Classroom itself.

**P0-C — duplicate prevention was a no-op on the first run**, from the same root
cause: an item classified `duplicate_title` still reached `transferPost` and was
created.

Measured, on the F15 fixture pair, against the tree as it was:

| | before the fix | after |
|---|---|---|
| create calls carrying a duplicate's title, first run | **4** | **0** |
| create calls on pass 2 for items terminal after pass 1 | all of them | **0** |
| `createTopic` calls on pass 2 for topics pass 1 created | all of them | **0** |
| job status after `AuthExpiredError` before the item loop | `failed` | `running`, paused, resumable |

**Superseded by §8:** at the time this section was written the two P0s were
fixed but the real provider was **never selected in production** — see §8/E1.
Both P0s were, and remain, real and fixed; the phase's headline requirement was
not met until §8's commit.

Every one of those numbers comes from a counting `ClassroomProvider` double
(`server/test/helpers/recording-provider.ts`) that records the method and
subject of every write call. **No P0 acceptance criterion is an outcome
assertion**, because an outcome assertion passes against the broken engine and
is therefore evidence of nothing. Each was written first, run against the
unfixed tree, and observed failing — the red output is quoted in §4.

---

## 2. What was built, module by module

The five modules marked *(prior session)* were committed before this stage
resumed and were not redone; they are listed for completeness.

| # | Module | Commit |
|---|---|---|
| 1 | `build-restoration` *(prior session)* | `2f30d89` |
| 2 | `datasource-postgres` *(prior session)* | `725987d` |
| 3 | `google-auth-core` *(prior session)* | `8e02c61` |
| 4 | `real-classroom-provider` *(prior session)* | `a2440e5` |
| 5 | `google-oauth-routes` *(prior session)* | `3e52b81` |
| 6 | `duplicate-topic-preflight` | `e334723` |
| 7 | `token-failure-resume-engine` | `f9eb2bd` |
| 8 | `signin-ui-rebuild` | `efa050e` |
| 9 | `transfer-ui-extensions` | `eb9aec7` |
| 10 | `deployment-config` | `cf1867a` |
| 11 | `server-typecheck-clean` | `cf1867a` |
| 12 | `quality-budgets-registration` | `cf1867a` |

### 6 — `duplicate-topic-preflight`

`normalizeTitle()` lives in `shared/src/normalize.ts` as the single answer to
"are these the same name?": NFC → collapse whitespace → trim → lowercase, and
deliberately nothing more. It does not strip punctuation and does not fuzzy
match, because the two failure directions are not symmetric — a missed match
copies a post twice (visible, fixable), an over-eager match silently drops a
post the teacher wanted (invisible).

`enumerateDestination()` reuses `post-enumerator`'s existing `drain` pagination
loop rather than hand-rolling a second one, and passes `courseWorkStates` /
`courseWorkMaterialStates` explicitly. A duplicate check blind to the
destination's DRAFTS would re-create every draft the previous run made, which is
precisely the bug this feature exists to fix.

`preflight-engine` builds the same-surface match map *before* the
attachment-health pass and **excludes duplicates from the health batch**, per PM
§6.3 precedence: a duplicate never enters `findings[]` whatever its attachments
look like, so checking their health buys a result that is thrown away.

**F15 is the first fixture *pair*** — dedupe is a relation between two courses,
so one course cannot express it. It seeds a draft match, a published match, a
normalization-only match, a `Unit 1` / `Unit 11` near-miss, a cross-surface
collision, the combined duplicate-plus-trashed-attachment case, a non-duplicate
**control** carrying the same broken attachment, and four topic cases including
an ambiguous pair.

*Verified by mutation, not by assertion alone:* forcing the destination read
back to `PUBLISHED`-only turns four of the new tests red.

### 7 — `token-failure-resume-engine`

The four §4.3 fixes, in order:

1. `where: { jobId, outcome: 'pending' }`, with `outcome`, `attemptedAt` and
   `claimedTargetPostId` selected. This one change closes both P0s.
2. `TransferJob.topicMapJson` makes the topic map durable, seeded from the job's
   own map and then from the scan's `topicReuseJson`, persisted in the same
   lease-checked write as the existing per-topic heartbeat. `topicReuseJson`
   alone cannot do this: it is a pre-flight snapshot, blind to the topics pass 1
   created itself.
3. An item that is `pending` **and** has `attemptedAt` set is evidence-ambiguous
   and is never dispatched. It resolves from `claimedTargetPostId` through the
   same branch `recordItemFailure` already implements. This is what stops a
   re-entry re-running `copyAttachmentToMyDrive` and making a second copy of a
   teacher's Drive file.
4. Duplicates are **pre-resolved at job creation** as terminal
   `skipped`/`duplicate_title` rows. They are not filtered inside the loop —
   an item that never enters the loop cannot be created by a bug in the loop.

Then the machinery those fixes make possible. **F7:** `AuthExpiredError` thrown
before the item loop used to reach `run()`'s top-level catch and mark the job
`failed` — no banner, no resume, start over. It now pauses. **F9:** a job whose
Google token has less than `GOOGLE_TOKEN_MIN_REMAINING_MS` left never claims the
lease. **F6:** `reconciliation.ts`'s skipped case is three-way with the
duplicate test *first*; its previous bare `else` is exactly how `duplicate_title`
acquired the "interrupted before we could confirm they copied" copy.

The pause is a **field, not a status**: `status` stays `'running'` and
`activeAccountId` stays set, because that exact pair (`'running'` + null
`executorId`) is what the lease claim's own WHERE re-matches on resume.
`'interrupted'` would be terminal and unresumable, and a new status value would
break the partial unique index and `/active`, both of which derive from `status`
alone. The reconciler exempts a paused job from heartbeat staleness and judges
it against `GOOGLE_REAUTH_GRACE_MS` instead — otherwise it terminates the job
while the teacher is on Google's consent screen doing what the app asked.

`shared/src/api-types.test.ts`'s partition case was **rewritten, and the reason
is worth stating plainly**: it claimed to classify every skip reason and
actually asserted `toHaveLength(6)` on a concatenated array, so adding
`duplicate_title` left it green while its own stated claim became false. It now
derives from `SkipReasonSchema.options` and checks an exhaustive, pairwise-
disjoint three-way partition against both the bucket lists *and* the predicates.
Mutation-checked: emptying `DUPLICATE_SKIP_REASONS` turns it red.

### 8 — `signin-ui-rebuild`

The no-Tailwind guard was **written first and observed failing** — 53
Tailwind-shaped class names across exactly two files (`AuthFlow.tsx` and
`SignInLanding.tsx`), and zero false positives anywhere else under `client/src`.
It is shape-based, not the five literal substrings the original diagnosis
grepped for; that literal list would have shipped green with `AuthFlow.tsx`
still broken, because that file's inert classes never produced the "two big
icons" symptom the grep was built around. The guard also self-checks its own
regex against known positives and against this product's real class names, so a
typo cannot make it pass vacuously.

Both components are re-authored in the token system. `SignInLanding` gets
Google's real button, contained to `.google-signin-btn` / `.google-g-logo`, with
explicit `width`/`height` on the inline SVG — a `viewBox`-only `<svg>` with
neither stretches to fill its containing block, which is the actual mechanism
behind 898×898px. `AuthFlow` gets its `onSignedIn` / `startAt` / `onError` prop
shape back; `App.tsx` had never stopped calling it that way, so every one of
those props was being ignored by the `{children}` rewrite.

The click **fetches the authorization URL before redirecting** (UX 1b). Linking
straight to Google is one fewer round trip and also means a sleeping Render
service shows the teacher nothing for a minute; going through the API puts that
wait inside the app's existing cold-start machinery, the only place it can be
narrated. The success redirect carries `?auth=callback` so the return leg can
render "Signing you in…" instead of flashing the landing screen; `App.tsx`
strips it with `history.replaceState` before paint. The authorization code
itself never reaches the frontend URL at all.

**Mock sign-in is gone from the client, not merely hidden.** `AccountPicker.tsx`
is deleted and `listMockAccounts` / `signIn` are removed from `api-client`,
because a string literal in `api-client.ts` is in the production bundle whether
or not anything calls it. The bundle now greps clean of mock endpoints — the
only remaining `mock` hits are the `.mock-note` CSS class name (a typographic
slot, not an endpoint). Along the way: the Completion Summary's "Open target
course" pointed at `/mock/courses/<id>`, a path this app never served — harmless
against a mock world, a 404 in a teacher's face the moment the course is real.
It now opens `classroom.google.com`.

**§8.4a's MANUAL-VERIFY is resolved rather than left open.** Google's
`#1F1F1F` on `#FFFFFF` measures **16.48:1**. It passes WCAG AA comfortably, so
**no contrast suppression was added anywhere** — a suppression for a violation
that never fires would be its own kind of lie. The check is arithmetic, in
`client/src/styles/contrast.a11y.test.ts`, reading the colours back out of
`tokens.css` rather than retyping them.

### 9 — `transfer-ui-extensions`

`Disclosure.tsx` is one native `<details>`/`<summary>` reused in three places.
Native rather than a `button` + `aria-expanded` pair because the element already
provides Enter/Space toggling, Tab reachability and an announced expanded state.
The `[expand]`/`[collapse]` text is real text swapped by CSS on `[open]`, so
React never holds a second copy of state the DOM already owns.

`OutcomeIcon` / `OutcomePill` gain an **optional** `skipReason` prop — additive
and proven so: a call site passing no prop renders byte-identical HTML to one
passing `null`. `duplicate_title` stays a `SkipReason` and never becomes a fifth
`Outcome`. The duplicate reads "Already in course" with a `≡` glyph and the teal
family (the exact `.badge-sis` triple, no new hex), so it differs from a user
skip in **text, glyph and colour** rather than colour alone.

One label function, three consumers: the CSV export and the on-screen Outcome
column both call `outcomeText`, asserted **by import** rather than by
duplicating strings in the test.

The seven stat tiles are two labelled ledger sections rather than a seven-wide
row, and the reconciliation line is four terms in tile order plus a fifth
*labelled* `interrupted` term shown only when `skippedBySystem > 0`. The
previous four-term-only formulation silently stopped balancing whenever a system
skip occurred; both branches are now tested.

4a reuses `ErrorState`. 4b/4c cannot — they sit **with** the frozen progress bar,
because the teacher needs to see how far the transfer got. They differ in
heading, glyph and button label, each asserted separately, since "they look
different" is satisfied by any one of the three and the requirement is all three.
4c's copy is routine, and a test asserts it contains no failure vocabulary: in
testing mode this is a weekly event, and copy that reads as a failure turns a
scheduled occurrence into a recurring trust hit.

### 10 / 11 / 12 — config, gate, budgets

`npm run typecheck` exists at the root and runs `tsc --noEmit` across all three
workspaces. It exits 0, down from the 19 baseline errors in
`inputs/verify-baseline.md`.

`.env.example` covers every name `config.ts` actually reads, **grep-verified in
both directions**, with four named asymmetries — the prose previously listed two
and the grep found four, so the omission was right and the sentence was not
(F7). `VITEST` is set by the test runner rather than configured; `DATABASE_URL`
is read by Prisma's schema, not by `config.ts`; and `COLD_START_SIMULATE_DELAY_MS`
and `MOCK_PROVIDER_DELAY_MS` are the two harness knobs `config.harnessDelay()`
forces to `0` under a production-like `NODE_ENV`, so documenting them in the file
a deployer copies would advertise two settings that cannot do anything where they
would be copied to. Placeholders only; `TOKEN_ENCRYPTION_KEY` carries its exact
`openssl rand -base64 32` generation command.

`docs/handoff/connecting-to-live-google.md` supersedes the `.docx` as the
version to trust. Written for a teacher: no CLI, no dev tools, four named parts,
every step paired with a "you'll know it worked when", troubleshooting beside
the step it happens at rather than in an appendix. The test-user step comes
**before** the first sign-in attempt, because a teacher blocked by Google never
reaches this app and it cannot narrate the failure. Postgres provisioning is a
required step with its reason stated. The weekly re-consent is called out as
normal.

The five new budget rows are registered in `docs/project-profile.md` with all
six columns and wired in both the workspace and root `package.json`. **Two are
`blocking`** — the two covering the P0s. An advisory tier on the assertion that
distinguishes "the teacher's course is correct" from "the teacher's course has
duplicate posts" would let the exact defect this phase exists to fix ship green.

---

## 3. Verification — real numbers

Run at the final commit (`eb9aec7`), from a clean tree.

```
npm test
  shared    26 / 26 pass   (2 files)
  server   310 / 310 pass  (32 files)
  client   251 / 251 pass  (12 files)

npm run typecheck          0 errors  (shared, server, client)
npm run build              clean — shared, server, client
                           client bundle 304.59 kB / 92.75 kB gzip
npm run lint               clean (eslint, whole repo)
```

Client went from **188 pass / 10 fail** at the start of this stage to **251 pass
/ 0 fail**, and the ten failures were closed by re-authoring the components, not
by reinstating a production-reachable mock sign-in.

### Quality budgets — all twelve green

| Budget | Result |
|---|---|
| `test:budget:dedupe` **(blocking, new)** | 2/2 — `duplicateTitleCreates=0`, `createCalls=3 == pendingAtStart=3` |
| `test:budget:reauth-resume` **(blocking, new)** | 7/7 — `pass2Creates=3`, `pass2Topics=0` |
| `test:budget:preflight-scan-cost` *(new)* | 2/2 — 2 calls per surface, 1 batched health call |
| `test:budget:reauth-grace` *(new)* | 6/6 — both bounds hold |
| `test:budget:no-tailwind` *(new)* | 2/2 — 0 matches |
| `test:budget:reconciliation` | 9/9 |
| `test:budget:totality` | 8/8 |
| `test:budget:f1` / `f13` / `f12` | 1/1 each |
| `test:budget:reconcile` | 5/5 |
| `test:budget:lease` | 3/3 |
| `test:budget:courses` | 3/3 |
| `test:budget:a11y` | 46/46 |
| `test:budget:coldstart` | 8/8 |
| `test:perf` | 1/1 |

### Non-negotiables, checked

- **No Tailwind.** Both auth components re-authored; the shape-based guard was
  proven red (53 offences, 2 files) before either was touched, and is green now.
- **Mock provider stays test-only.** Production boot fail-fasts on
  `GOOGLE_PROVIDER_MODE`; the mock routes are not registered in google mode; the
  client-side picker is deleted and its API calls removed. The built bundle
  greps clean of mock endpoint strings. **§8/E1 corrected the hole in this
  claim**: the mode gated the account directory and the auth routes but not the
  `ClassroomProvider` itself, so a google-mode boot still served every course
  read, coursework read and post creation from the mock. It now fail-fasts on
  that too.
- **No real secret committed.** `.env.example` is placeholders only. Nothing
  sensitive is in a `VITE_`-prefixed var — the only one is
  `VITE_API_BASE_URL`, a public origin.
- **No token, ciphertext, or raw googleapis payload is logged.** The OAuth
  callback's catch discards the caught error rather than logging it, precisely
  because a failed exchange's error object carries the authorization code and
  the client secret.

---

## 4. The red-first evidence

Recorded here because the whole argument for these fixes rests on it.

**P0-2, first run, against the unfixed engine:**

```
[budget] dedupe first run: pendingAtStart=7 createCalls=7 duplicateTitleCreates=4
AssertionError: "Angle Pairs Practice" was created in the destination course
```

Four real duplicate posts, on a first run, with no pause and no resume — exactly
what §4.3 predicted.

**P0-1 / F7, same tree:**

```
× pauses on AuthExpiredError without failing the job    expected 'completed' to be 'running'
× resume() makes ZERO create calls for terminal items   TypeError: engine.resume is not a function
× pauses when buildTopicMap throws                      expected 'failed' to be 'running'
```

**After the fixes:**

```
[budget] dedupe first run:  pendingAtStart=3 createCalls=3 duplicateTitleCreates=0
[budget] reauth resume:     terminalAfterPass1=3 pendingAtResume=3 pass2Creates=3 pass2Topics=0
[budget] three-way skip split: byUser=0 bySystem=0 duplicate=4 total=4
```

**The no-Tailwind guard, before the rewrite:** 53 offences across
`features/auth/AuthFlow.tsx` and `features/auth/SignInLanding.tsx`, and no other
file.

Two further guards were mutation-checked rather than merely observed passing:
forcing the destination enumeration to `PUBLISHED`-only turns four F15 tests
red, and emptying `DUPLICATE_SKIP_REASONS` turns the rewritten partition test
red.

---

## 5. What is NOT done, and what to check by hand

Stated plainly. Nothing below is blocked; all of it is genuinely outstanding.

### MANUAL-VERIFY items

- **`≡` (U+2261) in IBM Plex Mono.** The duplicate glyph was chosen for font
  coverage over a geometric-shapes alternative, but jsdom has no fonts and
  cannot confirm it renders. Check in a real browser during QA; substitute a
  bold ASCII `=` if it does not. Named in `OutcomeIcon.tsx`.
- **Native `<details>` keyboard toggling.** jsdom implements `<details>`
  toggling on *click* but not the Enter-key activation a real browser gives
  `<summary>`. The test asserts the element choice, focusability and click
  toggling, and says so in a comment rather than pretending to cover the
  keyboard path. Confirm Enter/Space in a browser.
- **A statically served production build.** The `signin-ui-rebuild` acceptance
  asks for `vite build` + `vite preview` with axe, checking both SVGs render
  small, no unstyled user-agent buttons, and zero asset 404s. The build was run
  and is clean, and axe passes under jsdom across the sign-in screen's four
  states — but **axe under jsdom cannot evaluate colour contrast or layout**,
  so the "not 898px" claim rests on the explicit `width`/`height` attributes
  (asserted in a test) rather than on a measured rendered box. A real-browser
  pass is still owed.
- **A live end-to-end OAuth round trip.** Everything here is exercised against
  injected doubles. No real Google credential has been used; `Part 4` of the
  handoff checklist is the acceptance test for that and has not been run.

### Deliberate deviations from the spec, and why

- **`TransferJobStatus.topicsCreatedOrMapped` is kept** as the derived sum of
  `topicsCreatedCount + topicsReusedCount`, alongside the two new fields. The
  MDB says to replace the *database column* — which was done. The stated reason
  for keeping the API field was that it "had existing client consumers"; that is
  **false**, and is corrected here (F8). Grepped: the only readers are
  `server/src/routes/transfer-jobs.ts`, which computes it, `shared`'s schema,
  which declares it, and four test fixtures that populate it. No component
  renders it. It is kept anyway because it is a zero-cost derived field on a
  response shape other clients may already be parsing, and removing it is a
  breaking API change bought for nothing — but the reason is compatibility, not
  a consumer that exists.
- **The 1e/1f/1g banner has no separate "Try again" button.** The wireframe
  sketches one; UI §3.1's table, which is the binding spec, describes only the
  banner below the existing CTA. Two controls with the same accessible name
  doing the same thing is worse than one. The Google button is the retry.
- **`AccountPicker.tsx` was deleted**, which the MDB does not explicitly
  instruct. It became unreferenced once `AuthFlow` stopped routing to it, and
  leaving a mock sign-in UI in the tree contradicts the non-negotiable it would
  otherwise satisfy only by accident.
- **`api-client.coldstart.test.ts` was repointed** from `listMockAccounts` to
  `listCourses`. It measures the request plumbing, not any one endpoint; the
  endpoint it used no longer exists in the client. What it asserts is unchanged.

### Tests that changed, and what they now assert

None were weakened to make anything pass. For the record:

- `shared/src/api-types.test.ts` — the partition case now derives from
  `SkipReasonSchema.options` and checks an exhaustive, pairwise-disjoint
  three-way partition. It is **strictly stronger**: the old version could not
  observe an unclassified reason at all.
- `client/src/features/auth/auth.test.tsx` — fully rewritten. The old suite
  asserted the mock account picker, a screen this phase deliberately removes.
  The new one covers all three failure states, the warm-up blocking-redirect,
  the callback landing, and the a11y properties of Google's button.
- `client/src/App.test.tsx` — the wizard walkthrough now enters with a live
  session rather than clicking through the picker, because the sign-in leg
  leaves this app for Google's domain and is driven in `auth.test.tsx` with an
  injected redirect. "Switch account" now asserts a return to the landing
  screen, which is where it goes now that the chooser is Google's.
- `client/src/features/summary/summary.test.tsx` — updated for seven tiles in
  two groups and the four/five-term reconciliation line. Both branches of the
  fifth term are tested, which the previous version could not express.
- `server/src/services/transfer-engine.test.ts`,
  `server/test/quality/reconciliation.budget.test.ts` — `topicsCreatedOrMapped`
  became `topicsCreatedCount + topicsReusedCount`. The claim under test (the
  topic counters are not terms in the sum) is unchanged.
- `server/test/google-oauth.integration.test.ts` — the success redirect now
  carries `?auth=callback`.

### Known-outstanding, out of this stage's scope

- The three system-interrupted skip reasons (`provider_error`,
  `server_interrupted`, `rate_limit_exhausted`) keep their pre-phase-2 generic
  pill treatment. UI §3.3 rules them explicitly out of scope; widening it here
  would have been scope creep.
- `docs/handoff/Connecting-To-Live-Google.docx` is superseded but not deleted,
  per the module's own instruction.
- The `.mock-note` CSS class name is now a misnomer — it carries the cold-start
  reassurance line, not a mock disclaimer. Renaming it touches four files for no
  behavioural gain; flagged rather than done.

---

## 6. Files changed in this stage

Modules 6–12 only; modules 1–5 landed in the prior session.

**Server** — `prisma/schema.template.prisma`, `src/config.ts`, `src/logger.ts`,
`src/app.ts`, `src/routes/auth.ts`, `src/routes/transfer-jobs.ts`,
`src/services/transfer-engine.ts`, `src/services/reconciliation.ts`,
`src/services/job-reconciler.ts`, `src/services/preflight-engine.ts`,
`src/services/post-enumerator.ts`, `src/services/notes.ts`,
`src/fixtures/index.ts`, `src/fixtures/seed.ts`, `package.json`

**Server tests** — `test/helpers/recording-provider.ts` (new),
`test/quality/dedupe.budget.test.ts` (new),
`test/quality/reauth-resume.budget.test.ts` (new),
`test/quality/reauth-grace.budget.test.ts` (new),
`test/quality/preflight-scan-cost.budget.test.ts` (new),
`test/fixtures.test.ts`, `test/google-oauth.integration.test.ts`,
`test/quality/reconciliation.budget.test.ts`,
`test/quality/executor-lease.budget.test.ts`,
`src/services/preflight-engine.test.ts`, `src/services/transfer-engine.test.ts`,
`src/services/job-reconciler.test.ts`,
`src/adapters/google/real-classroom-provider.test.ts`

**Shared** — `src/normalize.ts` (new), `src/normalize.test.ts` (new),
`src/api-types.ts`, `src/api-types.test.ts`, `src/notes.ts`, `src/index.ts`,
`package.json`

**Client** — `src/App.tsx`, `src/lib/api-client.ts`, `src/styles/tokens.css`,
`src/components/shared/Disclosure.tsx` (new),
`src/components/shared/OutcomeIcon.tsx`,
`src/components/shared/OutcomePill.tsx`, `src/components/shared/index.ts`,
`src/features/auth/AuthFlow.tsx`, `src/features/auth/SignInLanding.tsx`,
`src/features/auth/AccountPicker.tsx` (**deleted**),
`src/features/preflight/ReadyToTransfer.tsx`,
`src/features/summary/CompletionSummary.tsx`,
`src/features/transfer/TransferProgress.tsx`, `package.json`

**Client tests** — `src/test/quality/no-tailwind.quality.test.ts` (new),
`src/App.test.tsx`, `src/features/auth/auth.test.tsx`,
`src/features/preflight/preflight.test.tsx`,
`src/features/summary/summary.test.tsx`,
`src/features/transfer/transfer.test.tsx`,
`src/components/shared/shared.test.tsx`,
`src/components/shared/shared.a11y.test.tsx`,
`src/styles/contrast.a11y.test.ts`, `src/lib/api-client.test.ts`,
`src/lib/api-client.coldstart.test.ts`

**Root / docs** — `package.json`, `.env.example` (new),
`docs/handoff/connecting-to-live-google.md` (new), `docs/project-profile.md`

---

## 7. Handoff to QA

The single most valuable thing QA can do that this stage could not: **run the
live-OAuth checklist end to end against a real Google project**, and in
particular Part 4.2 — copy one item, then copy it again. That is the only
verification of the headline fix against a real Google Classroom rather than
against a double.

Second: a real-browser pass over the sign-in screen and the duplicate pill, for
the four MANUAL-VERIFY items in §5.

---

## 8. Revise pass — two reviewers' findings (2026-08-26)

Sources: `security-reports/2026-08-26-security-engineer.md` and
`critic-reports/2026-08-26-engineer-p1.md`. One bounded pass. Everything below
supersedes anything earlier in this file that contradicts it.

### E1 (critical) — `RealClassroomProvider` was never selected in production

`app.ts` built `new MockClassroomProvider(...)` unconditionally, `index.ts`
injected nothing, and `grep -rn "new RealClassroomProvider" server/src/` matched
only its own test file. `GOOGLE_PROVIDER_MODE` gated `createAccountDirectory`
and the mock auth routes — **never the classroom provider itself**. A teacher
could complete real Google OAuth and then have every course read, coursework
read and post creation served by the mock fixture world. The headline
requirement of this phase was not met.

**Why it could not be a one-line branch.** `RealClassroomProvider`'s constructor
is `(accountId, clients)` — read from
`server/src/adapters/google/real-classroom-provider.ts:304`, not assumed. It is
bound to ONE account because every real call carries that account's bearer
token, and it says so in its own comment: *"the composition root builds one of
these per acting account."* But the composition root builds exactly one provider
at boot, hands the same reference to `coursesRouter`, `PreflightEngine`,
`TransferEngine` and `JobReconciler`, and most of the port is deliberately
account-less (`listTopics(courseId)`, `countPosts(courseId)`,
`getRubric(courseWorkId)`). There is nowhere at composition time for the account
to come from. **Selecting the real provider therefore requires an
account-resolution seam, and that is the substance of this fix.**

What was built:

- **`GoogleClassroomProvider`** (`server/src/adapters/google/google-classroom-provider.ts`,
  new) — the app-lifetime `ClassroomProvider` for google mode. It owns no
  credentials; every method delegates to a `RealClassroomProvider` built for the
  account currently in scope.
- **`runForAccount`** — a new **optional** method on the port plus a
  pass-through helper (`server/src/adapters/acting-account.ts`). Account-agnostic
  adapters (the mock, and every test double) do not implement it, so their
  behaviour is unchanged; an adapter that needs the acting account takes it.
  `AsyncLocalStorage` carries the binding, so two concurrent jobs for two
  teachers cannot see each other's — which a mutable `this.current` could not
  promise.
- **Three scope entries**, at the only places that know who is acting: the
  authenticated request (`routes/courses.ts`, covering `GET /courses` and the
  pre-flight scan), the job executor (`TransferEngine.execute`, from
  `job.accountId`) and the reconciler's target verification
  (`JobReconciler.reconcileStaleJobs`, from the same field).
- **The bind is lazy, deliberately.** Loading the account's token can raise
  `AuthExpiredError`. The executor enters the scope *outside* the try that turns
  that error into a re-auth pause (F7's handling), so an eager bind would mark
  the job `failed` with no way back for exactly the routine case pause-and-resume
  exists for. `runForAccount` stores a thunk; the token is read on first use.
  There is a test for precisely this.
- **Boot-time fail-fast.** In google mode a resolved provider that is not the
  Google adapter refuses the boot, naming what it found. The `deps.provider`
  test seam is exempt only under `NODE_ENV=test`, so a production boot is guarded
  even against an explicit injection.
- **The stale comment is gone** — `'mock' is the only mode implemented in v1`
  was false and had been for two commits.

**The gap was the test, not the code.** 587 tests sat over this seam and none
touched it, because every one of them injects `deps.provider` explicitly, which
is exactly what hides the composition root's own choice. Closed by:

- `server/test/composition-root.test.ts` — provider **identity** per mode
  (`MockClassroomProvider` in mock, `GoogleClassroomProvider` in google, and the
  guard's refusal), which is the one fact the injection seam conceals.
- `server/test/acting-account-scope.test.ts` — a proxy that records whether each
  provider call arrived inside a scope, driven through the real HTTP routes, the
  executor and the reconciler. **Mutation-verified:** neutralising
  `runForAccount` to a bare `fn()` turns all four red. Plus two cases on
  `GoogleClassroomProvider` itself: an unscoped call throws rather than picking
  an account, and scope entry does not throw on an expired token.

Commit `5c9636a`.

### F1 — the third silent-drop, applied

`copyAttachmentToMyDrive` runs *before* `createWithBackoff`, so a token expiring
during attachment preparation reached `processItem`'s catch with `attemptedAt`
still null and nothing written anywhere — and `recordItemFailure` marked the post
terminal `skipped`/`provider_error` anyway. `resume()` dispatches `pending` items
only, so the post was **permanently lost while the ledger still balanced**.

An unattempted item now stays `pending` and the error is rethrown for the
re-auth pause path to own (`nothingWasAttempted` reads the row, not local state,
because the row is what `resume()` will read).

**The cost, stated:** a partially-completed attachment preparation re-copies the
Drive files it already copied on resume. A duplicated Drive copy is recoverable;
a silently dropped post is not.

**Red first.** Two new `reauth-resume` budget cases, run against the unfixed
tree:

```
× leaves the item PENDING when the token dies before anything was attempted
    AssertionError: a post that was never attempted was marked terminal:
    expected 'skipped' to be 'pending'
× resume() copies the post the pause interrupted — it is not silently lost
    AssertionError: expected 'skipped' to be 'transferred'
```

Commit `ccfebed`.

### F6 — the guard that did not guard, applied

The critic mutation-verified that reverting `execute()`'s `outcome: 'pending'`
item filter **alone** left `reauth-resume.budget.test.ts` green 7/7, because
§4.3's fix 3 diverts every `attemptedAt`-bearing item into `resolveFromEvidence`
before it can be dispatched. The rows that filter is the only guard for are the
ones that went terminal with `attemptedAt` **still null**, and nothing put one in
front of a resume.

A new case runs the F15 fixture pair, so four terminal `duplicate_title` rows
with `attemptedAt` null are present at resume. **Re-mutated to confirm:**
reverting the filter now fails `reauth-resume` and `dedupe.budget` together
(3 failed / 9 passed across the two files), where before it failed only
`dedupe`. Commit `ccfebed`.

### F2, F3, F4 — three false-green client tests, applied

- **F4** — `outcomeText` re-implemented the skip-reason partition as a hardcoded
  if-chain while `shared` exports `isUserSkip`/`isDuplicateSkip`, which the
  **server already uses** for `skippedByUser`. It now imports the shared
  predicates. Mutation-verified: dropping `cancelled_by_user` from a hardcoded
  list turns the new partition test red.
- **F2** — *"routes every consumer through ONE label function"* asserted five
  hardcoded literals and never rendered a pill or called `buildLogCsv`. It now
  renders `OutcomePill` for every member of `SkipReasonSchema` and `OutcomeSchema`
  and compares against `outcomeText`'s own answer; the CSV cases derive the
  Outcome column from `outcomeText` rather than spelling it, plus a new case that
  drives every skip reason through `buildLogCsv`. The MDB acceptance is
  *"asserted by import, not by duplicated string literals"* — it now is.
- **F3** — the 4b-vs-4c heading assertion read `.interrupt-head`'s full
  `textContent`, which includes the glyph span, so the glyph difference alone
  satisfied it — the any-one-of-three outcome its own docblock rules out. It now
  reads `.interrupt-head span:last-child`, and additionally asserts heading ≠
  glyph *within* each banner so neither check can be satisfied by the other's
  difference. Mutation-verified red by giving both banners the same heading.

Commit `3cbcee3`. **No test was weakened.** Every change above makes a test
assert strictly more than it did, and each was observed failing against a
mutation before being accepted.

### F5, F7, F8, F9, F11, E2 — applied

- **F5** — `docs/project-profile.md`'s *"every new row enters as advisory… nothing
  promotes itself"* was contradicted by the two rows registered **blocking**
  directly above it. `04-architecture.md` §8.1 grants that exception; the profile
  now records it, names both rows and the reason, and states the shape a future
  exception must take.
- **F7** — §2's `.env.example` grep claim listed two asymmetries where the grep
  finds four. `COLD_START_SIMULATE_DELAY_MS` and `MOCK_PROVIDER_DELAY_MS` are now
  named, with the reason omitting them from the file is right (both are forced to
  `0` under a production-like `NODE_ENV`).
- **F8** — the stated reason for keeping `topicsCreatedOrMapped` (*"the API field
  had existing client consumers"*) is **false**. Grepped: the only readers are the
  route that computes it, `shared`'s schema, and four test fixtures. Corrected to
  the real reason — API compatibility — rather than deleted.
- **F9** — `post-enumerator.ts` said *"all three courseWorkStates"* (there are
  two) and named a *"Scheduled post"* state Google does not have;
  `CompletionSummary.tsx` still described the reconciliation line as three terms
  after this stage made it four, or five when `skippedBySystem > 0`.
- **F11** — `hasRubric`'s `associatedWithDeveloper === true ||` disjunct means
  *"created by this API project"*, not *"has a rubric"*, and only ever widened an
  already-true predicate. Removed: no outcome changes, and the expression stops
  claiming a signal it never carried. The **residual inefficiency is real and is
  backlogged** — one `getRubric` per graded post at transfer time, mostly
  returning null.
- **E2** — `cross-account-isolation.test.ts` gains two cases driven by two
  distinct `GoogleAccount` identities, covering the session→identity half of
  §8.0/S5's missing foreign key. The job/scan half needs fixture courses owned by
  a `GoogleAccount` id, which the mock fixture world does not have; that is
  stated in the test's own docblock and backlogged rather than faked.

Commits `92acdd2` (code and docs), `db6f2db` (backlog).

### Deferred, with reasons

Recorded in `backlog.md` under *Engineer DEFER findings — revise pass*.
`backlog_add` refuses to write that file because it already holds hand-authored
sections it did not generate; the entries follow the convention the architect
pass established in the same file rather than discarding that content.

- **F12 — many-to-one duplicate matching. A product decision, not a patch.** Two
  source posts sharing a title both match the single destination post and are
  both skipped as `duplicate_title`, so the second is never copied. Both options
  and their costs are written out in the backlog; **no behaviour was silently
  chosen**. Whichever the PM rules must be seeded in F15 and asserted as provider
  create calls.
- **F10 — the no-Tailwind guard matches only a literal `className="…"`.** A
  conditional or variable className is invisible to it. No such call site exists
  in `client/src` today, and this project's discipline says a widened guard must
  first be proven red against a real positive — so it is fixed the next time a
  conditional className is genuinely introduced, red-first, in the same pass.
- **F11 residual** and **E2 residual**, as described above.

### Verification — real numbers, this pass

Run at commit `db6f2db`, whole repo, from a clean tree.

```
npm test
  shared     26 /  26 pass  ( 2 files)
  server    324 / 324 pass  (33 files)
  client    253 / 253 pass  (12 files)

npm run build    exit 0 — shared, server, client
                 client bundle 304.63 kB / 92.77 kB gzip
npm run lint     exit 0 (eslint, whole repo)
```

Server went from 310 to 324 (+14: 4 composition-root/scope identity, 2
`GoogleClassroomProvider` binding, 3 `reauth-resume` F1/F6, 2 cross-account
GoogleAccount, plus 3 from suite re-counting). Client went from 251 to 253 (+2:
the F2 partition case and the F2 CSV enum case).

**All 17 quality budgets green:**

| Budget | Result |
|---|---|
| `test:budget:dedupe` **(blocking)** | 2/2 |
| `test:budget:reauth-resume` **(blocking)** | **10/10** (was 7/7 — F1 ×2, F6 ×1) |
| `test:budget:reconciliation` | 9/9 |
| `test:budget:totality` | 8/8 |
| `test:budget:reconcile` | 5/5 |
| `test:budget:reauth-grace` | 6/6 |
| `test:budget:lease` | 3/3 |
| `test:budget:courses` | 3/3 |
| `test:budget:preflight-scan-cost` | 2/2 |
| `test:budget:f1` / `f13` / `f12` | 1/1 each |
| `test:lease-mp` | 1/1 |
| `test:perf` | 1/1 |
| `test:budget:a11y` | 46/46 |
| `test:budget:coldstart` | 8/8 |
| `test:budget:no-tailwind` | 2/2 |

### MANUAL-VERIFY, added by this pass

- **The real provider has never made a real call.** E1 proves the composition
  root now *selects* `GoogleClassroomProvider` in google mode and that every path
  into it names an acting account. It does **not** prove a live Google request
  succeeds — no real credential was used at any point in this stage. Part 4 of
  `docs/handoff/connecting-to-live-google.md` remains the acceptance test, and it
  has still not been run.
- **`GoogleClassroomProvider`'s delegation is exercised against a fake
  transport only.** `RealClassroomProvider`'s own suite covers the translation;
  the binder's tests cover scoping and laziness. Nothing has driven the two
  together against Google.
- **The token is re-read per scope, not cached.** One `GoogleAccount` row read
  plus one AES-GCM decrypt per request and per job entry. Correct and staleness-
  free by construction, but its cost against a real deployment is unmeasured.

### Files changed in this pass

**Server** — `src/app.ts`, `src/adapters/classroom-provider.interface.ts`,
`src/adapters/acting-account.ts` (new),
`src/adapters/google/google-classroom-provider.ts` (new),
`src/adapters/google/real-classroom-provider.ts`, `src/routes/courses.ts`,
`src/services/transfer-engine.ts`, `src/services/job-reconciler.ts`,
`src/services/post-enumerator.ts`

**Server tests** — `test/composition-root.test.ts`,
`test/acting-account-scope.test.ts` (new), `test/cross-account-isolation.test.ts`,
`test/quality/reauth-resume.budget.test.ts`

**Client** — `src/components/shared/OutcomePill.tsx`,
`src/features/summary/CompletionSummary.tsx`

**Client tests** — `src/components/shared/shared.test.tsx`,
`src/features/summary/summary.test.tsx`,
`src/features/transfer/transfer.test.tsx`

**Docs** — `docs/project-profile.md`,
`docs/features/real-google-integration/05-implementation.md`,
`docs/features/real-google-integration/backlog.md`

---

## 9. QA revise pass, cycle 2 — the four QA findings (2026-08-26)

**Supersedes anything earlier in this file that it contradicts**, including §1's
and §8's claims about the production boot guard.

### Orientation (written as it stood at orientation, not corrected afterwards)

**Mode C**, feature jump-in, revise. Inputs read before touching code:
`06-qa-report.md` (in full), `02-ux-workflow.md` §1/§3/§5 and Acceptance
Scenarios 10, 13 and 16, `03-ui-direction.md` §3.1/§6/§7,
`wireframes/02-duplicate-and-topic-preflight-disclosure.md` §2c and its
all-duplicate edge case, `docs/project-profile.md` (verify recipe, quality
budgets, Lessons learned), and — for each finding — the actual source and the
actual tests, before writing a word about them.

**Conventions committed to:** no Tailwind (shape-scanned by
`test:budget:no-tailwind`); the token system in `tokens.css` for every style;
`useRef` + `useEffect` + `tabIndex={-1}` for focus-on-mount, matching
`CompletionSummary`'s v1 pattern rather than inventing a second one; the shared
`NarrationBanner` constant rather than literals at call sites; colocated
`*.test.ts(x)` beside the code, with `server/test/` for integration; the
`token-crypto.test.ts` `boot()` pattern for testing import-time config
resolution.

**Lessons learned this plan answered** (from `docs/project-profile.md`, named
rather than gestured at):

- *"Read the file before asserting what it does."* Every finding here is an
  instance. Nothing in this pass was described from a doc: the boot was
  reproduced against `dist`, the banner was read out of the rendered DOM, and
  the focus position was measured with `document.activeElement`.
- *"A test's assertion must be at least as strong as its own name and comment."*
  This is now nine recorded instances, and three of the four findings were
  pinned by a green test asserting the wrong thing. Every test changed below
  says what it now asserts and why that is stronger, never merely different.
- *"A regression guard grepped from one symptom's literals is a record of that
  cleanup, not a guard."* Directly shaped QA-2's test: swapping one literal for
  another would have recorded this fix and guarded nothing, so the copy is
  asserted *and* the claim is asserted independently of the wording.
- *"When a bug is invisible from the outcome side, the assertion must not be an
  outcome assertion."* Shaped QA-4: `document.activeElement`, which is what QA
  measured, not the presence of a `tabIndex`, which passes against a component
  that never calls `.focus()`.

**Conflicts with `04` flagged:** none. All four fixes sit inside the
architecture as designed; QA-1 tightens `04` §8.3's own stated contract rather
than changing it.

**Cost estimate on file:** `WARNING: starting unestimated` — no estimate could
be joined, because `04-architecture.md`'s Module Declaration Block covers the
original 12 modules and this is a QA revise slice with no MDB of its own. That
is the "no parsed MDB to join on" case, not a missing-estimate case.

### QA-1 (blocker) — the production boot now refuses the fixture world

QA reproduced live that `NODE_ENV=production` with `GOOGLE_PROVIDER_MODE`
omitted booted cleanly and logged `providerMode:"mock"`. PM brief §7.1a, §8.3 of
`04-architecture.md`, and this file's own §1 all claimed otherwise.

The cycle-1 guard covered one direction: *mode is `google` but the provider is
not*. Two things covered the other direction with nothing at all — `?? 'mock'`,
and the `as 'mock' | 'google'` cast, which meant a **typo** was as dangerous as
an omission, since every consumer tests `=== 'google'` and anything else simply
behaves as mock.

`config.ts` now resolves the mode through `resolveGoogleProviderMode()`, which
refuses an unrecognised value in **any** environment and refuses mock/unset when
the environment is production-like. The `'mock'` default is deliberately kept
for non-production: it is right for a laptop and for the whole test suite, and
the guard belongs on the *environment*, which is the thing that actually
distinguishes Render from a laptop. `app.ts` carries the matching
second-direction guard as defence-in-depth, for callers reaching `buildApp` with
a config mutated after import.

The message's reader is a teacher looking at a failed Render deploy, so it names
the variable, the exact value, the Environment settings page, what the wrong
value would have *done*, and where the full variable list lives.

**Live, against the built `server/dist` — QA's exact reproduction:**

```
$ SESSION_SECRET=... DATABASE_URL=... NODE_ENV=production PORT=4099 node dist/src/index.js
Error: [config] GOOGLE_PROVIDER_MODE=google is required for a live deployment,
and it is not set. Refusing to boot: without it Classroom Copier would show
made-up demo courses instead of your real Google Classroom, and any copy you
started would go nowhere. To fix: open this service in the Render dashboard, go
to Environment, add GOOGLE_PROVIDER_MODE=google, and redeploy. …
exit 1
```

`GOOGLE_PROVIDER_MODE=mock` → exit 1. `GOOGLE_PROVIDER_MODE=typo` → exit 1.
`GOOGLE_PROVIDER_MODE=google` → boots.

### QA-2 (blocker) — the notice flips from warning to reassurance

`DUPLICATE_RUN_NOTICE` still carried v1's sentence, shown on Source & Target
Selection and Ready to Transfer. The new copy is taken from `wireframes/02` §2c,
not invented, and keeps PM §6.7's non-goal in the same breath so the reassurance
is not a promise the engine does not keep:

> Classroom Copier checks for items that already exist and skips them — safe to
> run more than once. Matches are found by title, so content changes since the
> last run aren't detected.

**The amber was the other half of the same claim.** `.notice` is the warning
treatment; leaving it would have told a teacher "careful" in colour while the
sentence said "safe". A `reassurance` variant now uses the teal pairing
`.outcome-duplicate` already uses for "Already in course" — so the promise and
the outcome that keeps it read as the same thing — and the glyph moves from `!`
to the wireframe's `(i)`. **Three** call sites were updated, not the two QA
named: the third was the a11y suite's own render.

### QA-3 (major) — the headline counts "X of Y"

`copyableCount()` = scanned − duplicates. The form is uniform, never conditional
on duplicates existing: "42 of 42" on a first run is the same sentence as
"38 of 42" on the second, so a teacher reading the screen twice reads one
sentence, not two.

Acceptance Scenario 13's all-duplicate re-run — the *expected, successful*
outcome of the product's headline promise — gets its own note, which **replaces**
the "everything lands as Drafts" reassurance rather than joining it, because
nothing lands. It is kept distinct from D26's empty-course state: same zero on
screen, two different facts, two different sentences.

Two E2E specs QA did not name (`clean-transfer`, `refresh-resume`) asserted the
old form and were updated.

### QA-4 (major) — focus moves to the new screen, on all six

`role="alert"` was already correct everywhere and is **not** this. It announces
without moving anyone: a teacher was told the sign-in failed, or that the
transfer needed attention, and left standing at the top of the document with the
whole page still between them and the control the announcement was about.

| Screen | Target | Keyed on |
|---|---|---|
| 1d callback landing | the "Signing you in…" title | `stage` |
| 1e/1f/1g sign-in failures | the `.signin-error` banner | `authError`, **not** mount |
| 4a session expired mid-wizard | `ErrorState`'s heading | mount |
| 4b/4c mid-transfer interrupts | each `.interrupt-banner` | whether the banner is up |

Two of those keys are the whole point. **1e/1f/1g cannot key on mount:** 1g
arrives *after* mount (render clean → click → fetch fails), so a mount-only
effect would have covered two states and missed the one reached by actually
using the screen. **4b/4c cannot key on the status object:** that screen polls
about once a second, and a teacher who tabbed to the button must not be yanked
back by the next tick.

### Other stale v1 claims found while fixing these

The assignment asked for a sweep. Swept `client/src`, `server/src/routes` and
`shared/src` for user-facing strings matching `yet`, `does not check/support/
detect`, `simulated`, `for now`, `not implemented`; and the docs for the
duplicate warning's claim.

- **`.env.example` lines 41–43** already asserted the QA-1 fail-fast existed.
  The claim was false when written; it is true as of this pass. No edit needed —
  worth recording that a doc was *ahead of* the code rather than behind it.
- **`preflight.test.tsx`'s file header** cited "Scenario 6 (duplicate-run
  **warning** restated verbatim)" — a v1 scenario number and v1's word. Corrected
  to this phase's Scenarios 10, 12, 13 and 16.
- **`selection.test.tsx`** cited "Scenario 6" in a case name. Corrected to 16.
- **The Playwright E2E suite** describes a sign-in screen that no longer exists
  (`Sign in with Google (mock)` plus an in-app account row). Nothing went red
  because the suite is not in the verify recipe. Same shape as QA-2/QA-3;
  **filed in `backlog.md`**, not fixed here — fixing it is new work.
- No other stale user-facing claim found.

### Tests that changed, and what they now assert

Never weakened; each is at least as strong as before.

| Test | Before | Now |
|---|---|---|
| `shared.test.tsx` NarrationBanner copy | asserted v1's literal, citing the v1 scenario | asserts the new literal **and, separately, the claim** — must match `/checks for items that already exist/` and `/safe to run more than once/`, must **not** match `/creates duplicate/`, `/does(n't\| not) check/` or a bare `yet`; register checked (no exclamation points); the title-only limit checked |
| `selection.test.tsx` notice | asserted the shared constant (which was stale, so it passed anyway) | asserts the **rendered** text against the claim as well as the constant; citation corrected to Scenario 16 |
| `preflight.test.tsx` Ready-to-Transfer headline | asserted `Ready to copy 42 posts` — the un-excluded count | asserts the verbatim `42 of 42` form, plus a new duplicates-present case asserting the headline **leads with the copyable count and does not lead with the un-excluded one** |
| `preflight.test.tsx` notice | asserted the constant | asserts the rendered claim too |
| `composition-root.test.ts` | 5 cases, none covering production-mock boot | +3: the production-like mock refusal, a message-content case requiring `GOOGLE_PROVIDER_MODE=google`, and a negative case proving mock still boots outside production. Both directions now sit in one `describe` so neither can be deleted unexplained |
| `health.test.ts` ×3 | set `NODE_ENV=production` without a provider mode, so after QA-1 they threw for the **wrong reason** — the `SESSION_SECRET` case would have stayed green while no longer exercising its own contract | each sets the full production-google environment and varies only its own variable. Same assertions, now actually reached |
| `contrast.a11y.test.ts` | 13 pairings; `teal-700`/`teal-100` was shipping in `.outcome-duplicate` and unaudited | 14 pairings |
| `shared.a11y.test.tsx` | rendered the banner with the warning glyph | renders the reassurance variant, which is what ships |

New tests with no predecessor: Scenario 13's all-duplicate case (which had none
at all), and 9 focus cases including three negatives — a clean 1a landing does
not steal focus, the banner-appears-after-mount path, and a poll tick not
re-stealing focus from the button.

### The red-first evidence

Every one of the 22 new or rewritten cases was observed **failing against the
unfixed tree** before its fix, in the order below.

```
QA-1  server  6 failed  (config.test.ts ×3 + message case; composition-root ×2)
QA-2  client  4 failed  (shared ×2, selection ×1, preflight ×1)
QA-3  client  3 failed  (headline verbatim, duplicates-present, all-duplicate)
QA-4  client  9 failed  (1d, 1e/1f/1g ×3, after-mount, 4a, 4b, 4c, no-re-steal)
```

### Verification — real numbers, this pass

Run at commit `5be3fb2`, whole repo.

```
npm test
  shared     26 /  26 pass  ( 2 files)
  server    333 / 333 pass  (34 files)
  client    268 / 268 pass  (12 files)
  total     627 / 627       (was 603 — +24)

npm run build    exit 0 — shared, server, client
                 client bundle 305.75 kB / 93.09 kB gzip
                 (was 304.63 / 92.77 — +1.12 kB raw, +0.32 kB gzip: the
                  reassurance-banner CSS, the all-duplicate note, and five
                  focus effects)
npm run lint     exit 0 (eslint, whole repo)
npm run check:citations   zero unresolved citations (260 across 18 docs)
```

Server +9: 6 QA-1 cases plus 3 suite re-counts. Client +15: 4 QA-2, 3 QA-3, 9
QA-4, less one replaced case, plus the added contrast pairing.

**All 17 quality budgets green, re-run this pass:**

| Budget | Result |
|---|---|
| `test:budget:dedupe` **(blocking)** | 2/2 |
| `test:budget:reauth-resume` **(blocking)** | 10/10 |
| `test:budget:reconciliation` | 9/9 |
| `test:budget:totality` | 8/8 |
| `test:budget:reconcile` | 5/5 |
| `test:budget:reauth-grace` | 6/6 |
| `test:budget:lease` | 3/3 |
| `test:budget:courses` | 3/3 |
| `test:budget:preflight-scan-cost` | 2/2 |
| `test:budget:f1` / `f13` / `f12` | 1/1 each |
| `test:perf` | 1/1 |
| `test:budget:a11y` | **47/47** (was 46 — the teal pairing) |
| `test:budget:coldstart` | 8/8 |
| `test:budget:no-tailwind` | 2/2 |

### Verified in a real browser, not just in jsdom

Chromium, against the real client dev build proxying a real server in mock mode,
signed in through the server's own mock-auth endpoints (the client picker is
gone), driving the **F15 fixture pair** — the same 7-scanned/4-duplicate
fixture QA used.

- **Selection screen:** the teal reassurance banner with the `i` glyph, reading
  the new copy. (QA saw v1's amber warning.)
- **Ready to Transfer:** headline reads **"Ready to copy 3 of 7 posts"**. QA
  measured "Ready to copy 7 posts" against this exact fixture. The separate
  disclosure line ("4 of 7 items are already in the destination course and will
  be skipped") and both expandable panels still render.
- **Consent-denied sign-in state:** `document.activeElement` is the
  `.signin-error` banner, `role="alert"`. QA measured `<body>`.

### MANUAL-VERIFY, added by this pass

- **The all-duplicate screen (Scenario 13) was not driven in a browser.** It is
  unit-tested, but reaching it live needs a destination pre-populated to match
  every source title, which the F15 fixture is deliberately not. The 3-of-7
  case *was* driven live and shares the same code path.
- **Focus-on-mount for 4b/4c was not driven in a browser** — both need a live
  mid-transfer 401 or Google-token expiry, the same states QA could not reach.
  Unit-tested against `document.activeElement`; 1e/1f/1g and the mechanism they
  share were confirmed live.
- **Everything QA left open stays open**, unchanged by this pass: the live
  end-to-end OAuth round trip (`docs/handoff/connecting-to-live-google.md`
  Part 4) and the native `<details>` Enter/Space keyboard toggle, which QA
  control-tested to a tooling limitation rather than a product defect.

### Files changed in this pass

**Server** — `src/config.ts`, `src/app.ts`

**Server tests** — `src/config.test.ts` (new), `src/routes/health.test.ts`,
`test/composition-root.test.ts`

**Client** — `src/components/shared/NarrationBanner.tsx`,
`src/components/shared/ErrorState.tsx`, `src/features/auth/AuthFlow.tsx`,
`src/features/auth/SignInLanding.tsx`,
`src/features/selection/SelectionScreen.tsx`,
`src/features/preflight/ReadyToTransfer.tsx`,
`src/features/transfer/TransferProgress.tsx`, `src/styles/tokens.css`

**Client tests** — `src/components/shared/shared.test.tsx`,
`src/components/shared/shared.a11y.test.tsx`,
`src/features/auth/auth.test.tsx`, `src/features/selection/selection.test.tsx`,
`src/features/preflight/preflight.test.tsx`,
`src/features/transfer/transfer.test.tsx`,
`src/styles/contrast.a11y.test.ts`

**E2E** — `e2e/specs/clean-transfer.spec.ts`, `e2e/specs/refresh-resume.spec.ts`

**Docs** — `docs/features/real-google-integration/05-implementation.md`,
`docs/features/real-google-integration/backlog.md`

---

## 10. QA revise pass, cycle 3 — the missing Drive scope (2026-08-26)

**Supersedes §2's and §8's description of the shipped `GOOGLE_SCOPES` array.**
Everything else in §1–§9 stands as written; the preserved-premise convention is
deliberate and this section does not edit the earlier ones.

### Orientation (written as it stood at orientation, not corrected afterwards)

**Mode C**, feature jump-in, revise, tightly scoped to two findings.

Inputs read before touching code: `06-qa-report.md` Cycle 2 §C2.6 and the
QA-doc-1 note; `04-architecture.md` §2 (lines 125–145) and §7/S9 (lines
1785–1800); `docs/project-profile.md` (verify recipe, quality budgets, Lessons
learned); and — before writing a word about either — the actual files:
`oauth-client.ts` in full, `real-classroom-provider.ts`'s Drive region
(lines 595–670), every test that mentions a scope URL, all four `.env*.example`
files, and `docs/handoff/connecting-to-live-google.md` end to end.

**Conventions committed to:** colocated `*.test.ts` beside the code it pins;
`vitest` with `describe`/`it`; the shape-based source-scan pattern already
established by `client/src/test/quality/no-tailwind.quality.test.ts`; scopes
asserted **by import** from `GOOGLE_SCOPES`, never by a duplicated literal; no
Tailwind; nothing logged that could carry a token or a googleapis payload.

**Lessons learned this plan answered** (named, from `docs/project-profile.md`):

- *"Read the file before asserting what it does."* QA-7 is the ninth instance
  and the sharpest: `04-architecture.md` had the right answer written down in
  two places, and the code never received it. This pass read
  `real-classroom-provider.ts`'s Drive region rather than trusting that
  `driveFileHealth` was the only Drive caller — it is not; `files.copy` is the
  second, and it is covered below.
- *"A regression guard grepped from one symptom's literals is a record of that
  cleanup, not a guard."* A test asserting nine scope strings would go green the
  moment someone edited the array and the test together. The guard added here
  matches the **shape** of the defect instead: it derives the requirement from
  the Drive calls the provider source actually contains.
- *"A test's assertion must be at least as strong as its own name and comment."*
  Each of the three new assertions was mutation-proven red before being trusted
  (evidence below), and each conditional requirement carries a guard against
  passing vacuously on a stale table.

**No conflict with `04` was found.** The architecture was already correct; this
is an implementation gap closing against it, not a design change.

### QA-7 (major) — `drive.metadata.readonly` restored to `GOOGLE_SCOPES`

**The defect.** `server/src/adapters/google/oauth-client.ts` shipped eight
scopes with `drive.file` as the only Drive grant. `drive.file` grants access
**only** to files the app itself created or the user explicitly opened with it.
`RealClassroomProvider.driveFileHealth()` (`real-classroom-provider.ts:625-626`)
calls `drive.files.get` on the Drive file id a **pre-existing** Classroom
attachment names — a file the teacher created long before this app existed.
Against live Google those reads would 403/404; the `catch` maps those to
`'permission_locked'`/`'deleted'` rather than crashing, so the failure would be
silent and total: a healthy course presenting as entirely broken, with the
Action Sheet Modal on nearly every item of a teacher's first live transfer.

`04-architecture.md:136-137` designed for **both** Drive scopes, and `:1794`
states plainly that "`drive.file` alone cannot provide it." The kickoff audience
decision (`state.json` `stages.kickoff.decisions[]`) had already settled that
restricted scopes carry **no verification cost** at this audience — Testing
mode, ≤100 listed users — so there was never a reason to avoid it.

**The fix.** One line added to `GOOGLE_SCOPES`:
`https://www.googleapis.com/auth/drive.metadata.readonly`, placed before
`drive.file`. The array's doc comment was rewritten: it previously explained
only why `drive.file` was chosen over `drive`, which is exactly the framing that
let the missing scope survive — it answered "is this too much access?" and never
"is this enough?"

**Why two reviews read past it.** The security-architect pass (S9) and the
security-engineer pass both looked at these lines and both asked only about
exposure and blast radius. A sufficiency question was never put to them. That is
the recurring pattern this project now tracks: **read the thing itself, and ask
what it must do, not only what it must not do.**

### Every place that asserts or duplicates the scope list — checked, not assumed

Searched exhaustively for `googleapis.com/auth`, `GOOGLE_SCOPES`, `drive.file`
and `drive.metadata` across `server/`, `shared/`, `client/`, `e2e/`, all four
`.env*.example` files and `docs/`:

| Location | Holds a scope list? | Action |
|---|---|---|
| `server/src/adapters/google/oauth-client.ts` | **Yes — the only source of truth** | Scope added; comment rewritten |
| `server/test/google-oauth.integration.test.ts:50` | No — a `scopesGranted` **fixture string** on a fake token, not an assertion about the request | None. Changing it would assert nothing |
| `server/test/account-directory.contract.test.ts:40`, `cross-account-isolation.test.ts:152` | No — same fixture shape | None |
| `.env.example`, `server/.env.example`, `client/.env.example` | No — scopes are requested in code, never configured | None |
| `docs/handoff/connecting-to-live-google.md` | Told the operator **not** to add scopes by hand (correct), but never previewed the consent screen | Fixed under QA-doc-1 below |
| `04-architecture.md`, `01-pm-brief.md` | Already specify both Drive scopes | None — the docs were right |

**No hardcoded scope-list literal existed in any test**, so the false-green
shape this run has hit nine times was not present here to remove. The new test
keeps it that way by construction: it imports `GOOGLE_SCOPES` and never retypes
a scope string outside the `grantedBy` capability table, whose entries are
alternatives Google itself accepts, not a copy of what is shipped.

### The new test pins the capability, not the string

`server/src/adapters/google/oauth-scopes.test.ts` (new, 4 assertions).

It reads `real-classroom-provider.ts` as **text**, extracts every
`this.clients.drive.<resource>.<method>(` call it contains, and holds a table
mapping each to the capability it needs and the set of scopes any one of which
grants it. Three guarantees:

1. **`has a capability entry for every Drive method the provider calls`** — the
   extracted call set must equal the table's declared set. A new Drive call
   added without a scope review goes red. This is the assertion that answers the
   assignment's "check whether anything else calls a Drive method": it makes the
   check permanent rather than a one-time reading.
2. **`grants a scope that can <capability> (<method>)`**, one per table entry —
   `GOOGLE_SCOPES` (imported) must intersect that entry's `grantedBy`. Each
   first asserts its call site still exists in the source, so a stale table
   cannot make the requirement pass vacuously.
3. **`carries every declared scope in the authorization URL it builds`** —
   parses the real `buildAuthorizationUrl()` output and compares its `scope`
   parameter to `GOOGLE_SCOPES` by import. Without this, the array could satisfy
   every capability and still be one nobody sends.

**Red-first evidence — each assertion was observed failing, for its own reason:**

- Assertion 2 was written and run **before** the scope was added:
  `AssertionError: no granted scope can "read metadata of a Drive file this app
  did not create" for drive.files.get; one of .../drive.metadata.readonly,
  .../drive.readonly, .../drive is required: expected [] to not have a length of
  +0`. That is the shipped defect, caught by the shipped test.
- Assertion 1 was proven red by temporarily adding a `drive.permissions.list`
  call to `real-classroom-provider.ts` — an undeclared Drive method — and
  observing the failure. Reverted.
- Assertion 3 was proven red by temporarily mutating `buildAuthorizationUrl` to
  filter `drive.metadata` out of the scopes it sends. Reverted.

Both mutations were applied and reverted in the same step; the suite is green on
the real tree.

### The other Drive caller, and the residual it leaves

`copyAttachmentToMyDrive()` (`real-classroom-provider.ts:646`) calls
`drive.files.copy` — the second and only other Drive method in the file. Its
**write** half is squarely `drive.file`'s case (the copy lands in the acting
teacher's own Drive as a file this app created), which is how the architecture
scoped it and is not re-opened here.

- **MANUAL-VERIFY:** `files.copy` also needs read access to the **source**
  file, and neither `drive.file` (app-created files only) nor
  `drive.metadata.readonly` (metadata, not content) plainly grants that for a
  teacher's pre-existing attachment. There is no Drive Picker in this app, so
  the "user explicitly opened it with this app" route is not available either.
  This is a distinct question from QA-7, it was **not** re-litigated in this
  cycle per the assignment's scope, and it is filed to the backlog. Confirm it
  during the live-OAuth checklist's first "Copy to My Drive" action — the same
  live run that already has to confirm `classroom.topics` read sufficiency.
- No other Drive surface is touched anywhere in `server/src`. Rubrics go through
  the Classroom client's generic `request()`, not Drive.

### QA-doc-1 (minor) — the consent screen, previewed for the teacher

`docs/handoff/connecting-to-live-google.md` correctly told the operator not to
add scopes by hand, but never said what Google's consent screen would actually
**show**. PM brief §7.3 asked for both. Added, in the register of the
surrounding document — a teacher, not a developer:

- A **"What Google will ask you to approve"** block in step 4.1, listing the
  five things the consent screen presents in plain language, including the Drive
  metadata read. It carries the sentence `04-architecture.md` §7/S9 specified
  verbatim: the app reads file names and sharing settings to check whether an
  attachment will copy, and never opens or downloads their contents.
- A **troubleshooting line for the QA-7 scenario** in step 4.2 — if every
  attachment shows as unavailable, the permissions were not all granted;
  disconnect and sign in again, approving everything. That symptom is precisely
  what a dropped Drive scope produces, and without this line it reads as "all my
  files are broken."

### Verification — real numbers (cycle 3)

| Step | Result |
|---|---|
| `npm test` — shared | **26 passed** (2 files), 221ms |
| `npm test` — server | **337 passed** (35 files), 38.75s — was 324; **+13** |
| `npm test` — client | **268 passed** (12 files), 5.66s — unchanged |
| `npm run build` | **passed** — shared `tsc`, server `tsc`, client `tsc -b` + `vite build`, 133 modules, 720ms, `index-Zo5ActC3.js` 305.75 kB / 93.09 kB gzip |
| `npm run lint` | **passed**, no output |
| `npm run check:citations` | **passed** — 260 citations across 18 docs, zero unresolved |
| `agent-c-budgets.js run` | **16/16 PASS**, including both blocking rows (`duplicate_dedupe_fixture`, `token_failure_pause_resume_fidelity`) |

Server's +13 is 4 from this pass's new `oauth-scopes.test.ts` and 9 already
landed by the cycle-2 pass after §9's numbers were written.

### Files changed in this pass

**Server** — `src/adapters/google/oauth-client.ts`

**Server tests** — `src/adapters/google/oauth-scopes.test.ts` (new)

**Docs** — `docs/handoff/connecting-to-live-google.md`,
`docs/features/real-google-integration/05-implementation.md`
