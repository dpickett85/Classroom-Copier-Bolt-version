# UX Workflow — Real Google Integration & Duplicate Prevention (Phase 2)

> How the product works (flows & structure, not visual style), revising
> `docs/product/02-ux-workflow.md` (v1) for Phase 2. Written by the UX agent
> from `01-pm-brief.md` under Beast Mode (full elicitation, every choice
> auto-accepted at its recommended option, recorded via
> `stage_record_decisions` with `source: "beast-mode-auto"`). Date: 2026-08-23.
>
> **Track:** `docs/features/real-google-integration/`, **scopeMode: "open"** —
> this doc reads the PM brief's §9 keep/revise/reinvent table as its scoping
> contract, not the conform-by-default feature-mode rule. §0 below restates
> that table mapped to UX surfaces.
>
> **Product type:** GUI app (responsive web) — unchanged from v1.
>
> **Relationship to v1:** this is not a replacement for
> `docs/product/02-ux-workflow.md` — it is a **revision layer**. Sections and
> screens the PM brief's §9 table marks **Keep** are referenced, not
> re-specified, here (the wizard's 5-step structure, the Action Sheet's
> Scenario 2/3 mechanics, the batch-transfer progress mechanics apart from the
> new interrupt states, WCAG AA baseline, per-type field display). Everything
> below earns its place either because it is new or because the PM brief
> requires it to change.

## 0. Scope framing — what changes here, mapped to UX surfaces

Restating the PM brief §9 table's UX-relevant rows as a quick reference (full
rationale lives in the brief; this is navigation, not a re-derivation):

| PM §9 area | Scope | What that means for this doc |
|---|---|---|
| Auth (sign-in, `SignInLanding`/`AuthFlow`) | **Reinvent** | §1–§5 below are new: real OAuth redirect flow, every failure path, session/token expiry mid-wizard and mid-transfer. |
| Pre-flight engine | **Revise** | §3–§5: duplicate-detection pass + topic-match pass added to the existing persisted-scan pattern; §6.3 precedence rule (duplicates never enter the Action Sheet). |
| Reconciliation invariants | **Keep** (vocabulary grows by one value) | §3, §5: `duplicate_title` joins the closed `skipped` vocabulary; the sum formula itself is unchanged. |
| Transfer engine | **Keep** (threads the new skip reason + topic reuse mapping through) | No new UX surface; the Completion Summary reads its output (§3). |
| UX flow (5-step wizard) | **Keep + targeted revise** | §1–§2: the wizard, Action Sheet, and Completion Summary containers stand; only the content named above changes. |
| Cold-start overlay / mechanism | **Keep the mechanism, revise where it applies** | §4, Delta P0-1: the existing 2s/60s latency-triggered machine (`04-architecture.md` D4) is reused, but the OAuth round trip has a leg it structurally cannot cover. |
| Design system | **Keep** | No new visual system; all new states are structural specs for UI to style within the existing token system (§6). |

## 1. Primary user flows (revised)

**Core JTBD flow — unchanged in shape, rewritten at steps 1–2 and 4–5:**

1. **Sign in (real OAuth).** Teacher clicks "Sign in with Google" on the
   landing screen. The client obtains an authorization URL from the backend
   (an ordinary, cold-start-covered API call — see §4) and navigates the
   browser to Google. See `wireframes/01-real-oauth-sign-in.md` 1a–1b.
2. **Choose account (forced, off-site).** Google's own account chooser
   renders — `prompt=select_account` semantics preserved from v1, now real
   and on Google's domain, not ours. The mock account-picker screen is
   **retired**; there is nothing left in this app to render at this step. See
   `wireframes/01-real-oauth-sign-in.md` 1c.
3. **Return and land.** Google redirects back through the backend's callback
   route (token exchange, session cookie set) to a "Signing you in…" screen,
   then directly to Source & Target Selection — same "no intermediate
   dashboard" rule as v1 Decision 2. See `wireframes/01-real-oauth-sign-in.md`
   1d.
4. **Select source & target.** Unchanged mechanically from v1 (two
   independent dropdowns, source ≠ target validation, Continue gating). The
   persistent notice changes tone: from a duplicate-risk **warning** to a
   duplicate-prevention **reassurance** — see §3.
5. **Pre-flight scan (revised).** Runs automatically, now performing three
   passes against the persisted scan: attachment health (v1, unchanged),
   duplicate-title detection against the destination (new, PM §6.1–§6.3), and
   topic-match detection against the destination (new, PM §6.8). Silent and
   auto-advancing when there is nothing **actionable** — duplicates are
   informational, not actionable, so a scan that finds only duplicates still
   auto-advances past the Action Sheet (which is reserved for items needing a
   teacher decision) straight to the disclosure on Ready to Transfer. See §3
   and `wireframes/02-duplicate-and-topic-preflight-disclosure.md`.
6. **Confirm ("Ready to Transfer," revised).** The confirmation checkpoint now
   states an accurate "X of Y posts" count (excluding duplicates), and
   discloses — via two expandable, inspectable lists — exactly which items
   will be skipped as duplicates and which topics will be reused, before the
   teacher commits. See `wireframes/02-duplicate-and-topic-preflight-disclosure.md`
   2c.
7. **Batch transfer (revised — new interrupt states only).** Mechanically
   unchanged from v1 (topics created/mapped first, oldest-first posts, live
   progress). New: a session-expiry interrupt and a Google-reconnect interrupt
   can appear mid-transfer without aborting the underlying job — see §5 and
   `wireframes/04-session-and-token-interrupts.md`.
