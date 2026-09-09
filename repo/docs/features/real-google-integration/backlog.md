# Product Backlog

## Open (18)
- [QA-0001] **[PM]** real-google-integration: Google app-verification / restricted-scope security-assessment submission (Drive read scopes). Explicitly OUT of Phase 2 — the phase ceiling is OAuth testing mode (explicit test users). Submit only after the live-OAuth checklist has succeeded and the scope list is final; include a last scope-minimization check (drive.metadata.readonly vs drive.readonly evidence from the shipped health check) before submitting. (medium)
- [QA-0002] **[PM]** real-google-integration: Follow-up pass for live-OAuth checklist findings. Per kickoff decision, done = automated green + numbered checklist handed to the user; whatever the user hits while executing it (GCP console, redirect URI, Render env, CORS, first real transfer, real re-run dedupe check) comes back as a scoped fix pass. Open until the user reports a completed real transfer and a 0-duplicate re-run. (high)
- [QA-0003] **[PM]** real-google-integration: Provenance-based exact re-run detection as a dedupe upgrade — v1-of-phase-2 dedupe is normalized-title-only by design (brief §6.7: no content diff, no fuzzy match, no merge/overwrite). A future slice could tag created drafts with provenance so an exact re-run of the same source→target is recognized as such and offered richer options (update/merge) instead of title-skip. (low)
- [QA-0004] **[UX]** real-google-integration: Formalize a fixture (or simulated-provider harness) covering the three new mid-wizard/mid-transfer auth-interrupt states this UX pass specified — session-expired mid-wizard, session-expired mid-transfer (reconnect to live job), and Google token-refresh-failure mid-transfer (see docs/features/real-google-integration/02-ux-workflow.md §5 and wireframes/04-session-and-token-interrupts.md). None of the F1-F14 manifest or the new §6.6 dedupe fixture exercises these; they join cold-start and F6-exhaustion as fixture-uncovered states per the same fixture-honesty discipline v1 already established. Not fixture-covered means QC must not treat them as certified. (medium)
- [QA-0005] **[UI]** real-google-integration UI: itemized-log outcome filter split ('Already in course' / 'Skipped by you') leaves the three system-interrupted skip reasons (provider_error/server_interrupted/rate_limit_exhausted) reachable only via 'All'. A future pass could add a third 'Skipped — couldn't confirm' filter option mirroring the existing systemSkipLine copy. Not required this phase (PM/UX scoped the split to exactly two kinds) — see 03-ui-direction.md Deltas P1. (low)
- [QA-0006] **[ARCHITECT]** real-google-integration: three new mid-wizard/mid-transfer auth-interrupt states (session-expired mid-wizard, session-expired mid-transfer, Google-reconnect mid-transfer) remain fixture-uncovered at the UI/E2E level. The engine-level unit budget (token_failure_pause_resume_fidelity) covers the transfer-engine mechanism but not a full UI fixture. Carried from UX's own P1 Delta, unchanged by architecture. Not fixture-covered means QC must not treat these three states as fixture-certified. (medium)
- [QA-0007] **[ARCHITECT]** real-google-integration: Decision I's production boot strategy (`prisma db push` on every boot, not `prisma migrate deploy`) has no migration rollback history in production. Explicitly accepted at this project's current single-tenant stakes. Revisit with `prisma migrate deploy` plus a parallel Postgres-specific migrations folder if this app ever gets a second production consumer whose schema changes need rollback safety. (low)
- [QA-0008] **[ARCHITECT]** real-google-integration: whether Render's health-check polling of /api/health prevents free-tier dyno sleep is unresolved (carried unchanged from v1 backlog DEFER-1). Explicitly NOT relied upon by the OAuth cold-start design (04-architecture.md Decision E / §4.1) — if verified true, it would be a genuine additional mitigation for the callback-processing window; if false, no design assumption breaks either way. (low)
- [QA-0009] **[ARCHITECT]** real-google-integration: whether `classroom.topics` scope alone is sufficient for `topics.list` reads (vs. also needing `classroom.topics.readonly`) is not independently confirmed — the verified-facts doc confirmed only the `topics.create` requirement. Engineer should confirm during the live-OAuth checklist's first real transfer; if listTopics fails under this scope alone, add classroom.topics.readonly to the consent-screen scope list. (low)
- [QA-0010] **[ARCHITECT]** security-architect (2026-08-23-security-architect.md, S1): OAuth authorization-code flow in 04-architecture.md §4.1/§6.3 has no PKCE (code_verifier/code_challenge) — only the state cookie is specified. RFC 9700 (Jan 2025) recommends PKCE for confidential clients and OAuth 2.1 draft defaults it for all authorization-code clients. google-auth-library's OAuth2Client supports it natively. Add to oauth-client.ts's authorization-URL construction and token exchange. (medium)
- [QA-0011] **[ARCHITECT]** security-architect (2026-08-23-security-architect.md, S2): The OAuth callback's outbound 302 "to the frontend origin" (04-architecture.md §4.1, §6.3) has no named, fixed config source — risk of open redirect if derived from request data instead of a server-side constant. Name an explicit source (new FRONTEND_ORIGIN env var, or CORS_ORIGINS[0]) used verbatim; add a test asserting the callback's Location header is always exactly that fixed origin regardless of request input. (medium)
- [QA-0012] **[ARCHITECT]** security-architect (2026-08-23-security-architect.md, S3): TOKEN_ENCRYPTION_KEY (04-architecture.md §5.1/§8.2) has only a presence-only fail-fast (mirrors SESSION_SECRET's existing config.ts pattern), no generation guidance for the non-developer audience this architecture explicitly designs for (driver 9). A 32-byte value passes Node's AES-256-GCM key-length check regardless of entropy. Live-OAuth checklist and .env.example must give an exact generation command (e.g. openssl rand -base64 32). (medium)
- [QA-0013] **[ARCHITECT]** security-architect (2026-08-23-security-architect.md, S4): token-crypto decrypt failures (e.g. from TOKEN_ENCRYPTION_KEY rotation/corruption) aren't routed through the existing AuthExpiredError/reauth pause-and-resume path in 04-architecture.md §4.2 — would currently surface as an unhandled exception instead of the routine "reconnect Google" UX. real-classroom-provider.ts/oauth-client.ts should catch a decrypt failure and treat it identically to AuthExpiredError. (medium)
- [QA-0014] **[ARCHITECT]** security-architect (2026-08-23-security-architect.md, S5): Session.accountId's FK removal (04-architecture.md §5.1, Decision B) deletes the DB's own safety net for cross-account isolation. Verified safe today by reading middleware/auth.ts, session.ts, routes/{courses,transfer-jobs}.ts directly (every route derives accountId from the resolved session and checks resource ownership) but nothing pins this invariant going forward now that Prisma can't enforce it. Add an explicit cross-account-isolation contract test as an acceptance criterion on google-auth-core/google-oauth-routes. (low)
- [QA-0015] **[ARCHITECT]** security-architect (2026-08-23-security-architect.md, S6): No explicit rule in 04-architecture.md against logging decrypted tokens, ciphertext, or raw googleapis/google-auth-library error payloads (which can echo Authorization headers). Sign-out revoke failure is "logged at WARN" (§5.1) with no stated content constraint. State the rule explicitly; security-engineer should verify against actual log call sites once code exists. (low)
- [QA-0016] **[ARCHITECT]** security-architect (2026-08-23-security-architect.md, S7): cc_oauth_state cookie's Secure flag and TTL in production aren't stated in 04-architecture.md §5.1 (the session cookie's are). Mirror the session cookie's environment-conditional Secure/SameSite behavior; short max-age (~10 min). (low)
- [QA-0017] **[ARCHITECT]** security-architect (2026-08-23-security-architect.md, S8): Decision F's resume(jobId) account-scoping ("finds this account's paused job") is shown in diagrams/token-failure-pause-resume-sequence.md but not a stated acceptance criterion in 04-architecture.md. Add a test that reconnecting as account B never resumes a job paused under account A. (low)
- [QA-0018] **[ARCHITECT]** security-architect (2026-08-23-security-architect.md, S9): drive.metadata.readonly (04-architecture.md §7 scope reconciliation) grants metadata visibility across the entire Drive, not just app-touched files, for the life of any live token. Least-privilege choice is reasonable and reaffirmed on its own merits; the exposure surface just isn't stated explicitly anywhere in 04. Add one sentence to §5.1 or §7 naming this trade-off, since the live-OAuth checklist already explains scopes to the non-developer end user consenting to them. (low)

## Done (0)

## Won't Fix (0)

## Technical-critic DEFER findings — architect p1 (2026-08-23)

Report: `critic-reports/2026-08-23-architect-p1.md`

- [QA-0019] **F13 — `datasource-postgres` acceptance needs uncommitted infrastructure.** The
  criterion requires `DATABASE_PROVIDER=postgresql npm run -w server db:push` "against
  a real or dockerized Postgres", but the project norm is "no CI/CD build-out beyond
  what deploy needs" and there is no Docker in the repo. Either name the provisioning
  step or downgrade to `prisma validate` parsing under both providers.
- [QA-0020] **F14 — a11y budget vs. the brand-mandated Google button.**
  `wcag_aa_automated_per_step` audits "every token pairing" arithmetically;
  `.google-signin-btn` uses Google's exact brand colors, which are not free to adjust.
  Needs either an in-scope ruling or a documented exemption before the budget runs.
- [QA-0021] **F15 — Decision I's `db push` failure mode is unstated.** The trade-off (no
  migration history) is named honestly and the upgrade path is cited, but `prisma db
  push` against a non-empty production Postgres refuses or prompts on a destructive
  change, and on boot there is no operator at the prompt. Name what happens when a
  column is dropped or narrowed against live Render data.

## Engineer DEFER findings — revise pass (2026-08-26)

Reports: `critic-reports/2026-08-26-engineer-p1.md`,
`security-reports/2026-08-26-security-engineer.md`

> **Recorded by hand, deliberately.** `backlog_add` refuses to write this file
> because it already holds hand-authored sections it did not generate, and
> regenerating would discard them. These follow the convention the architect
> pass established directly above rather than destroying that content.

- [QA-0022] **F12 — duplicate matching is MANY-TO-ONE. A product decision, not a patch.**
  Two source posts sharing a title both match the single destination post and are
  both skipped as `duplicate_title`, so the second is never copied. Not among PM
  §6.2's cases and not seeded in the F15 fixture pair. The trade-off, stated
  rather than silently resolved:
  - *Keep many-to-one.* Safest against creating duplicates in the teacher's
    course — but it silently drops a genuinely distinct second post whose title
    happens to collide, which is exactly the silent-drop class this phase exists
    to eliminate.
  - *Match one-to-one*, consuming each destination post at most once, so the
    second source post is copied. Honest about the post count — but it creates a
    same-titled sibling in the destination, which the dedupe feature was built to
    prevent.

  Whichever the PM rules, it must be seeded in F15 and asserted in
  `dedupe.budget.test.ts` as **provider create calls**, not item outcomes.
  Nothing was changed in this pass. (medium)

- [QA-0023] **F10 — the no-Tailwind guard only matches a literal `className="…"`.** A
  conditional (`className={cond ? 'a' : 'b'}`) or a variable className is
  invisible to it, so a Tailwind utility reaching the DOM through either form
  would not be caught. **No such call site exists in `client/src` today**, which
  is why this is deferred rather than fixed: widening the scan surface is a
  change to a guard, and this project's own discipline says a widened guard must
  first be proven red against a real positive. Fix it the next time a
  conditional className is genuinely introduced, red-first, in the same pass.
  (low)

- [QA-0024] **F11 (residual) — one `getRubric` call per graded post at transfer time.**
  The misleading `associatedWithDeveloper` disjunct was removed this pass, but
  the remaining predicate is `maxPoints != null`, i.e. true for *every* graded
  assignment, so against live Google every graded post costs a rubrics round-trip
  that mostly returns null. Google reports no rubric-presence flag on the
  `courseWork` resource, so the real fix is a batched or list-shaped rubrics read
  at enumeration time, or accepting the cost with a measured budget row. Needs a
  real-Google call-count measurement first — this is not measurable against the
  mock. (medium)

- [QA-0025] **E2 (residual) — the job/scan half of cross-account isolation under google
  mode.** The session→identity half is now covered by two distinct `GoogleAccount`
  identities (`server/test/cross-account-isolation.test.ts`). Driving the
  job/scan half needs fixture courses owned by a `GoogleAccount` id, which the
  mock fixture world does not have. Either seed google-flavoured fixture
  ownership or drive it from the live-OAuth checklist. (low)

## QA DEFER findings (2026-08-26)

Report: `docs/features/real-google-integration/06-qa-report.md`

> **Recorded by hand, deliberately** — `backlog_add` refuses to write this file
> for the same reason noted above (hand-authored sections it did not generate).
> Two blocker findings (production mock-boot fail-fast absent; stale
> duplicate-run notice copy) and two major findings (Ready-to-Transfer count
> not excluding duplicates; missing focus management on new screens) go back to
> the engineer directly per the QA report's recommendation and are not
> duplicated here — only the two minor, deferrable items are recorded below.

- [QA-0026] **QA-5 — Google sign-in button uses a 20px pill border-radius instead of the
  UI direction's explicitly decided `var(--radius)` (3px).** `tokens.css:132`'s
  `.google-signin-btn` ships `border-radius:20px`; `03-ui-direction.md` §2 makes
  a reasoned, binding **Decision** to use the system's own 3px radius instead of
  a pill, specifically so the button doesn't "look like an orphan" next to every
  other bordered, 3px-radius control. Functionally harmless — a pill is one of
  Google's own two approved button presets — but it contradicts the spec and is
  not listed among `05-implementation.md`'s deliberate deviations. Low-cost fix:
  change the one declaration to `border-radius:var(--radius)`. (low)

- [QA-0027] **QA-6 — `backlog.md`'s "Open (18)" count is stale.** Of the 9
  security-architect findings (S1–S9) listed under "Open" above, 8 are already
  addressed in `04-architecture.md` revision 2 and confirmed live in the shipped
  code (S1 PKCE, S2 fixed frontend-origin redirect, S3 key-generation guidance,
  S4 decrypt-failure routing, S6 no-log rule, S7 oauth-state cookie hardening,
  S9 drive.metadata exposure sentence — each independently verified against the
  actual code during the QA pass, not just the doc). Only S5's residual is
  genuinely still open, and it is *also* correctly tracked separately under
  "Engineer DEFER findings" as "E2 residual." Recommend moving S1/S2/S3/S4/S6/
  S7/S9 to a "Done" section (or removing them) the next time this file is
  regenerated, so the open count reflects reality. (low)

## Engineer DEFER findings — QA revise cycle 2 (2026-08-26)

> **Recorded by hand, deliberately** — `backlog_add` refuses to write this file
> for the same reason noted above (hand-authored sections it did not generate).
> QA-1 through QA-4 were all FIXED in this cycle and are not deferred; the three
> items below are things found *while* fixing them, each out of that scope.

- [QA-0028] **The Playwright E2E suite is stale against this phase's sign-in flow and
  cannot run past step one.** `e2e/support/flows.ts`'s `signInAsJamie()` clicks
  a button named `Sign in with Google (mock)` and then an in-app account row.
  The client-side mock picker was deliberately deleted this phase — the chooser
  is Google's — so that button does not exist and every spec fails at its first
  step. Nothing went red because the suite is not part of the verify recipe.
  Fix by minting the mock session through the server's own
  `/api/auth/mock-accounts` + `/api/auth/sign-in` endpoints (with the
  `X-Classroom-Copier` CSRF header), which is what both QA and this cycle's
  browser verification had to do by hand. This is the same shape as QA-2 and
  QA-3: a test describing a screen nobody re-read. (medium)

- [QA-0029] **Two pre-existing load-sensitive flakes, neither caused by this cycle's
  changes.** Both reproduced only when run alongside other files and passed on
  every isolated re-run (3/3 and 1/1 respectively):
  `server/test/composition-root.test.ts`'s D12 reconciler case asserts
  `pending === 0` immediately after the job's *status* flips to `interrupted`,
  so it races the reconciler's item resolution (observed `pending` of 6 and 2);
  and `client/src/features/preflight/preflight.test.tsx`'s "All clear"
  auto-advance runs on a 20ms `allClearMs`. Both should wait on the condition
  they actually mean rather than on a proxy for it. (medium)

- [QA-0030] **`teal-700` on `teal-100` was shipping unaudited.** `.outcome-duplicate`
  (the "Already in course" pill) has used this pairing since the duplicate work
  landed and it was never in `contrast.a11y.test.ts`'s `PAIRINGS` list. Added
  this cycle (it passes), but the gap is worth a moment's thought: the audit
  enumerates pairings by hand, so any new pairing is invisible to it until
  someone remembers. A scan of the actual stylesheet for `color`/`background`
  pairs would be a guard rather than a record. (low)

## QA DEFER findings — cycle 2 (2026-08-26)

Report: `docs/features/real-google-integration/06-qa-report.md` (Cycle 2 section)

> **Recorded by hand, deliberately** — `backlog_add` refuses to write this
> file for the same reason noted above (hand-authored sections it did not
> generate). QA-1 through QA-4 were all independently re-verified CLOSED this
> cycle (live browser evidence) and are not deferred. QA-7 below is new this
> cycle — found by an independent stale-claim sweep, not by re-checking the
> engineer's four fixes.

- [QA-0031] **QA-7 (major) — the shipped OAuth scope list is missing
  `drive.metadata.readonly`, which the architecture's own design and the
  project's own verified-facts research say the attachment-health check
  needs.** `server/src/adapters/google/oauth-client.ts:30-38`'s `GOOGLE_SCOPES`
  has only `drive.file`; `04-architecture.md:135-137` designs for **two**
  Drive scopes (`drive.metadata.readonly` for attachment-health reads,
  `drive.file` for the "Copy to My Drive" write); `docs/features/
  real-google-integration/inputs/google-api-facts-verified.md` (an input the
  architect stage was handed) explicitly says to choose Drive scopes on
  least-privilege/fidelity grounds alone and states that avoiding
  `drive.metadata.readonly` to reduce verification burden is "factually
  wrong" at this project's Testing-mode audience size. `drive.file` — per
  Google's own scope documentation, quoted in the same verified-facts doc —
  only grants access to files the app created or the user opened with it.
  `real-classroom-provider.ts`'s `driveFileHealth()` (~line 623-634) calls
  `drive.files.get` on the Drive file ID a Classroom attachment names — a
  file the teacher created independently, before ever using this app —
  which is exactly the read `drive.file` cannot perform. The catch maps a
  403/404 to `'permission_locked'`/`'deleted'` rather than crashing, so the
  likely live-Google failure mode is every real attachment silently
  mis-classified, triggering the Action Sheet Modal on nearly every item on
  a teacher's first live transfer — and since "Copy to My Drive" needs the
  same read access to `files.copy` a file it cannot see, that fallback may
  fail too, for exactly the courses most likely to be tried first. Cannot be
  verified against the mock (no test exercises real Drive scopes) or
  confirmed without live Google credentials, which QA is barred from
  seeking. Already seen once from a different angle: the 2026-08-26
  security-engineer report (S9) noticed the `drive.file` substitution but
  rated it only for exposure/blast-radius, never asked whether it is
  functionally sufficient. Recommend: verify with one real, non-app-created
  Google Drive file (a throwaway dev Google account via OAuth Playground
  suffices — no user credentials needed) before the user attempts
  `docs/handoff/connecting-to-live-google.md` Part 4.2; either restore
  `drive.metadata.readonly` (its cost is already cleared at this audience
  size per the verified-facts doc) or confirm `drive.file` suffices. Full
  evidence trail: `docs/features/real-google-integration/06-qa-report.md`
  Cycle 2 §C2.6. (high)

- [QA-0032] **The stale Playwright E2E suite should be treated as higher-priority than
  its neighbors.** Already filed by the engineer (see "Engineer DEFER
  findings — QA revise cycle 2" above) at medium severity. QA's view, asked
  for directly this cycle: a suite that fails at its first line for every
  spec provides zero regression coverage while still *looking* covered
  (file count, spec count) to anyone who doesn't check whether it currently
  runs — worse than no suite, not merely equivalent. Not re-filed as a
  separate item; recommend bumping this existing entry's priority rather
  than treating it as routine cleanup.
