# UI Direction — Classroom Copier

> The product's look, feel, taste, and voice. Written by the UI agent from
> 02-ux-workflow.md. Read by the architect/engineer next.
> Product type: GUI app (responsive web) — React frontend + Node/Express
> backend. Date: 2026-08-14
>
> Produced under Beast Mode (full elicitation run; every choice question
> auto-accepted at its recommended option; recorded via `stage_record_decisions`
> with `source: "beast-mode-auto"`). No human was asked; every decision below
> was the UI agent's own recommendation, self-accepted per stage-protocol §10.

## 1. Design concept & personality

**The organizing idea: "The Registrar's Manifest."** Classroom Copier is not a
consumer app and shouldn't look like one — it's a trusted piece of office
machinery a teacher runs once or twice a term, at a moment of real stakes
(moving a year of their own work). The visual vocabulary is drawn from the
domain object the product's own success metric is built around: an itemized,
numbered, **reconciled** paperwork ledger — a shipping manifest or a school
registrar's transcript, where every line is accounted for and the totals at
the bottom have to balance. That's not a metaphor bolted on after the fact —
it *is* the brief's "zero silent drops" guarantee (§5) made visible: the
Completion Summary's reconciliation line (39 + 2 + 1 = 42 of 42) is the
product's core promise, rendered exactly the way a ledger closes its books.

**Adjectives:** calm, precise, plainspoken, official-but-warm, unshowy,
legible under stress. Not: playful, gradient-slick, "delightful," cute.

**The feeling to evoke:** *"I can see exactly what happened to every single
item, and nothing is hidden from me."* Administrative trust, not app-store
polish. A teacher mid-panic at 9pm in August should feel like they've handed
their course to a careful, unglamorous clerk who double-checks everything —
not a flashy assistant promising magic.

**Signature moves** (the one or two deliberate deviations against an
otherwise disciplined, quiet system):
1. The Completion Summary's **reconciliation line** is styled like a closed
   ledger/checksum footer — monospace tabular figures in a bordered strip,
   distinct from ordinary body copy — because it is the single most important
   sentence in the product.
2. The Action Sheet Modal's recommended option carries a small **stamp-style
   badge** ("Recommended"), evoking an official form's pre-filled
   recommendation rather than a generic UI "suggested" chip.

## 2. Visual / presentational tone

**Typography — a three-role system, chosen for the manifest concept, not
reflex defaults:**

- **Headings / report titles:** `Source Serif 4` (variable, optical-size
  aware). A transitional serif gives screen titles and the Completion
  Summary's "Transfer complete." the register of an official document
  heading, without tipping into ornate. Verified current: still actively
  developed — a Display optical-size cut was submitted to Google Fonts
  2026-08-07 — and served from Google Fonts / Adobe Fonts (checked
  2026-08-14).
- **UI chrome & body copy:** `Public Sans`. Built by the U.S. Web Design
  System specifically for civic/government interface trust — which is exactly
  the register this product wants (plain, legible, no personality tax) and
  reinforces the "official paperwork" concept rather than fighting it. Status
  checked 2026-08-14: feature-complete at v2.001 (no longer under active
  development, per USWDS) but fully supported, widely deployed, and hosted on
  Google Fonts — a stable choice, not an abandoned one. Deliberately *not*
  Inter/Geist — those are the reflex default this project is avoiding by
  name.
- **Numbers & tabular data:** `IBM Plex Mono` with tabular figures, used only
  for counts, fractions, the progress counter, and the reconciliation line —
  never for prose. This is what makes stat tiles and the reconciliation
  strip read as a ledger rather than a dashboard.

**Color — muted, paper-grounded, function-coded (not decorative):**

