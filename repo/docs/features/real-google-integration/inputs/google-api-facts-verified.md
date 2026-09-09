# Google API facts — VERIFIED against current official docs

> Checked by Beast Mode, 2026-08-23, against `developers.google.com` (Workspace Classroom API
> reference and Drive API auth guide). These resolve `MANUAL-VERIFY` items the PM brief flagged
> as asserted-from-model-knowledge and load-bearing.
>
> **The architect should treat these as confirmed and NOT re-verify them.** One of them
> **contradicts a PM decision** and must be reconciled — see §3.

## 1. `courseWorkStates` default — CONFIRMED, and it is a trap

`courses.courseWork.list` — the docs state verbatim:

> "If unspecified, items with a work status of `PUBLISHED` is returned."

**The default returns PUBLISHED only.** Drafts are invisible unless `courseWorkStates` is passed
explicitly. This is directly load-bearing for duplicate prevention: the Directions require skipping
a title that exists **"whether as a draft or a published assignment"**, so the destination query
MUST pass `courseWorkStates=PUBLISHED,DRAFT` explicitly. A default-parameter call would silently
miss every draft and re-create duplicates — the exact bug the feature exists to prevent, in the
failure direction the PM brief called the expensive one.

Required scopes for the method (one of):
`classroom.coursework.students.readonly`, `classroom.coursework.me.readonly`,
`classroom.coursework.students`, `classroom.coursework.me`.

## 2. `courseWorkMaterials` — same default, same trap — CONFIRMED

`courses.courseWorkMaterials.list` has a `courseWorkMaterialStates` parameter with the identical
documented default: *"If unspecified, items with a work status of `PUBLISHED` is returned."*

So the Materials surface needs the same explicit state filter. Scopes:
`classroom.courseworkmaterials` or `classroom.courseworkmaterials.readonly`.

This confirms the v1 PM brief's finding that the Directions' two-scope list is incomplete —
`classroom.courseworkmaterials` is a genuinely separate API surface.

## 3. Drive scope classification — **CONTRADICTS a PM decision**

Google's Drive API auth guide classifies the scopes as:

| Scope | Classification | Doc wording |
|---|---|---|
| `drive.file` | **Non-sensitive** | "Create new Drive files, or modify existing files, that you open with an app or that the user shares with an app" |
| `drive.metadata.readonly` | **RESTRICTED** | "View metadata for files in your Drive." |
| `drive.readonly` | **RESTRICTED** | "View and download all your Drive files." |
| `drive` (full) | **RESTRICTED** | "View and manage all your Drive files." |

**The PM brief chose `drive.metadata.readonly` over `drive.readonly` with the stated rationale of
reducing the restricted-scope verification burden. That rationale does not hold — both are
restricted.** The swap buys a genuine least-privilege improvement (metadata vs file content), which
is still worth having, but it buys **zero** reduction in verification burden. The brief's §8
reasoning must be corrected so the architect and the user are not planning against a benefit that
does not exist.

`drive.file` is the only non-sensitive option and is what the "Copy to My Drive" write path needs.

### What this means practically

Any scope set including `drive.metadata.readonly` puts the app in Google's **restricted scope**
category, which for public/production verification requires an independent third-party security
assessment — costly and slow, and disproportionate for a single teacher's tool.

**However, this is only a gate for PUBLIC verification.** An app in **testing mode** with
explicitly-listed test users requires no verification at all. For the stated use case — the user,
plus optionally staff at their school — testing mode is very likely the correct and sufficient
posture, and the restricted-scope assessment never needs to happen.

**The architect should:**
1. Correct the §8 rationale (least privilege ✓, verification-burden reduction ✗).
2. Re-examine whether the pre-flight health check genuinely needs `drive.metadata.readonly` at
   all, or whether it can be built entirely on `drive.file` plus what the Classroom API's own
   `materials` payload already returns. **If the health check can avoid Drive metadata entirely,
   the app stays out of the restricted category altogether** — which would be a materially better
   outcome for this user than any amount of verification paperwork. This is worth real design
   effort, not a footnote.
3. State the testing-mode-vs-verification decision explicitly so the user knows which path they
   are on before they build against it.

## 4. `classroom.topics` scope — CONFIRMED

`courses.topics.create` requires exactly `https://www.googleapis.com/auth/classroom.topics`.
The PM brief's addition of this scope was correct, and it was genuinely missing from the
Directions — topic creation is shipped v1 behavior that nobody had scoped.

## Still unverified (left for the architect / the user)

- **MANUAL-VERIFY:** the ~100 test-user cap for OAuth testing mode. Not checked here.
- **MANUAL-VERIFY:** whether Google Classroom permits two topics with the same name in one course
  (bears on the topic-dedupe rule the revise pass added in §6.8).
- **MANUAL-VERIFY:** `QUIZ_ASSIGNMENT` has no equivalent in the real `workType` enum — carried
  from the v1 backlog, still open.

---

# RESOLVED by the user, 2026-08-23 — the restricted-scope question is moot

**Audience decision (binding, recorded in `state.json` `stages.kickoff.decisions[]`):**
the app is for **the user plus staff at their school**, running in Google OAuth
**testing mode** with an explicit test-user list (~100 cap). Public launch is **out of scope**
for this phase.

## What this changes for the architect

§3 above raised a design question: *can the pre-flight health check avoid Drive metadata entirely,
to keep the app out of Google's restricted-scope category?* **That question is now closed, and the
answer is that it does not need to.**

Google does not gate **testing mode** on app verification. At this audience size, a restricted
scope (`drive.readonly` or `drive.metadata.readonly`) carries **no verification requirement, no
third-party security assessment, and no paperwork whatsoever**.