8. **Completion summary (revised).** Reports the new `duplicate_title` skip
   bucket distinctly from user-chosen skips, and topics as a separate
   created/reused accounting line outside the item invariant. See §3 and
   `wireframes/03-completion-summary-duplicates-topics.md`.

**Secondary flow (curriculum lead/co-teacher):** unchanged from v1 — same
screens, same mechanics, only which course is picked as source vs. target
differs.

## 2. Entry points & structure (revised)

- **Session check on load (carried forward from v1, now real):** if a valid
  session cookie exists, the sign-in landing screen is skipped entirely and
  the app lands directly on Source & Target Selection — same IA rule as v1,
  now against a real, expiring session instead of a mock one that never
  expired.
- **Mock account-picker screen is retired.** It is not replaced by an
  equivalent in-app screen — Google's account chooser fully absorbs that
  responsibility, off our domain (`wireframes/01-real-oauth-sign-in.md` 1c).
  The step indicator's implicit "sign-in precedes step 1, isn't itself a
  step" rule (v1 §2) is unchanged; there is simply one less on-domain screen
  before it.
- **Header account control (revised mechanism, unchanged position/labels):**
  "Switch account" now re-runs the full real-OAuth redirect (with
  `prompt=select_account`) instead of reopening an in-app modal — the user
  briefly leaves the site and returns, same as any other sign-in. "Sign out"
  clears the server-side session. See `wireframes/01-real-oauth-sign-in.md`
  1h.
- **Back navigation (unchanged rule, new edge case flagged):** Back is still
  available from Selection through Ready to Transfer, still disabled once
  transfer starts. **New, architect-flagged edge case:** because sign-in now
  involves the browser leaving and returning via redirect, a teacher who
  presses the browser's own Back button after landing on Selection could, in
  principle, land on an intermediate OAuth redirect state rather than
  anything this app controls. **MANUAL-VERIFY / architect scope:** whether
  the client uses history-API routing that needs an explicit guard here, or
  whether the redirect-driven, non-bookmarkable nature of the callback route
  already makes this a non-issue (most SPA-with-redirect-auth implementations
  do). UX's requirement, independent of the mechanism: the browser Back
  button must never replay a stale OAuth code or silently corrupt the
  session — at minimum it must be a no-op, never a dead or broken screen.
- **No new top-level surfaces.** No dashboard, no run history — same as v1;
  the real-OAuth flow adds states within the existing linear wizard, not a
  new IA branch.

## 3. Key interaction surfaces & content (revised + new)

