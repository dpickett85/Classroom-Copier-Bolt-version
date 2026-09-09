# Product Brief — Classroom Copier

> Source of truth for the product's what & why. Written by the Sr. Product
> Manager. Read by UX next (02-ux-workflow.md). Date: 2026-08-14
>
> Input: `docs/product/inputs/source-prd.md` (v1.1) — treated as strong input,
> not gospel. Where it was silent or self-contradictory, decisions were made and
> recorded (see Decisions). Produced under Beast Mode (auto-accepted
> recommendations, recorded via `stage_record_decisions`).

**Product type:** GUI app (web) — React frontend + Node.js/Express backend.
Downstream stages adapt vocabulary and wireframes to a web app.

## 1. Problem & pain

**Anchor problem — the SIS/roster-sync lockout.** District IT departments
auto-provision empty Google Classroom shells with rosters synced from the
Student Information System (SIS). Google's native "Copy Class" creates a *new,
un-synced* course shell — so teachers literally cannot use native copying to
fill the roster shells IT assigns them. This is a hard blocker, not friction:
there is no native path from "my old course" into "my IT-provisioned course."

Two compounding pains:

- **Drive duplicate-file nightmare.** Native Copy Class creates a brand-new
  Drive copy ("Copy of Unit 1 Slides") of every attachment — hundreds of
  duplicates per course, broken master-template links, hours of manual Drive
  cleanup, and drift between the master file and the copies teachers actually
  assign.
- **"Reuse Post" friction.** Google's link-preserving alternative works one
  post at a time. Reusing a year of 50+ assignments means hours of repetitive
  clicking, every term, for every course section.

Who feels it: teachers at every term/semester rollover (predictable, recurring,
high-acuity spikes in August/September and January), and co-teachers/curriculum
leads distributing master courses. IT departments feel the second-order pain
(Drive storage clutter, support tickets) but are not the operators.

## 2. Target users & jobs-to-be-done

**Primary: the K-12 teacher in an SIS-managed district.** JTBD: *"When a new
term starts and IT hands me an empty roster-synced shell, help me move my
existing course's classwork into it in minutes — without duplicating my Drive
files — so I can start teaching instead of rebuilding."*

**Secondary: the curriculum lead / co-teacher.** JTBD: *"Help me push a master
template course's classwork into colleagues' or sections' existing courses
without forking every file."*

Both are Google Workspace for Education users who teach with Google Classroom
daily but are not technical. They will meet this product once or twice a term,
under time pressure, and must succeed on the first attempt without training.

Non-users (explicitly): IT admins (beneficiaries, not operators), students,
and non-Google LMS users.

## 3. Current alternatives

1. **Native "Copy Class"** — creates an un-synced new shell (unusable for
   roster shells) and duplicates every Drive attachment. Fails the primary job
   outright.
2. **Native "Reuse Post"** — preserves original file links but is strictly
   one-post-at-a-time; a full course takes hours of clicks. Correct behavior,
   unusable batch ergonomics.
3. **Manual rebuild** — re-creating each assignment by hand and re-attaching
   files. Slowest, most error-prone; common in practice.
4. **Do nothing / degrade** — teach out of the old archived course, paste raw
   links in the stream, or skip Classroom structure entirely. Loses topics,
   grading integration, and student experience.
5. **Third-party admin tooling** (e.g., domain-level Classroom management
   suites) — exists as a category, but is IT-purchased, admin-operated, and
   priced/permissioned above a single teacher's reach. Classroom Copier
   positions against the *native* features teachers actually use, not against
   admin suites.

## 4. Value proposition & differentiation

**One-click batch copy of an entire course's classwork into any existing
course — including IT-provisioned roster shells — with zero Drive duplicates.**

- **Copies INTO existing courses** — the one thing native Copy Class cannot do.
  Works with SIS-synced shells, archived sources, and any course where the user
  teaches.
- **Zero Drive clutter** — attaches the original Drive file IDs (link, don't
  copy). One master file; edits propagate; no "Copy of Copy of…" archaeology.
- **Batch speed with per-post fidelity** — the fidelity of Reuse Post
  (preserved links, shareModes, topics, points) at the speed of Copy Class
  (whole course in one operation).
- **Fail-safe by design** — pre-flight health check before anything is
  written; guaranteed draft-shell creation with an explanatory note when an
  attachment can't be linked; everything lands as a Draft with cleared dates so
  nothing is ever accidentally published to students.

Positioning (decided): a **single-purpose utility** that does one job
perfectly — not a classroom-management platform. This keeps trust high (narrow
OAuth story), onboarding instant, and scope defensible.

## 5. Success metrics

