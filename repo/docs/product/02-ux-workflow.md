# UX Workflow — Classroom Copier

> How the product works (flows & structure, not visual style). Written by the UX
> agent from 01-pm-brief.md. Read by UI next (03-ui-direction.md).
> Date: 2026-08-14
>
> **Product type:** GUI app (responsive web) — React frontend + Node/Express
> backend. Produced under Beast Mode (full elicitation run, every choice
> question auto-accepted at its recommended option, recorded via
> `stage_record_decisions` with `source: "beast-mode-auto"`).
>
> Every flow, screen, and edge case below is written to be demonstrable
> against the mock fixture manifest **F1–F11** from `01-pm-brief.md` §6 item
> 12. Where a stated behavior needs a fixture the manifest doesn't cover, that
> gap is called out explicitly in Deltas/Assumptions rather than glossed over.

## 1. Primary user flows

**Core JTBD flow — "copy my course into an existing (possibly IT-provisioned)
target course":**

1. **Sign in.** Teacher clicks "Sign in with Google (mock)" on the landing
   screen.
2. **Choose account (forced).** The mock account picker renders unconditionally
   (`prompt=select_account` semantics) — never skipped, never remembered
   across a sign-in — listing the ≥2 seeded mock teacher accounts (F10). The
   teacher selects one.
3. **Select source & target.** Teacher picks a source course (active or
   archived) and a target course (active only, including SIS/IT roster
   shells) from two independent dropdowns. A persistent notice warns that
   re-running a copy creates duplicate drafts. Continue is disabled until both
   are chosen and distinct.