Full low-fi structure lives in `wireframes/` (this feature's) and
`docs/product/wireframes/` (v1, for anything marked Keep below).

| # | Surface | Status | What changed |
|---|---|---|---|
| 1 | Sign-in landing | **Revise** | Real OAuth CTA, no seeded accounts, cold-start-expectation copy, error banner slot. `wireframes/01-real-oauth-sign-in.md` 1a. |
| — | Mock account picker | **Retired** | Replaced entirely by Google's off-site chooser. Nothing renders in its place. |
| 2 | Pre-redirect warm-up | **New** | Blocks the Google redirect until the backend confirms warm, reusing the existing `ColdStartOverlay`. `wireframes/01-real-oauth-sign-in.md` 1b. |
| 3 | "Signing you in…" callback landing | **New** | The return leg's landing screen; confirms session via a cold-start-covered fetch. `wireframes/01-real-oauth-sign-in.md` 1d. |
| 4 | Sign-in failure states (denied / expired link / generic) | **New** | Three distinguishable, non-dead-end error states, all returning to screen 1. `wireframes/01-real-oauth-sign-in.md` 1e–1g. |
| 5 | Source & Target Selection | **Revise** | Header control mechanism (§2); duplicate-run notice flips from warning to reassurance (§3 below). |
| 6 | Pre-flight scan | **Revise** | New "Checking for existing items…" status line; duplicate + topic-match passes added to the persisted scan. `wireframes/02-…` 2a. |
| 7 | Action Sheet Modal | **Revise** | Excludes duplicate items entirely (§6.3 precedence); count reflects only actionable items. `wireframes/02-…` 2b. |
| 8 | Ready to Transfer | **Revise** | Accurate "X of Y" count; expandable duplicate-items and topic-reuse disclosure lists; reassurance copy. `wireframes/02-…` 2c. |
| 9 | Batch Transfer Progress | **Revise** | Two new interrupt banners (session-expired, Google-reconnect-needed), distinct from the existing rate-limit pause. `wireframes/04-…`. |
| 10 | Completion Summary | **Revise** | New "Skipped, already existed" tile distinct from "Skipped by you"; Topics split into created/reused, outside the item sum; itemized log Outcome wording and filter split; new topic detail panel. `wireframes/03-…`. |
| 11 | Cold-start overlay | **Keep the component, revise usage + copy** | Same component, now also gates the pre-redirect leg (§4); landing-screen copy sets expectations before the user ever sees it. |
| 12 | Session-expired interrupt (mid-wizard) | **New** | `wireframes/04-…` 4a. |
| 13 | Session-expired interrupt (mid-transfer) | **New** | `wireframes/04-…` 4b. |
| 14 | Google-reconnect interrupt (mid-transfer) | **New** | `wireframes/04-…` 4c. |
| — | Live-OAuth checklist | **New deliverable** | Not a product screen — a document handed to the user. Content/shape spec in §7. |

Everything else — the wizard's step indicator, the Ready-to-Transfer
checkpoint's existence, the batch-transfer progress mechanics apart from the
two new interrupts, the Completion Summary's full-screen-report container,
per-type field display, CSV export — is **Keep** per PM §9 and stands as
specified in `docs/product/02-ux-workflow.md`.

### Duplicate & user-choice skips must read differently, everywhere they appear

This is the concrete answer to the assignment's trust requirement ("a skip
must mean 'already there,' not 'we lost it'"), stated once here because it
threads through three surfaces:

- **Ready to Transfer:** duplicates appear only in the dedicated, labeled
  disclosure list (`wireframes/02-…` 2c) — never mixed into the Action
  Sheet's actionable rows.
- **Completion Summary stat tiles:** "Skipped, already existed" and "Skipped
  by you" are two separate tiles, not one "Skipped" tile with a breakdown a
  teacher has to dig for.
- **Completion Summary itemized log:** the Outcome column uses different
  wording per kind ("Already in course" vs. "Skipped — you chose to skip"),
  and the filter dropdown offers them as separate options.

Both kinds still feed the same closed `skipped` term in the reconciliation
sum (PM §6.5) — the distinction is entirely presentational/informational, not
a new outcome bucket, per the PRD's explicit constraint that `duplicate_title`
joins the existing vocabulary rather than creating a fourth term.

## 4. In-the-moment feedback & responses (revised)

- **Cold start (mechanism unchanged, usage extended):** the existing
  latency-triggered state machine (`04-architecture.md` D4 — overlay at 2s
  unresolved, 60s ceiling, then a distinct error state) now also wraps the
  pre-redirect "get the Google auth URL" call (§1 step 1,
  `wireframes/01-real-oauth-sign-in.md` 1b) and the post-callback session
  confirmation (§1 step 3, `wireframes/01-real-oauth-sign-in.md` 1d). **It
  does not, and structurally cannot, cover the redirect round trip itself**
  (the time the browser spends on Google's domain, or the server-side
  processing window between Google's redirect landing on the backend and that
  route's own redirect to the frontend) — no page has loaded during that
  window, so nothing can render an overlay into it. See Delta P0-1 for the
  required mitigation and the honest statement of residual risk.
- **Sign-in landing sets expectations up front (new):** "First sign-in today
  can take up to a minute while the app wakes up" appears on the landing
  screen itself, before the user ever leaves for Google — so that if the
  round trip *is* slow (whether from the covered legs or the uncovered
  middle), it reads as an already-announced normal wait, not a broken app.
  This is the primary lever available for the uncovered window: the
  assignment's reported incident ("waking up the server… then a dead screen")
  is best prevented by minimizing the chance of hitting the window at all
  (front-loaded warm-up, §Delta P0-1) and by making its worst case
  unsurprising when it can't be avoided.
- **Pre-flight scanning status text (revised):** cycles through "Checking
  topics…", "Checking for existing items…" (new), "Verifying attachments…",
  "Checking permissions…" — same pattern as v1, one line added.
- **Duplicate/topic disclosure (new, theme-4 not theme-5):** the expandable
  lists on Ready to Transfer are informational, not an interrupt — they
  don't require a decision, don't block Continue, and don't change the
  interaction the way the Action Sheet's rows do. This is why they live on
  the confirmation checkpoint rather than as a modal: per the
  ux-Agent-C theme-4/5 boundary, a status that's informational during a
  still-normal-path interaction is theme 4 even though the number implies
  something (a re-run) happened before.
- **"Signing you in…" (new):** a transitional screen, not a dead spinner —
  its own confirmation call is cold-start-covered (above), so if it's slow it
  visibly becomes the cold-start overlay's copy rather than sitting mute.

## 5. Edge cases & off-happy-path (revised + new)

This section carries the bulk of the assignment's "every failure path"
requirement. Each item states the required user-facing behavior; where the
underlying mechanism is architecture/engineering scope, that's named
explicitly rather than left implicit.

- **OAuth consent denied.** Google redirects with `error=access_denied`.
  Lands back on sign-in landing with a blame-free, specific error and a
  one-click retry. `wireframes/01-real-oauth-sign-in.md` 1e.
- **Expired or invalid sign-in link.** State/nonce mismatch or a reused/stale
  callback. Distinguishable copy from consent-denial. `wireframes/01-…` 1f.
- **Generic Google/network sign-in failure.** Catch-all extending v1's
  existing generic-error pattern to the auth surface, with an optional
  low-emphasis reference code. `wireframes/01-…` 1g.
- **Cold backend interleaved with the OAuth redirect (the "dead screen"
  risk) — P0, see Delta P0-1.** The single most important failure path named
  in the assignment. Fully specified in §4 above and `wireframes/01-…`
  1b/1d, with the residual, architecturally-unclosable window named honestly
  rather than claimed as fixed.
- **Google-side test-user block.** If the signing-in account isn't on the
  OAuth consent screen's test-user list (§8 of the PM brief, testing-mode
  cap), Google shows its own "access blocked" screen — entirely outside this
  app, un-narratable by it, and indistinguishable on return from any other
  denial. Not fixable in-app; the live-OAuth checklist (§7) must pre-empt it
  by having the user add themselves as a test user *before* attempting
  sign-in.
- **Session expired mid-wizard (Selection / Pre-flight / Action Sheet / Ready
  to Transfer).** Any 401 interrupts the current screen with an honest "your
  selections weren't saved" message and a one-click re-auth. No draft has
  been written yet at any of these steps, so nothing durable is actually
  lost. `wireframes/04-…` 4a.
- **Session expired mid-transfer.** The batch-write job is server-owned and
  keeps running independent of the browser's session (same job/executor/lease
  machinery that already makes browser-refresh-mid-transfer safe, v1 P0 Delta
  #2 / fixture F12) — the banner must say the job is still running, never
  read as a transfer failure. Re-auth reconnects to the same job via the
  existing `GET /transfer-jobs/active` mechanism. `wireframes/04-…` 4b.
- **Google token refresh fails mid-transfer.** Distinct from app-session
  expiry — the backend's standing permission to call Google died (revoked
  consent, expired refresh token), not the browser's session. Requires a
  "Reconnect Google account" action, must be visually distinct from the
  purely-informational rate-limit pause banner, and — per zero-silent-drop —
  every item must still resolve to a defined terminal outcome once the job
  finishes, never silently disappear from the eventual reconciliation sum.
  **P0, see Delta P0-2.** `wireframes/04-…` 4c.