(The source PRD is silent on metrics; the following were decided and recorded.)

**North star:** completed batch transfers (a transfer = one source→target run
that copies ≥1 post).

**Leading indicators**

- Activation: ≥80% of users who reach the source/target selection screen
  complete a transfer in the same session.
- Speed: median time from sign-in to completed transfer < 5 minutes for a
  50-post course; batch engine throughput such that a 50-post course transfers
  in under ~2 minutes of engine time (rate-limit permitting).
- Transfer fidelity: ≥95% of posts transfer without fallback-note injection on
  healthy source courses.
- Zero silent drops: 100% of source classwork posts produce either a
  faithful copy, a fallback draft shell with note, or an explicit user-chosen
  skip recorded in the summary report. No fourth outcome exists.

**Lagging indicators**

- Term-boundary retention: users returning in a subsequent term window.
- Fallback-shell rate trending down over time (proxy for health-check and
  linking quality).

**v1 acceptance bar (mock-backed build — see §7):** 100% pass on the
acceptance scenarios derived from this brief across the **full fixture
manifest in §6 item 12** — the three pre-flight scenario courses (F1 healthy /
F2 trashed-deleted / F3 permission-locked), the 50-post throughput course
(F4), the attachment-cap course (F5), the rate-limit simulation (F6), the
rubric-license-denial course (F7), all-states and all-types coverage (F8/F9),
the two-account forced-picker flow (F10), and topic-map coverage (F11) — not
only the three pre-flight scenarios. The completion summary's counts must
reconcile exactly with the seeded fixture counts; all metric events above are
instrumented (logged/counted) even though no analytics vendor is wired in v1.

## 6. Scope & non-goals

### In scope (v1)

**Workflow (5 steps):** Sign in → Select source & target → Pre-flight scan →
Batch transfer (with conditional action-sheet modal) → Itemized summary report.

1. **Sign-in & account handling** — OAuth-style sign-in flow with forced
   account selection (`prompt=select_account` semantics) to avoid multi-account
   collisions. *In v1 this authenticates against the mock identity layer, which
   seeds **at least two selectable mock teacher accounts** specifically so the
   forced account-picker flow (and the collision-avoidance behavior it exists
   for) is exercisable and QA-testable end-to-end (decided — see Decisions and
   the fixture manifest in item 12).*
2. **Source & target selection** — Source dropdown: active AND archived
   courses where the user is a teacher. Target dropdown: active courses where
   the user is a teacher, including SIS/IT roster shells. One source → one
   target per run.
3. **Topic infrastructure first** — fetch source topics, create them in the
   target, and maintain an old-topic-ID → new-topic-ID map used for every post.
4. **Classwork copy — full course, all states** — Assignments, Quiz
   assignments, Questions, and Materials, whether Draft, Published, or
   Scheduled at the source. Whole-course copy only; the only per-item choices
   in v1 are the pre-flight action sheet's fix/skip options.
5. **Post transformation rules** — copies land as **Drafts**; due dates and
   scheduled times cleared; titles, instructions/descriptions, max points, and
   topic assignment preserved; audience defaults to All Students; posts are
   created **oldest-first by source creation time** so the target feed reads in
   correct chronological order (decided — resolves the PRD's mislabeled
   "reverse chronological" wording in favor of its stated intent).

   **These rules apply per available field, not uniformly across the four
   coursework types** — the data model is per-type, not one generic shape:

   | Field | Assignment | Quiz assignment | Question | Material |
   |---|---|---|---|---|
   | Title + description/instructions | ✓ preserved | ✓ preserved | ✓ preserved | ✓ preserved |
   | Due date / scheduled time | ✓ cleared | ✓ cleared | ✓ cleared | — (field does not exist) |
   | Max points | ✓ preserved | ✓ preserved | ✓ preserved | — (field does not exist) |
   | Topic assignment | ✓ mapped | ✓ mapped | ✓ mapped | ✓ mapped |
   | Type-specific config | — | quiz/form linkage preserved | question type + multiple-choice options / short-answer config preserved | — |

   Fields not present on a given type are simply never set; Questions'
   answer-configuration fields must be carried over intact, not dropped by a
   generic transform. The architect must model these as distinct per-type
   shapes (mirroring Classroom's separate CourseWork vs. CourseWorkMaterial
   surfaces), not a single uniform post record.
6. **Master-file linking protocol** — attach original Drive file IDs (never
   copy files); preserve each attachment's `shareMode` (VIEW / EDIT /
   STUDENT_COPY — never default to VIEW); map attachments to the correct
   driveFile / youtubeVideo / link / form types; enforce the 20-attachment cap
   with attachments 21+ appended as URL links inside the description text.
