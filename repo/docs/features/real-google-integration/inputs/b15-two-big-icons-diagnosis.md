# B15 "two big icons" — REPRODUCED and root-caused

> Reproduced by Beast Mode at run entry, 2026-08-23, before the UI/engineer stages ran.
> The PM brief listed this as unreproduced and mandated reproduce-first. It is now reproduced,
> so that mandate is discharged and the "not reproducible post-restore" exit does not apply.

## Reproduction

1. `npm run build` (client builds clean at `06c3d05`)
2. Serve the production build statically: `npm run preview --workspace=client -- --port 4173`
3. Open `http://localhost:4173`

**Observed:** the sign-in screen renders a single monochrome document icon scaled to
**898 × 898 px**, filling the viewport. `document.body.scrollHeight` is **2135px** on an
800×455 viewport. A second `<svg>` — the Google mark inside the sign-in button — is *also*
898 × 898 px. Two oversized icons, matching the user's report verbatim ("it's got two big icons").

Measured in-page:

```
svgCount: 2
svg[0]  class="w-8 h-8"   viewBox="0 0 24 24"  width/height attrs: none  → 898×898px
        parent class="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex …"
svg[1]  class="w-5 h-5"   viewBox="0 0 24 24"  width/height attrs: none  → 898×898px
        parent class="w-full flex items-center justify-center gap-3 bg-white … rounded-lg shadow-sm …"
```

## Root cause

**`client/src/features/auth/SignInLanding.tsx` is written in Tailwind utility classes, and this
project has no Tailwind.**

Verified:

- ~~It is the **only** file under `client/src` containing Tailwind utilities.~~
  **CORRECTED 2026-08-23 (UI stage) — see the correction section at the end of this file.
  `AuthFlow.tsx` is affected too. The grep that produced the "only file" claim used five
  literal substrings and missed it.**
- Those classes **did not exist before the prior session's edits**:
  `git show 0694779:client/src/features/auth/SignInLanding.tsx | grep -c 'w-8\|w-5\|w-16\|bg-blue-100\|text-slate'` → **0**.
  They arrived in commits `79aaa92` / `3fc22bf` ("Update SignInLanding.tsx").
- Tailwind appears in **no** `package.json`, has **no** config file
  (`tailwind.config.*` / `postcss.config.*` absent), and is **not** in the Vite pipeline.

So every class on that screen resolves to nothing. Two consequences follow mechanically:

1. **The icons.** An inline `<svg>` with a `viewBox` but no `width`/`height` attribute and no
   CSS sizing stretches to fill its containing block. `w-8 h-8` and `w-5 h-5` were the only
   things constraining them, and they are inert — hence 898px.
2. **The buttons.** `bg-white … border border-slate-300 rounded-lg shadow-sm` are equally
   inert, which is precisely the user's other complaint: **"raw unstyled fallback buttons"**.

**One root cause explains both reported frontend defects** — Tailwind markup in a project with no
Tailwind. ~~One file.~~ **CORRECTED: two files.** See the correction section below.

## Why this vindicates the kickoff decision, and what the fix is NOT

The Directions say *"Audit `client/src` to ensure stylesheets (Tailwind/CSS) are imported in
`main.tsx`."* That framing is a red herring produced by a session that could not read the repo:

- `main.tsx` **already** imports the stylesheet correctly (`import './styles/tokens.css'`).
- The stylesheet is **not** Tailwind and never was — it is the v1 design-token system, verified
  at WCAG 2.1 AA with axe-core in real Chromium.

**Do not add Tailwind to fix this.** Adding it would make the broken screen *look* fine while
introducing a second, competing styling system into a codebase with a WCAG-audited one — and
every other screen in the app would still be token-based.

**The fix is to rewrite `SignInLanding.tsx`'s markup in the existing design-token system**, so it
matches the other wizard steps. Reference the v1 version at `0694779` for the correct idiom:

```bash
git show 0694779:client/src/features/auth/SignInLanding.tsx
```