4. **Pre-flight scan.** Runs automatically. Silent and auto-advancing when
   every attachment is healthy (F1/F4). When trashed/deleted files (F2) or
   permission-locked files (F3) are found, the Action Sheet Modal opens and
   the teacher resolves each flagged item (or turns on "apply recommended
   fixes automatically").
5. **Confirm ("Ready to Transfer").** A summary checkpoint restates what will
   happen (N posts, drafts only, dates cleared) and repeats the duplicate-run
   warning immediately before the batch-write commits.
6. **Batch transfer.** Topics are created/mapped first, then classwork posts
   are created oldest-first, landing as Drafts. Progress is shown live;
   rate-limit pauses (F6) narrate and resolve automatically.
7. **Completion summary.** A full report shows topics created/mapped, drafts
   transferred, fallback shells (with itemized log), skips, and
   rubric-degradation notes, reconciling exactly to the posts scanned. The
   teacher can start another transfer or open the target course.

**Secondary flow — curriculum lead/co-teacher distributing a master course:**
identical mechanically to the flow above (same screens, same account model);
the only difference is which course the teacher picks as source (a shared
master template) versus target (a colleague's or their own section's existing
course). No separate UI path is needed — this is the same flow with different
course selections, which is why source/target are two independent, symmetric
dropdowns rather than a "personal vs. shared" toggle.

Both flows are single-session, single-run: one source → one target per pass
through steps 3–7 (per brief §6 non-goals: no multi-target fan-out).

## 2. Entry points & information architecture

- **Single linear flow**, not a dashboard. There is no course/run history in
  v1 (no dashboard non-goal is implied by the brief's silence on persistence
  and its "single-purpose utility" positioning) — every session starts at
  sign-in (or, if already signed in, at Source & Target Selection) and ends
  at the Completion Summary, from which "Start another transfer" loops back
  to selection.
- **Persistent step indicator** once signed in: `Select → Pre-flight →
  Transfer → Summary` (sign-in/account-picker precede it and aren't shown as
  a step once passed). The indicator is **non-interactive** — it orients, it
  doesn't let the teacher jump ahead.
- **Back navigation** is available from Selection through the Ready-to-Transfer
  checkpoint (each Back re-validates rather than assuming stale state is still
  valid). Back is **disabled once the batch transfer has started** — a
  half-completed batch-write is not something Back can safely undo.
- **Persistent header** once signed in: current account (avatar/name/email),
  "Switch account" (re-triggers the forced picker), "Sign out." This is the
  concrete home for the account-collision-avoidance requirement — it isn't
  just a first-login gate, it's reachable at any time.
- **No student-facing surface, no admin console** — reachable navigation is
  scoped entirely to what a single teacher needs for one copy operation, per
  the brief's non-goals.

## 3. Key screens/views & purpose

Full low-fi structure for each surface lives in `docs/product/wireframes/` —
summarized here by purpose and content.

1. **Sign-in landing** — single CTA ("Sign in with Google (mock)"), one-line
   value prop. No account data here.
2. **Mock account picker** (forced) — lists ≥2 seeded mock teacher accounts
   (avatar, name, email); selecting one signs in and loads that account's
   distinct course list (F10). Structurally identical whether reached at
   first sign-in or via "Switch account."
3. **Source & Target Selection** — two dropdowns (source: active + archived
   courses; target: active courses only, SIS-shell badge shown), inline
   validation (source ≠ target), persistent duplicate-run notice, Continue.
4. **Pre-flight scan** — transient scanning state (status text cycling
   through topics/attachments/permissions checks); auto-advances silently on
   a healthy scan (F1/F4).
5. **Action Sheet Modal** (conditional) — renders only on F2/F3-type findings.
   Global "apply recommended fixes automatically" toggle; per-item rows with
   scenario-specific options (Scenario 2: Create Draft Shell with Note /
   **Skip \<Type\>** — type-aware label, e.g. "Skip Material," "Skip
   Question," "Skip Quiz Assignment," never hardcoded to "Skip Assignment";
   Scenario 3: Copy to My Drive / Link Existing File / Skip Attachment and
   Note Draft); Continue disabled until every row resolves.
6. **Ready to Transfer** — confirmation checkpoint: post count, source/target
   names, "everything lands as Drafts" reassurance, duplicate-run warning
   restated, Start Transfer.
7. **Batch Transfer Progress** — live fraction counter + progress bar,
   recent-activity ticker (title + outcome icon), rate-limit pause banner
   with countdown (F6), no cancel control in v1.
8. **Completion Summary** — full-screen report (not a small modal — see
   Decisions): stat tiles (topics, drafts transferred, fallback shells,
   skips, rubric-notes), an explicit reconciliation line, a filterable
   itemized log table (title, type, topic, outcome, **type-specific
   fields**, note — see §6 per-type field display), and "Start another
   transfer" / "Open target course" actions.
9. **Cold-start overlay** (cross-cutting, not a standalone step) — "Waking up
   server…" state, reusable wherever the backend hasn't responded within a
   short threshold after being idle, not hardcoded only to sign-in.

## 4. States & feedback

- **Cold start ("Waking up server…"):** shown whenever a backend call hasn't
  responded within ~2s following >15 min of idle time (Render free-tier
  cold-start simulation per the brief's constraint). Auto-dismisses on
  response; no user action required. **Not fixture-covered:** no fixture in
  the F1–F11 manifest (or F12) simulates a cold start; QC cannot certify
  this behavior against a seeded fixture, only against manual/local
  Render-free-tier testing. Flagged in Deltas/Assumptions like the other two
  self-reported fixture gaps (resumability, network-error catch-all) — the
  wireframes previously cited a nonexistent fixture tag and a nonexistent
  Deltas row for this state; both citations are corrected in this revision.
- **Pre-flight scanning:** status text cycles ("Checking topics…", "Verifying
  attachments…", "Checking permissions…"); healthy result shows a brief "All
  clear" confirmation (~1s) before auto-advancing, so the transition doesn't
  read as a glitch.
- **Batch transfer progress:** live "Transferring N of Total" counter +
  progress bar + recent-activity ticker tagged with outcome icons
  (transferred / fallback shell / skipped).
- **Rate-limit pause (F6):** an inline banner with a visible retry countdown;
  the progress bar pauses (never resets) and resumes on its own. This is
  purely informational/in-the-moment (theme 4) as long as the retry
  eventually succeeds — it becomes an edge case only if retries exhaust (see
  §5).
- **Toggle feedback:** turning on "apply recommended fixes automatically" in
  the Action Sheet Modal immediately auto-selects every row's starred
  recommended option and enables Continue; rows stay individually
  expandable/overridable.
- **Form validation (Selection screen):** Continue stays disabled until both
  dropdowns are filled; an inline error appears only if source and target are
  the same course.
- **Rubric degradation (F7):** not a modal/interrupt — the post is created
  normally and a note is appended; surfaced afterward as a distinct
  "Rubric notes added" count and per-row Note in the Completion Summary, not
  as an in-the-moment interruption during transfer.
- **Combined-outcome rule (fallback shell + rubric-degraded on the same
  post):** the two failure modes are independent — attachment failure routes
  a post to Scenario 2/3 handling; rubric failure is a separate API call —
  and can co-occur on a single post (e.g., an Assignment with a trashed
  attachment AND a license-blocked rubric). For the reconciliation sum, that
  post counts **exactly once, under "Fallback shells"** — fallback-shell
  status always wins the primary transferred/fallback/skipped bucket, since
  the draft-shell path already ran for that post. **"Rubric notes added" is
  a non-exclusive secondary tag** that can co-occur with any of the three
  primary outcomes without ever adding a second term to the reconciliation
  sum. The itemized log's Note column shows both notes (fallback reason +
  rubric note) on that single row. No fixture in F1–F11 combines F2/F3 with
  F7, so this rule is specified but not fixture-tested (see Assumptions).

## 5. Edge cases & off-happy-path

- **Trashed/deleted attachment (F2):** Action Sheet Modal, Scenario 2 options;
  recommended default = "Create Draft Shell with Note" (never silently
  skips).
- **Permission-locked/co-teacher attachment (F3):** Action Sheet Modal,
  Scenario 3 options; recommended default = "Copy to My Drive (Become
  Owner)" (a permanent fix, applied only to the flagged file — not a
  wholesale duplication of the course's Drive files).
- **Re-running the same source→target pair:** no dedupe exists in v1; warned
  at two touchpoints (Selection screen notice + Ready-to-Transfer restatement)
  rather than blocked.
- **Attachment cap overflow (F5, 21+ attachments):** handled silently/
  automatically during transfer (attachments 21+ become URL links in the
  description, per spec) — not pre-flight-blocking — but surfaced
  after the fact as a Note on that post's row in the Completion Summary's
  itemized log, so it's never invisible to the teacher.
- **Rate-limit retries exhausted:** the brief and fixture F6 specify that a
  429 occurs mid-batch and must trigger exponential backoff, but neither
  specifies what happens if backoff never succeeds. **Assumption (flagged):**
  a bounded retry cap (e.g. 5 attempts) applies; on exhaustion, that single
  item resolves as a fallback/skip with an explicit reason logged in the
  summary — the batch as a whole is never abandoned or hung. This exact
  cap/behavior is not confirmed by any fixture beyond "429 mid-batch" and
  needs architect/engineer/QA sign-off.
- **Empty course (0 posts):** if the selected source has nothing to copy, the
  pre-flight scan still runs but resolves to a Ready-to-Transfer screen
  stating "0 posts to copy" with Start Transfer effectively a no-op
  confirmation (rather than silently succeeding with an empty summary the
  teacher has to interpret).
- **Browser refresh/close mid-transfer:** the batch transfer is a
  long-running server-side job; the UX requirement is that reconnecting
  (refresh) resumes showing accurate live progress rather than restarting or
  losing the job. **This is a P0 Delta** (see below) — no fixture in F1–F11
  exercises refresh-during-transfer, and the underlying job/poll contract is
  an architecture dependency, not something UX can fully specify alone.
- **General unhandled/network error mid-flow:** a generic fallback state
  ("Something went wrong" + Retry / Start Over) is defined as a catch-all,
  but **explicitly not exercised by any F1–F11 fixture** — flagged so QC does
  not assume it's certified.
- **Session/account switch mid-flow:** switching accounts via the header
  control restarts the flow at Source & Target Selection under the new
  account; any in-progress (unconfirmed) selection is discarded, never
  silently carried over to the new account's course list.

## 6. Workflow constraints

- **Responsive web only** — no native mobile apps (per brief non-goals);
  layout must work down to a tablet/Chromebook viewport since that's a common
  classroom device, but there is no mobile-app-specific interaction model.
- **Accessibility target: WCAG AA** (best practice — not explicitly stated in
  the brief, applied as the current standard for education-sector web tools).
  Concretely:
  - The Action Sheet Modal traps focus and is keyboard-operable; all
    interactive controls (dropdowns, toggle, radio rows) are
    keyboard-reachable and labeled.
  - **Live-region throttling:** the batch-transfer progress view uses an
    `aria-live="polite"` region, but it does **not** announce every one of
    the up to 50 per-item ticker events individually — that would be
    unusable screen-reader noise, a known AA pitfall. It announces
    throttled periodic count updates instead (e.g., "12 of 50 transferred,"
    on an interval of roughly every 5 items or every ~3 seconds, whichever
    is less frequent) plus one announcement on completion. Per-item outcomes
    stay visually available in the ticker and itemized log for sighted
    users and remain reachable on-demand via the itemized log table for
    screen-reader users — they are just not spoken one-by-one during the
    live batch.
  - **Text alternatives for outcome icons:** every outcome icon
    (transferred / fallback shell / skipped, plus the rubric-notes marker)
    carries a text label — never icon- or color-alone. The itemized log's
    Outcome column already renders text; anywhere an icon appears without
    adjacent visible text (e.g., the recent-activity ticker rows), it
    carries an `aria-label`/`sr-only` text equivalent.
  - **Focus management:** when the Action Sheet Modal closes (via Continue
    or Cancel), focus returns to the control that opened it, or — if that
    control no longer exists because the screen advanced — to the new
    screen's primary heading/first interactive element. When the
    Completion Summary replaces the Progress screen, focus moves to the
    Completion Summary's main heading ("Transfer complete.") so
    screen-reader users get an announcement that the page changed, rather
    than silence.
- **Cold-start idle detection is an architecture dependency (flag for
  architect):** the client's ">15 min idle" detection is a client/server
  timing question, not a pure frontend behavior — the same category of
  dependency as the resumability job/poll contract (Deltas P0 #2).
  Architect must decide whether idle-tracking is client-clock-based
  (elapsed time since the browser tab's last successful backend response)
  or server-signaled (the backend reports its own cold-start state), and
  specify it before engineer builds the overlay's trigger logic.
- **English-only UI** for v1 (per brief assumption).
- **No offline support** — the product is inherently online (batch-writes to
  a mock/live Classroom+Drive layer).
- **Whole-course copy only** — no per-item topic/post selection UI anywhere;
  the *only* per-item choices in the entire product are the Action Sheet
  Modal's fix/skip rows. Screens must not imply a granular picker exists.
- **Per-type field display, not uniform:** the itemized log and any future
  per-post detail view must reflect the brief's per-type transformation table
  — Materials never show a due-date or max-points field; Questions surface
  their answer-config (multiple-choice / short-answer); Assignments and Quiz
  assignments show both due-date-cleared and max-points. No screen should
  render a single generic "post" shape across all four types. **Concretely,
  the Completion Summary's itemized log table (§3 screen 8) carries a
  "Type-specific fields" column** that renders per-type: Materials show
  nothing in this column (no due date, no max points); Assignments and Quiz
  assignments show "Due: cleared · Max pts: N"; Questions show "Answer:
  Multiple choice (N opts)" or "Answer: Short answer." The column is never
  populated with a generic placeholder — it is either type-appropriate
  content or empty. See the updated table in
  `wireframes/05-completion-summary.md`.
- **No short client-side timeouts** — the transfer progress screen must
  tolerate the full engine runtime (up to ~2 min for 50 posts, plus retries)
  without erroring out on its own; this is a constraint on the frontend's
  polling/connection model, handed to architect.
- **No mid-transfer cancel** in v1 (see Decisions) — deferred to backlog since
  partial-cancel semantics for already-created drafts are undefined.

## Wireframes

Low-fidelity, structure-only wireframes (offered and accepted — see
Decisions):

- `docs/product/wireframes/00-flow.md` — overall process flow (Mermaid)
- `docs/product/wireframes/01-sign-in-and-account-picker.md` — sign-in
  landing, cold-start overlay, mock account picker
- `docs/product/wireframes/02-source-target-selection.md` — source/target
  selection screen
- `docs/product/wireframes/03-preflight-and-action-sheet.md` — pre-flight
  scan, Action Sheet Modal, Ready to Transfer
- `docs/product/wireframes/04-batch-transfer-progress.md` — batch transfer
  progress, rate-limit pause
- `docs/product/wireframes/05-completion-summary.md` — completion summary
  report

## Acceptance scenarios

Given/when/then scenarios derived from themes 1, 4, and 5, each tagged with
the fixture(s) it targets. These are the acceptance contract for engineer and
QA.

1. **Forced account picker (F10).** Given the user clicks "Sign in," when the
   account picker renders, then it lists ≥2 mock teacher accounts with
   distinct emails; when the user selects one, then they land on Source &
   Target Selection with that account's course list loaded.
2. **Silent healthy pre-flight (F1).** Given a source course where all
   attachments are healthy, when the pre-flight scan completes, then no
   Action Sheet Modal appears and the flow auto-advances to Ready to
   Transfer.
3. **Trashed/deleted file handling (F2).** Given a source course with a
   trashed or deleted attachment, when pre-flight completes, then the Action
   Sheet Modal shows [Create Draft Shell with Note] / [Skip \<Type\>] for
   that item, where the skip label is type-aware and matches the flagged
   item's coursework type (e.g. "Skip Material," "Skip Question") — never
   hardcoded to "Skip Assignment"; when the user picks "Create Draft Shell
   with Note" and continues, then the resulting target post's description
   contains the exact fallback-note text specified in the brief.
4. **Permission-locked file handling (F3).** Given a source course with a
   permission-locked/co-teacher-owned attachment, when pre-flight completes,
   then the Action Sheet Modal shows [Copy to My Drive (Become Owner)] /
   [Link Existing File (Risk Warning)] / [Skip Attachment and Note Draft],
   with "Copy to My Drive" marked recommended.
5. **Global auto-fix toggle.** Given the Action Sheet Modal is open with
   multiple flagged items, when the user turns on "Apply recommended fixes
   automatically," then every row auto-selects its recommended option and
   Continue becomes enabled without further per-row input.
6. **Duplicate-run warning.** Given the user has selected a source and
   target, when they view the Selection screen, then a persistent notice
   states that re-running creates duplicate drafts; when they reach Ready to
   Transfer, then the same warning is restated immediately before Start
   Transfer.
7. **50-post throughput & progress (F4).** Given a source course with exactly
   50 posts, when the batch transfer runs, then the progress view shows a
   live counter advancing from 0/50 to 50/50 with per-item ticker updates,
   and total engine time stays within the brief's ~2-minute target.
8. **Cold-start state.** Given any backend call remains unresolved for more
   than ~2 seconds (the latency-triggered mechanism the architecture adopted
   as D29 — superseding this scenario's original ">15 minutes idle"
   precondition, which the product does not implement because the client
   cannot know the server's idle time), then a "Waking up server…" overlay
   displays until the backend responds, then clears automatically without
   user action. Idle >15 minutes on Render's free tier is the typical CAUSE
   of such latency, not the detection mechanism.
9. **Rate-limit resilience (F6).** Given the deterministic mid-batch 429
   condition, when the transfer engine receives a 429, then the progress view
   pauses with a visible retry countdown and resumes automatically with no
   user action required.
10. **Attachment cap overflow (F5).** Given a post with 21+ attachments, when
    that post transfers, then attachments 1–20 link directly, attachments
    21+ appear as URL links in the description, and the Completion Summary's
    itemized log notes the overflow on that post's row.
11. **Rubric graceful degradation (F7).** Given a rubric-bearing assignment on
    a course whose mock license tier blocks the rubrics API, when it
    transfers, then the post is created successfully with a rubric note
    appended, and the Completion Summary counts it under a distinct
    "rubric notes added" total — not under fallback shells.
12. **All-states normalization (F8).** Given source posts in Draft,
    Published, and Scheduled states, when they transfer, then every
    resulting target post is a Draft with due/scheduled dates cleared,
    regardless of source state.
13. **All-types per-field transformation (F9).** Given source posts covering
    all four coursework types — including Questions with multiple-choice and
    short-answer configs, and Materials — when they transfer, then Materials
    show no due-date/max-points fields, Questions preserve their
    answer-config, and Assignments/Quiz assignments preserve due-date-cleared
    + max points, matching the brief's per-type field table exactly; and the
    Completion Summary's itemized log row for each type populates the
    "Type-specific fields" column matching this same per-type table (empty
    for Materials, due/points for Assignments and Quiz assignments,
    answer-config for Questions).
14. **Topic mapping (F11).** Given a source course with ≥2 topics and ≥1
    untopiced post, when the transfer runs, then the target gets matching new
    topics with old→new IDs correctly mapped, and the untopiced post lands
    with no topic assigned (never miscategorized into an existing topic).
15. **Completion summary reconciliation.** Given any completed transfer, when
    the Completion Summary renders, then **(drafts transferred) + (fallback
    shells) + (user-chosen skips) = total posts scanned**, per the brief's
    zero-silent-drop guarantee. **Topics created/mapped is a separate count
    and never enters this sum** — a topic is not a post, and including it
    makes the formula unbalanceable for any course with topics > 0.
    **"Rubric notes added" is a non-additive subset tag**, not a fourth or
    fifth term in the sum: it marks posts already counted under one of the
    three buckets above (see the combined-outcome rule in §4) whose rubric
    could not be copied. Matches the worked example in
    `wireframes/05-completion-summary.md` (39 + 2 + 1 = 42 of 42 posts
    scanned, with 6 topics and 1 rubric-notes tag shown separately, outside
    the sum).
16. **Source/target validation.** Given the user selects the same course as
    both source and target, when they attempt to continue, then Continue
    stays disabled and an inline error explains the courses must differ.
17. **Source/target list scoping.** Given the user opens the Source dropdown,
    then it lists both active and archived courses; given the user opens the
    Target dropdown, then it lists active courses only (no archived options
    present, including SIS/IT roster shells).
18. **Transfer resumability (flagged — not fixture-covered).** Given a batch
    transfer in progress, when the user refreshes the browser tab, then the
    progress view reconnects to the in-flight job and continues showing
    accurate progress rather than restarting or duplicating the job. No
    fixture in F1–F11 exercises this; it depends on an architecture-level
    job/poll contract (see Deltas #2).

## Deltas (required quality improvements)

| Risk (P0/P1) | Recommendation | Rationale | Prerequisite for next stage? |
|---|---|---|---|
| P0 — The PRD/brief describe the Completion Summary as a "modal," but the fixture manifest requires an itemized log across up to 50 posts (F4) with multiple outcome types (F2/F3/F7) and per-type fields (F9) — a compact dialog cannot hold that content without becoming unusable. | Render the Completion Summary as a full-screen scrollable report surface, not a small modal dialog. | Content volume from F4 (50 posts) plus multi-type/multi-outcome rows breaks readability in a cramped modal, undermining the zero-silent-drop guarantee's own point (every outcome must be visibly reviewable). | Yes — UI must design this as a page-level surface, not a modal component, or the design and downstream build target the wrong container. |
| P0 — Long-running batch transfer (up to ~2 min engine time, plus 429 pauses and cold starts) has no defined behavior if the browser tab is refreshed or closed mid-transfer. | Architect must expose a pollable transfer-job id/status so the frontend can reconnect and resume showing accurate progress after a refresh, instead of losing or duplicating the in-flight job. | The brief names "progress, partial-failure, and resumability states" as a first-class UX problem; the PRD is silent on the mechanism, and UX cannot specify a client-only fix for a server-side job. | Yes — this is an architecture/engineering contract the batch-transfer progress screen depends on; UI/architect need it before the screen can be built correctly. |
| P0 — Neither the brief nor fixture F6 ("returns HTTP 429 mid-batch") specifies what happens if exponential backoff retries are exhausted for an item. | Define a bounded retry cap (e.g. 5 attempts); on exhaustion, resolve that single item as a fallback/skip with an explicit logged reason — never hang the batch or drop the item silently. | Without a defined terminal state, the zero-silent-drop metric (every post resolves to transfer/fallback/skip) has no answer for the retry-exhaustion path, and QA has nothing concrete to test against F6 beyond "a pause happens." | Yes — QA needs a defined terminal state to test against F6; architect/engineer need the cap to implement backoff. |
| P0 — Rubric graceful degradation (F7) doesn't fit the brief's three named summary buckets (topics, drafts transferred, fallback-shell count). | Track rubric-degradation as its own distinct count/log category in the Completion Summary; the assignment itself counts as "transferred" (attachment linking succeeded), not as a fallback shell (no draft-shell fallback occurred — only the rubric failed to copy). | The brief's §5 acceptance bar requires the summary's counts to reconcile *exactly* against fixture counts; without a defined bucket for F7's outcome, that reconciliation math is undefined and engineer/QA will guess differently. | Yes — this changes the summary's data shape, which architect/engineer must build against, and QA needs it to verify F7's exact-reconciliation acceptance bar. |
| P1 — A general unhandled/network error mid-flow (outside the specific F1–F11 conditions) has no fixture and no previously-defined UX treatment. | Define a generic catch-all error state ("Something went wrong" + Retry / Start Over), but document explicitly that it is not exercised by any fixture in the manifest. | Some non-happy-path coverage is good practice even where the mock-first constraint doesn't fixture it, but QC must not assume this state is certified when nothing seeds it. | No — informational safety net, doesn't block UI/architect from proceeding; flagged so QC doesn't over-credit it. |
| P1 — Attachment-cap overflow (F5, 21+ attachments) has no explicit UX surfacing point beyond the mechanical "appended as links" behavior. | Surface the overflow as a Note on that post's row in the Completion Summary's itemized log (not pre-flight-blocking, stays silent/automatic during transfer). | The zero-silent-drop principle in spirit extends to transformations, not only failures — a teacher should be able to see this happened without digging through Drive/Classroom manually. | No — an observability improvement, not a structural blocker for downstream stages. |
| P1 — Cold-start ("Waking up server…," Acceptance Scenario #8) has no fixture in the F1–F11 manifest, and the wireframes previously cited a phantom "F: cold-start sim" tag and a nonexistent Deltas row (both corrected in this revision). Its idle-detection mechanism is also a client/server timing dependency, structurally the same category as the resumability job/poll contract (P0 Delta #2 above). | Flag cold-start as fixture-uncovered like the other two self-reported gaps (no fixture claimed); architect must specify whether ">15 min idle" detection is client-clock-based or server-signaled before engineer builds the trigger logic. | An uncovered behavior carrying a phantom citation is worse than one honestly flagged — it teaches QC to trust tags that aren't reliable. The detection mechanism has the same client/server ambiguity as resumability, which was correctly escalated to architect. | No — doesn't block UI/architect from proceeding with the overlay's visual design, but architect should resolve the detection mechanism before engineer builds it; QC must not treat cold-start as fixture-certified. |
| P1 — Fixture F6 as scoped ("returns HTTP 429 mid-batch") reads as a single transient rate-limit event resolved by backoff — it exercises the retry-succeeds path, not the retry-exhausted→fallback-shell path that the already-resolved P0-3 decision requires. | Extend F6 to explicitly cover a persistent/exhausting 429 condition, or add a companion fixture (e.g., F13) alongside F12, mirroring how resumability's fixture gap was closed. | Without a fixture that actually exhausts retries, QC has nothing to certify the retry-exhaustion→fallback path against — it stays exactly as untestable as resumability was before F12. | No — doesn't block UI/architect design (the resolved behavior itself is already specified), but PM/architect should extend the fixture manifest before QA/QC needs to test the exhaustion path. |

---

## Decisions (confirmed)

Recorded via `stage_record_decisions` with `source: "beast-mode-auto"` (batch
call below). All choices auto-accepted their recommended option per Beast
Mode (stage-protocol §10); none crossed the repository boundary (§10's
auto-accept-stops-at-the-boundary rule), so nothing required a decline.

1. **Overall structure:** a single linear wizard (Sign in → Select → Pre-flight
   → Transfer → Summary) with a non-interactive step indicator, not a
   dashboard/tabs model — matches the brief's 5-step workflow and the
   single-purpose-utility positioning.
2. **Entry after sign-in:** lands directly on Source & Target Selection, no
   intermediate dashboard/history screen — v1 has no run history to show.
3. **Account picker scope:** the forced picker (`prompt=select_account`
   semantics) is not a first-login-only gate; it's also reachable anytime via
   a persistent header "Switch account" control, so the
   multi-account-collision-avoidance behavior is exercisable beyond a single
   first sign-in.
4. **Pre-flight/Action-Sheet container:** Action Sheet renders as a modal
   overlay on top of the pre-flight scan screen, matching the PRD's naming
   and blocking-until-resolved intent.
5. **Added confirmation checkpoint ("Ready to Transfer"):** inserted between
   pre-flight resolution and the actual batch-write commit, even though the
   PRD doesn't name it as a separate step — a batch-write operation (even
   drafts-only) warrants one explicit human confirmation click rather than
   silently auto-firing the instant pre-flight clears.
6. **Completion Summary container:** rendered as a full-screen report surface
   rather than a small modal dialog, to hold the itemized log at F4's 50-post
   volume — see Deltas #1 (P0).
7. **Action Sheet Modal toggle default:** "Apply recommended fixes
   automatically" defaults OFF — a trust-sensitive, fail-safe-by-design
   product should default to explicit per-item review, not silent
   auto-application, even though the toggle exists for speed.
8. **Scenario 2 recommended default:** "Create Draft Shell with Note" (never
   silently skips) is the starred/recommended option when the auto-fix toggle
   is on.
9. **Scenario 3 recommended default:** "Copy to My Drive (Become Owner)" is
   the starred/recommended option — a permanent, targeted fix (only for
   flagged files) consistent with the brief's option ordering, over "Link
   Existing File" (leaves standing risk) or "Skip" (loses content).
10. **Duplicate-run warning placement:** shown at two touchpoints — a
    persistent notice on the Selection screen, and restated on the
    Ready-to-Transfer checkpoint immediately before commit — rather than a
    single one-time notice.
11. **429 mid-batch presentation:** treated as in-the-moment feedback (theme
    4), not an edge case, as long as it resolves on its own; only becomes an
    edge case if retries exhaust (see Deltas #3, flagged as an
    under-specified assumption).
12. **Rubric-degradation presentation:** treated as a post-hoc summary detail
    (distinct count + log note), not an in-the-moment interruption during
    transfer — the transfer itself doesn't pause or prompt for it.
13. **No mid-transfer cancel in v1:** deferred to backlog; partial-cancel
    semantics for already-created drafts are undefined and out of scope.
14. **Accessibility target:** WCAG AA applied as current best practice (not
    explicit in the brief) — focus-trapped/keyboard-operable Action Sheet
    Modal, `aria-live` progress announcements, fully keyboard-reachable
    controls.
15. **Wireframes:** offered and produced (low-fi, structure-only) — see
    Wireframes section; recommended because this product has two
    high-complexity conditional surfaces (Action Sheet Modal, Completion
    Summary) that benefit from a structural sketch before UI applies visual
    design.
16. **Reconciliation formula corrected (critic pass 1, finding 1):**
    Acceptance Scenario #15 now reads (drafts transferred) + (fallback
    shells) + (user-chosen skips) = total posts scanned; topics
    created/mapped is removed from the sum (a topic is not a post), and
    "rubric notes added" is documented as a non-additive subset tag, not a
    term in the sum — matching the worked example in
    `wireframes/05-completion-summary.md` (39+2+1=42).
17. **Combined-outcome rule added (critic pass 1, finding 2):** a post that
    is both a fallback shell and rubric-degraded counts once, under
    "Fallback shells," for the reconciliation sum; "Rubric notes added" is a
    non-exclusive secondary tag that can co-occur with any of the three
    primary outcomes without adding a second sum term.
18. **Itemized log gets real per-type fields (critic pass 1, finding 3):**
    added a "Type-specific fields" column to the Completion Summary's
    itemized log (due-date/max-points for Assignments and Quiz assignments,
    answer-config for Questions, empty for Materials) rather than narrowing
    the §6 per-type-coherence claim — the architect needs the per-type shape
    modeled, and the brief mandates it.
19. **Action Sheet Modal skip-button labels made type-aware (critic pass 1,
    finding 4):** Scenario 2's skip option reads "Skip \<Type\>" (e.g. "Skip
    Material," "Skip Question") rather than a hardcoded "Skip Assignment."
20. **Fixture-honesty corrections (critic pass 1, finding 5):** removed the
    phantom "F: cold-start sim" tag from `wireframes/00-flow.md` and the
    nonexistent Deltas citation from
    `wireframes/01-sign-in-and-account-picker.md`; cold-start is now
    explicitly flagged fixture-uncovered (new Deltas P1 row) instead of
    citing something that doesn't exist. F6's retry-success-only scope
    (vs. the resolved retry-exhaustion→fallback path) is flagged as a
    companion fixture gap (new Deltas P1 row), recommending F6 be extended
    or a companion fixture (e.g. F13) be added, mirroring how resumability
    got F12.
21. **Three WCAG AA specifics added (critic pass 1, finding 6):** aria-live
    throttling for the up-to-50-item progress ticker (periodic count
    announcements, not per-item), text alternatives for outcome icons, and
    focus management after Action Sheet close and on Completion Summary
    landing — added to §6. Cold-start's ">15min idle" detection is now also
    flagged as a client/server timing dependency needing an architect
    contract, the same treatment resumability already received.

## Assumptions

- **429 retry-exhaustion behavior** (a bounded retry cap, terminal
  fallback/skip outcome) is an assumption, not confirmed by fixture F6 or the
  brief — flagged in Deltas #3 for architect/engineer/QA sign-off.
- **Empty-course handling** (0 posts to copy) assumed to still render a
  Ready-to-Transfer screen stating "0 posts to copy" rather than being
  blocked earlier — no fixture explicitly seeds a zero-post course.
- **Session/account-switch mid-flow** assumed to discard any in-progress,
  unconfirmed selection rather than attempt to carry it to the new account's
  course list — not addressed by the brief.
- **General unhandled/network errors** (outside F1–F11) are assumed to need
  *some* generic fallback state for basic usability, even though nothing in
  the fixture manifest exercises it — explicitly flagged in Deltas #5 so QC
  doesn't treat it as certified.
- **"Open target course" action** on the Completion Summary is assumed to
  link to a mock representation of the target course (since there is no live
  Google Classroom in v1) rather than a real external URL.
- **Cold-start fixture coverage:** no fixture in F1–F11 (or F12) exercises
  cold-start behavior (Acceptance Scenario #8) — flagged in Deltas so QC
  does not treat it as fixture-certified; previously mis-cited via a
  phantom fixture tag and a nonexistent Deltas reference in the wireframes,
  now corrected.
- **Combined fallback+rubric-degradation outcome:** no fixture in F1–F11
  combines F2/F3 (attachment failure) with F7 (rubric degradation) on the
  same post; the combined-outcome rule (§4) is specified but untested
  against a seeded fixture.

## Open questions

- Exact wording/microcopy for the cold-start overlay, error states, and
  Action Sheet Modal copy — left for UI/content-design pass (voice & tone is
  UI's remit per the stage boundary).
- Whether "Start another transfer" should pre-clear or retain the previously
  chosen source/target as defaults — no strong signal either way in the
  brief; left open for UI/engineer to decide based on ease of repeated same-
  term copying.
- Whether a downloadable/exportable version of the itemized log is worth
  adding — not in scope for v1 per the brief, but noted as a candidate
  backlog item (see below).

## Next handoff

UI agent → reads this workflow, defines look and feel, writes
docs/product/03-ui-direction.md. Notes for UI:

- Two screens carry the most visual-design weight: the **Action Sheet Modal**
  (per-item rows, scenario-specific option sets, global toggle interaction)
  and the **Completion Summary** (stat tiles + reconciliation line +
  filterable itemized table) — both are now specified as full surfaces, not
  small dialogs.
- The **cold-start overlay** and the **rate-limit pause banner** are both
  "in-the-moment, non-blocking narration" components reused across multiple
  screens — worth designing once as shared components rather than bespoke
  per screen.
- Voice/tone and exact microcopy (see Open questions) are UI's to resolve.
