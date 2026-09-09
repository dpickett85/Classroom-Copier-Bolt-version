# Feature Brief — Real Google Integration & Duplicate Prevention (Phase 2)

> Source of truth for Phase 2's what & why. Written by the Sr. Product Manager
> under Beast Mode (auto-accepted recommendations, recorded via
> `stage_record_decisions`, source `beast-mode-auto`). Date: 2026-08-23.
>
> Track: `docs/features/real-google-integration/`, **scopeMode: "open"** — this is
> a full product revision, not a bolt-on feature. Downstream stages read §9
> **Scope of change** as their scoping contract instead of the
> conform-by-default rule.
>
> Parent product: **Classroom Copier** (`docs/product/01-pm-brief.md`,
> qc/approved-complete, READY WITH CAVEATS). The parent stays untouched as the
> reference; this brief revises its *what & why* for the live-Google phase.
>
> Inputs read: `inputs/directions.md` (authoritative Phase-2 scope, with kickoff
> annotations), `inputs/prior-session-bug-inventory.md` (Section A is the
> current, verified state of the repo), the six binding kickoff decisions in
> `state.json`, the v1 brief/backlog/QA/QC reports, and `docs/project-profile.md`.
>
> **Revision 1 (2026-08-23):** applies critic pass 1 (F1 topic dedupe, F2
> skip-precedence, F3 inline tag, F4 C7) and folds in two measured inputs that
> landed after the first draft: `inputs/verify-baseline.md` (the verify recipe
> was actually run) and `inputs/b15-two-big-icons-diagnosis.md` (B15 reproduced
> and root-caused).

**Product type:** GUI app (web) — React/Vite frontend + Node/Express backend,
unchanged. Deployment target: two Render services (static site + Node web
service with PostgreSQL).

**Git baseline:** branch `phase2/real-google-integration`. Per kickoff decision
(binding): the engineer **restores the v1 build configuration from commit
`0694779`** and re-applies the *intent* of the prior session's changes
(real provider, real auth) on top — `06c3d05` is not a baseline to patch
forward (regressions A1–A9 in the bug inventory are verified against the tree).

---

## 0. Premise check — what this phase is, honestly

Two distinct things happened since v1 shipped as READY WITH CAVEATS:

1. **The planned follow-on came due.** v1 was mock-first by explicit user
   directive; "Real Google integration" was the top-priority open backlog item
   and QC's #1 recommended next slice. The Directions activate it.
2. **The repo regressed.** A prior LLM session (which could not read the repo)
   guided 9 hand-edits in the GitHub web UI (`4a879d9..06c3d05`) that gutted the
   root `package.json`, broke the workspace link, downgraded majors, repointed
   every test script at nonexistent paths, and rewrote the composition root.
   The QC-certified v1 verification surface (365 tests, 11 budgets) is
   **unrunnable at HEAD — now measured, not inferred** (`inputs/verify-baseline.md`,
   run 2026-08-23 at `06c3d05`): `npm test` and `npm run lint` are *missing
   scripts*; the root `npm run build` goes green but silently excludes the
   server; `npm run build --workspace=server` fails with **19 TypeScript
   errors from five root causes** — the backend does not compile at all. The
   green root build is itself a trap: a CI or Render build would pass while
   shipping a broken backend.

Phase 2 therefore has a double definition: **deliver the real integration** and
**restore the verification surface it must be verified against.** A phase that
delivered live OAuth on top of a broken test harness would be un-QC-able and
would repeat exactly the failure mode that produced A1–A9.

**Directions vs. reality — conflicts found and resolved** (each recorded as a
decision; none papered over):

| # | Directions say | Reality | Resolution |
|---|---|---|---|
| C1 | "Remove all mock/test auth states" | The mock backs all 365 tests, 11 budgets, and the contract suite | Scoped to the **deployed app**: mock retained as test-only double; production build cannot select it (kickoff decision, binding; acceptance criteria in §7) |
| C2 | "Ensure stylesheets (Tailwind/CSS) are imported in main.tsx" | The app never used Tailwind; `tokens.css` is a WCAG-AA-verified token system already imported correctly | No Tailwind (kickoff decision, binding). Fix the reported defects within the token system |
| C3 | Two OAuth scopes named | v1 brief already established the list is incomplete; PM review here found a further omission (topics) | Full scope list decided in §8; architect reconciles against actual API calls |
| C4 | "Root package.json must maintain workspaces" | The prior session's own commits removed `workspaces` (regression A1/B5) | Restore from `0694779` (kickoff decision, binding) |
| C5 | Duplicate prevention "before creating any assignment" | v1 explicitly decided *no* dedupe; open backlog item exists for it | Treated as a real PRD change with defined semantics (§6), superseding v1 Decision 7 and closing the backlog item when shipped |
| C6 | `.env.example` with 5 placeholders | No `.env.example` exists; real config surface is broader (CORS_ORIGINS, NODE_ENV, GOOGLE_PROVIDER_MODE, VITE_API_BASE_URL) | Template must cover what the code actually reads (§7) |
| C7 | "Pass Google access tokens to server routes" — ambiguous; could read as the client holding and forwarding tokens | Client-held tokens would sit one XSS away from theft and contradict v1's server-side session model | **Server-side-only token custody** (§7.1e): tokens are stored server-side against the session; the browser holds only the HttpOnly session cookie; no access token ever reaches the client bundle |