7. **Pre-flight health check engine** — runs automatically after selection;
   silent (auto-proceeds) when all attachments are healthy; when problems are
   found, a conditional action-sheet modal presents per-file options with a
   global "Apply recommended fixes automatically" toggle:
   - *Trashed/deleted file:* [Create draft shell with note] or [Skip
     assignment].
   - *Permission-locked / co-teacher-owned file:* [Copy to My Drive (become
     owner)] or [Link existing file (risk warning)] or [Skip attachment and
     note draft].
8. **Fail-safe transfer engine** — exponential backoff on HTTP 429; rubric
   copy attempted via the rubrics API with graceful degradation to a
   description note when license tier blocks it; **guaranteed draft-shell
   creation** when an attachment fails verification, with the exact fallback
   note format: `[Classroom Copier Note: Original attachment '<name>' could
   not be linked due to a permission error or deleted file.]`
9. **Completion summary report** — modal showing topics created/mapped, draft
   posts successfully transferred, fallback-shell count with a detailed
   itemized log, and user-chosen skips.
10. **Long-running transfer UX** — progress feedback during batch transfer and
    a "waking up server…" state for backend cold starts.
11. **Monetization stubs** — credit-balance and subscription-status objects
    checked in backend route middleware as feature-flagged no-ops, with the
    credit rule specified (deduct only on 100% clean transfer; auto-refund on
    any fallback injection) so later activation is a flag flip plus Stripe.
12. **Mock Google API layer** (v1 constraint, see §7) — a swappable mock of
    Google Classroom + Drive APIs with seeded fixture data and mock teacher
    accounts. Every behavior above must be fully specified and testable
    against this layer — and to guarantee that, the mock MUST seed the
    following **fixture manifest**. Every named v1 behavior in this brief maps
    to at least one fixture below; a behavior without a fixture is not
    considered testable, and QC certifies only what a fixture exercises.

    **Fixture manifest (required seeds):**

    - **F1 — Healthy course:** all attachments linkable; exercises the silent
      auto-proceed pre-flight path and the ≥95% fidelity metric.
    - **F2 — Trashed/deleted-file course:** ≥1 post referencing a trashed or
      deleted Drive file; exercises the action sheet's draft-shell/skip
      options and the exact fallback-note format.
    - **F3 — Permission-locked course:** ≥1 post referencing a co-teacher-owned
      or permission-locked file; exercises Copy-to-My-Drive / link-with-warning
      / skip-and-note options.
    - **F4 — 50-post throughput course:** exactly 50 classwork posts;
      exercises the "<5 min sign-in-to-done" and "~2 min engine time" metrics
      in §5.
    - **F5 — Attachment-cap course:** ≥1 post with 21+ attachments; exercises
      the 20-attachment cap with overflow appended as URL links in the
      description.
    - **F6 — Rate-limit simulation:** a deterministic mock condition that
      returns HTTP 429 mid-batch; exercises exponential backoff and
      transfer-engine resilience.
    - **F7 — Rubric-license-denial course:** ≥1 assignment with a rubric on a
      course whose mock license tier blocks the rubrics API; exercises
      graceful degradation to a description note. (A rubric-permitted course —
      F1 may serve — exercises the successful rubric-copy path.)
    - **F8 — All-states coverage:** fixture posts spanning **Draft, Published,
      and Scheduled** source states (distributed across F1/F4 is acceptable;
      all three states must each appear at least once).
    - **F9 — All-types coverage:** fixture posts spanning all four coursework
      types — **Assignment, Quiz assignment, Question, Material** — including
      Questions with both multiple-choice and short-answer configs and
      Materials (no due date/max points), so the per-type transformation
      table in item 5 is exercised per type.
    - **F10 — Mock identity: ≥2 teacher accounts**, each with distinct course
      lists, so the forced account picker (`prompt=select_account` semantics)
      and multi-account collision avoidance are exercisable (see item 1).
    - **F11 — Topic-map coverage:** a source course (F1 or F4) with ≥2 topics
      plus ≥1 untopiced post; exercises topic creation, old→new topic-ID
      mapping, and unassigned-topic handling.

### Non-goals (v1 — explicit)

- **No live Google integration** — real OAuth, real Classroom/Drive API calls,
  and Google app verification are a named follow-on (backlog, high priority).
- No stream announcements; no student submissions, turn-in states, student
  files, grades, or class/private comments; no course-level settings (Meet
  links, grading categories); no rosters/people management.
- No granular pick-and-choose copying (select individual topics/posts) —
  whole-course only; deferred to backlog.