- **Browser Back button after the OAuth redirect.** Flagged as an
  architect-scope edge case in §2 — UX's requirement is a no-op at worst,
  never a dead or broken screen, never a replayed stale code.
- **User closes the browser tab/window mid-redirect (without clicking
  Deny).** Not a distinct failure state under the full-page-redirect model
  (Decision 1) — there is no parent tab left waiting on a popup to resolve;
  the user simply returns (or doesn't) to an ordinary signed-out landing
  screen on their next visit, and the ordinary session check handles it with
  no special-cased behavior required.
- **Re-running a fully-completed transfer ("all items are duplicates").**
  Extends v1's existing "0 posts to copy" empty-course treatment: "Ready to
  copy 0 of 42 posts… all 42 already exist" is the expected, successful
  result of the product's own headline promise, and must read as such, not
  as an error. `wireframes/02-…` "All-duplicate edge case."
- **Topic name collision (ambiguous match).** More than one destination topic
  matches a source topic's normalized name (PM §6.8). Disclosed at pre-flight
  and again in the Completion Summary's topic detail panel, both times with
  an explicit note naming the ambiguity and which one was reused — never
  silently resolved with no trace. `wireframes/02-…` 2c, `wireframes/03-…`
  3c.
- **Duplicate item that also has an unhealthy attachment (combined case).**
  Per PM §6.3's decided precedence, the duplicate skip wins outright — the
  item never enters the Action Sheet, resolves as exactly one outcome
  (`duplicate_title` skip), and no attachment-health decision is ever asked
  of the teacher for it. `wireframes/02-…` 2b.
- **Switch account mid-wizard.** Unchanged rule from v1, reaffirmed under
  real OAuth: any in-progress, unconfirmed selection is discarded when the
  new account lands, never silently carried over.

## 6. Workflow constraints (revised)

Everything in v1 §6 (responsive-web-only, WCAG AA baseline, live-region
throttling, text alternatives for outcome icons, focus management, English-
only, no offline support, whole-course-only, per-type field display, no
short client-side timeouts, no mid-transfer cancel) is **Keep** and applies
unchanged to every surface in this doc. Additions specific to Phase 2:

- **New interrupt banners (session-expired, Google-reconnect) get the same
  focus-management treatment** as the Action Sheet Modal and Completion
  Summary already receive in v1 §6 — focus moves to the banner's heading when
  it appears, so a screen-reader user is told the state changed rather than
  discovering it by accident.
- **Text alternatives extend to the new duplicate/topic disclosure controls.**
  The expand/collapse triangles on Ready to Transfer and the Completion
  Summary's topic detail panel are keyboard-operable (standard
  `<details>`-equivalent semantics: `Enter`/`Space` toggles, reachable by
  `Tab`) and carry visible text ("expand"/"collapse"), never an icon-only
  affordance.
- **The new duplicate/user-skip Outcome distinction must not be color-only.**
  Per the project profile's existing `OutcomeIcon` rule ("cannot render
  glyph-only — no prop suppresses its text label"), the "Already in course"
  vs. "Skipped — you chose to skip" distinction must be legible from text
  alone in every rendering context (log row, filter option, stat tile label),
  not from icon or color alone.
- **The pre-redirect warm-up (§4) must not create a new short-timeout
  failure mode.** It reuses the existing cold-start machine's 60s ceiling
  rather than inventing a shorter one — a short timeout here would fail the
  sign-in flow exactly during the scenario it exists to protect against.
- **Cold-start idle detection remains an architecture dependency (v1 §6,
  unchanged pointer):** carried forward without change; Phase 2 adds no new
  detection requirement, only new call sites for the existing mechanism.

## 7. The live-OAuth checklist — a UX deliverable

Per the binding kickoff decision and PM brief §7.3, this is a first-class
deliverable, not documentation-as-afterthought. The engineer stage authors
its actual content (it needs the final, as-built env var names, routes, and
screenshots); this section specifies the **shape and content requirements**
so what gets produced is genuinely usable by a teacher, not a developer.

**Audience assumption (binding):** no CLI, no dev tools, no jargon. Every
technical term either has a plain-language gloss on first use or is avoided
entirely (e.g., "the web address Google should send people back to" instead
of "redirect URI," until a plain gloss has been given once).

**Required shape:**