**Evidence discipline:** the prior session's *diagnoses* are hypotheses (it
never read the repo); its *pasted logs* are evidence. Bug-inventory Section A
is repo-verified fact. B1–B14 are diagnosed-with-evidence. B15 ("two big
icons") — unreproduced when this brief was first drafted — is now **reproduced
and root-caused** (`inputs/b15-two-big-icons-diagnosis.md`):
`SignInLanding.tsx` was rewritten in Tailwind utility classes in a project
that has no Tailwind, so every class is inert; two `viewBox`-only SVGs stretch
to 898×898px and the buttons render user-agent-default. The oversized icons
and the "raw unstyled fallback buttons" are **one defect, not two**. §7.2
states acceptance against this known cause.

---

## 1. Problem & pain

The v1 problem statement stands unchanged (SIS/roster-sync lockout, Drive
duplicate nightmare, Reuse-Post friction — see the parent brief §1). Phase 2's
problem is one level up: **the product that solves that problem cannot yet be
used by a single real teacher.**

- **No live integration.** `RealClassroomProvider` does not exist in working
  form; `GOOGLE_PROVIDER_MODE=mock` is the only implemented mode. Every v1
  guarantee is asserted against fixtures.
- **The one real deployment attempt burned a week.** ~120 of 186 prior-session
  turns went to deployment plumbing: build config, env vars, CORS, redirect-URI
  mismatches, a frontend deployed from a *different repository* than the
  backend (B11). The user — a teacher, not a developer — was driven through
  hand-edits that regressed the finished product.
- **Re-runs create duplicates.** v1's documented behavior (re-run = second set
  of drafts) is unacceptable once real courses are involved: a teacher who
  re-runs after a partial failure — the *most likely* real-world sequence —
  doubles their target course. The mock world made this tolerable; the real
  world does not.
- **The deployed frontend is visually broken** ("two big icons", raw unstyled
  fallback buttons) — reported at the end of the prior session; now reproduced
  and root-caused as a **single defect** in `SignInLanding.tsx` (§0, §7.2).

Who feels it: the same teacher personas as v1, plus acutely **this specific
user**, who has real courses waiting and has already spent a week failing to
deploy.

## 2. Target users & jobs-to-be-done

Unchanged from the parent brief §2 (K-12 teacher in an SIS-managed district;
curriculum lead secondary). Phase-2 additions to the JTBD:

- *"When I click Copy, actually copy — into my real Google Classroom, with my
  real Google account."*
- *"When I run it twice, don't double my course."* (New: duplicate prevention.)
- *"When you hand me setup steps, make them numbered and jargon-free — I am not
  a developer."* (Process lesson C3: the live-OAuth checklist is a first-class
  deliverable with this user as its audience.)

Non-users unchanged. One addition: **the unattended build agent is explicitly
not a user of the user's Google account** — no Client Secret handling, no
sign-in on the user's behalf (kickoff decision, binding).

## 3. Current alternatives

Unchanged for the end user (parent brief §3). For *this phase's* delivery
problem the alternatives considered and rejected:

1. **Patch `06c3d05` forward** — rejected (kickoff, binding): means
   rediscovering a known-good configuration already in git history.
2. **Delete the mock layer as the Directions literally say** — rejected
   (kickoff, binding): deletes the entire verification surface.
3. **Gate done on live-Google E2E** — rejected (kickoff, binding): an
   unattended run cannot perform an interactive consent flow; claiming it was
   verified would be false.
4. **Keep shipping mock-only** — rejected: the product has no value to anyone
   until a real teacher can use it.

## 4. Value proposition & differentiation

The parent value prop stands. Phase 2 makes it true, and adds one promise:

**"Run it as many times as you like — assignments that already exist in the
destination are skipped, not duplicated."**

This converts the product's weakest disclosed behavior (duplicate drafts on
re-run) into a strength (safe, idempotent-by-title re-runs), and it is the
behavior that makes partial-failure recovery safe with real courses.

The promise covers **topics** as well as coursework (§6.8): a re-run reuses
existing destination topics by name instead of re-creating them. A re-run that
skipped every assignment but doubled every topic in the course sidebar would
break "don't double my course" just as visibly.

