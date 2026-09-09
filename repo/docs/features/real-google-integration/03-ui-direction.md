# UI Direction — Real Google Integration & Duplicate Prevention (Phase 2)

> The product's look, feel, taste, and voice for Phase 2 — a **revision layer**
> over `docs/product/03-ui-direction.md` (v1), not a replacement. Written by the
> UI agent from `02-ux-workflow.md` (this feature) under Beast Mode (full
> elicitation, every choice auto-accepted at its recommended option, recorded via
> `stage_record_decisions` with `source: "beast-mode-auto"`). Date: 2026-08-23.
>
> **Track:** `docs/features/real-google-integration/`, **scopeMode: "open"** —
> this doc reads the PM brief's §9 keep/revise/reinvent table as its scoping
> contract. Per that table: **design system is Keep**; auth surfaces are
> **Reinvent**; the pre-flight/Completion Summary surfaces are **Revise**.
> Everything below earns its place because it is new or because the PM/UX docs
> require it to change — screens and tokens marked Keep are referenced, not
> re-specified.
>
> **Binding constraint (kickoff, non-negotiable):** no Tailwind, anywhere, ever.
> `client/src/styles/tokens.css` is the only styling system this doc extends.

## 0. Scope framing — what changes here, mapped to UI surfaces

| PM §9 / UX §0 area | Scope | What that means for this doc |
|---|---|---|
| Design system (tokens, type, color, component shapes) | **Keep** | §1–§2 below restate v1's concept/palette/type as still-governing; no new hue, no new typeface family. |
| Sign-in landing + `AuthFlow` | **Reinvent** | §3.1: full re-authoring in the token system — real Google button, pre-redirect/returning states, three inline failure states. |
| Completion Summary stat tiles | **Revise** | §3.2: 5→7 tiles, regrouped (not a straight row extension) to preserve the ledger concept at the new count. |
| Duplicate-vs-user-skip visual language | **New, extends `OutcomeIcon`/`OutcomePill`** | §3.3: a third, structurally distinct treatment — not a third color for its own sake. |
| Ready-to-Transfer disclosure, topic detail panel | **New component** | §3.4: one new shared `Disclosure` component, reused three places. |
| Mid-wizard / mid-transfer interrupt banners | **New, extends `NarrationBanner`/`ErrorState`** | §3.5: reuses two existing patterns rather than inventing a third. |
| Action Sheet Modal, Ready-to-Transfer card shell, progress bar, itemized log columns | **Keep** | No visual change beyond the Outcome-cell content rule in §3.3. |

## 1. Design concept & personality (Keep, restated)

**"The Registrar's Manifest" is unchanged and governs every new surface in this
phase.** A teacher handing their course to a careful, unglamorous clerk who
double-checks everything — not a flashy assistant. Every new screen below
(sign-in, interrupts, disclosures) is designed to read as **"a clerk pausing to
tell you something," never "the app broke."** This is the direct visual answer
to the assignment's premise: the prior session's user hit dead ends and gave up;
nothing new in this phase should look like a dead end.

**One addition to the signature-move list (§1 of v1 had two; this phase adds a
third, in the same restrained spirit):**

3. The Completion Summary's stat tiles are no longer one undifferentiated row —
   they split into two labeled **ledger sections** (§3.2), so the "which
   numbers actually add up to the total below" question is answered by
   *layout*, not just by the reconciliation sentence underneath. This is the
   direct structural response to the 5→7 tile problem UX flagged, and it
   reinforces the manifest concept rather than working around it.

Adjectives, feeling, and the "calm, precise, plainspoken, official-but-warm"
register are unchanged from v1 §1 — read there for the full framing.

## 2. Visual / presentational tone (Keep, one bounded exception)

Typography, color, and the token set in v1 §2 are **unchanged**. No new
typeface family, no new brand hue. **One deliberate, narrowly-scoped exception,
required by an external party's rules, not by taste:**

**The "Sign in with Google" button is a branded asset, not a themed control.**
Google's current branding guidelines (`developers.google.com/identity/
branding-guidelines`, verified live 2026-08-23) are **non-negotiable** for any
custom Google sign-in button:

- **Colors — three approved themes**, exact hex, no substitution:
  **Light** (fill `#FFFFFF`, 1px inset stroke `#747775`, text `#1F1F1F`),
  Dark (`#131314` / `#8E918F` / `#E3E3E3`), Neutral (`#F2F2F2`, no stroke,
  `#1F1F1F`).
- **Font:** "Google Sans Medium" (Google's own guidance says available via
  Google Fonts). **MANUAL-VERIFY:** confirm at build time that this exact
  family is actually resolvable from Google Fonts — "Google Sans" has
  historically **not** been publicly hosted there under that name in past
  guideline revisions, and a broken font `@import` is exactly the class of
  failure (B11/B14) this phase exists to stop repeating. Fallback stack
  required regardless: `'Google Sans Text', 'Google Sans', Roboto, Arial,
  sans-serif` — never fail silently to the browser default.
- **The "G" logo cannot be altered:** no recoloring, no resizing independent of
  the button, and it must render on a white background. Use Google's actual
  four-color asset (the existing inline SVG paths in the current file already
  carry the correct four brand hex values — `#4285F4`/`#34A853`/`#FBBC05`/
  `#EA4335` — so the artwork itself does not need replacing, only its sizing;
  see §3.1 and §6).
- **Approved CTA text:** exactly "Sign in with Google" (also acceptable:
  "Sign up with Google," "Continue with Google") — never a paraphrase, never
  "(mock)" appended.
- **Shape:** Google pre-approves rectangular and pill presets; the guidance
  fetched today gives no explicit ruling on other corner-radius values.
  **Decision:** use the system's own `--radius` (3px) rather than force-fitting
  a pill or a sharp rectangle, since 3px sits visually between the two
  documented presets and the button otherwise looks like an orphan next to
  every other bordered, 3px-radius control in the product. **MANUAL-VERIFY:**
  if this project ever goes through Google's app-verification review, use the
  branding-guidelines page's own "build your own button" tool to confirm 3px
  passes review, or fall back to the pill/rectangle preset if it doesn't.
- **Size:** Google's guidance gives no fixed px height in the fetched text; the
  system's own 44×44px minimum hit-area rule (v1 §6, unchanged) already meets
  or exceeds every historical Google minimum-height figure, so no conflict —
  the button inherits `.btn`'s `min-height:44px` sizing behavior without
  inheriting `.btn`'s color/font.

