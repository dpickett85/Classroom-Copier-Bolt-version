# 06 — QA Report

**Feature:** real-google-integration
**Branch:** `phase2/real-google-integration` @ `d7203b5` (source read-only; no fixes applied here)
**Mode:** Feature jump-in (Mode C), Beast Mode
**QA method:** Read every upstream artifact (`01`–`05`, `state.json`, `backlog.md`, `wireframes/`, `mockups/`); verified backend claims by reading the actual source and running targeted tests (not by trusting the docs that describe them); drove the **real, statically-served production build** in a real Chromium browser (`spec-fidelity`) against a locally running server (mock-mode backend, mock accounts minted directly via the server's own mock-auth endpoints — the client-side picker is deleted, so this was the only way to reach signed-in screens without live Google credentials).

**Orchestrator-verified baseline, taken as given:** `npm test` 603/603, `npm run build` exit 0, `npm run lint` exit 0, at `d7203b5`. This report does not re-litigate that baseline; it asks whether green means the product does what was specified.

```
QA verification complete (plan 8/8 checks)
   • Acceptance criteria review — pass
   • Functional verification — FAIL (2 blockers, 2 majors)
   • Build & tests — pass (spot-verified; baseline trusted)
   • Design & architecture conformance — pass with issues
   • Deltas verification — pass with issues
   • Non-functional checks — pass (measured)
   • Regression & side-effects — pass (not independently re-run beyond baseline; no evidence of regression)
   • Documentation accuracy — pass with issues

Verdict: FAIL (back to engineer)
```

---

## 1. Headline

Two **blockers**, found by reproducing behavior live rather than trusting what the docs and prior tests claimed — the exact failure mode this project's own `project-profile.md` "Lessons learned" section already warns about, twice more:

1. **The production boot does NOT refuse to start with `GOOGLE_PROVIDER_MODE` mock/unset.** PM brief §7.1a (a binding, numbered acceptance criterion), `04-architecture.md` §8.3, and `05-implementation.md`'s own headline claim ("Production boot fail-fasts on `GOOGLE_PROVIDER_MODE`") all assert this exists. It does not. Reproduced live: booting `server/dist` with `NODE_ENV=production` and `GOOGLE_PROVIDER_MODE` unset boots cleanly and serves the mock fixture world (`"providerMode":"mock"` in the boot log, `/api/health` returns 200). This is item #3 of this QA assignment — the single most important non-dedupe requirement of the phase — and it is not shipped.
2. **The Selection screen and Ready-to-Transfer screen still show v1's stale, now-false duplicate-risk warning**, not the reassurance copy UX Decision 11 and Acceptance Scenario 16 require. Confirmed live and in source: every teacher who reaches Source & Target Selection is told *"Classroom Copier does not check for existing copies yet"* — the literal opposite of what this entire phase built and fixed.

Both were caught only by reading the actual rendered banner text / actual boot behavior, not by reading the docs that describe them. Both have existing tests that assert the **wrong** thing (a stale string, an untested branch) and pass green regardless.

Everything else checked out strong. The two P0 engine bugs (re-entrancy, day-one dedupe no-op) are genuinely fixed and well-evidenced. The provider-selection fix (E1) holds under direct, live reproduction. The real OAuth redirect flow, PKCE, and all three sign-in failure states work correctly in a real browser. The 7-tile Completion Summary, the duplicate-vs-user-skip pill, the fixed sign-in icon/button, and the reconciliation invariant are all faithfully built.

---

## 2. Acceptance criteria (derived)

Primary source: `02-ux-workflow.md`'s 16 Phase-2 Acceptance Scenarios (v1's 18 scenarios are Keep and covered by the orchestrator's baseline, not re-derived here) plus PM brief §5's automated bar (items 1–6) and §7's production/frontend acceptance criteria. Architecture NFR targets folded in via `project-profile.md`'s Quality budgets table.

---

## 3. Functional verification (UX behavioral)

### 3.1 Duplicate prevention — mechanics: **PASS**

- `courseWorkStates`/`courseWorkMaterialStates` are passed explicitly as `['DRAFT','PUBLISHED']` on **both** destination reads (`post-enumerator.ts:30-38`, used by `enumerateDestination()`, called from `preflight-engine.ts:133`). The real Google client's own default is confirmed `PUBLISHED`-only when the param is omitted (`real-classroom-provider.ts:436,491`) — so the risk PM §6.1 flagged is real, and it's closed. Mutation-verified: forcing the destination read back to PUBLISHED-only turns 4 F15 tests red (05-implementation.md §4, reproduced by description, not independently re-mutated here).
- Title normalization (`shared/src/normalize.ts`): NFC → collapse whitespace → trim → lowercase, exactly as specified, no fuzzy/punctuation logic. `normalize.test.ts` covers the pure-function cases (whitespace, NFC, near-miss "Unit 1"/"Unit 11", locale-independent casing); the state/surface cases (draft match, published match, cross-surface non-match) live in `preflight-engine.test.ts` against the F15 fixture instead — the behaviors are all genuinely covered, just split across two files rather than the one the implementation doc implies.
- Duplicate skip precedence over attachment health (PM §6.3): confirmed **live** — driving the F15 fixture pair through the real wizard produced exactly one Action Sheet item (the non-duplicate control with a trashed attachment); the combined duplicate+trashed-attachment case did not appear in the modal, as required.
- Reconciliation invariant holds across the `duplicate_title` branch: verified in code (`reconciliation.ts:104-129`, three-way skip split checks `isDuplicateSkip` first) and in a real transfer I drove end-to-end (7 scanned = 2 transferred + 1 fallback + 4 duplicate-skipped + 0 user-skipped; UI reconciliation line matched exactly).
- Topic dedupe: lookup-before-create by normalized name (`preflight-engine.ts:174-192`, `transfer-engine.ts:940-979`), reused topics never re-created, `topicsCreated`/`topicsReused` reported as a structurally separate ledger section, confirmed both in code and live in the browser (Completion Summary: "1 created + 3 reused = 4 topics referenced").

### 3.2 Real Google OAuth / mock unreachability: **PASS WITH ONE BLOCKER**

- The critical wiring defect the security review caught (`RealClassroomProvider` never selected in production) **is fixed and holds.** `app.ts`'s `createClassroomProvider()` selects `GoogleClassroomProvider` in google mode; a boot-time guard refuses to start if google mode resolves to anything else; `composition-root.test.ts` asserts provider **identity** (not just a smoke pass) in both modes plus the guard's refusal (5/5 tests, independently re-run here, pass).
- Mock routes are genuinely unregistered in google mode: `/api/auth/mock-accounts` and `/api/auth/sign-in` both return the standard 404 envelope under an integration test that hits real HTTP routes (`google-oauth.integration.test.ts:297-320`), and the production client bundle greps clean — `grep -c mock-accounts client/dist/assets/*.js` → 0. Confirmed independently.
- Real OAuth flow confirmed live: clicking "Sign in with Google" fires an API call for the auth URL (cold-start-coverable, per Delta P0-1) then does a genuine full-page navigation to `accounts.google.com`, carrying PKCE (`code_challenge`/`code_verifier`, addressing backlog S1) and state. All three failure states render distinct, correct copy: consent-denied ("You didn't grant access, so we couldn't sign you in. Nothing was changed."), expired-link ("This sign-in link has expired."), rendered inline below the button, never a dead end.
- **BLOCKER — production boot does not fail-fast on mock/unset mode.** See §1. `server/src/config.ts`'s `googleProviderMode` computation has no `isProductionLike` gate anywhere in the file; `app.ts`'s only provider guard fires solely when mode is explicitly `'google'` but resolves to the wrong class — it is silent when mode is `'mock'` or unset under `NODE_ENV=production`. Reproduced live (see evidence below). PM brief §7.1a is an explicit, numbered, binding acceptance criterion; `04-architecture.md` §8.3 and `05-implementation.md` both assert this exists. It does not.

  **Evidence (live reproduction):**
  ```
  $ SESSION_SECRET=... DATABASE_URL=... NODE_ENV=production PORT=4099 \
    node dist/src/index.js
  [INFO] {"...","message":"classroom-copier api listening","port":4099,"providerMode":"mock",...}
  $ curl http://localhost:4099/api/health
  {"status":"ok","uptimeMs":1206}
  ```
  No `GOOGLE_PROVIDER_MODE` was set. A real Render deploy that simply omits the variable (a very plausible failure mode — this project's own bug inventory is full of exactly this class of miss) boots cleanly and silently serves fixture data to a real, signed-in teacher.

### 3.3 UX acceptance scenarios / OAuth failure paths: **PASS WITH ONE BLOCKER, ONE MAJOR**

All sign-in failure states (Scenarios 2, 3) checked live: distinct, blame-free copy, inline (never full-page takeover), the Google button itself serves as retry, `role="alert"` correctly used (not `role="status"`). No path left me with no explanation and no next action — the "no usable message" complaint from the prior session is genuinely closed for the sign-in surface.

Session-expiry mid-wizard/mid-transfer and Google-token-failure mid-transfer (Scenarios 7–9) were **not** drivable in this pass — they require either a live 401 mid-flow or Google-token expiry, neither reachable via the mock-account shortcut I used to get past the missing client-side picker; the engine-level unit budgets cover the mechanism (per `05-implementation.md` §2 module 7) but, as UX's own Delta flags and the architect's backlog entry confirms, these three states remain **fixture-uncovered at the UI/E2E level** — correctly disclosed as still-open, not silently assumed complete.

- **BLOCKER — Acceptance Scenario 16 fails.** "The Selection screen's duplicate-run notice flips from warning to reassurance copy" (UX Decision 11) is not implemented. `NarrationBanner.tsx`'s `DUPLICATE_RUN_NOTICE` constant is still v1's verbatim warning ("Running the same copy more than once creates duplicate drafts — Classroom Copier does not check for existing copies yet.") and is rendered, unchanged, on **both** `SelectionScreen.tsx` and `ReadyToTransfer.tsx`. Confirmed live (screenshot + `get_page_text` on both screens) and in source. `selection.test.tsx` (citing "Scenario 6" — a v1 scenario number, not this phase's Scenario 16) and `preflight.test.tsx` both assert this stale text is present and correct — the tests actively pin the wrong behavior rather than being merely silent about it.
- **MAJOR — Acceptance Scenarios 10 and 13 partially fail.** Ready to Transfer's headline reads `Ready to copy {scan.totalPostsScanned} posts` (`ReadyToTransfer.tsx:66`) — the **full** scanned count, not the "X of Y" count excluding duplicates the UX doc (§1 step 6), the wireframe (`wireframes/02-…md:71,140`, "Ready to copy 37 of 42 posts"), and Scenarios 10/13 explicitly specify. The duplicate exclusion is disclosed in a separate sentence below ("4 of 7 items are already in the destination course and will be skipped"), so no information is actually lost to the teacher, but the literal, wireframed acceptance criterion is unmet — confirmed live (headline read "Ready to copy 7 posts" against a 4-duplicate/7-scanned fixture) and pinned by a test (`preflight.test.tsx:365-366`, asserts the un-excluded wording). The all-duplicate re-run case (Scenario 13, "0 of Y posts") has no dedicated test either — only the unrelated v1 "0 posts scanned" (D26) case is covered.

---

## 4. Build & tests

Baseline trusted as stated by the orchestrator (603/603, build clean, lint clean). Spot-verified independently in this pass, all consistent with the implementation doc's claims:

| Check | Result |
|---|---|
| `npm run -w shared build`, `-w server build`, `-w client build` | clean, bundle 304.63 kB / 92.77 kB gzip — matches `05-implementation.md` exactly |
| `client/dist` grep for `mock-accounts` | 0 matches |
| `server/test/composition-root.test.ts` (re-run) | 5/5 pass — **does not cover** the production-mock-boot gap (§3.2) |
| `test/quality/dedupe.budget.test.ts` (re-run) | 2/2 pass |
| `client test:budget:a11y` (re-run) | 46/46 pass |

No regressions found; not exhaustively re-run beyond the above spot checks (full suite already covered by the orchestrator's baseline).

---

## 5. Design & architecture conformance (UI visual — spec-fidelity)

Driven in a **real Chromium browser** against `vite build` + `vite preview` (the statically-served production build, as Render serves it), with a locally running server. This is the "reproduce-first" check the two known frontend defects (898px icons, unstyled buttons) required — done, not assumed.

### 5.1 The two known frontend defects — both **CLOSED, confirmed fixed**

- **No 898×898px icons.** Measured via DOM: the Google "G" SVG renders at `18×18px` with explicit `width`/`height` attributes (`attrW:"18", attrH:"18"`), not just a `viewBox`. Screenshot confirms visually small, correctly proportioned icon.
- **No raw unstyled fallback buttons.** Measured via computed style: `background:#FFFFFF`, `border:1px solid #747775`, `min-height:44px`, `font-family:Roboto,...` — properly styled, not user-agent default. Matches Google's Light-theme branding spec exactly.

### 5.2 7-tile Completion Summary layout: **PASS**

Confirmed live: Group A ("Items scanned" — Drafts transferred, Fallback shells, Skipped already existed, Skipped by you, 4-col grid) visually separated by a divider + label from Group B ("Reported separately" — Topics created, Topics reused, Rubric notes added, 3-col grid), exactly per `03-ui-direction.md` §3.2. The topics callout text and the dynamic reconciliation line (4-term when `skippedBySystem === 0`) both render verbatim as specified and were arithmetically correct against the live fixture (2+1+4+0=7 of 7).

### 5.3 Duplicate-vs-user-skip distinction: **PASS**

`outcome-duplicate` pill measured live: `color: rgb(15,92,86)` / `background: rgb(220,238,235)` / `border: rgb(15,92,86)` — exact match for the spec's `--teal-700`/`--teal-100` pairing, text "Already in course", visually and textually distinct from "Transferred" (green) and "Fallback" (amber). Filter dropdown confirmed to carry the 5 specified options (All / Transferred / Fallback / Already in course / Skipped by you). CSV export (`buildLogCsv`) confirmed in source to call the same `outcomeText()` label function as the on-screen column — one implementation, not three.

One note, not a defect: the `≡`/`⊘` glyph pairing lives only in `OutcomeIcon` (used by the mid-transfer live ticker), not in `OutcomePill` (used by the Completion Summary's itemized log, filter, and CSV) — `OutcomePill` is text+colour only, which is v1's existing, unchanged pattern for that surface and independently satisfies the "never colour alone" rule via distinct text. Judged **not a defect** — the spec's glyph row is satisfied by the component that actually carries a glyph.

### 5.4 Deviations found, undocumented in `05-implementation.md` §5

- **MINOR — Google sign-in button border-radius.** `03-ui-direction.md` §2 makes an explicit, reasoned **Decision**: use the system's own `var(--radius)` (3px), not a pill, specifically because "the button otherwise looks like an orphan." The shipped CSS (`tokens.css:132`) is `border-radius:20px` — a pill, one of Google's two other approved presets, but not the one the spec decided on. Functionally harmless (pill is Google-compliant), but it contradicts an explicit binding design decision and is not listed among `05-implementation.md`'s "Deliberate deviations from the spec."
- **MAJOR — focus management on new screens is not implemented.** UI direction §6 states plainly: "Focus management, new screens: 1d/1e/1f/1g and 4a/4b/4c all move focus to their heading/banner on mount... restated here as a UI-testable acceptance point." Confirmed live: after landing on the consent-denied error state, `document.activeElement` is `<body>`, not the error banner. Confirmed in source: neither `SignInLanding.tsx` nor `TransferProgress.tsx` contains a `.focus()` call or a ref used for focus-on-mount anywhere. Confirmed untested: zero occurrences of `focus`/`activeElement` in `auth.test.tsx` or `transfer.test.tsx`. Partially mitigated — `role="alert"` (correctly present) does auto-announce to screen readers without requiring focus — but the explicit, named acceptance point is unmet across every one of the six screens it names, not implemented, and not tested anywhere.

---

## 6. Deltas verification

| Delta | Status |
|---|---|
| UX P0-1 (cold-start/redirect interleave) | **Addressed.** Confirmed live: click on "Sign in with Google" fires the auth-URL API call (cold-start-coverable) before navigating; the callback redirects to the frontend origin, not a backend-rendered page. |
| UX P0-2 (Google token-refresh failure mid-transfer) | Addressed at the engine level (pause/resume mechanism, `AuthExpiredError` handling); **not** independently drivable/verified at the UI level in this pass (no live token-expiry scenario reachable without real Google) — consistent with the architect's own backlog entry flagging this fixture-uncovered at the UI/E2E tier. Not re-flagged as a new finding; already honestly disclosed. |
| UX P0-3 (duplicate/user-skip distinguishability) | **Addressed and verified** — §5.3 above. |
| UI P0 (`skippedDuplicate` field) | **Addressed** — confirmed live, tile renders correctly bound to the server-computed count. |
| UI P0 (`OutcomePill`/`OutcomeIcon` `skipReason` prop) | **Addressed and verified.** |
| UI P0 (regression-guard scope, `AuthFlow.tsx` included) | **Addressed** — `test:budget:no-tailwind` passes 2/2; dist greps clean of Tailwind-shaped classes across both files per `05-implementation.md`'s red-first evidence (not independently re-mutated here). |

No unaddressed `Prerequisite? Yes` Delta rows found.

---

## 7. Non-functional checks (measured)

Spot-measured directly (not read from the doc): `test:budget:dedupe` 2/2, `test:budget:a11y` 46/46, `composition-root.test.ts` 5/5 — all consistent with `05-implementation.md`'s claimed 17/17 budgets green. Not every budget row was independently re-run in this pass; the ones re-run matched claims exactly.

**Accessibility — MANUAL-VERIFY items closed this pass:**

- **axe contrast/layout in a real browser: CLOSED.** Ran axe-core (the project's own devDependency) directly in Chromium against the statically-served production build across four states: sign-in landing (0 violations / 8 passes), consent-denied error state (not separately re-run with axe, covered by structural checks), expired-link error state (0 violations / 11 passes), Completion Summary with a live duplicate-and-topic transfer rendered (0 violations / 23 passes), all scoped to WCAG 2A/2AA rule tags.
- **`≡` (U+2261) glyph rendering in IBM Plex Mono: CLOSED.** Injected the glyph pairing (`≡` vs `⊘`) styled with the app's actual `--font-mono` stack into the live page and visually confirmed both render distinctly and correctly (no tofu/missing-glyph boxes, no fallback substitution needed).
- **Native `<details>` Enter/Space keyboard toggling: ATTEMPTED, still genuinely unverifiable in this session.** Real mouse click (both a dispatched `computer` click and a programmatic `.click()`) correctly toggles the app's `Disclosure` component. A dispatched `Return`/`space` keypress via this session's browser-automation tool did **not** toggle it. To rule out a product defect before flagging one, I ran a control test: a bare, appless native `<details><summary>` element injected into the same page (zero React, zero event handlers) **also** failed to toggle on a dispatched Enter/Space via this tool, while responding correctly to a real click. This isolates the gap to this session's key-event dispatch mechanism, not the product's `Disclosure` component — genuinely still owed a human-hands verification pass, not closed, but not evidence of a defect either.
- **Live end-to-end OAuth round trip: correctly remains open.** No real Google credential was used anywhere in this pass, per the assignment's explicit instruction not to seek any. `docs/handoff/connecting-to-live-google.md` Part 4 remains unrun. This is the honest headline limit of this entire QA pass, not something QA can close.

---

## 8. F12 — many-to-one duplicate matching (backlog assessment)

Confirmed real, confirmed not silently resolved. `preflight-engine.ts`'s destination match map is keyed by normalized title with first-writer-wins semantics and is never decremented/consumed per match — so two source posts sharing a normalized title both resolve against the same single destination post and are **both** marked `duplicate_title`, meaning the second is never created. Confirmed not seeded in F15 (its 4 duplicate titles are all distinct) and not asserted anywhere in the test suite.

**On honesty of the reporting:** the item reconciliation invariant still balances correctly under this behavior — both source items get their own `TransferJobItem` row and both are counted as `skipped/duplicate_title`, so nothing vanishes from the ledger's arithmetic. What's actually lost is *content*, not *count*: the second post is never written to Classroom, and neither the pre-flight disclosure nor the Completion Summary's log distinguishes "this exact post already exists" from "a post with this title already exists, possibly a different one." `backlog.md`'s "Engineer DEFER findings" entry states this plainly, lays out both resolution options (keep many-to-one vs. one-to-one matching) with their honest trade-offs, and defers the choice to PM rather than silently picking one. **This is the correct handling of an open product question** — assessed, disclosed, and deferred rather than papered over. Not a QA-blocking defect; correctly still open.

---

## 9. Regression & side-effects

Not independently re-audited beyond the orchestrator's baseline (603/603) and the spot-checks in §4. No evidence of regression found in anything driven live in this pass (v1-Keep screens — Selection, Action Sheet, Batch Transfer progress bar mechanics — all behaved as expected during the live walkthrough).

---

## 10. Documentation accuracy

- **`04-architecture.md` §8.3 and `05-implementation.md`'s "Production boot fail-fasts on `GOOGLE_PROVIDER_MODE`" claim is false as shipped** — see §1/§3.2. This is the artifact-vs-code divergence the QA method exists to catch; flagging here per the "stale artifacts are a defect in the lifecycle" rule.
- **`backlog.md`'s "Open (18)" list is stale.** Of the 9 security-architect findings (S1–S9) listed as open, **8 are already addressed** in `04-architecture.md` revision 2 and confirmed live in the shipped code: S1 (PKCE — confirmed live, `createPkcePair`/`code_challenge` in the real redirect I drove), S2 (`FRONTEND_ORIGIN`/`CORS_ORIGINS[0]`, never request-derived — confirmed in `config.ts:100`), S3 (`openssl rand -base64 32` generation guidance — confirmed in `.env.example` and the handoff checklist), S4 (`decryptToken` raises `AuthExpiredError` on a rotated/corrupt key — confirmed in `oauth-client.ts:176`, code comment cites "S4"), S6 (no-log rule — confirmed stated in `04-architecture.md`, code comment cites "S6"), S7 (`cc_oauth_state` cookie `httpOnly`/`sameSite`/`secure:isProductionLike` — confirmed in `auth.ts:56-64`, code comment cites "S7"), S9 (drive.metadata exposure sentence — confirmed present in `04-architecture.md`). Only S5's residual (job/scan half of cross-account isolation) is genuinely still open, and it is *also* correctly tracked separately as "E2 residual" in the newer backlog section. The stale S1–S9 listing under "Open (18)" inflates the apparent backlog size and could mislead a future session that trusts the count without checking the code — flagged as a **minor** documentation-hygiene finding, not a functional defect.
- **User Manual** (`docs/USER_MANUAL.md`): not reviewed in this pass for phase-2 accuracy (out of this feature-mode track's scope; the manual is a whole-product document). No changes recommended from this QA pass — flag for QC/human judgment on whether phase-2 changes should be reflected there before ship.

---

## 11. Findings summary

| ID | Severity | Summary | Where |
|---|---|---|---|
| QA-1 | **blocker** | Production boot does not refuse `GOOGLE_PROVIDER_MODE=mock`/unset under `NODE_ENV=production` — reproduced live, contradicts PM §7.1a, 04 §8.3, 05's own claim | `server/src/config.ts`, `server/src/app.ts` |
| QA-2 | **blocker** | Selection screen and Ready-to-Transfer still show v1's stale, now-false "does not check for existing copies" warning instead of the required reassurance copy (UX Decision 11 / Acceptance Scenario 16) | `client/src/components/shared/NarrationBanner.tsx`, `SelectionScreen.tsx`, `ReadyToTransfer.tsx` |
| QA-3 | major | Ready-to-Transfer headline shows the full scanned count, not "X of Y" excluding duplicates (Acceptance Scenarios 10, 13; wireframe) | `client/src/features/preflight/ReadyToTransfer.tsx:66` |
| QA-4 | major | Focus management on mount not implemented for any of the six new screens named in UI §6 (1d/1e/1f/1g, 4a/4b/4c) | `SignInLanding.tsx`, `TransferProgress.tsx` |
| QA-5 | minor | Google sign-in button uses 20px pill radius, not the UI direction's explicitly decided 3px `--radius`; undocumented deviation | `client/src/styles/tokens.css:132` |
| QA-6 | minor | `backlog.md`'s "Open (18)" list carries 8 already-resolved security-architect findings (S1,S2,S3,S4,S6,S7,S9) | `docs/features/real-google-integration/backlog.md` |

---

## 12. MANUAL-VERIFY status (final)

| Item | Status |
|---|---|
| Live end-to-end OAuth round trip | **Still open** — correctly so; QA has no credentials and sought none |
| axe contrast/layout under jsdom | **Closed** — real-Chromium axe pass, 0 violations across 4 states |
| `≡` glyph rendering in IBM Plex Mono | **Closed** — visually confirmed distinct and correct |
| Native `<details>` Enter/Space toggling | **Attempted, still open** — isolated to a tooling limitation in this session's key-dispatch (control-tested against a bare native element), not evidence of a product defect; genuine human-hands verification still owed |
| `docs/handoff/connecting-to-live-google.md` Part 4 | **Still open** — unrun, as expected |

---

## Recommendation

**Back to the engineer** to fix QA-1 and QA-2 (both blockers, both small, targeted fixes — a missing config-time guard and a stale string constant), then re-verify. QA-3 and QA-4 should be fixed in the same pass if practical; QA-5 and QA-6 are low-cost cleanups. Once fixed, the second-most-valuable next step remains what `05-implementation.md` §7 already named: a human running the live-OAuth checklist end to end, especially Part 4.2 (copy once, copy again, confirm zero duplicates against a real Google Classroom) — nothing in this pass or the engineer's own work has exercised that path.

---

# Cycle 2 — Re-verification (2026-08-26)

**Branch:** `phase2/real-google-integration` @ `ef5a2d7`. Read-only on source —
no fixes applied in this pass. **Entry mode:** revise, targeted re-verification
of `05-implementation.md` §9's four fixes, not a fresh full pass.

**Method, this cycle:** rebuilt (`npm run build`), re-ran the whole suite and
lint independently, then booted the real server in mock mode (`npm run
-w server dev`, `npm run -w client dev`) and drove the live app in a real
Chromium browser via the `spec-fidelity` method — signed in through the
server's own mock-auth endpoints (client picker is gone), drove the exact F15
fixture pair cycle-1 used, and measured `document.activeElement`, computed
CSS, and network responses directly rather than reading source and inferring.
Also independently reproduced cycle-1's QA-1 boot evidence (not required by
the assignment — QA-1 was declared closed — but cheap and worth the 60
seconds of corroboration) and ran an independent sweep for a further stale
claim beyond the four the engineer's own sweep found.

**One environment hazard worth recording, not a product defect:** the first
attempt at driving the app hit a **stale server process left listening on
port 4000 from an earlier session** (PID 49353, using a differently-named
`qa-dev.db` with ~19 old transfer jobs from 2026-08-14), which silently
absorbed the dev-proxy's API traffic ahead of the freshly-seeded server this
session started. It produced a confusing false alarm (an F15 scan reporting
"0 of 7, all duplicate" against titles that don't exist in the static
fixture) before being traced to the stale process and killed. Recorded here
so a future QA session recognizes the symptom immediately: if a fixture scan
disagrees with a direct Prisma read of the same database file, check `lsof
-iTCP -sTCP:LISTEN -P | grep <port>` before suspecting the product.

```
QA Cycle 2 verification complete (targeted re-verification, 5/5 checks)
   • QA-1/QA-2/QA-3/QA-4 re-verification — pass (all four independently reproduced closed, live)
   • Adjacent regression check (a11y/focus/copy) — pass (measured, no regressions)
   • Stale-claim sweep (ninth-instance search) — pass with issues (one new, well-evidenced finding: QA-7)
   • Handoff doc followability review — pass with issues (one minor gap)
   • Playwright E2E suite assessment — not-run as a fix (assessment only, per assignment scope)

Verdict: PASS WITH FINDINGS
```

## C2.1 — QA-1 (blocker): closed, lightly re-corroborated

Not required by the assignment (declared closed by the orchestrator's own
live reproduction) but reproduced anyway since it took under a minute:
rebuilt `server/dist`, booted it under `NODE_ENV=production` with
`GOOGLE_PROVIDER_MODE` unset, `=mock`, and `=googl` (typo) — all three exit
non-zero with the three distinct messages `05-implementation.md` §9
describes; `=google` (with the four required companion vars) boots. Holds.
Not re-litigated further.

## C2.2 — QA-2 (blocker): CLOSED, verified live

Signed in as a mock account, selected the F15 source/target pair, landed on
Source & Target Selection. The banner reads exactly the claimed copy —
*"Classroom Copier checks for items that already exist and skips them — safe
to run more than once. Matches are found by title, so content changes since
the last run aren't detected."* — with the `(i)` glyph, not `!`. Measured the
computed style directly rather than trusting the class name:

```
background-color: rgb(220, 238, 235)   /* --teal-100 */
color:            rgb(15, 92, 86)      /* --teal-700 */
```

Exact match for the pairing `OutcomePill`'s "Already in course" state already
uses (confirmed side by side later in the same session — see C2.encoding
below). Same banner, same copy, confirmed again on Ready to Transfer. Source
confirms three call sites as claimed: `SelectionScreen.tsx:150`,
`ReadyToTransfer.tsx:123`, and `shared.a11y.test.tsx`'s render. **v1's stale
warning is gone from every screen a teacher can reach.**

## C2.3 — QA-3 (major): CLOSED, verified live

Drove the real F15 fixture pair end to end (not just read the test). Pre-flight
scan against the correctly-seeded fixture (see the port-collision note above —
this is the result *after* that was resolved and independently confirmed
against a direct Prisma read of `course-f15-target`'s 6 rows):

```
Ready to copy 3 of 7 posts from "Geometry (2025) — re-run source" into
"Geometry — Period 6 (2026)."
4 of 7 items are already in the destination course and will be skipped.
```

The four skipped titles matched exactly (Angle Pairs Practice, Proof Writing
Quiz, Triangle Congruence Notes, Circle Theorems Packet) — the correct four,
not the near-miss ("Unit 11") or the cross-surface non-match ("Lab Notes"
material vs. courseWork). Ran the transfer through to completion: Completion
Summary tiles read **2 transferred / 1 fallback / 4 skipped-duplicate / 0
skipped-by-you**, reconciliation line `2 + 1 + 4 + 0 = 7 of 7`. The headline
correctly leads with the copyable count, never the raw scanned count. The
Scenario 13 all-duplicate case was **not** independently driven live this
cycle either (same reason §9 gives — the F15 fixture isn't seeded for it);
this stays consistent with the engineer's own disclosure, not newly closed.

## C2.4 — QA-4 (major): CLOSED, verified live, including the negative case

Navigated to `?authError=denied` (the consent-denied path). Measured
`document.activeElement` directly:

```json
{"tag":"DIV","cls":"signin-error","role":"alert","text":"You didn't grant access..."}
```

Not `<body>`. Then navigated to the plain landing screen (no error) and
re-measured: `document.activeElement` is `<body>` there — **the negative case
holds behaviorally, not just in a unit test**: a clean landing does not steal
focus. This is exactly the failure mode the assignment asked to check for
("focus changes can steal focus at the wrong moment") and it does not
reproduce. 4b/4c (mid-transfer interrupt, poll-tick-does-not-re-steal) and the
1e/1f/1g pairing beyond `denied` were not independently re-driven live this
cycle (mid-transfer 401/token-expiry isn't reachable via the mock-account
shortcut, same limit §9 already discloses) — unit-tested only, consistent
with the engineer's own MANUAL-VERIFY entry, not newly closed.

## C2.5 — Adjacent regression check

Independently reproduced, not read off the doc:

| Check | Result |
|---|---|
| `npm test` | shared 26/26, server 333/333, client 268/268 — **627/627** |
| `npm run build` | exit 0, bundle 305.75 kB / 93.09 kB gzip |
| `npm run lint` | exit 0 |
| `npm run check:citations` | zero unresolved |
| `test:budget:a11y` | **47/47** (the new `teal-700`/`teal-100` pairing did not regress contrast) |
| `test:budget:dedupe` | 2/2 |
| `test:budget:no-tailwind` | 2/2 |
| `client/dist` grep `mock-accounts` | 0 matches |
| `composition-root.test.ts` + `config.test.ts` | 14/14 |
| `composition-root.test.ts` in isolation, ×3 | 8/8 each run — consistent with the engineer's "isolated re-run passes" claim for the filed D12 flake |
| QA-5 (pill radius) | still **20px**, unfixed — correctly still open, correctly still minor |

No regression found anywhere driven live or re-run. The copy-change and
focus-change fixes did not steal focus at the wrong moment and did not break
the teal-pairing contrast budget — both of the assignment's specific "did the
fix break something adjacent" concerns check out clean.

## C2.6 — Stale-claim sweep: the four engineer-found instances, corroborated, plus a ninth

Independently swept `client/src`, `server/src`, `shared/src` for
`yet|does(n't| not) (check|support|detect)|simulated|for now|not implemented|
TODO|FIXME|placeholder` and cross-checked every `Scenario N` code citation
(30+ call sites) against both `02-ux-workflow.md`'s Phase-2 list (1–16) *and*
`docs/product/02-ux-workflow.md`'s v1 list (1–18), since the codebase cites
both without a document qualifier. All v1-era test citations (Scenario 7, 9,
17, 18 in `transfer.test.tsx`/`selection.test.tsx`) resolve correctly against
v1's own numbering (confirmed line-by-line against `docs/product/
02-ux-workflow.md`'s Acceptance scenarios) — not stale, just ambiguous
shorthand shared across two independently-numbered documents. Worth a
one-line doc-qualifier convention going forward, but nothing here is
factually false, so not filed as a finding.

The four items the engineer's own sweep found (two test-header citations,
the Playwright suite, `.env.example`) all check out as correctly resolved or
correctly filed — see C2.8 for the Playwright suite specifically.

**QA-7 (new, major) — the shipped OAuth scope list is missing
`drive.metadata.readonly`, which the architecture's own design and the
project's own verified-facts research say the attachment-health check
needs.** This is the ninth instance, and it is a stronger case than the
previous eight: not a copy/citation drifting out of sync with a fix, but a
**design decision that was researched, written down, and then not
followed** — caught only by reading four documents against each other and
the actual runtime array, not by any test (this cannot be exercised against
the mock, so no test currently could catch it):

- `docs/features/real-google-integration/inputs/google-api-facts-verified.md`
  (an input the architect stage was handed) states plainly: `drive.file` is
  *"Create new Drive files, or modify existing files, that you open with an
  app or that the user shares with an app"* (line 44) — i.e. **it cannot see
  a file the app did not create or the user did not explicitly open with
  it**. The same doc explicitly instructs: *"Choose Drive scopes on
  least-privilege and fidelity grounds alone"* (line 119) and states that
  avoiding `drive.metadata.readonly` "to reduce verification burden" is
  *"factually wrong"* (line 124) — because the kickoff decision already
  established Testing-mode carries **no** verification cost for a restricted
  scope at this audience size.
- `04-architecture.md:135-137` designs for **two** Drive scopes accordingly:
  `drive.metadata.readonly` for attachment-health **reads**, `drive.file` for
  the "Copy to My Drive" **write**.
- The shipped `GOOGLE_SCOPES` array (`server/src/adapters/google/
  oauth-client.ts:30-38`) has only **one**: `drive.file`. No occurrence of
  `drive.metadata.readonly` exists anywhere in `server/src`, `shared/src`, or
  `client/src` — confirmed by a repo-wide grep, only doc/report hits.
- `real-classroom-provider.ts`'s `driveFileHealth()`
  (`server/src/adapters/google/real-classroom-provider.ts:621-634`) calls
  `this.clients.drive.files.get({ fileId, ... })` on the Drive file ID a
  Classroom attachment names — a file the teacher created independently of
  this app, in their own Drive, before ever using Classroom Copier. Per
  `drive.file`'s own documented scope (above), this read is exactly the kind
  `drive.file` cannot perform. The catch block maps a resulting 403/404 to
  `'permission_locked'`/`'deleted'` (lines 631-633) rather than crashing — so
  the likely live-Google failure mode is not a 500, it is **every real
  attachment silently mis-classified as trashed or permission-locked**,
  which would make the Action Sheet Modal appear for nearly every item on a
  teacher's very first live transfer, and — since "Copy to My Drive" needs
  the identical read access to `files.copy` a file it cannot see — plausibly
  makes the fallback resolution fail too, on live Google, for exactly the
  courses most likely to be tried first.
- This was **seen and analyzed once already, from a different angle, and the
  functional question was never asked.** The most recent security-engineer
  report (`security-reports/2026-08-26-security-engineer.md`, finding S9)
  correctly noticed the substitution and rated it "superseded" — but only
  evaluated it for *exposure/blast-radius* ("`drive.file`... eliminates the
  whole-Drive metadata exposure S9 was scored against"), which is true and a
  good security outcome, and never asked whether `drive.file` can still
  *perform the read the health check needs*. Two different reviews of the
  same three lines, two different questions, and the functional one was
  never asked until this pass.

I cannot verify this against live Google (no credentials, and the assignment
explicitly bars seeking any) — the mock provider doesn't exercise real Drive
scopes at all, which is exactly why no test in the suite could have caught
this. Filing as **major**, not blocker: it degrades rather than crashes or
silently drops data (an item that can't be read still surfaces to the
teacher via the Action Sheet, it just surfaces for the wrong reason), and it
does not touch this phase's headline feature (title-based duplicate
detection reads the Classroom API, not Drive, and is unaffected). But it sits
directly across the path of `docs/handoff/connecting-to-live-google.md` Part
4.2 — the very first live transfer a teacher runs is likely to have at least
one real Drive-file attachment, and if this is confirmed, the "Silent healthy
pre-flight" behavior (mock-verified as F1/Scenario-2's whole point) may never
actually occur live. **Recommend the engineer verify this with one real
Google Drive file not created by the app** (does not require the user's
production credentials — a developer's own throwaway Google account and a
5-minute OAuth Playground check would settle it) **before** the user
attempts Part 4.2, and either restore `drive.metadata.readonly` (the
verified-facts doc already cleared its cost at this audience size) or confirm
`drive.file` is in fact sufficient and the concern is unfounded.

## C2.7 — the recurring pattern, one more time, for `project-profile.md`

Recommend appending a ninth bullet to `docs/project-profile.md`'s Lessons
learned, distinct in kind from the eight already there: *a design decision
can be correctly researched, correctly written into the architecture, and
still not survive to the implementation, and neither a same-stage
self-check nor a differently-angled review (security, in this case) will
catch it if neither one asks the specific question "does the shipped
mechanism still do what the doc says it does, for the reason the doc says it
needs to."* Not filed as a backlog item on my own authority (that's QC/PM's
call on whether to accept this framing) — recorded here for QC to weigh.

## C2.8 — the stale Playwright E2E suite: assessment

The engineer's judgment call (file to backlog, don't fix in this revise pass)
is defensible on its own terms — nothing regressed, the suite isn't in the
fail-fast verify recipe, and disclosing it plainly (rather than silently
leaving it) is the correct behavior for *this* pass. But asked directly
whether **leaving it stale is acceptable**, my view: **not indefinitely.** A
test suite that fails at its first line, for every spec, provides **zero**
regression coverage — worse than deleting it, because its presence in the
repo (`e2e/specs/*.spec.ts`, several files, real assertions past step one)
reads as "this is covered" to anyone who does not know to check whether it
currently runs. A suite that cannot get past step one is a liability
specifically because it *looks* like safety. Recommend treating the
backlog's existing medium-severity entry as higher-priority than its
neighbors — not because this cycle's changes made it worse, but because
every day it stays broken is a day the project's actual E2E coverage is
zero while its apparent coverage (file count, spec count) says otherwise.
The fix itself is small and already scoped in the backlog entry (mint the
mock session through the server's own endpoints, same as this QA pass and
the engineer's own verification both had to do by hand).

## C2.9 — what remains genuinely open (honest accounting)

| Item | Status |
|---|---|
| QA-1 | **Closed.** Re-confirmed, not re-litigated. |
| QA-2 | **Closed.** Verified live this cycle. |
| QA-3 | **Closed.** Verified live this cycle (3-of-7 case; all-duplicate case remains unit-only). |
| QA-4 | **Closed.** Verified live this cycle, including the negative case. |
| QA-5 | **Still open**, minor, unchanged, confirmed live (20px pill radius). |
| QA-6 | **Still open**, minor, not independently re-checked this cycle — no reason to doubt the prior assessment. |
| **QA-7 (new)** | **Open, major.** Drive scope may be functionally insufficient for the attachment-health read on live Google. Cannot be closed without live Google access; recommend a developer smoke-test before the user's Part 4.2. |
| Live end-to-end OAuth round trip | **Still open, correctly so.** No credentials used or sought, per the assignment. |
| Native `<details>` Enter/Space | **Still open**, re-attempted and re-isolated to the same tooling limitation (a script-dispatched `KeyboardEvent` cannot trigger a browser's native default action for *any* element, trusted or not — reconfirmed against a bare native `<details>` this cycle). Genuine human-hands verification still owed. |
| Two load-sensitive flakes (D12 reconciler race, `allClearMs` timing) | **Corroborated** — both pass in isolation (re-run 3× each), consistent with the engineer's filed disclosure. Not fixed, correctly not blocking. |
| Playwright E2E suite | **Still stale**, correctly filed; see C2.8 for the "should this be more urgent" view. |

## C2.10 — `docs/handoff/connecting-to-live-google.md`: followability review

Read end to end as the teacher it's written for, then cross-checked every
concrete claim against the actual code rather than taking the doc's word for
it.

**What checks out:**

- **Every Google Cloud Console step is present and in order** — project
  creation, enabling both APIs, the OAuth consent screen, the test-user list
  (with the 100-person cap and the ~weekly re-consent both stated plainly and
  reassuringly — "this is completely normal," with the pause-and-resume
  behavior named as the mitigation, exactly what the assignment asked me to
  check), credential creation, and the two-box redirect-URI/origin
  distinction with a named, specific failure mode (`redirect_uri_mismatch`)
  and a debugging tip (compare character by character, look for a trailing
  slash).
- **Every Render step is present and in order** — Postgres creation, the
  backend env-var table, the frontend `VITE_API_BASE_URL` setting with the
  rebuild-vs-restart gotcha called out (a real footgun this project's own
  `vite.config.ts` comment corroborates), and the final health-check
  restart/verify step with the `/api/health` vs `/health` trap named.
- **Every env var is named with an exact value or an exact generation
  instruction**, cross-checked one by one against `server/src/config.ts`:
  `DATABASE_URL`, `DATABASE_PROVIDER=postgresql`, `GOOGLE_PROVIDER_MODE=google`,
  `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI`, `FRONTEND_ORIGIN`,
  `CORS_ORIGINS`, `NODE_ENV=production`, `SESSION_SECRET`,
  `TOKEN_ENCRYPTION_KEY` — all eleven match what `config.ts` actually
  requires in google + production mode, no extra, none missing. The
  "eleven" count in the doc's own "you'll know it worked when" (§3.2)
  matches the table's actual row count. `TOKEN_ENCRYPTION_KEY`'s 32-byte
  requirement and the `openssl rand -base64 32` fallback both match
  `token-crypto.ts`'s actual check exactly.
- **The duplicate-prevention verification (Part 4.2) is concretely
  runnable, and I directly verified its promised UI text is what actually
  ships**: I drove a real copy-then-recognize-as-duplicate pair live this
  cycle (C2.2/C2.3) and confirmed the pill the doc promises — *"the summary
  shows it under 'already in course' rather than 'copied'"* — reads
  **exactly** `"Already in course"` with the exact teal styling. A teacher
  following this step will see precisely what the doc says they'll see (for
  a Classroom-only item with no real Drive attachment — see QA-7 above for
  the one case this may not hold).
- The example service URLs (`classroom-copier.onrender.com`,
  `classroom-copier-api.onrender.com`) match the project's actual established
  names from `docs/product/inputs/source-prd.md`, not invented placeholders.

**One minor gap:** PM brief §7.3 asked the checklist to cover "the scope
list of §8 and what Google will show" — the doc explains *why* Drive access
is requested (§1.3's note) but never previews the actual consent screen a
teacher will see (e.g., "Google will list several Classroom and Drive
permissions — this is expected"). A teacher mid-flow, staring at a multi-item
Google permissions screen with no forewarning, may hesitate. Low cost to add
one sentence to §4.1's "things that look like problems and are not" list.

**One new recommendation, from QA-7:** if QA-7 is confirmed, Part 4.2's
"you'll know it worked when" needs a third bullet for the case where a real
attachment unexpectedly triggers an Action Sheet Modal item on a course that
should have scanned silently-healthy — right now a teacher hitting that would
have no troubleshooting entry to reach for.

**Overall verdict on the handoff doc: followable as written**, for a teacher
with no developer, for every step short of the one open technical risk this
cycle surfaced. It is a genuine improvement over what the assignment
describes as the prior session's pattern of handing over instructions the
user could not act on — this one is concrete, sequenced, and self-checking
at every step.

## C2.11 — Cycle 2 verdict

**PASS WITH FINDINGS.** Both blockers from cycle 1 (QA-1, QA-2) are
independently confirmed closed by live reproduction, not by reading the
engineer's report. Both majors (QA-3, QA-4) are independently confirmed
closed the same way, including the negative/adjacent-regression cases the
assignment specifically asked about. No new blocker appeared. One new major
finding (QA-7) surfaced from this cycle's own independent sweep — well
evidenced from four independent sources (an input research doc, the
architecture doc, the shipped scope array, and the health-check call site)
but not live-Google-confirmable in this session, so it is reported as an
open major risk rather than a blocker, with a concrete, cheap next step
(a developer smoke-test with one non-app-created Drive file) that does not
require touching the user's production credentials.