Differentiation is otherwise unchanged: copies into existing (SIS-synced)
courses, zero Drive duplicates (link-don't-copy), batch speed, drafts-only
fail-safe.

## 5. Success metrics

v1's product metrics (activation, speed, fidelity, zero-silent-drop) carry
forward unchanged. Phase-2-specific bar:

**Automated bar (what Beast Mode can certify):**

1. Verify recipe green at HEAD of the phase branch: `npm test`, `npm run
   build`, `npm run lint` — restoring the v1 surface (365 tests was the v1
   count; the phase count will be ≥ that as dedupe and real-provider tests
   land). The measured baseline (`inputs/verify-baseline.md`) is zero: both
   scripts missing outright, server workspace non-compiling — "green" here
   means restored-then-extended, not patched. All 11 quality budgets pass; the totality invariant
   `transferred + fallback_shell + skipped == count(items)` holds with the new
   skip reason included (§6.5).
2. Real-provider contract tests green: `RealClassroomProvider` passes the
   existing `classroom-provider.contract.test.ts` suite (extended as needed)
   against recorded/simulated Google semantics — the suite v1 built precisely
   so the real adapter would be "a swap, not a rewrite."
3. Production-mode acceptance criteria in §7 all pass (no reachable mock in a
   production build; fail-fast provider-mode selector).
4. Duplicate-prevention fixture (new, §6.6) passes: a re-run against a dirty
   destination produces 0 duplicate coursework items **and 0 duplicate
   topics**, correct skip and topic-reuse accounting (§6.5, §6.8), exact
   summary reconciliation, and the combined duplicate+unhealthy-attachment
   case resolves per the §6.3 precedence rule.
5. `.env.example` exists and names every env var the code actually reads, with
   placeholder values only.
6. Render-deployable configuration is documented and the build commands the
   docs name are the ones that run clean locally.

**Human bar (what only the user can certify — never claimed by the run):**

7. Following the numbered live-OAuth checklist, the user completes a real
   transfer between two real courses. **MANUAL-VERIFY:** live E2E — the run
   hands over the checklist; it never claims this step was performed.
8. An immediate re-run of the same transfer reports all items skipped as
   duplicates, reuses (not re-creates) every topic, and creates 0 new drafts
   and 0 new topics in the real destination course.
   **MANUAL-VERIFY:** same as above.

**North star for the phase:** the first completed *real* transfer (the v1
north-star metric, measured against reality for the first time).

## 6. Duplicate prevention — product requirements (PRD change)

This section supersedes parent-brief Decision 7 ("v1 performs no dedupe") and,
when shipped, closes the open backlog item *"Idempotent re-run / duplicate
detection."* These are product semantics; the architect designs the mechanism.

**6.1 — What counts as "already exists."** A source item is a **duplicate** if
the destination course contains an item **on the same coursework surface**
(CourseWork↔CourseWork; CourseWorkMaterial↔CourseWorkMaterial) whose
**normalized title equals** the source item's normalized title, in **either
DRAFT or PUBLISHED state**. Both states must be checked — the Directions are
explicit, and Google's list API does not return drafts unless asked
(**MANUAL-VERIFY:** Google's default `courseWorkStates` filter returns
PUBLISHED only; the architect must confirm against current API docs and request
DRAFT and PUBLISHED explicitly). Same-surface matching is deliberate: an
Assignment titled "Syllabus" and a Material titled "Syllabus" are different
objects to teacher and API alike; cross-surface matching would silently drop
real content. Topics are also in dedupe scope, under their own simpler rule —
§6.8.

**6.2 — Title normalization rule (decided).** Two titles match when they are
equal after: Unicode NFC normalization → trim leading/trailing whitespace →
collapse internal whitespace runs to a single space → case-insensitive
comparison (Unicode case folding). **Why this rule:** trailing spaces, casing
drift, and double spaces are typing accidents, not intent; anything stronger
(punctuation stripping, fuzzy matching, prefix matching) risks treating
"Unit 1 Quiz" and "Unit 11 Quiz" — or a teacher's deliberate "(v2)" — as the
same item, and a false-positive skip silently loses content, which violates the
zero-silent-drop guarantee. False-negative (a duplicate slips through) merely
recreates v1's disclosed behavior for that one item. The rule is biased toward
the cheaper failure.

**6.3 — When detection happens.** During the pre-flight scan, before anything
is written. The scan queries the destination's coursework (both surfaces, both
states) and marks matching source items as will-skip with reason
`duplicate_title`. The teacher sees the outcome **before** confirming the
transfer: "N of M items already exist in the destination and will be skipped."
Whether the engine re-checks at write time (guarding against a race with a
concurrently-editing co-teacher) is an architect decision; if it does, the item
still counts exactly once, as a skip.

**Precedence when checks overlap (decided — critic F2):** the duplicate skip
**short-circuits** the attachment health check. An item classified
`duplicate_title` never enters the pre-flight action sheet — its attachments
will never be written, so prompting the teacher to resolve a trashed or
permission-locked attachment on it would demand a decision with no consequence
and invite a wrong answer on an item that *is* transferred. Whether the engine
still gathers health metadata for such items internally is architect scope;
the product rule is that the user is never prompted about an item that will
not be written, and the item resolves as exactly one outcome: the
`duplicate_title` skip.