Note the v1 file may not have had a Google sign-in button at all (v1 used mock accounts), so this
is a re-authoring against the token system, not a straight revert — the real-OAuth button is new
and legitimately needed.

## Guard to add

A regression test or lint rule asserting **no Tailwind utility classes appear under `client/src`**
would have caught this at the commit that introduced it, and would catch the next one. Recommend
the engineer stage add it — this codebase has a `test/quality/` convention for exactly this kind
of budget.

**Write the guard against a Tailwind-class-SHAPED pattern, not against the literal substrings in
this document.** That distinction is not pedantry — the five-substring grep used to write this
file is exactly what caused it to miss `AuthFlow.tsx`, and a guard built on the same list would
ship green with a broken file still in the tree. Match the *shape* of Tailwind utilities
(`min-h-*`, `bg-<color>-<weight>`, `text-<color>-<weight>`, `w-<n>`, `h-<n>`, `flex`,
`items-*`, `justify-*`, `font-<weight>`, `rounded-*`, `shadow-*`, `gap-*`, `p[xytblr]?-<n>`,
`m[xytblr]?-<n>`, …) and assert zero matches across `client/src`.

## Diagnosis record

- **hypothesis:** Tailwind classes in a project with no Tailwind leave the SVGs unconstrained.
- **observed:** 2 SVGs at 898×898px; both carry only Tailwind sizing classes; no width/height attrs.
- **ruledOut:** broken asset paths (the SVGs are inline, not fetched); missing stylesheet import
  (`main.tsx` imports `tokens.css`, and the CSS bundle builds to 14.83 kB and loads); a Render-specific
  base-URL problem (reproduces on a local static server with no base path).
- **narrowestRepro:** serve `client/dist` statically and load `/`; the sign-in landing is the first
  and only screen needed.


---

# CORRECTION — the "only file" claim was wrong (2026-08-23, found by the UI stage)

The Root cause section above originally asserted `SignInLanding.tsx` was the **only** file under
`client/src` carrying Tailwind utilities. **That is incorrect.** The UI stage ran a broader,
class-shaped scan and found a second affected file. Verified independently:

**`client/src/features/auth/AuthFlow.tsx` lines 34–35:**

```tsx
<div className="min-h-screen bg-slate-50 flex items-center justify-center">
  <div className="text-slate-500 font-medium">Loading Classroom Copier...</div>
```

Every one of those classes is inert. This is the **app's loading state** — so the "Loading
Classroom Copier…" screen renders as unstyled text on a default-white page with no centering,
which is very likely part of what the user saw and described as the frontend looking "jacked up".

Confirmed the same way as the original finding:

- `git show 0694779:client/src/features/auth/AuthFlow.tsx | grep -c 'min-h-screen\|bg-slate-50\|text-slate-500\|font-medium'` → **0**.
  These classes did **not** exist before the prior session's edits; they arrived in commit
  `995a5a6` ("Update AuthFlow.tsx").
- The original diagnosis's grep pattern
  (`w-16|bg-blue-100|text-slate-700|rounded-lg|shadow-sm`) returns **0** against `AuthFlow.tsx` —
  it missed the file entirely because `AuthFlow` happens to use a different set of utilities.

## Why the original grep missed it, and the lesson

The pattern was built from the classes actually observed in `SignInLanding.tsx`, then used to
answer the *different* question "which files are affected?". A pattern derived from one instance
cannot enumerate a population. The correct scan is class-**shaped**, not class-**literal**.

## What changes

- **Scope: two files, not one.** `SignInLanding.tsx` (re-authored per UI §3.1) **and**
  `AuthFlow.tsx` (loading state must be re-authored in the token system).
- **The guard must be shape-based** (see the strengthened Guard section above). A guard written
  from this document's original substrings would pass while `AuthFlow.tsx` stayed broken — the
  precise failure this correction exists to prevent.
- **The engineer must re-scan `client/src` themselves** with a shape-based pattern before
  declaring the defect closed. Do not treat either this file's original list *or* this correction
  as a complete enumeration; a third file may exist that neither scan happened to match.