- No idempotency/dedupe on re-run — running the same copy twice creates a
  second set of drafts; the UI states this before transfer; dedupe deferred.
- No multi-target fan-out (one source → one target per run), no scheduled or
  recurring copies, no due-date remapping.
- No LMS beyond Google Classroom; no native mobile apps (responsive web only);
  no student-facing surface; no admin/district console.
- No payments (Stripe) activation — stubs only. No analytics vendor
  integration — local instrumentation only.

## 7. Constraints & risks

### Standing constraint: mock-first build (user directive)

**v1 is built and validated entirely against a mock Google Classroom + Drive
API layer with seeded fixture data and mock test users.** The user directed:
"run qa on everything that you can, we will revisit the apis later" and "mock
any test users and google apis that are blocking." Consequences, which
downstream stages must honor:

- The mock layer is a first-class deliverable whose seed data is specified by
  the **fixture manifest (§6 item 12, F1–F11)**: pre-flight scenario courses,
  the 50-post throughput course, attachment-cap and rate-limit and
  rubric-denial fixtures, all-states/all-types coverage, ≥2 mock teacher
  accounts, and topic-map coverage — so every product behavior in §6 is
  exercisable and QA/QC-testable end-to-end. QC certifies only what a fixture
  exercises.
- The mock sits behind the same interface the real Google clients will use
  (swappable adapter), so the real integration is a replacement, not a rewrite.
- **Real OAuth + live API integration is a named follow-on** (backlog, high):
  includes OAuth consent-screen setup, live end-to-end testing between two real
  courses, and Google's app-verification process.

### Other constraints

- **Scope gaps found in the PRD (decided, recorded):** Materials require the
  `classroom.courseworkmaterials` scope, absent from the PRD's scope list — the
  mock models materials as first-class and the follow-on must request it.
  Scenario 3's "Copy to My Drive" is a write operation exceeding
  `drive.readonly` — the follow-on must request `drive.file` (or equivalent);
  the mock models the copy action.
- **Google app verification burden (follow-on risk):** `drive.readonly` is a
  restricted scope triggering security assessment; verification can take weeks.
  A scope-minimization review before submission is on the backlog.
- **Execution environment:** long-running batch transfers must not be subject
  to serverless-style ~10s timeouts (PRD selects a persistent Express server on
  Render). Free-tier cold starts (30–50s) are a product-level UX requirement
  (the "waking up server…" state), not just an ops note.
- **Google API realities the mock must simulate:** HTTP 429 rate limiting
  (exponential backoff required), 20-attachment cap, rubric API availability
  varying by Workspace license tier.

### Biggest risks

1. Mock-to-real gap: behaviors validated against mocks diverging from real
   Google API semantics. Mitigation: adapter interface mirrors real API shapes
   (resource names, error codes, field names) and the follow-on includes a full
   live E2E pass.
2. Verification/scope approval delays blocking real launch (weeks, outside our
   control).
3. Trust: teachers granting coursework-write access to a third-party tool —
   the narrow single-purpose positioning and drafts-only guarantee are the
   mitigations.
4. Google shipping native "copy into existing class" — accepted risk; no
   moat beyond speed and focus.

### Timeline & execution

- **Standard Mode (with approval gates):** ~3–4 weeks — includes 1–2 day
  approval-gate waits between each stage (UX, UI, architect, engineer, QA, QC).
- **Beast Mode (auto-accept, no inter-stage gates):** ~1 week of stage
  runtime — stages run back-to-back automatically. The final ship decision
  still needs the user's approval (Beast Mode never auto-ships). *This run is
  Beast Mode through QC.*