**Therefore:**

- **Do NOT contort the pre-flight health check to dodge a restricted classification.** The cost it
  was being avoided for does not exist at this audience. Sacrificing health-check fidelity to
  avoid `drive.metadata.readonly` would be paying a real price for an imaginary saving — exactly
  the kind of trade this project has already been burned by.
- **Choose Drive scopes on least-privilege and fidelity grounds alone.** `drive.metadata.readonly`
  over `drive.readonly` remains a genuine least-privilege improvement and is still the right
  default *if* metadata is all the health check needs. But if reading metadata is insufficient for
  a trustworthy health check, the architect is free to take what the feature actually requires.
- **The §8 rationale correction still stands.** The brief's stated reason for preferring
  `drive.metadata.readonly` ("reduces verification burden") was factually wrong and must be
  corrected either way — both scopes are restricted. The scope choice may well survive; only its
  justification changes.

## What the architect MUST specify instead

Because testing mode is now the deployment posture, it is a first-class design and documentation
requirement, not a footnote:

1. **The Google Cloud Console configuration** the user must apply — publishing status left as
   *Testing*, the OAuth consent screen fields, and where the test-user list lives.
2. **Adding a test user is now an operational step with a user-visible failure mode.** A teacher
   at the school who is *not* on the list will be refused by Google at the consent screen with an
   error the app never sees and cannot improve. The live-OAuth checklist (UX §7) must cover this,
   in the register a non-technical user can act on — and UX's F6 revision already added the
   co-teacher persona to that step.
3. **The ~100 test-user cap is still MANUAL-VERIFY** — it has not been confirmed against current
   Google documentation, and it is the ceiling on how many colleagues can use the tool. Worth
   confirming before the user promises access to an all-staff list.
4. **A refresh-token caveat if one applies in testing mode.** Google has historically expired
   refresh tokens for apps in testing status after a short window, which would force periodic
   re-consent and interacts directly with UX Delta P0-2 (token failure mid-transfer).
   **MANUAL-VERIFY:** confirm current behavior — if it holds, it is a recurring user-visible
   interruption that the design must handle gracefully rather than treat as an edge case.

## Delivery decision (also binding)

Code is **committed to `phase2/real-google-integration` locally only**. It is **not** pushed to
GitHub and **not** merged to `main`. `origin/main` and the live Render deployment stay untouched
until the user reviews the diff and completes the live-OAuth checklist themselves.

---

# VERIFIED 2026-08-23 — testing-mode limits. One of these is user-visible and material.

Both were `MANUAL-VERIFY` items. Both are now confirmed against Google's own documentation
(Cloud Console Help, "Manage App Audience"). **The architect must design against these; they are
not footnotes.**

## 1. Test-user cap — CONFIRMED at 100

> "Projects configured with a publishing status of **Testing** are limited to up to 100 test users
> listed in the OAuth consent screen."

A test user consumes the quota once added. 100 is comfortably above a single school's staff, so
the audience decision holds. Worth stating plainly in the live-OAuth checklist so the user knows
the ceiling before promising access to an all-staff list.

## 2. **Authorizations expire after SEVEN DAYS in Testing status** — CONFIRMED, and material

> "Authorizations by a test user will expire **seven days** from the time of consent. If your
> OAuth client requests an `offline` access type and receives a refresh token, **that token will
> also expire**."

The documented exception — apps requesting only name/email/profile — **does not apply here**.
This app requests Classroom and Drive scopes.

### What this means concretely

A teacher who signs in today and returns more than a week later **must go through Google's consent
screen again**. This is not a bug, not something the app can prevent, and not something that can
be engineered around while the app stays in Testing status. It is a property of the deployment
posture the user chose — and given that posture is what avoids an expensive verification process,
it is very likely the right trade. But it must be **designed for and disclosed**, not discovered.

### Why this is architecturally load-bearing

**It interacts directly with UX Delta P0-2** (Google token failure mid-transfer). P0-2 was written
as an edge case — revoked consent, unusual expiry. In Testing status, expiry is not an edge case:
it is **guaranteed, on a fixed 7-day cycle**. The "Reconnect Google account" interrupt UX
specified is therefore a routine path, and the zero-silent-drop guarantee must hold across it
reliably rather than best-effort.

### The design question the architect must answer

**Does this app actually need `access_type=offline` at all?**

Transfers are interactive: the user is present, watching a progress screen, and a batch completes
in minutes. If the app never needs to act on the user's behalf while they are away, it may not
need a refresh token whatsoever — a standard access token (≈1 hour) covers any realistic transfer,
and the 7-day refresh-token expiry becomes irrelevant to the app's mechanics.

That would be a genuine simplification: fewer stored secrets, less token-refresh machinery, a
smaller blast radius if the session store is compromised, and one less failure mode in the transfer
engine. **Weigh it explicitly.** The counter-argument is resumability — v1 supports resuming a
transfer after a disconnect, and a job resumed after the access token expires needs *something*.
Decide, state the reasoning, and make sure the resumability guarantee and the token lifetime agree.

Whatever is chosen, the 7-day re-consent must appear in:
- the **live-OAuth checklist** (UX §7), in plain language — "you'll be asked to sign in again about
  once a week; this is normal and not a problem with the app";
- the **UX interrupt design** (Delta P0-2), as a routine path rather than an exception.

## Escaping the 7-day expiry (context, not a recommendation)

The 7-day limit and the 100-user cap are both lifted at **Production** publishing status. But
Production with a restricted scope in the list requires app verification **plus an independent
third-party security assessment**. For this audience that trade is almost certainly not worth it —
recorded here only so the option is visible and the user is not surprised later.