1. **Numbered, checkbox-style steps**, grouped into named parts a teacher can
   complete in one sitting or come back to (e.g., "Part 1: Set up your Google
   project," "Part 2: Tell Google where your app lives," "Part 3: Set up your
   app's settings," "Part 4: Try it"). Not a single flat list of 30 items.
2. **Every step pairs an instruction with a confirmation cue** — "do this,"
   then "you'll know it worked when you see ___." A step with no visible way
   to confirm success is not acceptable; per the process lesson (bug
   inventory §C3), the prior session repeatedly handed over instructions the
   user couldn't act on or verify.
3. **Inline troubleshooting drawn from B1–B14, translated into plain
   language**, placed next to the step it would actually occur at — not
   collected in an appendix nobody reaches. At minimum:
   - Both the front-end and back-end setup must point at the **same** copy of
     the project (B11 — "the single most expensive miss of the prior
     session," named as an explicit early step per PM §7.3).
   - The web address Google sends people back to must match **exactly**,
     character for character (B13).
   - Seeing an error at `/api/auth/me` **before** signing in is normal, not a
     problem (B9).
   - Changing the app's web-address setting requires rebuilding the site, not
     just restarting it (B14).
   - The health-check address is `/api/health`, not `/health` (B8).
   - The "allowed origins" / cross-site setting must include the app's own
     custom header, or sign-out and other actions will fail silently in the
     browser's network log (B10).
   - Your database needs to be a real Postgres database provisioned on
     Render — not the default SQLite setting — before the backend will boot
     cleanly (B7).
4. **A pre-flight step for the testing-mode test-user list**, placed *before*
   the first sign-in attempt in the checklist's sequence — directly closing
   the "Google-side test-user block" edge case in §5, which this app cannot
   narrate if hit live. Covers the secondary curriculum-lead/co-teacher
   persona too: anyone who will sign in during testing needs to be added to
   the same test-user list, not just the primary teacher running the
   checklist.
5. **A final, concrete success checkpoint**, not just "you're done": "Try
   copying one item between two of your own test courses. If it lands as a
   draft in the target course, and running the exact same copy again shows it
   as already-there instead of creating a second copy, everything is
   working." This doubles as the human bar's own acceptance test (PM §5,
   items 7–8).
6. **A short "if something doesn't work" closing step** telling the teacher
   what to note (which part, which step, what they saw) and that it comes
   back as a follow-up pass — matching the kickoff-decision-bound handling of
   checklist findings (PM §7.3, backlog item already recorded).

**MANUAL-VERIFY (delivery surface):** `docs/handoff/Connecting-To-Live-
Google.docx` already exists in this repository at the time of writing. Whether
the engineer stage updates that existing document to this shape or produces a
new one is an engineer/architect call this doc does not make — flagged rather
than assumed, since the file's current content was not read as part of this
pass (out of scope for UX; reading and revising it is the engineer stage's
job).

## Wireframes

Low-fidelity, structure-only wireframes for every screen this phase
materially changes (offered and produced — see Decisions; screens with no
material change are not re-drawn, per the assignment's scoping):

- `wireframes/01-real-oauth-sign-in.md` — sign-in landing, pre-redirect
  warm-up, the off-site Google leg (boundary marker only), the "Signing you
  in…" callback landing, all three sign-in failure states, and the revised
  Switch-account mechanism.
- `wireframes/02-duplicate-and-topic-preflight-disclosure.md` — revised
  pre-flight status text, the Action Sheet's duplicate-exclusion behavior,
  and the Ready-to-Transfer duplicate/topic disclosure (including the
  all-duplicate edge case).
- `wireframes/03-completion-summary-duplicates-topics.md` — revised stat
  tiles, itemized log Outcome/filter changes, and the new topic detail panel,
  with a worked reconciliation example.
- `wireframes/04-session-and-token-interrupts.md` — the three new interrupt
  states (session-expired mid-wizard, session-expired mid-transfer,
  Google-reconnect-needed mid-transfer).

## Acceptance scenarios

Given/when/then scenarios for what this phase adds or changes. v1's 18
scenarios (`docs/product/02-ux-workflow.md`) remain the acceptance contract
for everything marked Keep in §0 and are not restated here.

1. **Real sign-in, happy path.** Given the user is on the sign-in landing
   screen, when they click "Sign in with Google," then the client obtains an
   auth URL and navigates to Google; when they grant consent and select an
   account, then they land on Source & Target Selection with their real
   course list and account details in the header.
2. **Consent denied.** Given the user is on Google's consent screen, when
   they click Deny/Cancel, then they land back on the sign-in landing screen
   with a specific "you didn't grant access" message and a working retry —
   never a blank or dead page.
3. **Expired sign-in link.** Given a callback request with a mismatched or
   already-used state/nonce, when the exchange is attempted, then the user
   lands on sign-in landing with an "expired link" message distinct from the
   consent-denial message.
4. **Pre-redirect cold-start coverage.** Given the backend has been idle and
   the user clicks "Sign in with Google," when the auth-URL request takes
   longer than 2 seconds, then the existing cold-start overlay appears before
   any navigation to Google occurs; when it exceeds 60 seconds, then the
   existing distinct error state appears instead of navigating anywhere.
5. **Post-callback cold-start coverage.** Given the "Signing you in…" screen
   is showing, when its session-confirmation call takes longer than 2
   seconds, then the same cold-start overlay copy applies to that screen
   rather than a mute spinner.
6. **Switch account.** Given a signed-in user clicks "Switch account," when
   Google's account chooser completes with a different account, then the app
   lands on Source & Target Selection with that account's course list, and
   any unconfirmed prior selection is discarded.
7. **Session expiry mid-wizard.** Given a user is on Source & Target
   Selection, Pre-flight, the Action Sheet, or Ready to Transfer, when an API
   call returns 401, then an interrupt states the session expired and
   selections weren't saved, with a one-click re-auth that returns to Source
   & Target Selection.
8. **Session expiry mid-transfer.** Given a batch transfer is running, when
   the session expires, then the progress view shows a distinct banner
   stating the transfer is still running and re-auth is needed to keep
   watching; when the user re-authenticates, then polling resumes against the
   same job with no duplication.
9. **Google token failure mid-transfer.** Given a batch transfer is running,
   when the stored Google token can no longer be refreshed, then a
   "Reconnect Google account" banner appears, visually distinct from the
   rate-limit pause banner; when the user reconnects, then the job resumes
   and every item still resolves to a defined transferred/fallback/skipped
   outcome by completion.
10. **Duplicate detection at pre-flight.** Given a destination course already
    contains items matching some source titles (draft or published), when
    pre-flight completes, then Ready to Transfer shows an accurate "X of Y"
    count and an expandable list naming each duplicate item and which
    destination item (title + state) it matched.
11. **Duplicate skip precedence over health check.** Given a source item is
    both a duplicate-title match and has a trashed/permission-locked
    attachment, when pre-flight completes, then that item never appears in
    the Action Sheet and resolves as exactly one outcome: a `duplicate_title`
    skip.
12. **Topic reuse disclosure.** Given a destination course already has topics
    matching some source topic names, when pre-flight completes, then Ready
    to Transfer shows an expandable list naming each reused topic; when a
    topic name matches more than one destination topic, then the list notes
    the ambiguity and which one will be reused.
13. **All-duplicate re-run.** Given every source item already exists in the
    destination, when pre-flight completes, then Ready to Transfer shows "0
    of Y posts" with all Y listed as duplicates, and Start Transfer still
    completes successfully with 0 new drafts and 0 new duplicates.
14. **Completion Summary duplicate/user-skip distinction.** Given a completed
    transfer with both duplicate-skipped and user-chosen-skipped items, when
    the Completion Summary renders, then "Skipped, already existed" and
    "Skipped by you" appear as two separate stat tiles, the itemized log's
    Outcome column uses distinct wording for each, and the filter dropdown
    offers them as separate options.
15. **Topics reported outside the item invariant.** Given a completed
    transfer with both newly-created and reused topics, when the Completion
    Summary renders, then "Topics created" and "Topics reused" appear as
    separate figures that are never terms in the item reconciliation sum, and
    an explicit note states topics are counted separately.
16. **Duplicate-run notice reassurance.** Given a user is on Source & Target
    Selection, when they view the persistent notice, then it states that
    already-existing items are detected and skipped (not that re-running
    creates duplicates), matching the same reassurance restated on Ready to
    Transfer.

## Deltas (required quality improvements)

| Risk (P0/P1) | Recommendation | Rationale | Prerequisite for next stage? |
|---|---|---|---|
| **P0-1** — A full-page OAuth redirect leaves a window (the server-side processing time between Google's redirect landing on the backend's callback route and that route's own redirect to the frontend) during which no page has loaded and nothing can render — the exact "waking up the server… then a dead screen" incident the prior session hit. The existing cold-start machine (`04-architecture.md` D4) only wraps client-side fetch calls and cannot reach into this window. | Front-load a backend warm-up the instant "Sign in with Google" is clicked (an ordinary, cold-start-covered fetch, before navigating to Google) to minimize the odds the backend is still cold when Google redirects back; set expectation copy on the sign-in landing screen before the user ever leaves; route the callback's redirect target through the always-warm static frontend so the post-callback confirmation is itself cold-start-covered. State the residual, architecturally-unclosable slice of the window honestly rather than claiming it fixed. | Directly named in the assignment as the incident to fix; a silent dead screen during sign-in is the single worst first impression this phase can produce for the one real teacher waiting on it. | Yes — architect must design the callback route's redirect target and the warm-up call's exact trigger point before engineer builds the auth flow; getting this backwards (e.g., callback redirecting straight to a backend-rendered page) reintroduces the exact incident. |
| **P0-2** — Google token-refresh failure mid-transfer (revoked consent, expired refresh token) has no defined terminal behavior. Items not yet attempted when the token dies must not silently vanish from the eventual Completion Summary's reconciliation sum, and the teacher needs a way to recover without risking re-duplication of items already written. | Define a distinct "Google access needs to be reconnected" interrupt (visually and semantically separate from the rate-limit pause banner), reconnecting via the existing job-resume mechanism (`GET /transfer-jobs/active`); whichever mechanism the architect chooses for pausing/resuming vs. failing-and-retrying, every item must resolve to a defined transferred/fallback/skipped outcome by job completion. | Zero-silent-drop is a shipped guarantee (v1 brief, carried forward); a Google-side auth failure is a new, real failure mode this phase introduces by replacing the mock (which never had a revocable token) with a live one, and the brief itself names "OAuth token lifecycle bugs" as risk #5. | Yes — architect must specify the transfer-engine's behavior on token failure (pause-and-wait vs. fail-and-let-a-rerun's duplicate-skip recover the gap) before engineer builds the interrupt and before QA can write a fixture against it. |
| **P0-3** — A skip caused by duplicate detection and a skip chosen by the teacher must never be presented identically, anywhere a teacher can see outcomes — collapsing them would directly contradict the trust guarantee this phase's headline promise depends on ("a skip means already there, not we lost it"). | Two separate stat tiles, two distinct Outcome-column wordings, two separate filter options — specified concretely in §3 and the Completion Summary wireframe — while keeping both feeding the same closed `skipped` reconciliation term per PM §6.5 (no new outcome bucket). | Directly named in the assignment; also the concrete, checkable form of PM §6.4's requirement that duplicate skips be "distinct from user-chosen skips." | Yes — UI needs this distinction as a design requirement (two tiles, not one with a tooltip), and engineer/QA need it as a testable acceptance criterion, not an implicit convention. |
| **P1** — The Action Sheet Modal's own item count, and its "we found N items" framing, could read as inconsistent with the duplicate count disclosed one screen later if the two aren't visibly reconciled at the point the modal appears. | The modal names the duplicate count in its header line ("5 items already exist… see the next screen") even though duplicates aren't actionable there, so a teacher doesn't wonder why the actionable count seems low relative to the course size. | A minor but real coherence gap — without this line, a teacher who mentally tallies "the course has 42 posts, why does this modal only mention 1" has no way to resolve that within the modal itself. | No — a copy/content refinement UI can apply directly; doesn't block architect or engineer design. |
| **P1** — No fixture in the F1–F14 manifest (nor PM §6.6's new dedupe fixture) exercises the session-expiry or Google-token-failure interrupt states (§5, `wireframes/04-…`). | Flag these three states as fixture-uncovered, matching how v1 flagged cold-start and resumability rather than silently assuming coverage; PM/architect should consider a companion fixture in a later pass. | Mirrors v1's own established discipline (Deltas P1 rows for cold-start and F6-exhaustion) — an uncovered state with no citation is worse than one honestly flagged, per the project profile's own "fixture-honesty" lesson learned. | No — doesn't block UI/architect from designing these states as specified; QC must not treat them as fixture-certified. |
| **P1** — The browser Back button's behavior immediately after the OAuth redirect return (§2) is unspecified at the mechanism level — whether the SPA's routing needs an explicit guard, or whether the redirect-driven flow already makes this a non-issue, depends on implementation choices not yet made. | Architect states the mechanism explicitly (history-API guard vs. structurally moot) before engineer builds the callback-landing route; UX's requirement — never a dead/broken screen, never a replayed stale code — holds regardless of which mechanism is chosen. | An unspecified browser-native affordance (Back) is exactly the kind of gap that produced B4-style prop-contract drift in v1 — better named now than discovered during QA. | No — doesn't block UI's visual design of the affected screens; architect should resolve before engineer builds the callback route. |

## Decisions (confirmed)

Recorded via `stage_record_decisions` with `source: "beast-mode-auto"` (batch
call, this session). All choices auto-accepted their recommended option per
Beast Mode (stage-protocol §10); none crossed the repository boundary, so
nothing required a decline.

1. **Sign-in is a full-page redirect, not a popup.** More reliable across
   school-network/Chromebook environments (popup blockers are a common
   classroom-device failure mode), and matches the standard authorization-code
   flow with server-side token exchange (C7, PM brief).
2. **The client fetches the Google auth URL via an ordinary API call before
   navigating**, rather than navigating the browser directly to a
   backend-constructed URL — this is what makes the pre-redirect leg
   cold-start-coverable at all (Delta P0-1).
3. **The OAuth callback's redirect target is the frontend origin** (the
   always-warm static site), which then confirms sign-in via its own
   cold-start-covered fetch — rather than the backend directly rendering the
   post-auth landing state itself, which would leave the entire confirmation
   step uncovered by the existing cold-start machine.
4. **The pre-redirect warm-up blocks the redirect** (rather than firing the
   redirect immediately and warming in parallel) — deliberately trades a
   small amount of extra wait time for a real reduction in the odds of
   hitting the uncovered mid-flow window, which is the higher-cost failure.
5. **Mock account-picker screen is retired outright**, not replaced by an
   equivalent in-app screen — Google's own chooser fully absorbs that
   responsibility off-domain; no UI budget spent re-designing a screen that
   no longer needs to exist.
6. **Duplicate/topic disclosure lives on Ready to Transfer, not a separate
   interrupt screen or a modal.** Per the theme-4/5 boundary: duplicates are
   informational, not decision-requiring, so folding the disclosure into the
   existing confirmation checkpoint (rather than a new modal or a new wizard
   step) keeps the "silent when nothing needs a decision" principle intact
   while still satisfying PM §6.3's "disclosed before commit" requirement.
7. **Duplicate items are excluded from the Action Sheet Modal's count and
   rows entirely** (PM §6.3 precedence, decided) — the modal only ever
   reflects items genuinely requiring a teacher decision.
8. **Two separate stat tiles for the two skip kinds**, not one "Skipped"
   tile with a sub-breakdown — chosen over a combined tile with a tooltip or
   expand-to-reveal, because the trust distinction needs to be visible at a
   glance, not one interaction away.
9. **Topics reported as two adjacent tiles ("created" / "reused") plus a
   collapsed-by-default per-topic detail panel** — rather than one tile with
   a slash-separated number (v1's old "6 created/mapped" pattern) — because
   "created" and "reused" are now materially different outcomes a teacher
   needs to be able to tell apart, unlike v1 where mapping vs. creating a
   topic had no product-visible distinction.
10. **Session-expiry mid-transfer and Google-token-failure mid-transfer are
    two visually and semantically distinct interrupt banners**, not one
    generic "something's wrong, reconnect" banner — because their causes,
    recovery actions, and what's actually still safe differ enough that
    conflating them would send a teacher down the wrong recovery path.
11. **The Selection screen's duplicate-run notice flips from warning to
    reassurance copy**, superseding v1's prior notice (which warned that
    re-running creates duplicate drafts, since the check didn't exist yet)
    entirely — the product's own behavior changed, so the copy that
    described the old behavior would now be actively false if left in place.
12. **The live-OAuth checklist's shape is specified here (§7) as numbered,
    grouped, checkbox-style steps with inline troubleshooting and a concrete
    success checkpoint**, rather than left for engineer to invent — this
    satisfies the binding kickoff decision that the checklist is a UX
    deliverable, not documentation-as-afterthought, while leaving the
    engineer stage to fill in as-built specifics (env var names, actual
    screenshots).
13. **Wireframes produced for every materially-changed screen** (four files,
    `wireframes/`), none for Keep screens — matches the assignment's explicit
    scoping instruction rather than defaulting to redrawing the whole wizard.

## Assumptions

- **The pre-redirect warm-up call and the post-callback confirmation call are
  both implementable as ordinary fetches the existing `api-client.ts` cold-
  start wrapper already covers** — this doc assumes no new client-side
  transport mechanism is needed for either leg; if architect finds a reason
  the auth flow can't use the standard fetch wrapper for these two calls,
  the cold-start coverage claims in §4 and Acceptance Scenarios 4–5 need
  re-verification.
- **The residual dead-screen window (the backend's own callback-processing
  time when cold) cannot be closed by any client-side UX mechanism** — this
  is asserted as a structural fact (a page cannot render before it loads),
  not a gap left for lack of trying. The only levers are minimizing its
  likelihood (warm-up) and its perceived severity (expectation-setting copy).
- **Sign-out does not need to revoke the stored Google token** to satisfy
  this phase's UX requirements — flagged as MANUAL-VERIFY for
  architect/engineer in `wireframes/01-real-oauth-sign-in.md` 1h; UX has no
  requirement either way but did not want it silently undecided.
- **The existing `docs/handoff/Connecting-To-Live-Google.docx` is the likely
  home for the live-OAuth checklist**, though this was not read as part of
  this pass and its disposition (update vs. replace) is left to engineer —
  see §7 MANUAL-VERIFY.
- **Google-side "access blocked" screens for non-test-users cannot be
  distinguished, on return to our app, from any other consent denial** —
  assumed rather than confirmed against current Google behavior; if Google's
  callback error payload does carry a distinguishing signal for this case,
  architect may choose to surface a more specific message than 1e's generic
  denial copy. Not blocking — the checklist-based pre-emption in §7 covers
  the case either way.

## Open questions

- Exact mechanism for distinguishing "app session expired" from "Google
  token can no longer be refreshed" at the transfer-job status contract level
  — architect scope, named in Delta P0-2 and `wireframes/04-…`'s Notes.
- Whether the transfer engine pauses-and-waits for Google reconnection or
  fails remaining items outright (letting a subsequent identical run recover
  them via duplicate-title skip) — architect scope, Delta P0-2.
- If the architect chooses fail-outright over pause-and-wait, whether
  unattempted items (never reached before the token died) need a new
  skip-reason value to stay inside the closed
  `transferred`/`fallback_shell`/`skipped` vocabulary this doc specifies
  elsewhere — and if so, whether that new value needs P0-3-style
  distinguishability (its own tile/wording/filter treatment) so a teacher can
  tell it apart from both `duplicate_title` and a user-chosen skip. Not
  resolved here — architect's mechanism choice decides whether the question
  even arises — but named so it isn't discovered late, per Delta P0-2.
- Whether the browser Back button after the OAuth callback needs an explicit
  routing guard — architect scope, §2 and Delta P1 row.
- Whether a companion fixture for session-expiry/token-failure states is
  worth adding in a later pass, given they join cold-start and F6-exhaustion
  as fixture-uncovered states — noted, not decided; candidate for the
  backlog.
- Exact content and delivery surface of the live-OAuth checklist itself
  (§7's shape is specified; the words are engineer's to write against the
  as-built system) — including whether it updates the existing
  `Connecting-To-Live-Google.docx` or supersedes it.

## Next handoff

UI agent → reads this doc plus `docs/product/03-ui-direction.md` (v1's design
system, Keep per PM §9), and styles every Revise/New surface named in §3
within the existing token system — no Tailwind, no new visual language (PM
§7.2, kickoff-binding). Two things UI should weight heaviest:

- **The three sign-in failure states (1e/1f/1g) and the two mid-transfer
  interrupt banners (4b/4c) need a visual vocabulary that reads as
  "recoverable, not broken"** — this phase's whole premise is that the prior
  session's user hit dead ends and gave up; the visual design carries real
  weight in whether these read as safe interruptions or alarming failures.
- **The duplicate/user-skip distinction (§3, Delta P0-3) needs to be legible
  at the stat-tile glance level**, not just in the log detail — UI should
  treat the two tiles as needing genuinely distinct visual treatment (not
  merely different labels on visually identical tiles), consistent with the
  existing `OutcomeIcon`/`OutcomePill` component vocabulary in
  `client/src/components/shared/`.
- **The Completion Summary's stat-tile count grows from v1's 5 to 7 this
  phase** (§3, Decisions 8–9): topics split into two tiles ("created" /
  "reused") and skips split into two tiles ("duplicate" / "user-chosen").
  `docs/product/03-ui-direction.md` (v1, Keep per PM §9) specifies five stat
  tiles in a single row, with a documented responsive strategy (3+2 at
  1024px, 2-col at 768px) built around exactly five. Seven tiles may not fit
  that layout assumption at all — this is a layout-level problem UI must
  resolve (wrap/grid treatment, a revised responsive breakpoint scheme, or
  something else), not just the visual-distinctness question above.

Architect should read §4/Delta P0-1 (cold-start-vs-redirect interleave) and
Delta P0-2 (token-failure mid-transfer) first — both are named prerequisites
before engineer can build the auth flow and the transfer-engine interrupt
handling correctly.