(Estimates cover the mock-backed v1; the real-API follow-on adds integration
time plus Google's externally-controlled verification window.)

## 8. Business model & monetization

- **Launch: 100% free, unlimited batch transfers.** No paywall, no credit
  card. Goal is adoption and trust at term boundaries.
- **Pre-wired monetization hooks (stubs, feature-flagged off):** credit-balance
  checks and a user subscription-status object embedded in backend route
  middleware, ready for later activation via Stripe.
- **Credit deduction rule (specified now for the stub):** a credit is deducted
  only when 100% of posts and attachments transfer with zero fallback
  injections; partial or fallback transfers auto-refund the credit. (Users
  never pay for a degraded copy.)
- No pricing levels are set in v1; pricing design is deferred until the free
  launch produces usage data.

---

## Decisions (confirmed)

Recorded via `stage_record_decisions`. Sources: the mock-first constraint is a
standing **human** directive; all other choices are Beast Mode auto-accepted
recommendations (**beast-mode-auto**).

1. **Mock-first v1 (human):** build and validate against a mock Google
   Classroom + Drive layer with seeded fixtures and mock users; real OAuth +
   live APIs are a named follow-on.
2. **Anchor problem:** SIS/roster-sync lockout leads the narrative; Drive
   duplication and Reuse Post friction are compounding pains.
3. **Primary persona:** K-12 teacher in an SIS-managed district at term
   rollover; curriculum lead/co-teacher secondary; IT admins are not users.
4. **Positioning:** single-purpose utility, competing with Google-native
   features rather than admin suites.
5. **Metrics:** north star = completed transfers; activation ≥80%,
   median < 5 min, fidelity ≥95% on healthy fixtures, zero-silent-drop
   guarantee; v1 bar = 100% acceptance pass against the **full fixture
   manifest (§6 item 12, F1–F11)** with exact summary-report reconciliation
   (revised — originally only the three pre-flight scenarios).
6. **Whole-course copy only** in v1; per-item choices exist only in the
   pre-flight action sheet; granular selection deferred.
7. **No idempotency in v1:** re-running creates duplicate drafts; UI warns
   pre-transfer; dedupe deferred.
8. **Post-creation order:** oldest-first by source creation time — resolves
   the PRD's contradictory "reverse chronological (oldest post first)" wording
   in favor of its stated intent (correct chronological feed in target).
9. **Scope-list corrections:** `classroom.courseworkmaterials` added for
   Materials; `drive.file` (write) required for Scenario 3's "Copy to My
   Drive"; both recorded for the real-API follow-on, both modeled in the mock.
10. **Monetization:** free at launch; credit/subscription middleware stubbed
    as feature-flagged no-ops with the clean-transfer-only deduction rule
    specified.
11. **Fixture manifest (critic revision 1):** the mock layer must seed the
    F1–F11 fixture manifest in §6 item 12 so every named v1 behavior has a
    fixture that exercises it; the §5 acceptance bar covers the full manifest,
    not only the three pre-flight scenarios.
12. **Mock identity seeds ≥2 teacher accounts (critic revision 1):** the
    forced account picker (`prompt=select_account`) is exercised against ≥2
    seeded mock teacher accounts with distinct course lists — resolves the
    former assumption; authorized by the standing mock-first user directive
    ("mock any test users… that are blocking").
13. **Per-type transformation rules (critic revision 1):** post
    transformation applies per available field per coursework type (Materials
    have no due date/max points; Questions carry answer-config fields that
    must be preserved) — the data model is per-type, not one generic shape.
14. **Archived courses as targets: no in v1** — target dropdown lists active
    courses only, per PRD (recategorized from Open Questions, where it was
    already answered inline; candidate to revisit post-v1 on user feedback).

## Assumptions

- Term boundaries (Aug/Sep, Jan) are the usage spikes; retention is measured
  against them.
- Teachers accept "everything lands as Drafts with cleared dates" as a safety
  feature, not a chore (they review before publishing).
- The PRD's deployment guide (Render, OAuth console setup) is treated as
  architect-stage input, not product scope; nothing in this brief depends on
  Render specifically beyond "no short request timeouts + cold-start UX."
- English-only UI for v1.
- (Resolved to Decision 12: the former assumption that mock accounts can
  represent multi-account collision is now a decision — the mock identity
  layer seeds ≥2 teacher accounts to exercise the forced picker.)

## Open questions

- Should the follow-on request `drive.metadata.readonly` + `drive.file`
  instead of `drive.readonly` to reduce verification burden? (Backlog:
  scope-minimization review.)
- Exact pricing/credit sizing when monetization activates (deferred until
  usage data exists).
- Rubric fidelity details (criteria/levels mapping) beyond copy-or-note —
  architect/engineer to specify against the mock's rubric model.

## Next handoff

UX agent → reads this brief, runs workflow elicitation, writes
docs/product/02-ux-workflow.md. Notes for UX:

- Product type is a web app with a 5-step linear workflow (sign in → select →
  pre-flight → transfer → summary); the pre-flight action-sheet modal and the
  completion summary report are the two highest-complexity surfaces.
- **Sign-in surface:** design a mock account-chooser screen presenting the ≥2
  seeded mock teacher accounts (Decision 12) — the forced-picker flow
  (`prompt=select_account` semantics) is an in-scope, acceptance-tested v1
  behavior, so the picker needs a concrete screen, not a bypass.
- All flows must be demonstrable against the mock layer's **fixture manifest
  (§6 item 12, F1–F11)** — not only the three pre-flight scenarios; edge-case
  states (attachment-cap overflow, 429 mid-batch progress, rubric degradation
  notes) need UX treatment because fixtures will exercise them.