**6.4 — What the user is told.** Pre-flight: the count and an inspectable list
of which items will be skipped and which destination item each matched
(title + state, draft/published). Completion summary: duplicate-skips appear in
the itemized log with reason `duplicate_title`, distinct from user-chosen
skips (`skippedByUser` stays honest — a duplicate skip is the product's
decision, not the user's) and from fallback shells. The CSV export carries the
reason column unchanged.

**6.5 — Reconciliation invariant (shipped quality budget — must not break).**
`duplicate_title` joins the **closed skip-reason vocabulary** feeding the
existing `skipped` term. The invariant
`transferred + fallback_shell + skipped == count(items) == scan.totalPostsScanned`
is **unchanged** — duplicates are counted in the scan and land in `skipped`.
No fourth outcome is created; the `reconciliation_invariant_all_fixtures` and
`no_pending_after_completion` budgets must pass with duplicate fixtures
included.

Topics remain **outside** this invariant — they are containers, not items —
and get a parallel accounting line of their own instead (§6.8). Folding topic
reuse into `skipped` would corrupt the item ledger.

**6.6 — Fixture requirement (v1 rule: no fixture, not testable).** A new
seeded fixture (next free number in the F-manifest): a destination course
pre-populated with items matching source titles — at least one as **draft**,
one as **published**, one matching only after normalization (case/whitespace),
one near-miss that must NOT match ("Unit 1" vs "Unit 11"), and one
cross-surface title collision that must NOT match; **one combined case** — an
item that is both a duplicate-title match and carries a trashed or
permission-locked attachment — which must resolve as a single
`duplicate_title` skip with no action-sheet prompt (the §6.3 precedence rule);
and pre-existing destination **topics** — one exact-name match, one matching
only after normalization, one near-miss that must NOT match (§6.8). The
automated bar (§5.4) runs against this fixture.

**6.7 — Non-goals of dedupe (v1-of-phase-2).** No content comparison, no
fuzzy/similarity matching, no merge/update of existing items, no
"overwrite existing" option, no dedupe keyed on anything but title
(e.g. no provenance tags written into descriptions). A provenance-based exact
re-run detection is a candidate future slice, backlogged.

**6.8 — Topic duplicate prevention (dedupe scope extended — revision 1, critic
F1).** The first draft's dedupe covered coursework only; topic creation ran
unconditionally on every run, so a re-run would have skipped every assignment
and still **doubled every topic** in the destination's sidebar — the same
"don't double my course" complaint this phase exists to kill, and one the item
invariant would never catch (topics sit outside it). Dedupe scope is therefore
**extended to topics** rather than declared a non-goal: non-goaling it would
leave §4's headline promise visibly false on the first re-run.

- **Matching rule (stated here, not inherited — topics have no draft/published
  duality):** a topic is a name. A source topic matches a destination topic
  when their names are equal under the §6.2 normalization (NFC → trim →
  collapse internal whitespace → case-fold). No state clause, no surface
  clause.
- **Behavior on match:** the source topic **maps to the existing destination
  topic** — its coursework lands under it — and no new topic is created. On no
  match, the topic is created exactly as today. If more than one destination
  topic matches, the engine reuses one deterministically (first in API return
  order) and notes the ambiguity in the summary. **MANUAL-VERIFY:** whether
  Google Classroom permits duplicate topic names within one course — architect
  confirms against current API docs.
- **How a reused topic is reported (topics stay outside the §6.5 item
  invariant):** a parallel accounting line —
  `topicsCreated + topicsReused == count(distinct source topics referenced by
  the transfer)` — surfaced in the completion summary as "Topics: N created,
  M reused" and disclosed at pre-flight alongside the duplicate-item list
  ("these topics already exist and will be reused"). A reused topic is a
  **reuse**, not a `skipped` item: the coursework outcome vocabulary is
  untouched beyond §6.5.
- **Fixture:** the §6.6 topic cases (exact match, normalization-only match,
  near-miss non-match) exercise this rule.

## 7. Production auth, mock removal, and frontend defects — acceptance criteria

**7.1 — "Remove all mock/test auth states," made observable.** All of the
following are testable without a Google account and are the acceptance
criteria for C1:

- a. **Server fail-fast:** with a production environment (`NODE_ENV=production`
  or equivalent build flag), booting with `GOOGLE_PROVIDER_MODE=mock` — or the
  variable unset, since the current default is `'mock'` — **refuses to start**
  with an error naming the accepted values. There is exactly **one** canonical
  value for the real mode: `google` (closes B12, where `real` vs `google`
  spelling burned a day). Unknown values also fail fast with the same message.
- b. **No mock routes in production:** with `GOOGLE_PROVIDER_MODE=google`, the
  mock-account endpoints (`/api/auth/mock-accounts` and kin) are **not
  registered** — requests return the standard 404 envelope. Asserted by an
  integration test.
- c. **No mock code in the shipped bundle:** the production client build
  (`client/dist`) contains **no mock-account fetch path** — verifiable by
  scanning built assets for the mock endpoint string (this is exactly how B11
  was caught: `index-DwwRpvWe.js` visibly contained `mock-accounts`). The
  client must select its auth flow from a **build-time** production flag, not a
  runtime fallback.
- d. **Mock retained for tests:** `npm test` still exercises the full suite
  against the mock double; the 11 budgets still run. Deleting the mock is a
  regression, not a cleanup (kickoff decision, binding).
- e. **Real OAuth flow:** sign-in initiates Google OAuth 2.0
  (authorization-code, via `googleapis`), with `prompt=select_account`
  semantics preserved from v1 (the forced picker is an existing acceptance-
  tested behavior — it now becomes Google's real account chooser). Tokens are
  stored server-side; the browser holds only the session (JWT cookie,
  HttpOnly). Access tokens are never exposed to the client bundle. Refresh
  handling and token lifetime are architect scope.
- f. **Secrets hygiene:** `.env.example` exists at repo root covering the full
  real config surface (`DATABASE_URL`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `JWT_SECRET`/`SESSION_SECRET`,
  `CORS_ORIGINS`, `GOOGLE_PROVIDER_MODE`, `NODE_ENV`, client
  `VITE_API_BASE_URL`) with placeholders only — and anything else the restored
  code actually reads (the engineer greps config access, not this list, as the
  source of truth). No real secret ever enters the repo, the artifacts, or the
  run transcript.

**7.2 — Frontend defects (B15 + "raw unstyled fallback buttons") — root cause
known.** B15 is **reproduced and root-caused**
(`inputs/b15-two-big-icons-diagnosis.md`, 2026-08-23):
`client/src/features/auth/SignInLanding.tsx` — the only such file under
`client/src` — was rewritten in Tailwind utility classes during the prior
session (`79aaa92`/`3fc22bf`), in a project with no Tailwind dependency,
config, or build integration. Every class resolves to nothing: the two
`viewBox`-only SVGs stretch to 898×898px (the "two big icons") and the buttons
render user-agent-default (the "raw unstyled fallback buttons"). **Both
reported symptoms are one defect.** The first draft's reproduce-first staging
and its "not reproducible post-restore" exit are retired — reproduction is
done, and that exit no longer applies.

- a. **The fix (binding direction):** re-author `SignInLanding.tsx`'s markup
  in the existing design-token system so it matches the other wizard steps,
  using the v1 file as the idiom reference
  (`git show 0694779:client/src/features/auth/SignInLanding.tsx`). This is a
  re-authoring, not a straight revert — the real-OAuth sign-in button is new
  and legitimately needed (v1 used mock accounts). Adding Tailwind to make
  the classes resolve is **out of contract** (kickoff decision, binding): it
  would mask this one screen while introducing a second, competing styling
  system beside a WCAG-audited one.
- b. **Pass criteria:** the statically-served production build (as Render
  serves it — not the Vite dev server) renders the sign-in landing, loading,
  and error states visually equivalent to dev; zero 404s for any
  asset/stylesheet in the network log; no unstyled (user-agent-default)
  buttons in any auth state; axe re-run on the built app reports 0
  critical/serious violations (protecting the v1 WCAG-AA certification
  through the fix).
- c. **Regression guard (new requirement):** a quality check under the
  existing `test/quality/` convention asserting **no Tailwind utility classes
  appear anywhere under `client/src`** — a cheap grep-shaped assertion. It
  would have caught the introducing commit, and it protects the no-Tailwind
  decision against the next well-meaning hand edit.
- d. **Known concrete defect (repo-verified today):** `SignInLanding.tsx`
  hardcodes a fallback API origin (`https://classroom-copier-api.onrender.com`)
  instead of failing loudly when `VITE_API_BASE_URL` is absent — a baked-in
  cross-environment origin is exactly the class of error behind B11/B14. Fix
  in scope: one explicit build-time origin configuration, misconfiguration
  fails visibly, and the B14 rule ("changing it requires a rebuild") lands in
  the deploy docs.
- e. All fixes stay **within the token design system** (kickoff decision,
  binding). No Tailwind, no restyle.

**7.3 — The live-OAuth checklist (deliverable, not documentation).** A
numbered, jargon-free checklist for the user (a teacher), covering at minimum:
Google Cloud project + OAuth consent screen setup (test-user mode first);
exact-match redirect URI (B13); the scope list of §8 and what Google will show
on the consent screen; Render backend env vars; Render static-site build with
`VITE_API_BASE_URL` and the rebuild-on-change rule (B14); `CORS_ORIGINS`
including the custom `X-Classroom-Copier` header allowance (B10); **"verify
both Render services point at the same GitHub repository"** as an explicit
early step (B11 — the single most expensive miss of the prior session);
PostgreSQL provisioning on Render (B7); and what success looks like at each
step (including "`/api/auth/me` returning 401 before sign-in is normal" — B9,
and the health route being `/api/health` — B8). Findings from the user's
execution of the checklist come back as a follow-up pass (kickoff decision,
binding).

## 8. OAuth scope list (decided) and the verification gate

**Decided v1-of-phase-2 scope list** — supersedes the Directions' two-scope
list (C3); the architect reconciles each scope against the actual API calls
the restored engine makes and may drop, but not silently add:

| Scope | Why |
|---|---|
| `classroom.courses.readonly` | List source/destination courses (Directions) |
| `classroom.coursework.students` | Read source + create destination CourseWork (Directions) |
| `classroom.courseworkmaterials` | Materials are a separate API surface (v1 decision, carried) |
| `classroom.topics` | **New finding this pass:** the engine creates topics in the destination (v1 §6.3, topic-map is a shipped behavior); neither the Directions nor the v1 scope discussion lists a topics scope. **MANUAL-VERIFY:** confirm the exact scope name/need against current Google docs |
| `drive.file` | "Copy to My Drive" pre-flight action is a write; also grants access to files the app creates (v1 decision, carried) |
| `drive.metadata.readonly` | Pre-flight health check reads trashed-state/capabilities of arbitrary attachment files. Chosen over `drive.readonly` (content read) per the v1 scope-minimization open question: the health check needs metadata, not content. Architect may overturn **only with evidence** metadata is insufficient (e.g. shareMode/permission detail requires more) |

**The verification gate (real-world, user-clearable only):** Drive read scopes
are on Google's **restricted** list — expect an app-verification/security-
assessment process measured in weeks, entirely outside this project's control.
**MANUAL-VERIFY:** current restricted/sensitive classification of
`drive.metadata.readonly` vs `drive.file` against Google's published scope
categories — the minimization choice narrows exposure but may not escape
restricted-scope verification. Until verification completes, the app runs in
**testing mode with up to 100 explicitly-listed test users**
(**MANUAL-VERIFY:** the 100-user testing-mode cap is model knowledge — confirm
against Google's current OAuth consent-screen documentation) — which fully
covers this user's own use. The checklist (§7.3) sets the user up in testing
mode first; verification submission is a named backlog item, not a phase gate.

## 9. Scope of change — keep / revise / reinvent (the downstream contract)

Open-scope track: downstream stages read this table as their scoping contract.
"Keep" areas are conform-only (feature-mode rules apply); "revise" areas change
only as described; "reinvent" areas take new direction within the named
constraints.

| Area | Decision | What that means concretely |
|---|---|---|
| **Transfer engine** (`post-enumerator`, `transfer-engine`) | **Keep** | Provider-agnostic and budget-verified. Only changes: the `duplicate_title` skip reason threads through the outcome vocabulary (§6.5), and topic creation consults the §6.8 reuse mapping — create only unmatched topics, feed the `topicsCreated + topicsReused` accounting line. No re-architecture. |
| **Pre-flight engine** (`preflight-engine`) | **Revise** | Gains the duplicate-detection pass (§6.3): destination query (both surfaces, both states), normalization rule, will-skip marking persisted in the scan — plus the topic-match pass (§6.8: list destination topics, match by normalized name, persist the reuse mapping) and the §6.3 precedence rule (duplicate items never enter the action sheet). The persisted-scan pattern (one measurement read twice) is retained. |
| **Reconciliation invariants** | **Keep** | The totality invariant and its budgets are untouched except that the closed skip-reason vocabulary grows by one value. Any design that breaks `transferred + fallback_shell + skipped == count(items)` is out of contract. |
| **Job/executor/lease machinery** (`job-reconciler`, executor lease, single-active-job guard) | **Keep** | Untouched. The two-process lease harness and its budget stay green. |
| **Fixtures** (F1–F14 manifest + seeds) | **Keep + extend** | All existing fixtures retained. One new duplicate-prevention fixture added (§6.6). Real-provider work must not fork the fixture world. |
| **Provider layer — port interface** (`classroom-provider.interface.ts`, contract tests) | **Keep** | Deliberately shaped to the real API; it is the swap-point v1 built. Extensions (e.g. state filters for §6.1, OAuth token plumbing) are made *at* the interface with contract-test coverage, not around it. |
| **Provider layer — mock adapter** | **Keep (test-only)** | Retained as the test double behind the same port (kickoff, binding). Must become unreachable in production builds (§7.1a–c). |
| **Provider layer — real adapter** (`RealClassroomProvider`) | **Reinvent** | The 305-line `06c3d05` file is unreconciled with the interface — treat as reference material at most. Write the real adapter properly against the port + contract suite, resolving the named divergences: QUIZ_ASSIGNMENT workType mapping, scheduled-as-DRAFT+scheduledTime (already resolved in vocabulary), async write consistency, real 429 envelopes (Retry-After) — all pre-catalogued in the backlog's architect notes. |
| **Auth** (server auth routes, session; client `AuthFlow`/`SignInLanding`) | **Reinvent** | Real Google OAuth 2.0 per §7.1e. The v1 mock-identity UX (account picker) is replaced by Google's real consent/account chooser; the app-side flow (signed-out → signing-in → signed-in states, sign-out, 401 handling) is redesigned by UX for the real redirect flow. `SignInLanding` is also the B15 defect site — its token-system re-authoring (§7.2a) lands here. B4 warning applies: `SignInLanding`/`AuthFlow` prop contracts drifted before — this pair changes as one unit with its tests. CSRF header defense (X-Classroom-Copier) is kept. |
| **Build config** (root/workspace package.json, tsconfigs, scripts) | **Revise via restore** | Restore from `0694779` (kickoff, binding), then apply the *minimum* deltas Phase 2 needs (e.g. `googleapis`, Postgres driver). Keep the B1 lesson: production `tsc` excludes test globs. Keep A6's `prisma generate` coupling. |
| **Persistence** | **Revise** | Production database is **PostgreSQL on Render** (Directions; closes B7 and moots the Render-disk-durability backlog spike *for production*). How dev/test map to this (Prisma is single-provider per schema; v1 tests depend on per-file SQLite copies) is an explicit architect decision — the test-isolation pattern must survive. |
| **Design system** (`tokens.css`, shared components, a11y guarantees) | **Keep** | No Tailwind, no restyle (kickoff, binding). Frontend defect fixes land within it (§7.2). WCAG-AA verification is re-run after fixes, not assumed. A `test/quality/` guard asserts no Tailwind utility classes appear under `client/src` (§7.2c). |
| **Deployment** (Render config, env template, docs) | **Revise** | Two Render services, `.env.example` (§7.1f), deploy docs + live-OAuth checklist (§7.3) encoding lessons B1/B2/B6/B7/B10/B11/B13/B14. No CI/CD build-out beyond what deploy needs — same as v1. |
| **Monetization stubs** | **Keep** | Feature-flagged no-ops, untouched. Stripe stays out (non-goal). |
| **UX flow (5-step wizard)** | **Keep + targeted revise** | The wizard, action sheet, completion summary, cold-start UX all stand. Revisions only where Phase 2 touches: sign-in flow (real OAuth), pre-flight surface (duplicate count/list), summary log (`duplicate_title` rows). |

## 10. Non-goals (explicit)

- **No Stripe/billing activation** — stubs stay stubs.
- **No granular per-item selection** — whole-course only; per-item choices
  remain confined to the pre-flight action sheet (duplicate skips are
  product-decided, not a new selection UI).
- **No Tailwind, no visual redesign** of the certified design system.
- **No content-diff or fuzzy dedupe; no merge/overwrite of existing items**
  (§6.7).
- **No Google app-verification submission inside this phase** — testing-mode
  operation is the phase's ceiling; submission is backlogged.
- **No handling of the user's Google credentials by the run** — no Client
  Secret in any artifact, no sign-in on the user's behalf (kickoff, binding).
- **No new product surfaces** — no announcements, submissions, grades,
  rosters, admin console, native mobile, non-Google LMS (all carried from v1).
- **No claim of live E2E verification** — the automated bar is §5.1–6; live
  steps are MANUAL-VERIFY and belong to the user's checklist run.

## 11. Constraints & risks

**Binding kickoff decisions** (recorded in `state.json`; not re-litigated
here): mock-as-test-only-double; no Tailwind; dedupe is a real PRD change;
done excludes live-Google verification; restore build config from `0694779`;
Beast Mode through QC.

**Risks, ranked:**

1. **Mock-to-real divergence surfaces late.** v1's contract tests are strong
   but one undisclosed divergence already slipped through once (P0-3, caught
   at QA cycle 2), and QC explicitly said the spot-check is not exhaustive
   (QA-6). Mitigation: the real adapter is written against the contract suite,
   the pre-catalogued divergences are worked as a checklist, and QC's caveat
   #3 ("a new real-API adapter should be reviewed by a code auditor") is
   honored via the engineer stage's required code review.
2. **Google-side gates outside our control:** restricted-scope verification
   (weeks), consent-screen review, API quotas. Mitigation: testing-mode-first
   checklist; verification backlogged, not gating.
3. **The regressed baseline — now measured.** `inputs/verify-baseline.md`
   puts numbers on it: two verify scripts missing outright, the server
   workspace failing to compile (19 errors, five root causes), and a root
   build that goes green anyway. Restoration from `0694779` must precede
   everything measurable; until then no number in this repo means anything.
   Risk: the prior session's *intended* changes get lost in restoration —
   mitigated by the bug inventory's A-section being an explicit re-apply
   list, and by the baseline doc's root-cause list (causes 2–5 are code
   defects the restore alone will not fix).
4. **Postgres migration ripple.** Moving production off SQLite touches Prisma
   schema assumptions (String-typed vocabularies, per-file test DBs, the
   `@unique` single-active-job guard). Architect must keep the test-isolation
   pattern working.
5. **OAuth token lifecycle bugs are user-facing and hard to test unattended**
   (expiry mid-transfer, revoked consent). Architect must specify behavior;
   automated tests simulate at the port.
6. **B15 phantom risk — retired.** B15 is reproduced and root-caused (§7.2);
   the risk of fixing a phantom is gone. Residual risk: re-authoring the
   sign-in screen regresses the WCAG-AA certification or drifts the
   `SignInLanding`/`AuthFlow` prop contract again (B4). Mitigated by §7.2b's
   axe re-run, the pair-changes-as-one-unit rule (§9 Auth row), and the §7.2c
   no-Tailwind guard preventing recurrence of the defect class.

**Timeline & execution:**

- **Standard Mode (with approval gates):** ~2–3 weeks — six gated stages with
  1–2-day approval waits, plus the user's own checklist execution at the end.
- **Beast Mode (auto-accept, no inter-stage gates):** ~3–5 days of stage
  runtime through QC. The final ship decision — and the entire live-OAuth
  checklist — still belongs to the user; Beast Mode never auto-ships and never
  touches the user's Google account. *This run is Beast Mode through QC.*
- Google's verification window (if/when submitted) is additive and externally
  controlled — weeks, not days.

## 12. Business model & monetization

Unchanged from the parent brief §8: free at launch, monetization stubs
feature-flagged off, credit rule specified but dormant. No Phase-2 changes.

---

## Decisions (confirmed)

All recorded via `stage_record_decisions` with source `beast-mode-auto` (Beast
Mode auto-accepted the recommended option); the six kickoff decisions listed in
§11 are prior **human** decisions that bind this brief and are not re-recorded.

1. **Double definition of the phase:** restore the verification surface from
   `0694779` AND deliver real integration; neither alone is the phase.
2. **Duplicate semantics:** same-surface title match, DRAFT+PUBLISHED states
   both checked (§6.1).
3. **Normalization rule:** NFC + trim + whitespace-collapse + case-fold; no
   fuzzy matching — biased so a miss recreates v1 behavior for one item rather
   than silently dropping content (§6.2).
4. **Detection at pre-flight**, disclosed before transfer; counted once as
   `skipped`/`duplicate_title`; totality invariant unchanged (§6.3–6.5).
5. **New dedupe fixture** required (draft match, published match,
   normalization match, near-miss non-match, cross-surface non-match) (§6.6).
6. **Provider-mode selector:** single canonical value `google`; production
   refuses `mock` (including as an unset default) and fails fast naming
   accepted values (§7.1a).
7. **Mock unreachability is testable:** no mock routes registered in real
   mode; production bundle greps clean of the mock endpoint (§7.1b–c).
8. **Scope list of §8** including the newly-flagged `classroom.topics`, with
   `drive.metadata.readonly` chosen over `drive.readonly`; architect
   reconciles against actual calls; restricted-scope verification is a
   user-clearable external gate, testing-mode operation is the phase ceiling.
9. **B15 acceptance was reproduce-first** with a not-reproducible-post-restore
   exit — *superseded by Decision 15 once reproduction landed*; the hardcoded
   fallback origin in `SignInLanding.tsx` remains a confirmed in-scope fix
   (§7.2d).
10. **Production persistence is PostgreSQL on Render**; dev/test mapping is an
    explicit architect decision that must preserve the per-file test-DB
    isolation pattern (§9).
11. **The live-OAuth checklist is a first-class deliverable** written for a
    teacher, encoding B1–B14's lessons; its execution findings return as a
    follow-up pass (§7.3).
12. **Keep/revise/reinvent scoping** as tabled in §9 — the downstream
    contract for this open-scope track.
13. **Topic dedupe is in scope** (revision 1, critic F1): topics match by
    §6.2-normalized name and are reused, never re-created; reported via the
    parallel `topicsCreated + topicsReused` line outside the item invariant;
    fixture cases added (§6.6, §6.8).
14. **Duplicate-skip precedence** (revision 1, critic F2): `duplicate_title`
    short-circuits the attachment health check — a duplicate item never
    enters the action sheet; combined-case fixture row added (§6.3, §6.6).
15. **B15 criteria rewritten against the known root cause** (revision 1):
    re-author `SignInLanding.tsx` in the token system — no Tailwind — and add
    a `test/quality/` guard asserting no Tailwind utilities under
    `client/src` as a phase requirement (§7.2).
16. **C7 recorded** (revision 1, critic F4): the Directions' "pass Google
    access tokens to server routes" is resolved as server-side-only token
    custody (§0 table, §7.1e).

## Assumptions

- The user's Google account is a Google Workspace for Education (or standard
  Workspace) teacher account able to create a GCP project and OAuth consent
  screen in testing mode. (If district policy blocks GCP project creation,
  the checklist's step 1 fails and the phase needs a distribution rethink —
  flagged, not planned for.)
- Render remains the deployment target (Directions) and its PostgreSQL
  offering is provisionable by the user at free/low tier.
- Real-API behavior facts asserted from model knowledge (default
  `courseWorkStates`, scope names/classifications, testing-mode 100-user cap)
  are load-bearing and individually marked MANUAL-VERIFY where cited; the
  architect verifies them against current Google documentation before design
  hardens.
- The 365-test/11-budget count is the *restoration* target; the phase's final
  counts will be higher and the QA/QC bar is "green at final count," not the
  literal 365.

## Open questions

- Refresh-token lifecycle details (offline access, expiry mid-transfer,
  revoked consent recovery) — architect scope, §11 risk 5.
- Whether write-time duplicate re-check (co-teacher race) is worth its API
  cost — architect (§6.3).
- Prisma dev/test strategy under a Postgres production target — architect
  (§9 Persistence).
- Exact Google scope classifications and any consent-screen copy implications
  — MANUAL-VERIFY items in §8.
- Provenance-tagged exact re-run detection as a future dedupe upgrade —
  backlogged (§6.7).
- **MANUAL-VERIFY:** whether Google Classroom permits duplicate topic names
  within one course (bears on §6.8's multiple-match rule) — architect confirms
  against current API docs.
- **MANUAL-VERIFY:** whether the currently-deployed Render services serve this
  repo at this commit or a stale build from another repository
  (`inputs/verify-baseline.md`) — the checklist's B11 step ("both services
  point at the same GitHub repo") is where the user confirms it.

## Next handoff

UX agent → reads this brief (especially §6 duplicate-prevention UX surfaces,
§7 auth-flow states, and the §9 scoping table's "keep" boundaries), revises the
flows only where this phase touches them, writes
`docs/features/real-google-integration/02-feature-ux.md`. The wizard, action
sheet, and completion summary are **keep** — UX work is the real-OAuth sign-in
flow, the pre-flight duplicate disclosure, and the summary's duplicate-skip
rows.