**Containment rule:** these five values (two hexes not already in the palette,
one foreign font, one fixed CTA string, one fixed logo asset) are scoped
**exclusively** to the `.google-signin-btn`/`.google-g-logo` classes. They do
not enter `:root`, they are not reused anywhere else, and no other control in
the product may borrow Google's white-fill/gray-stroke look. One button is a
deliberate, bounded, externally-mandated exception — not a second design
system.

## 3. Key element styling (New / Revised)

### 3.1 Sign-in landing — re-authored, not restyled (task 2)

**Root cause, confirmed independently before writing this spec:** the
`b15-two-big-icons-diagnosis.md` grep (`w-16|bg-blue-100|text-slate-700|
rounded-lg|shadow-sm`) found exactly one file and called it "the only file
under `client/src` containing Tailwind utilities." **That claim does not
survive a broader scan.** Running a Tailwind-shaped-class sweep
(`min-h-screen|bg-slate-|bg-blue-|flex\b|items-center|justify-center|
text-slate-|font-medium|rounded-|shadow-|px-[0-9]|py-[0-9]|...`) across
`client/src` today returns **two** files:

```
client/src/features/auth/AuthFlow.tsx
client/src/features/auth/SignInLanding.tsx
```

`AuthFlow.tsx`'s `loading` branch renders `<div className="min-h-screen
bg-slate-50 flex items-center justify-center"><div className="text-slate-500
font-medium">Loading Classroom Copier...</div></div>` — every one of those
classes is exactly as inert as `SignInLanding.tsx`'s, for the identical reason
(no Tailwind in this project). It happened not to produce an oversized SVG
(there's no `<svg>` in this branch), so it didn't get caught by a diagnosis
built around reproducing the "two big icons" symptom specifically — but it is
the same defect class, and it is a "raw unstyled fallback" in its own right (an
unstyled `<div>` with no visual weight, background, or spacing, exactly the
kind of screen that reads as "app broke" rather than "app is loading"). **§7.2c's
regression guard must be written to catch this too** — a guard grepped from the
diagnosis's five original substrings would pass with `AuthFlow.tsx` still
broken; it needs a Tailwind-class-shaped pattern (or a maintained prefix list),
not five literals borrowed from one symptom. This is a P0 finding — see Deltas.

**The fix, both files, same rule as v1's fix for every other screen: re-author
in the token system, using `git show 0694779:client/src/features/auth/
SignInLanding.tsx` and `...AuthFlow.tsx` as the idiom reference** (`.signin-screen`,
`.wordmark`, `.seal`, `.signin-tag`, `.mock-note`, the `Button` shared
component, a `stage` state machine) — not a straight revert, since v1 had no
real Google button and no redirect/callback states.

**States to build (all under the existing `.signin-screen` shell):**

| State | Structure | Notes |
|---|---|---|
| **1a — Landing (default)** | `.wordmark` + `.signin-tag` + `.google-signin-btn` (§2) + a new reassurance line under it, replacing v1's `.mock-note` role | Reassurance line: *"First sign-in today can take up to a minute while the app wakes up."* — same `.mock-note` typographic treatment (ink-500, 12.5px, mono) repurposed for a real fact instead of a demo disclaimer. |
| **1b — Pre-redirect warm-up** | No new visual component. The click fires the existing cold-start-covered fetch; nothing changes on screen unless the app's **existing global `cold.coldStart` flag** (already wired in `App.tsx`, `ColdStartOverlay` layered on top of whatever's rendered beneath) goes true at 2s. | Reuses `ColdStartOverlay` **verbatim** — its existing `COLD_START_TITLE`/`COLD_START_SUBLINE` constants ("Waking up server…" / "up to 50 seconds") are the single source of truth; do **not** introduce the wireframe's slightly different paraphrase ("up to a minute") as a second string. One copy, one place, per the reconciliation-line discipline already established in this codebase. |
| **1c — On Google's domain** | Not rendered by this app. Nothing to spec. | |
| **1d — "Signing you in…" (callback landing)** | New, minimal: `.signing-in` (copy of `.coldstart`'s layout: centered, 70px/32px padding) with `.spinner` + the single line **"Signing you in…"**, no sub-line. | If its own confirmation fetch exceeds 2s, it does **not** get a bespoke slow-state — the same global `cold.coldStart` mechanism as everywhere else layers `ColdStartOverlay` on top, silently replacing "Signing you in…" with "Waking up server…" per the existing app-wide pattern. No new state machine needed; this is a direct reuse of a mechanism the app already has. |
| **1e/1f/1g — Sign-in failures (inline, on 1a)** | A new `.signin-error` banner (amber family, §6 has the contrast math), rendered **inside** the landing screen below the button — never a full-page takeover. `role="alert"` (§6, corrected this revision — not `role="status"`). | All three share **one visual treatment**; only the copy differs (UX owns exact wording). This is deliberate: per Delta P0-3's sibling principle here, three differently-*colored* error states would suggest three different severities, when in fact none of the three lost any data and none is more "broken" than another — same register as the existing `NarrationBanner` discipline ("one component, several call sites, distinct copy"). 1g's optional reference code renders as a `.ref` sub-line (ink-500, mono, 11.5px) inside the same banner — de-emphasized, never the headline. |
| **1h — Switch account / Sign out** | No visual change from v1's header-bar pattern; `Button variant="link"` unchanged. | |

**The icon-sizing rule that cannot fail this way again:** every inline `<svg>`
in this codebase — the Google "G" mark included — **must carry explicit
`width`/`height` attributes** (not just a `viewBox`). This is the actual
mechanism behind 898×898px: a `viewBox`-only SVG with no CSS sizing and no
`width`/`height` attribute stretches to fill its containing block, and a
project with no utility-class framework has nothing to stop that. Concretely:
`<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">…</svg>`.
This is a **project-wide rule**, not a one-off fix — recommend it be added to
`docs/project-profile.md`'s conventions (or a project lesson-learned) so the
next SVG anyone adds doesn't silently repeat this.

### 3.2 Completion Summary — the 5→7 stat-tile problem (task 1)

**Verified against `tokens.css` before designing this** (not assumed): the
shipped responsive strategy is `.stat-grid{ display:grid;
grid-template-columns:repeat(5,1fr); }`, `@media (max-width:1024px){
grid-template-columns:repeat(3,1fr); }`, `@media (max-width:768px){
grid-template-columns:repeat(2,1fr); }` — built, as UX flagged, around exactly
five equal cells in one row. Simply adding two more columns to that same row
(`repeat(7,1fr)`) would make each tile narrower than any tile in the shipped
5-across layout, at exactly the moment two tiles carry longer labels ("Skipped,
already existed" is longer than any v1 label). **Rejected for that reason.**

**Decision: don't extend the row — split it into two labeled ledger
sections**, reusing an existing `tokens.css` breakpoint value rather than
inventing a third. This isn't a workaround for the tile count; it's a better
expression of the manifest concept than a flat row ever was — it makes
visible, by layout alone, **which numbers are the ones that sum to the total
below** and which aren't, before a teacher reads a single word of the
reconciliation sentence.

**Breakpoint correction (this revision):** the prior draft of this section
claimed both of `tokens.css`'s existing tiers (1024px, 768px) were reused
here, then shipped CSS that only used 1024px, and a mockup that used neither
(620px, found nowhere in `tokens.css`) — three different values across two
co-produced artifacts and the prose, none agreeing. Corrected: **this grid
reuses only the system's existing 768px tier**, not both. Reasoning, checked
against real widths rather than asserted: v1's 1024px tier exists to rescue
*five* equal-width tiles from becoming too narrow at typical tablet-landscape
width. Group A has only **four** tiles and Group B only **three** — both
already sit at or below v1's own 1024px-tier column count (3), so stepping
down again at 1024px would shrink tiles that are not yet cramped. The
768px tier — the system's existing "collapse to 2 columns" floor, reused
by the itemized log's own responsive strategy on this same screen (§6) — is
the one real transition these groups need. No new pixel value is introduced;
exactly one of the system's two existing tiers is reused, and §6 below is
corrected to say so precisely instead of overclaiming both.

**Group A — "Items scanned" (the terms that sum to the reconciliation total
when no item was skipped for a system-interrupted reason — see the
reconciliation-line correction below for the case where one was):** Drafts
transferred · Fallback shells · **Skipped, already existed** · **Skipped by
you**. `grid-template-columns:repeat(4,1fr)` at desktop.

**Group B — "Reported separately" (never terms in that sum):** Topics created
· Topics reused · Rubric notes added. `grid-template-columns:repeat(3,1fr)`,
visually separated from Group A by an 18px gap plus a `1px solid var(--line)`
top rule (a literal ledger-section divider, not just whitespace) and its own
small mono uppercase caption.

```css
.stat-groups{ display:flex; flex-direction:column; gap:20px; margin-bottom:18px; }
.stat-group-label{
  font-family:var(--font-mono); font-size:10.5px; text-transform:uppercase;
  letter-spacing:.03em; color:var(--ink-500); margin-bottom:8px;
}
.stat-group-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
.stat-group-grid.topics-group{
  grid-template-columns:repeat(3,1fr); padding-top:18px; border-top:1px solid var(--line);
}
/* Reuses the system's existing 768px tier only (see the breakpoint
   correction above) — not v1's 1024px tier, and not a new value. Both groups
   collapse to 2-col together: Group A becomes 2x2, Group B becomes 2+1.
   Neither group needs the intermediate 3-col step v1's 1024px tier provides
   for five tiles — four and three tiles are already narrow enough to skip
   straight to 2-col at the system's existing 768px floor. */
@media (max-width: 768px){
  .stat-group-grid, .stat-group-grid.topics-group{ grid-template-columns:repeat(2,1fr); }
}
```

**Individual `.stat-tile`/`.stat-num`/`.stat-label` markup is unchanged from
v1** — only the wrapper grid changes. At desktop, 4 columns is *less* cramped
per tile than v1's shipped 5-across (more width per tile, not less) — a direct
side benefit of not trying to keep everything in one row.

**Tile order in Group A** deliberately puts the reassuring number first:
Transferred, Fallback shells, **Skipped — already existed**, Skipped — by you.
**The reconciliation line's term order is changed to match this left-to-right
tile order** (a deliberate departure from the UX wireframe's worked-example
ordering, justified by the wireframe's own stated reason for the reconciliation
line's design: *"the arithmetic is checkable by eye against the tiles above
it"* — that only works if the two orders match).

**Formula correction (this revision):** the prior draft hardcoded exactly
four terms — `transferred + fallback + duplicate-skip + user-skip = total` —
which only reconciles when `skippedBySystem == 0`. The shipped v1 line
(`CompletionSummary.tsx`, confirmed by reading it) instead sums
`transferred + fallbackShell + skippedTotal`, where `skippedTotal` is a
server-computed aggregate that is *always* `skippedByUser + skippedBySystem`
by construction — safe regardless of how many skip sub-reasons exist. Once
`skippedTotal` splits into three server-tracked sub-reasons instead of two
(`skippedDuplicate` / `skippedByUser` / `skippedBySystem`, per the P0 schema
Delta below), the same safety property must carry over: **the visible sum
must always equal `totalItems`, including when a system-interrupted skip
occurred.**

Fix: the reconciliation line shows the four Group-A terms as before —
because that's the common case (no system-interrupted skips this transfer)
and it's what keeps the line checkable by eye against the four visible
tiles — **plus a fifth, labeled term, shown only when `skippedBySystem > 0`**,
sourced from the exact same `skippedBySystem` value the existing, unchanged
`systemSkipLine` text already renders below (not a new client computation —
the same server aggregate read twice, which is what keeps this from becoming
"a second implementation of the sum"). The fifth term is *labeled inline*
("interrupted"), not a bare number, precisely because it has no matching
Group-A tile to be checked against by position alone — system-interrupted
skips are deliberately excluded from Group A's tile set (§3.3: out of this
phase's scope for the pill/filter treatment) and keep their existing
`systemSkipLine` explanation, unchanged.

Common case — no system-interrupted skips (unchanged from the worked example):

```
✓ 32 + 2 + 5 + 1 = 40 of 40 items scanned — every item resolved to a
  transfer, fallback, or skip.
```

Same transfer, now with 3 system-interrupted skips (the case the prior draft
could not represent — term count and total both grow, and the line still
balances):

```
✓ 32 + 2 + 5 + 1 + 3 interrupted = 43 of 43 items scanned — every item
  resolved to a transfer, fallback, or skip.
```

The fifth term is omitted entirely when `skippedBySystem === 0` (not shown
as `+ 0 interrupted`) — the common case stays exactly the clean four-term
line above, unchanged from what the tiles show.

`.reconcile`'s existing never-truncate rule (`white-space:normal;
overflow-wrap:break-word`) is unchanged and still required — a 4- or 5-term
sum is a longer string than v1's 3-term one.

**Topics stay visibly outside the item invariant (task 3, second half).** Two
mechanisms, not one:

1. **Structural:** Group B sits in its own visually divided section, never
   inside the 4-tile reconciled group — a teacher cannot mentally include a
   Group-B number in the ledger total without first crossing a printed rule.
2. **Textual:** a plain callout directly under Group B, **not** styled like the
   green `.reconcile` strip (that green treatment specifically means "the item
   ledger balances" — reusing it here would visually claim topics are also
   part of that balance, the exact thing this requirement forbids). Plain
   body text instead:

```css
.topics-callout{ color:var(--ink-700); font-size:13px; margin-top:10px; }
```
> *"Topics are reported separately and never counted in the item total above —
> reusing an existing topic is not an item outcome. 4 created + 2 reused = 6
> topics referenced by this transfer."*

**Rubric notes added** stays in Group B for the same "not a term in the sum"
reason, but for a **different** underlying reason than topics (a subset tag on
already-counted items, not a different object type) — the callout above only
speaks to topics; rubric notes' non-additive nature is carried by its existing
v1 label and needs no separate visual treatment here, since it was already
correctly excluded from the sum in v1.

### 3.3 Duplicate vs. user-chosen skip — structurally distinct, not just recolored (task 3, first half)

**Color alone is explicitly insufficient** (v1 §6, unchanged rule) — this
distinction needs its own glyph and its own token pairing, extending
`OutcomeIcon`/`OutcomePill` rather than replacing them.

**The `Outcome` enum itself stays four values** (`pending | transferred |
fallback_shell | skipped`) — `duplicate_title` is a `SkipReason`, not a new
`Outcome`, per PM §6.5's closed-vocabulary rule. The distinguishing information
(`skipReason`) already exists per-item on `TransferJobItemRowSchema` today.
**`OutcomeIcon`/`OutcomePill` need one additive, backward-compatible change:**
an optional `skipReason?: SkipReason | null` prop. When `outcome === 'skipped'
&& skipReason === 'duplicate_title'`, both components render the new
`outcome-duplicate` treatment instead of the existing `outcome-skipped`
treatment; every other call site (no prop passed) is unaffected.

| | User-chosen skip | Duplicate skip (new) |
|---|---|---|
| Glyph | `⊘` (existing — unchanged) | `≡` (new — "identical to," i.e. matches something already there) |
| Log/pill text | "Skipped — you chose to skip" | "Already in course" |
| Tile label | "Skipped by you" | "Skipped, already existed" |
| Color family | slate (`--slate-600` on `--paper-1`, `--line-strong` border) — unchanged | **teal** (`--teal-700` on `--teal-100`, `--teal-700` border) — reused, not new: this is an exact match for `.badge-sis` (same text/border/fill triple) and a partial match for the Action Sheet's "Recommended" `.stamp` (same `--teal-700` text/border, but `.stamp` has no `--teal-100` fill — it's transparent, per `tokens.css`). Teal was chosen in v1 specifically to read as *"verified,"* which is exactly what a duplicate match is — the product verified this item is already there. No new hex introduced either way. |

```css
.outcome-duplicate{ color:var(--teal-700); background:var(--teal-100); border:1px solid var(--teal-700); }
```

**Contrast, computed (not asserted):** `--teal-700` (`#0F5C56`) text on
`--teal-100` (`#DCEEEB`) fill — relative luminances 0.0844 and 0.8237 —
`(0.8237+0.05)/(0.0844+0.05) ≈ 6.50:1`. Clears WCAG AA's 4.5:1 for normal text
(the pill renders at 11px, below the large-text threshold, so the stricter
ratio applies) with real margin, and the border pairing (same two colors)
clears the 3:1 non-text/UI-component minimum by the same math. The unchanged
`outcome-skipped` pairing (`--slate-600` `#5B6B67` on `--paper-1` `#F2EEE3`)
computes to `≈4.84:1` — also clears AA, consistent with v1's existing claim for
that pairing (still an open P1 in v1's own Deltas to run this through an
automated tool — unchanged, not newly introduced by this phase).

**`≡` (U+2261, IDENTICAL TO) chosen over a geometric-shapes-block glyph**
(e.g. `▣`) specifically for wider font-coverage reliability — it sits in
general/math punctuation, not the more sparsely-implemented geometric shapes
block IBM Plex Mono may not cover. **MANUAL-VERIFY:** engineer should still
visually confirm `≡` renders as expected in IBM Plex Mono in real Chromium (the
project's existing axe-core-in-real-Chromium verification pass is the right
place for this), and substitute a plain ASCII fallback (e.g. a bold `=`) if it
doesn't.

**Same rule reaches the itemized log's Outcome column, the filter dropdown,
and the CSV export — one label function, three consumers, not three
implementations of "what does this outcome mean":**

- Log Outcome cell: renders `OutcomePill` with the new `skipReason` prop —
  "Already in course" (duplicate) vs. "Skipped — you chose to skip" (user) vs.
  unchanged generic "Skipped" for the three system-interrupted reasons
  (`provider_error`/`server_interrupted`/`rate_limit_exhausted` — **out of
  this phase's scope**, per PM §6/UX §3, which name only the duplicate/user
  distinction; these three keep their existing, pre-phase-2 generic treatment).
- Filter dropdown: extends `All / Transferred / Fallback / Already in course /
  Skipped by you` (exact UX wireframe wording) — five options, up from four.
- CSV export (`buildLogCsv`): **must call the same skipReason-aware label
  function the on-screen column uses**, not a second implementation — the
  existing code comment on the reconciliation line already states the
  discipline this needs ("a second implementation of the sum is exactly how a
  ledger starts disagreeing with itself"); the same logic applies to the
  Outcome label.

**Stat-tile data contract gap (flagged for architect — see Deltas):** binding
the new "Skipped, already existed" tile requires a count field the current
`TransferJobStatus` schema doesn't have. `skippedBySystem` today means "every
non-user skip," and its only current UI consumer (`systemSkipLine`, unchanged
by this phase) reads *"N posts were interrupted before we could confirm they
copied"* — actively false if a duplicate skip is silently folded into that
count. This is a genuine, blocking gap, not a styling question — see Deltas P0
rows.

### 3.4 Ready-to-Transfer & topic-detail disclosure — one new shared component

A single new `Disclosure` component (`client/src/components/shared/
Disclosure.tsx`), built on native `<details>`/`<summary>` (free keyboard
semantics — `Enter`/`Space` toggles, native `Tab` reachability — satisfying
UX §6's requirement without hand-rolled ARIA), reused in **three** places:
Ready-to-Transfer's duplicate-items list, its topic-reuse list, and the
Completion Summary's topic detail panel (§3c of the UX wireframe).

```css
.disclosure{ border:1px solid var(--line-strong); border-radius:var(--radius); margin-bottom:14px; background:var(--paper-0); }
.disclosure > summary{
  list-style:none; cursor:pointer; padding:12px 14px; font-size:13.5px; font-weight:600;
  color:var(--ink-900); display:flex; align-items:center; gap:8px; min-height:44px;
}
.disclosure > summary::-webkit-details-marker{ display:none; }
.disclosure > summary::before{ content:'▸'; color:var(--teal-700); font-size:11px; }
.disclosure[open] > summary::before{ content:'▾'; }
.disclosure > summary:focus-visible{ outline:3px solid var(--focus); outline-offset:2px; }
.disclosure-body{ border-top:1px solid var(--line); padding:4px 14px 10px; font-size:13px; color:var(--ink-700); }
.disclosure-row{ padding:7px 0; border-bottom:1px solid var(--line); }
.disclosure-row:last-child{ border-bottom:none; }
.disclosure-ambiguity{ color:var(--amber-700); font-size:12.5px; margin-top:2px; }
```

The `▸`/`▾` marker is `aria-hidden`-equivalent decoration (native `<summary>`
already announces expanded/collapsed state to assistive tech); per UX §6's
"never icon-only" rule, the visible **"[expand]"/"[collapse]"** text UX
specified is rendered as real text inside the summary line (two spans, one
hidden by `[open]` state via CSS, no JS needed) — not represented by the
triangle alone.

### 3.5 Mid-wizard / mid-transfer interrupt banners — reuse two existing patterns, don't invent a third

**4a (session-expired, mid-wizard — full-screen, nothing durable lost yet):**
reuses the **existing** `.error-state` + `.notice-glyph` combination verbatim
(already built for the scan-conflict notice — see `tokens.css`'s "Fix 1"
comment) with a `!` glyph and a "Sign in again" primary button. This is the
cleanest possible instance of "conform, don't reinvent": the exact component
this state needs already exists in the codebase for an almost-identical
situation (a recoverable interrupt, nothing lost, one clear CTA).

**4b/4c (mid-transfer — job still running, progress bar must stay visible and
frozen):** cannot reuse `.error-state` (it replaces the whole screen); needs a
banner that sits with the frozen progress bar, but must read as heavier /
action-required than the existing slim `.rate-banner` (which is purely
informational and self-resolving). New `.interrupt-banner` — same amber
family as `.rate-banner` (nothing here is destructive, so red stays reserved
for true errors per v1 §2), but a bordered, padded card with its own heading
line and button, not a one-line strip:

```css
.interrupt-banner{
  display:flex; flex-direction:column; gap:10px; align-items:flex-start;
  padding:16px 18px; background:var(--amber-100); border:1px solid var(--amber-700);
  border-radius:var(--radius); margin-top:14px;
}
.interrupt-banner .interrupt-head{ display:flex; gap:8px; align-items:center; font-weight:700; color:var(--amber-700); font-size:14px; }
.interrupt-banner p{ margin:0; color:var(--ink-900); font-size:13.5px; }
```

**4b vs. 4c must be distinguishable without reading the body copy** (UX
Decision 10) — differentiated by heading text, button label, **and** a
different leading glyph: `!` for 4b (app-session-side, "Sign in again"), `⇄`
for 4c (Google-connection-side, "Reconnect Google account") — a cheap,
consistent visual cue that this one is about the external connection, not the
local session, on top of the copy difference UX already owns.

**4c's tone, corrected against the newly-verified 7-day fact (this
revision):** `inputs/google-api-facts-verified.md` now confirms Google OAuth
authorizations in Testing status expire after **seven days**, for every user,
on a fixed cycle — not an edge case, a routine weekly occurrence for as long
as the app stays in Testing status. 4c is exactly the surface this hits: it's
the "Google-connection-side" interrupt, so it is what a teacher will see
roughly once a week. The amber treatment and heavier card stay unchanged —
this is a copy/tone correction, not a structural one — but 4c's copy must not
read as "something went wrong," or a routine weekly moment becomes a
recurring trust hit. Two changes to the copy this doc specifies for the
mockup (UX still owns the exact final wording; this is the tone this
treatment must land, corrected from a more alarm-shaped draft):

- Heading softened from a passive "needs to be" framing to a plain, matter-
  of-fact instruction — *"Time to reconnect Google"* rather than *"Google
  access needs to be reconnected"* (the former reads as a routine step; the
  latter reads as something having failed).
- Body copy states the routineness plainly, the same way the verified-facts
  doc recommends for the live-OAuth checklist: *"This happens about once a
  week while the app is in testing — it's expected, not a sign of a
  problem."* — placed **before** the existing reassurance sentence, since
  "why is this happening" is the teacher's first question and "nothing was
  lost" is the second.
- 4b keeps its existing, unadjusted copy: it is not the surface the 7-day
  fact touches (it's the app-session-side interrupt, mechanism-independent
  of the Google token's own expiry), so softening it further isn't this
  revision's job and isn't asked for.

## 4. Voice & tone (Keep, one addition)

v1 §4's register (plainspoken, warm-administrative, never blame the user, no
exclamation points, no invented jargon) governs every new string in this
phase — UX's copy for the sign-in failures and interrupt banners is already
written in that register (§5/§7 of the UX doc); nothing here overrides it.

**One addition:** the "recoverable, not broken" visual vocabulary UX's Next
Handoff explicitly asked UI to weight — carried structurally, not just in
copy: every one of 1e/1f/1g/4a/4b/4c renders **without leaving the screen the
teacher was already on** (inline banner or, at most, the same `.error-state`
shell used elsewhere for recoverable interrupts) — never a blank page, never a
different route, never a loss of place. That structural choice *is* the "not
broken" statement, independent of what the copy says.

## 5. References & anti-references (Keep, one addition)

v1 §5's emulate/avoid lists are unchanged. **Addition, specific to this
phase:** the Google sign-in button is emulated **exactly as Google specifies
it** (§2) — this is the one place in the product where "match the source
precisely" beats "match our own system," and that exception is documented,
bounded, and does not set precedent for any other control.

**Reaffirmed by name:** Tailwind utility classes are not a "look" to consider
or avoid stylistically — they are out of contract entirely (kickoff decision,
binding). The "only this product" test is unaffected by this phase: the
ledger-section-grouped stat tiles and the teal "verified" duplicate pill are
new instances of the same manifest vocabulary, not a departure from it.

## 6. Accessibility & medium constraints (Keep + extensions)

v1 §6's binding rules (WCAG AA target, never-color-alone, `--focus` ring,
44×44px hit areas, live regions, reduced motion, English-only) are unchanged
and apply to every new surface in this phase. Extensions:

- **Contrast of new pairings — computed above, not asserted:** the new
  `.outcome-duplicate` pairing (`--teal-700`/`--teal-100`) computes to
  `≈6.50:1`; the `.signin-error` banner reuses the existing `--amber-700`/
  `--amber-100` pairing already spot-checked at `4.4:1+` in v1's critic pass
  (Decision 15); the Google button's own colors are Google's fixed asset,
  outside this product's contrast audit scope by definition (`#1F1F1F` on
  `#FFFFFF` is in any case one of the highest-contrast pairings possible,
  ≈16:1). **MANUAL-VERIFY:** all of the above still needs the automated
  axe/contrast-tool pass v1's own Deltas already flagged as outstanding — this
  phase adds pairings to that same unresolved audit, it doesn't newly create
  the gap.