| Token | Hex | Role |
|---|---|---|
| `--paper-0` | `#FBF9F4` | Page background — warm paper, not stark white |
| `--paper-1` | `#F2EEE3` | Section/card fill, table zebra stripe, step-indicator bar |
| `--paper-2` | `#EAE4D2` | Outer gallery/app-chrome background |
| `--line` / `--line-strong` | `#D8D2C2` / `#B9B29B` | Hairline borders — everything is bordered, nothing floats on shadow alone |
| `--ink-900` / `--ink-700` / `--ink-500` | `#16231F` / `#3C4A45` / `#5B6B67` | Primary / secondary / tertiary text |
| `--teal-700` / `--teal-600` / `--teal-100` | `#0F5C56` / `#147A72` / `#DCEEEB` | Primary action & brand — a deep, unsaturated teal read as "verified," not "playful blue" |
| `--green-700` / `--green-100` | `#1E7A42` / `#E1F3E7` | Success / transferred outcome |
| `--amber-700` / `--amber-100` | `#8A5A00` / `#FBEDD1` | Attention / fallback outcome / cold-start & rate-limit narration — never used for destructive actions, because nothing in this product is destructive |
| `--red-700` / `--red-100` | `#A22C2C` / `#FBE4E4` | True errors only (generic catch-all failure state) — reserved and rare by design, since the product's whole promise is that nothing is lost |
| `--slate-600` | `#5B6B67` | Skipped/neutral outcome |
| `--focus` | `#1857C9` | Focus ring — a saturated blue chosen to be visually distinct from every status color, so focus is never confused with an outcome state |

Explicitly avoided: the indigo/purple gradient hero, any glassmorphism, and
saturated "SaaS blue" as the primary — teal was chosen over blue specifically
so the brand color never gets confused with the reserved focus-ring blue or
with link-blue conventions.

## 3. Key element styling

- **Buttons:** rectangular, 3px radius (paperwork controls, not app-store
  pill buttons). Primary = solid `--teal-700` fill, white text. Secondary =
  outlined, `--paper-0` fill. No ghost/text-only primary actions.
- **Cards & stat tiles:** thin 1px hairline border (`--line-strong`), flat
  fill (`--paper-1`), minimal/no drop shadow — ledger cells, not floating
  material-design cards.
- **Dropdowns (source/target):** standard native-feeling selects; course rows
  carry rectangular, bordered status badges (`Active` / `Archived` / `SIS
  Roster Shell`) styled like stamped tags, not gradient pills.