- **SVG sizing (new, project-wide rule):** every inline `<svg>` carries
  explicit `width`/`height` attributes; no sizing may depend on a class that
  might not resolve. See §3.1.
- **Disclosure keyboard/AT behavior:** native `<details>`/`<summary>`
  semantics (§3.4) — `Enter`/`Space` toggles, native tab order, native
  expanded/collapsed announcement, plus the required visible "[expand]/
  [collapse]" text redundancy.
- **Focus management, new screens:** 1d/1e/1f/1g and 4a/4b/4c all move focus
  to their heading/banner on mount, matching the existing pattern (Completion
  Summary heading, v1 §6) — UX §6/§7 already requires this; restated here as a
  UI-testable acceptance point since it touches every new component in §3.
- **ARIA role, corrected against project convention (this revision):**
  `.signin-error` (1e/1f/1g) uses `role="alert"`, not `role="status"` — this
  codebase reserves `role="status"`/implicit `aria-live="polite"` for benign,
  self-resolving content (`ColdStartOverlay`'s `.coldstart`,
  `PreflightScreen`'s `.scanning`), and `role="alert"` for genuine errors
  (`SelectionScreen`'s `.field-error`, `TransferProgress`'s cancel-confirm
  `.notice`). A failed sign-in is the latter. `.interrupt-banner` (4b/4c)
  gets the same `role="alert"` for the same reason — both are action-required,
  non-benign states, the same class `.field-error` already occupies — and it
  is announced *twice*, redundantly but not harmfully, by the focus-on-mount
  move above landing on the banner at the same moment the live region fires.
- **Responsive floor — reused breakpoint values, not new ones (corrected this
  revision):** §3.2's stat-groups reuse the system's existing **768px** tier
  only (see §3.2's breakpoint correction for why the 1024px tier isn't needed
  at this tile count); the existing itemized-log horizontal-scroll-with-
  sticky-column strategy on the same screen separately uses **both** of
  `tokens.css`'s existing tiers for its own, unrelated behavior. No pixel
  value outside `tokens.css`'s existing 1024px/768px pair is introduced
  anywhere in this phase — the mockup previously used 620px for the
  stat-groups grid; that was a bug in the prior draft, not an intentional
  third breakpoint, and is corrected in the mockup to 768px, matching this
  doc.
- **Regression guard scope (ties to §3.1's correction):** the §7.2c
  "no Tailwind classes under `client/src`" guard must use a pattern broad
  enough to have caught `AuthFlow.tsx`, not just the five substrings the
  original diagnosis grepped — see Deltas.

## Mockups

Produced. `docs/features/real-google-integration/mockups/phase2-ui-mockups.html`
— a single self-contained, token-driven HTML file (same convention as v1's
`docs/product/mockups/ui-mockups.html`, and it inlines the `:root` token block
from `tokens.css` verbatim so the two never silently diverge) covering the
three highest-risk new surfaces: the re-authored sign-in landing (default +
one inline failure state + the real Google button), the regrouped 7-tile
Completion Summary (with a duplicate-vs-user-skip log excerpt), and the
Ready-to-Transfer duplicate/topic disclosure (collapsed + expanded). The
mid-transfer interrupt banners (4b/4c) and the remaining sign-in failure
variants (1e/1f) are specified in prose above (§3.1, §3.5) but not separately
mockup'd — they reuse the same two CSS patterns (`.signin-error`,
`.interrupt-banner`) already shown once each in the mockup, so a second
rendering would not add new information.

## Image prompts

Not needed — unchanged reasoning from v1 (single-purpose B2B/education
utility; imagery would work against the plainspoken "not clever" register).
This phase adds no consumer-facing surface that would change that assessment.

## Design sync

Declined — Beast Mode override (stage-protocol §10, AGNTC-0130), same as v1.

**MANUAL-VERIFY:** design-system sync to Claude Design (claude.ai/design) was
never taken up this run. A human should invoke the UI stage's design-sync
offer interactively if a hosted, browsable design system is wanted.

## Deltas (required quality improvements)

| Risk (P0/P1) | Recommendation | Rationale | Prerequisite for next stage? |
|---|---|---|---|
| **P0** — `TransferJobStatus` has no field to bind the new "Skipped, already existed" tile to. Left unaddressed, engineer's only two options are both wrong: fold `duplicate_title` into `skippedBySystem` (which then makes the existing `systemSkipLine` copy — "N posts were interrupted before we could confirm they copied" — actively false for duplicates) or invent an ad-hoc client-side count with no server-verified total (silently reintroducing the totality-invariant risk this whole phase exists to close). | Architect adds an explicit `skippedDuplicate` (or equivalently named) count field to `TransferJobStatus`, computed server-side from `skipReason === 'duplicate_title'`, kept fully separate from `skippedBySystem` (which continues to mean only `provider_error`/`server_interrupted`/`rate_limit_exhausted`). `skippedTotal` remains the sum of all three; PM §6.5's invariant shape is unaffected. | Directly blocks §3.2/§3.3 of this doc and UX's Delta P0-3 — the stat tile and the itemized log's per-row label both need this distinction available in the data, not just in this doc's prose. | **Yes** — architect must design this field before engineer can build the tile or the log's Outcome column correctly. |
| **P0** — `OutcomePill`/`OutcomeIcon` currently key only on the coarse `Outcome` enum (4 values); they cannot express "this skip was a duplicate" without the additive `skipReason` prop specified in §3.3. Left unaddressed, engineer either hacks a duplicate check into call sites (component-contract drift, the same failure class named in this project's own `OutcomeIcon` "cannot render glyph-only" discipline) or ships the duplicate/user-skip rows visually identical, defeating the phase's headline trust promise. | Extend `OutcomePill`/`OutcomeIcon` with the optional `skipReason?: SkipReason | null` prop and the `outcome-duplicate` treatment specified in §3.3 — additive, backward-compatible, single source of truth reused by the log cell, the CSV export, and (once §3.2's tile exists) the stat tile's own icon if one is added. | This is the concrete, checkable form of UX's Delta P0-3 (duplicate vs. user-chosen skip must never look identical) — a design requirement UI must hand engineer as a testable component contract, not an implicit convention. | **Yes** — engineer needs this contract before building any of the three consumers named in §3.3. |
| **P0** — The B15 diagnosis's regression-guard recommendation (§7.2c) is scoped to the five substrings that reproduced *that specific* symptom, and a fuller scan run for this doc (§3.1) found `AuthFlow.tsx` also carries inert Tailwind classes the diagnosis's own grep pattern does not match. A guard built from the diagnosis's literal pattern would ship green while `AuthFlow.tsx` stays broken. | Write the §7.2c guard against a Tailwind-class-*shaped* pattern (common prefixes: `\b(bg|text|border|rounded|shadow|flex|items|justify|w|h|p|m|px|py|mx|my|gap|min-h|max-w)-` or a maintained prefix list) rather than the five literal substrings from the diagnosis doc, and confirm it fails loudly against `AuthFlow.tsx`'s current HEAD content before the fix lands (red first, per the project's own TDD discipline) so the guard is proven to catch what it's meant to catch. | A guard that would not have caught the second instance of the exact defect it exists to prevent is not a guard — it's a false sense of coverage, worse than no guard because it looks like protection. | **Yes** — engineer must confirm the guard actually fails on `AuthFlow.tsx` pre-fix before relying on it post-fix. |
| **P1** — Splitting the itemized log's outcome filter into "Already in course" / "Skipped by you" (§3.3) leaves the three system-interrupted skip reasons (`provider_error`/`server_interrupted`/`rate_limit_exhausted`) reachable only via the "All" filter — neither new option covers them, mirroring how they were never separately filterable in v1 either, but now two named options exist that a teacher might reasonably (and incorrectly) assume are exhaustive. | Note in engineer/QA handoff that this is a known, small gap, not silently assumed complete; a future pass could add a third "Skipped — couldn't confirm" filter option mirroring `systemSkipLine`'s existing copy, but PM/UX scoped this phase's split to exactly two kinds and this doc does not expand that scope unilaterally. | Filter completeness is a minor but real coherence gap once two named, specific options exist next to a generic "All." | No — doesn't block architect/engineer; a scope note for QA to test against ("all" still reaches every row) rather than a build blocker. |
| **P1** — "Google Sans Medium" availability via Google Fonts at build time is asserted by the fetched branding guidance but not independently confirmed against the live Google Fonts catalog in this pass; the button's own fallback stack (`Roboto, Arial, sans-serif`) is required regardless. | Engineer confirms the exact font resolves at build time before shipping; if it does not, the documented fallback stack already covers the failure mode (never a bare "font not found" default). | A repeat of B11/B14's failure shape (an asset reference that silently doesn't resolve in one environment) is exactly what this phase is trying to close everywhere else; the Google button shouldn't be the one place it's newly introduced. | No — doesn't block architect; a build-time check for engineer. |
| **P1** (carried from v1, unchanged, still open) — The full palette (including this phase's new `.outcome-duplicate` pairing and the reused `.signin-error` amber pairing) is contrast-designed by construction/computed by hand above, but has not been run through an automated contrast-ratio tool in *any* UI stage to date. | Engineer/QA runs an automated WCAG AA contrast audit (axe, Lighthouse, or a contrast tool) against the final rendered palette, including this phase's additions, before treating any of it — v1's or phase 2's — as AA-certified. | Same rationale as v1's original P1: hand-computed contrast is not the same as tool-verified contrast at the exact rendered pixel values (anti-aliasing, sub-pixel rendering, font-weight interactions). | No — doesn't block architect; must close before QA signs off accessibility on this phase. |

---

## Decisions (confirmed)

Recorded via `stage_record_decisions` with `source: "beast-mode-auto"` (batch
call, this session, plus one item appended in revision 1 — see below). All
choices below are the UI agent's own recommended option, self-accepted per
Beast Mode (stage-protocol §10); none crossed the repository boundary except
the design-sync offer, which was declined per the same rule (unchanged from
v1's precedent).

**Count correction (this revision):** the 13 numbered choices below do not
map one-to-one onto `state.json`'s `stages.ui.decisions` array. #12
(imagery) was missing from the durable log and has been appended by this
revision. #4 (the glyph choice within the duplicate-skip treatment) and #6
(the inline-vs-full-page placement within the failure-differentiation
question) were folded into their parent entries (#3 and #4 respectively)
rather than recorded as standalone rows — a real choice was made and is
reflected in each parent entry's `optionChosen` text, just not split into
its own row. `state.json` now holds 11 entries for these 13 documented
choices; that is the accurate count, not a discrepancy to chase further.

1. **7-tile Completion Summary resolved by regrouping into two labeled ledger
   sections (4-tile "Items scanned" + 3-tile "Reported separately"), reusing
   the system's existing 768px breakpoint value** (corrected this revision —
   an earlier draft claimed both of `tokens.css`'s tiers and a mockup that
   used neither; see §3.2), over extending the single row to `repeat(7,1fr)`
   or inventing a new breakpoint — the row extension makes every tile
   narrower at the exact moment labels got longer, and a genuinely new pixel
   value would depart from the system's own established tier values for no
   added benefit.
2. **Reconciliation line's term order changed to match the new tile order**
   (transferred, fallback, already-existed, by-you) rather than keeping the
   UX worked-example's ordering (transferred, fallback, by-you,
   already-existed) — chosen because the wireframe's own stated reason for the
   line's design ("checkable by eye against the tiles above it") only holds if
   the two orders match.
3. **Duplicate-skip visual treatment reuses the existing teal "verified"
   family** (`--teal-700`/`--teal-100`, already used for `.badge-sis` and the
   Action Sheet's "Recommended" stamp) over introducing a new hue — teal's
   existing meaning in this system ("verified," per v1 §2) is a semantic fit
   for "the product verified this already exists," and reusing it keeps the
   palette from growing for its own sake.
4. **`≡` (U+2261) chosen as the duplicate-skip glyph over a geometric-shapes-
   block character** (e.g. `▣`) — better font-coverage reliability across
   IBM Plex Mono and fallback fonts, still legible as "matches/identical to."
5. **Three sign-in failure states (1e/1f/1g) share one visual treatment**,
   differentiated by copy only, over three distinct colors/severities — none
   of the three lost data or is more "broken" than another, so differentiating
   them visually would overstate a difference that doesn't exist.
6. **Sign-in failures render inline on the landing screen, never as a
   full-page takeover** — reinforces "recoverable, not broken" structurally,
   not just in copy, per UX's Next Handoff instruction to weight this heavily.
7. **4a reuses the existing `.error-state`/`.notice-glyph` combination
   verbatim; 4b/4c get a new, heavier `.interrupt-banner` treatment** distinct
   from the existing slim `.rate-banner` — over inventing a third generic
   interrupt pattern, because 4a fully replaces its screen (matching
   `.error-state`'s existing use) while 4b/4c must coexist with a frozen,
   still-visible progress bar (which `.error-state` cannot do).
8. **One new shared component (`Disclosure`, built on native `<details>`/
   `<summary>`) reused for all three expand/collapse surfaces** (duplicate
   list, topic-reuse list, topic detail panel) — over three bespoke
   implementations, and over a JS-managed open/closed state, since native
   semantics give the required keyboard/AT behavior for free.
9. **The Google sign-in button is treated as a bounded, documented exception
   to the token system** (Google's own fixed colors/font/logo, contained to
   two CSS classes) rather than either (a) reskinning it fully into the
   product's own palette (which would violate Google's branding requirements)
   or (b) letting Tailwind back in to render it (explicitly out of contract,
   kickoff-binding).
10. **Regression-guard scope corrected from the diagnosis doc's 5-substring
    pattern to a Tailwind-class-shaped pattern**, based on this stage's own
    broader scan finding `AuthFlow.tsx` as a second, previously-uncaught
    instance — over trusting the diagnosis doc's "only file" claim as-is.
11. **Mockups produced for the three highest-risk new surfaces only** (sign-in
    landing, 7-tile Completion Summary, Ready-to-Transfer disclosure), not a
    full redraw of every changed screen — the remaining new patterns
    (`.signin-error`, `.interrupt-banner`) are each shown once in the mockup
    and reused by reference for their other call sites, since a second
    rendering of an already-shown pattern adds no new information.
12. **Imagery:** none needed — same reasoning as v1, unchanged by this phase's
    scope.
13. **Design-system sync:** declined under the Beast Mode repository-boundary
    override, recorded as MANUAL-VERIFY for a human to take up interactively.

## Assumptions

- **Google's branding guidance fetched live today (`developers.google.com/
  identity/branding-guidelines`, 2026-08-23) is treated as current** — it was
  not cross-checked against an archived/dated snapshot, so a future revision
  to Google's own page could move these specifics; flagged as MANUAL-VERIFY at
  the point each specific value is used (§2).
- **The existing four-color Google "G" logo SVG paths already in
  `SignInLanding.tsx` are assumed to match Google's official asset closely
  enough to reuse** (the four brand hex values are correct) — this doc does
  not byte-diff them against Google's downloadable asset library; engineer
  should pull the official asset directly if strict pixel fidelity matters for
  app verification.
- **`AuthFlow.tsx`'s current `{children}`-based structure is assumed to be
  replaced, not patched** — it doesn't match the props (`onSignedIn`,
  `startAt`, `onError`) `App.tsx` already calls it with, and v1's version
  (`0694779`) used that prop shape with a `stage` state machine this phase's
  new states (warmup/callback-landing/error variants) naturally extend. This
  is noted as architecture/engineering context, not decided here — this doc
  specifies the *states*, not the wiring.
- **The topics-outside-invariant callout (§3.2) is assumed sufficient without
  a third visual grouping mechanism** (e.g., a distinct background tint for
  Group B) — the divider rule + label + plain-text callout were judged
  adequate; if QA/user testing finds teachers still read Group B as part of
  the total, a background-tint escalation is a low-cost follow-up.

## Open questions

- Exact `skippedDuplicate`-equivalent field name and whether the engine
  re-checks duplicates at write time (race-with-co-teacher case, PM §6.3) —
  architect scope, named as a P0 Delta above.
- Whether a third "Skipped — couldn't confirm" filter option (covering
  `provider_error`/`server_interrupted`/`rate_limit_exhausted`) is worth
  adding in a later pass — flagged as P1, not decided here; PM/UX did not
  scope it into this phase.
- Whether Google's branding guidance changes between this doc's writing and
  engineer's build — MANUAL-VERIFY at build time, not resolvable here.
- Whether the existing inline Google "G" SVG paths are pixel-exact to
  Google's current downloadable asset — MANUAL-VERIFY, flagged in Assumptions.

## Next handoff

Architect → reads `01-pm-brief.md`, `02-ux-workflow.md`, and this doc, and
designs the system in `docs/features/real-google-integration/
04-architecture.md`. Two things architect should weight heaviest, both named
as P0 Deltas above:

- **The `TransferJobStatus`/`TransferJobItemRow` contract needs real
  extension, not just new UI markup:** a `skippedDuplicate`-equivalent count
  field separate from `skippedBySystem`, and confirmation that `skipReason`
  (already per-item) is sufficient for the client to drive `OutcomePill`'s new
  `skipReason` prop without a further round-trip.
- **The `AuthFlow.tsx`/`SignInLanding.tsx` rebuild is one unit** (kickoff
  decision, restated): both files carry the same defect class today, both
  need the same token-system re-authoring, and the §7.2c regression guard
  must be scoped to catch both — a guard written only against the
  originally-diagnosed file would ship green with `AuthFlow.tsx` still
  broken.