- **Duplicate-run notice & rate-limit banner:** one shared "in-the-moment
  narration" *component* (per UX's handoff note) — amber-tinted inline banner
  with a `!`/⏱ glyph, never a modal interrupt — used on Selection,
  Ready-to-Transfer, and Batch Transfer Progress. The component's styling is
  reused verbatim across all three; the **duplicate-run notice's copy** is
  reused verbatim only at its own two touchpoints (Selection and
  Ready-to-Transfer restatement — identical sentence both times, per UX
  Acceptance Scenario #6). The rate-limit banner on Batch Transfer Progress is
  a different event and carries its own distinct copy — same component,
  different narration content, not a third copy of the duplicate-run
  sentence.
- **Action Sheet Modal:** focus-trapped, bordered, no backdrop blur (a flat
  dark scrim instead of glassmorphism). Global toggle rendered as a labeled
  switch defaulting OFF (binding constraint). Each issue row is a bordered
  block; every option shows a visible radio, never color alone. **Two
  independent visual states, never conflated:** "Recommended" is a static
  per-row label (`--teal-100` row fill + border + "Recommended" stamp badge)
  that never changes based on what's chosen; "Selected/checked" is the
  dynamic interaction state, given its own shape change on the radio itself —
  a hollow ring becomes a filled ink-900 dot (or, when the selected option is
  also the recommended one, a filled teal-700 dot with an outer ring) — so a
  teacher who picks a non-recommended option (e.g., "Link Existing File")
  gets the same visible "this is now chosen" confirmation as one who accepts
  the recommendation, never left with an unconfirmed hollow radio. Skip
  option labels are type-aware ("Skip Material," "Skip Question," "Skip Quiz
  Assignment") per UX, never hardcoded to "Skip Assignment."
- **Progress bar:** a segmented/hatched fill (diagonal ticks) rather than a
  smooth gradient — a printed shipping-label meter, not a loading spinner
  aesthetic. Pauses (rate-limit) freeze the fill in place; it never resets or
  reverses.
- **Completion Summary:** five stat tiles in a single row (topics, drafts
  transferred, fallback shells, skips, rubric notes — the four binding-constraint
  counts plus topics), each with a large monospace tabular number. Below them,
  the reconciliation line renders as a bordered, green-tinted ledger strip
  with a ✓ glyph and monospace arithmetic. The itemized log is a
  zebra-striped table with **six columns — Title / Type / Topic / Outcome /
  Type-specific fields / Note** — outcome shown as both a colored pill *and*
  text (never color alone; the pill set covers all three filterable outcome
  kinds — Transferred/green, Fallback/amber, **Skipped/slate**, the last with
  its own `.outcome-skipped` treatment, not left unstyled), filterable by
  outcome.
- **Per-type field display — the "Type-specific fields" column:** per UX's
  updated §3/§6 spec, the itemized log carries a dedicated **Type-specific
  fields** column (not folded into Note) that renders per coursework type:
  empty for Materials (no due date, no max points); "Due: cleared · Max pts:
  N" for Assignments and Quiz assignments; "Answer: Multiple choice (N opts)"
  or "Answer: Short answer" for Questions. The column is either
  type-appropriate content or genuinely empty — never a padded/uniform
  placeholder across types. The mockup's own log table demonstrates all four
  coursework types with this column populated accordingly, so the ledger
  metaphor actually shows four distinct post shapes rather than decorating
  one generic row.
- **Cold-start overlay:** a single shared component (spinner + "Waking up
  server…" + "up to 50 seconds" sub-line), reused wherever a backend call
  exceeds the ~2s threshold — built once, not bespoke per screen, per UX's
  handoff note.

## 4. Voice & tone

Plainspoken, precise, warm-administrative — the voice of a trusted school
office worker, not a cheerful assistant. Concretely:

- **State facts, don't perform enthusiasm.** "Waking up server — this can
  take up to 50 seconds the first time." Not "Almost there! ✨"
- **No exclamation points except where genuinely warranted** (there are
  effectively none in this product's happy path).
- **Never blame the user.** Fallbacks and skips are described as things the
  *system* is handling ("File is trashed or deleted" / "Copy to My Drive
  (Become Owner)"), never "Your file is broken."
- **Reassurance is stated plainly, once, where it matters** — e.g. "Everything
  will land as Drafts with dates cleared — nothing is visible to students
  until you publish it" — not repeated decoratively.
- **No emoji as UI furniture** (icons/glyphs carry status instead — ✓, ◆, !).
- **No invented jargon.** No "payload," "endpoint," or "sync engine" surfaces
  to the user; the mock/real distinction never leaks into copy.
- **The fallback note text is exact and non-negotiable** (brief §6 item 8):
  `[Classroom Copier Note: Original attachment '<name>' could not be linked
  due to a permission error or deleted file.]` — voice guidance does not
  extend to rewriting this string. The mockup's itemized-log Fallback row
  renders this string in full (`<name>` substituted with a real filename,
  no truncation) so it can be copied verbatim rather than reconstructed from
  a shortened example.

## 5. References & anti-references

**Emulate:** the U.S. Web Design System's civic-trust plainness (source of
the Public Sans choice); a well-run school registrar's transcript / a
certified-mail receipt (source of the manifest concept and the reconciliation
line); Stripe's early invoice/receipt tables for the itemized log's tabular
restraint; Linear/Basecamp's spacing discipline and refusal to decorate.

**Avoid, by name:** untouched shadcn/ui component defaults; the indigo/purple
gradient SaaS hero; Inter/Geist reached for by reflex; glassmorphism and
backdrop blur; emoji as section bullets; generic AI gradient blobs; the
centered-headline + three-feature-card + bento layout; consumer ed-tech's
cartoon-mascot/primary-bubble playfulness (e.g. ClassDojo-style) — wrong
register for a tool that touches a teacher's whole year of work in one
irreversible-feeling batch write.

**The "only this product" test:** the reconciliation-line ledger footer, the
stamp-style "Recommended" badge in the Action Sheet, and the
serif-report-heading + mono-tabular-numbers + civic-sans-UI typographic
system together could not be dropped onto a generic SaaS dashboard without
looking wrong — they're built around this product's specific promise (every
item accounted for) and its specific audience (a non-technical teacher who
needs to trust a paperwork process, not be impressed by one). **The one
memorable thing:** the Completion Summary reads like a closed ledger, not a
dashboard — "39 + 2 + 1 = 42 of 42."

## 6. Accessibility & medium constraints

- **Target: WCAG AA** (binding constraint, carried from the UX stage).
- **Contrast:** every text/background and icon/background pairing in the
  palette above uses ink-dark tones (`--ink-900/700`, `--teal-700`,
  `--green-700`, `--amber-700`, `--red-700`) against the `--paper-0/1`
  near-white family, chosen specifically to clear 4.5:1 for body text and 3:1
  for large text/UI components. **MANUAL-VERIFY:** engineer/QA must run an
  automated contrast audit (e.g. axe or a contrast-ratio tool) against the
  final rendered palette before ship — the hexes above are designed to pass
  but were not run through a contrast-calculation tool in this stage.
- **Never color-alone:** every outcome (transferred/fallback/skipped) is
  shown as an icon + text label + color, never color alone — including
  Skipped, which has its own `.outcome-skipped` pill style (slate-600 text on
  a `--paper-1` fill with a `--line-strong` border), not left undefined as
  the one filterable outcome kind with no sanctioned style; every radio/
  toggle state has a visible shape change, not just a fill-color change —
  and, on the Action Sheet Modal specifically, the checked/selected shape
  change is independent of the static "Recommended" label styling (see §3),
  so choosing any option — recommended or not — is always visibly confirmed.
- **Focus:** a dedicated `--focus` blue (`#1857C9`), visually distinct from
  every semantic status color, applied as a 3px outline with offset on every
  interactive element (`:focus-visible`), never suppressed.
- **Action Sheet Modal:** focus-trapped while open, closable via Escape and
  the Cancel control, first focus lands on the modal heading, focus returns
  to the triggering control on close.
- **Live regions:** batch transfer progress (fraction counter, rate-limit
  pause/resume, completion) announced via a polite `aria-live` region so
  screen-reader users get spoken progress without polling.
- **Keyboard reachability:** every dropdown, toggle, radio row, and action
  button is keyboard-operable in DOM/tab order; no mouse-only affordance.
- **Target size:** interactive controls (buttons, radio rows, toggle) sized
  to at least a 44×44px hit area, including on the tablet/Chromebook
  viewport floor named in the UX constraints.
- **Responsive floor:** layout holds down to a tablet/Chromebook viewport
  (per UX constraint); the five-tile stat grid and the itemized log table
  are the two components that most need a defined narrow-viewport behavior
  (stack to fewer columns / horizontal scroll with a sticky first column) —
  flagged in Deltas below since neither is nailed down at this stage.
- **Reduced motion:** the cold-start spinner and progress-bar animation
  respect `prefers-reduced-motion` (static equivalents supplied) rather than
  animating unconditionally.
- **English-only UI** for v1 (per brief).

## Mockups

Produced — recommended because the UX stage flagged the Action Sheet Modal
and Completion Summary as the two highest-complexity surfaces warranting a
structural pass before implementation, and because a from-scratch concept
("The Registrar's Manifest") benefits from being shown, not just described.

`docs/product/mockups/ui-mockups.html` — a single self-contained styled HTML
gallery covering all six primary surfaces plus the two shared components:
sign-in landing, cold-start overlay, mock account picker, source/target
selection, pre-flight scanning, the Action Sheet Modal, Ready to Transfer,
Batch Transfer Progress (incl. rate-limit pause), and the Completion Summary
(stat tiles + reconciliation line + itemized log). Built with the design
tokens (fonts, colors, radii) defined in §2–§3 above as CSS custom properties,
so it doubles as a living style reference for architect/engineer.

## Image prompts

Not needed. Imagery-need assessment (per the shared imagery-assessment table):
Classroom Copier is a single-purpose B2B/education utility used once or twice
a term by a non-technical teacher under time pressure — closer to an
"internal business tool" than a consumer app or marketing site. Adding hero
imagery, onboarding illustration, or empty-state art would work against the
design concept itself (a plainspoken paperwork tool, not a delightful
consumer product) and against the "not clever" emotional register the product
owner named as load-bearing. Typography, iconography (✓ / ◆ / ! glyphs), and
the ledger/manifest layout carry the entire visual system. This is a
deliberate "none needed" decision, not an oversight.

## Design sync

Declined — Beast Mode override (stage-protocol §10, AGNTC-0130). Syncing to
Claude Design publishes outward-facing hosted state that this unattended run
cannot have the user review or undo, so the offer is declined and recorded
here rather than silently skipped.

**MANUAL-VERIFY:** design-system sync to Claude Design (claude.ai/design) was
never taken up this run. If a hosted, browsable design system is wanted, a
human should invoke the UI stage's design-sync offer interactively.

## Deltas (required quality improvements)

| Risk (P0/P1) | Recommendation | Rationale | Prerequisite for next stage? |
|---|---|---|---|
| P1 — The stat-tile grid (5 tiles) and the itemized log table (title/type/topic/outcome/note columns) have no defined narrow-viewport behavior, and the UX constraint requires the layout to hold down to a tablet/Chromebook floor. | Architect/engineer must specify the responsive behavior explicitly: the stat grid reflows (e.g. 5→3→2 columns) and the log table either horizontal-scrolls with a sticky title column or collapses to a stacked card-per-row layout below a defined breakpoint. | Without a defined narrow-viewport strategy, the two most content-dense surfaces (Completion Summary, Action Sheet Modal rows) are the most likely to break on a Chromebook — the exact device class named as common in classrooms. | No — informational; doesn't block architecture, but must be resolved before engineer builds these two components, or they'll improvise inconsistently. |
| P1 — The palette in §2/§6 is contrast-designed by construction (dark ink-family tones against near-white paper) but was not run through an automated contrast-ratio tool during this stage. | Engineer/QA runs an automated WCAG AA contrast audit (axe, Lighthouse, or a contrast-ratio tool) against the final rendered palette as part of the build/QA pass, before this is treated as AA-certified. | WCAG AA is a binding constraint carried from UX; asserting contrast by visual inspection alone is not verification, and this product's accessibility bar should not rest on an unverified claim. | No — doesn't block architect from proceeding with these tokens, but must close before QA signs off accessibility. |
| P1 — Voice/tone (§4) and this direction cover the fallback-note exact string and general register, but do not write every piece of microcopy the UX stage explicitly parked for UI (cold-start sub-copy, generic error-state copy, Action Sheet Modal header/body text beyond the examples shown). | Treat the copy shown in this doc and the mockups as the voice reference; engineer should extend from these examples rather than inventing a different register for untouched strings, and flag any remaining copy gaps to a content pass before ship. | UX explicitly deferred "exact wording/microcopy" to UI; this doc sets the register and gives worked examples for every screen, but a handful of secondary strings (e.g. the generic catch-all error state's exact body copy) are illustrative, not exhaustively specified. | No — doesn't block architect/engineer from building the components; copy can be finalized in parallel with implementation. |

---

## Decisions (confirmed)

Recorded via `stage_record_decisions` with `source: "beast-mode-auto"` (batch
call at end of stage). All choices below are the UI agent's own recommended
option, self-accepted per Beast Mode (stage-protocol §10); none crossed the
repository boundary except the design-sync offer, which was declined per the
same rule.

1. **Design concept:** "The Registrar's Manifest" — an itemized,
   reconciled-ledger metaphor rooted in the product's own zero-silent-drop
   guarantee, over a generic SaaS-dashboard or consumer-app concept.
2. **Typography system:** Source Serif 4 (headings/report titles) + Public
   Sans (UI chrome/body) + IBM Plex Mono (tabular numbers only) — a
   three-role pairing chosen for the civic-trust/paperwork register, over
   defaulting to Inter/Geist.
3. **Color system:** a muted, paper-grounded palette with function-coded
   status colors (teal = brand/action, green = success, amber = attention/
   in-the-moment narration, red = reserved for true errors only, slate =
   neutral/skipped) — over a saturated "SaaS blue" primary or a
   purple/indigo gradient default.
4. **Element styling:** rectangular low-radius controls, hairline-bordered
   flat cards (no floating shadow/glassmorphism), a segmented/hatched
   progress-bar fill, and a stamp-style "Recommended" badge in the Action
   Sheet Modal — over rounded pill-shaped consumer-app styling.
5. **Voice & tone:** plainspoken, warm-administrative, fact-stating register
   (school-office-clerk voice) — over a cheerful/enthusiastic assistant
   voice, and over generic AI hedge-speak.
6. **Mockups:** produced, covering all six primary surfaces plus the two
   shared narration components, as a single token-driven HTML gallery — see
   Mockups section.
7. **Imagery:** none needed — recorded as a deliberate decision (single-
   purpose utility register, imagery would undercut the "not clever" mandate)
   rather than an oversight.
8. **Design-system sync:** declined under the Beast Mode repository-boundary
   override; recorded as a MANUAL-VERIFY item for a human to take up
   interactively if wanted.
9. **Fallback-note string corrected in the mockup (critic pass 1, finding 1):**
   the itemized log's Fallback-row Note cell now renders the full,
   non-truncated canonical string with `<name>` substituted for a real
   filename, instead of a shortened/ellipsized paraphrase — the doc's "exact
   and non-negotiable" claim (§4) now matches its own reference mockup.
10. **"Type-specific fields" column added to the itemized log (critic pass 1,
    finding 2; matches `02-ux-workflow.md` rev 2 decision 18):** the mockup's
    log table gained a sixth column, populated per coursework type across all
    four types shown (Material: empty; Assignment/Quiz assignment: "Due:
    cleared · Max pts: N"; Question: "Answer: Multiple choice (N opts)") —
    the ledger metaphor now demonstrates genuinely different row shapes per
    type rather than one generic post shape with a claim attached.
11. **Duplicate-run notice copy unified (critic pass 1, finding 3):** the
    Selection-screen notice and the Ready-to-Transfer restatement now use the
    identical sentence, matching the doc's "reused verbatim" claim; the §3
    bullet was reworded to distinguish the shared *component* (styling,
    reused across three screens) from the duplicate-run *copy* (verbatim only
    at its own two touchpoints) from the rate-limit banner (same component,
    different event, its own distinct copy).
12. **Skipped outcome styled and demonstrated (critic pass 1, finding 4):**
    added an `.outcome-skipped` pill style (slate-600 on paper-1, line-strong
    border) and a sample Skipped row to the mockup's itemized log — all three
    filterable outcome kinds (Transferred/Fallback/Skipped) now have a
    sanctioned style, not just two of three.
13. **Action Sheet Modal checked-state decoupled from "Recommended" (critic
    pass 1, finding 5):** added an independent `.selected` radio treatment
    (filled ink-900 dot; filled teal-700 dot with outer ring when combined
    with `.recommended`) so choosing a non-recommended option is just as
    visibly confirmed as accepting the recommendation — the mockup now shows
    one row where the recommended option is accepted and one row where a
    non-recommended option is chosen instead, demonstrating both states.
14. **"Next handoff" reconciliation wording corrected (critic pass 1, finding
    6):** reworded to state that only three of the five Completion Summary
    fields (transferred/fallback/skips) sum to total posts scanned; topics
    and rubric-notes are independently reported, non-additive counts — no
    longer calling all five fields "independently reconciling."
15. **`.notice`/`.rate-banner` text color moved onto the `--amber-700` token
    (critic pass 1, finding 7):** replaced the hardcoded `#5C3D00` with
    `var(--amber-700)` in the mockup CSS so the stylesheet is actually
    token-authoritative, as the Mockups section already claimed. No contrast
    regression — amber-700 on the amber-100 tint was already spot-checked by
    the critic at 4.4:1+.

## Assumptions

- The contrast-by-construction palette (§6) is assumed AA-compliant based on
  the darkness of the chosen ink/status tones against the paper background,
  but was not verified with an automated contrast tool in this stage — see
  Deltas (P1).
- Narrow-viewport (tablet/Chromebook) behavior for the stat-tile grid and
  itemized log table is assumed to need a defined reflow/collapse strategy,
  but the specific breakpoint and pattern are left to architect/engineer —
  see Deltas (P1).
- Public Sans's "feature-complete, not actively developed" status (verified
  2026-08-14) is treated as an acceptable stable choice rather than a risk,
  since it remains hosted on Google Fonts and widely deployed; flagged here
  in case a future design pass wants to re-evaluate.

## Open questions

- Whether "Start another transfer" should pre-clear or retain the previous
  source/target selections as defaults — left open by UX for UI/engineer;
  this direction doesn't resolve it (no visual-design implication either
  way) and it remains for architect/engineer to decide.
- Exact copy for the generic catch-all error state ("Something went wrong" +
  Retry/Start Over) beyond the register established in §4 — not fixture-
  exercised per UX's flag; a content pass can finalize this in parallel with
  build.
- Whether a downloadable/exportable itemized log is worth adding — out of
  v1 scope per the brief; noted as a backlog candidate, no visual-design
  work needed until it's in scope.

## Next handoff

Architect → reads 01/02/03, designs the system, writes
docs/product/04-architecture.md. Notes for architect:

- The Completion Summary's five counts (topics, drafts transferred, fallback
  shells, skips, rubric notes added) must be modeled as five distinct fields
  the backend exposes in whatever data shape the batch-transfer job reports —
  but they are **not five equally-reconciling fields**. Only three
  (transferred/fallback/skips) sum to total posts scanned, per the corrected
  reconciliation formula ((drafts transferred) + (fallback shells) + (skips)
  = total posts scanned). Topics created/mapped is a separate count that
  never enters that sum (a topic is not a post). Rubric notes added is a
  non-additive subset tag — it marks posts already counted under one of the
  three summed buckets whose rubric couldn't be copied, never a fourth or
  fifth term. The UI's reconciliation-line design depends on the backend
  being able to supply exactly these numbers with this exact arithmetic
  relationship, not a generic status blob where all five fields look
  interchangeable.
- The two P1 Deltas above (responsive breakpoint strategy for the stat
  grid/log table; contrast audit) are UI-adjacent but land as engineer/QA
  work, not architecture — flagged here so they aren't lost between stages.
- Two shared, cross-screen components are specified once in this doc and the
  mockups (cold-start overlay, rate-limit/duplicate-run narration banner) —
  architect should treat these as reusable components in the system design,
  not per-screen one-offs.
