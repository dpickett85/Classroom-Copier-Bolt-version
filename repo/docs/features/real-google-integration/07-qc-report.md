# 07 — QC Report

**Feature:** real-google-integration
**Branch:** `phase2/real-google-integration` @ `b756ac2` (read-only, no changes applied)
**Stage:** QC (final verification)
**Mode:** Beast Mode

---

## 1. Verification Summary

### Executed commands (all pass)

| Command | Result | Observed numbers |
|---------|--------|------------------|
| `npm test` | PASS | 631 total (26 shared + 337 server + 268 client), 0 failures, 49 test files |
| `npm run build` | PASS | exit 0, client bundle 305.75 kB / 93.09 kB gzip |
| `npm run lint` | PASS | exit 0, no eslint violations |
| `npm run check:citations` | PASS | 260 citations / 18 docs / zero unresolved |
| Quality budgets (16/16) | PASS | Both blocking rows pass; all advisory rows pass |

**Reported vs. observed:** The reported baseline of 631 pass / 0 fail from the orchestrator is **exactly confirmed**. No discrepancy.

---

## 2. Production fail-fast verification (server boot)

QA Cycle 1 found blocker QA-1: "Production boot does NOT refuse `GOOGLE_PROVIDER_MODE` mock/unset." This was fixed in commit `4e186fc`. Verified by direct execution:

| Scenario | NODE_ENV | GOOGLE_PROVIDER_MODE | Expected | Observed | Status |
|----------|----------|----------------------|----------|----------|--------|
| Production, unset | production | (unset) | Fail exit 1 | Fail exit 1 ✓ | PASS |
| Production, mock | production | mock | Fail exit 1 | Fail exit 1 ✓ | PASS |
| Production, typo | development | typo | Fail exit 1 | Fail exit 1 ✓ | PASS |
| Dev, mock | development | mock | Boot port 4000 | Boot success ✓ | PASS |
| Production, google + all vars | production | google + 5 required env vars | Boot port 4000 | Boot success ✓ | PASS |

The fail-fast contract is **correctly implemented and verified live**. The `resolveGoogleProviderMode()` function in `server/src/config.ts` correctly:
- Refuses unrecognized mode values in any environment
- Refuses mock/unset specifically when `NODE_ENV=production`
- Defaults to mock in non-production (by design)

---

## 3. QA Cycle 1 findings — all blockers and majors addressed

Six findings were reported in QA Cycle 1. All have commits addressing them between `d7203b5` (QA report) and `b756ac2`:

| ID | Severity | Issue | QA Report Status | Fix Commit | Verified |
|---|---|---|---|---|---|
| QA-1 | blocker | Production boot does not refuse mock/unset | FAIL | 4e186fc | PASS ✓ |
| QA-2 | blocker | Stale "does not check for existing copies" warning still shown | FAIL | 018fb6e | Not independently verified in this pass (UI behavioral) |
| QA-3 | major | Ready-to-Transfer shows full count not "X of Y" excluding duplicates | FAIL | b1cfa89 | Not independently verified in this pass (UI behavioral) |
| QA-4 | major | Focus management not implemented on new screens | FAIL | 1d1be8f | Not independently verified in this pass (UI behavioral) |
| QA-5 | minor | Google button radius is 20px pill, not 3px as decided | Noted | Not addressed in commits | Still present |
| QA-6 | minor | backlog.md carries 8 already-resolved security findings as "Open" | Noted | Not addressed | Still present (see §4 below) |

**QA-2, QA-3, QA-4 verified by code inspection** (the commits exist and the changes are present), but **not by live UI behavioral reproduction** in this QC pass — those require a real browser and driving the UI to the affected screens, which is outside QC's scope (QC verifies executables run; QA drives the product). The commits are present, the code reads correctly, and the test names match the findings.

---

## 4. Disclosed limits — verified still accurately stated

Per the assignment, these limits must be verified still honestly stated:

### Limit 1: No live Google call has ever been made

**Status:** Confirmed accurate. The mock provider is the only path exercisable in this session; no real Google credentials were used or requested. `docs/handoff/connecting-to-live-google.md` Part 4 (live OAuth round trip) remains explicitly unrun.

### Limit 2: `drive.files.copy` may still fail live (deferred architect decision)

**Status:** Confirmed accurately stated in `04-architecture.md` §7 and `backlog.md` (architect finding F13). The issue is noted: the app uses `drive.metadata.readonly`, which does not grant read access to a teacher's pre-existing attachment files, only to app-created ones. Noted as a known gap, not silently assumed resolved.

### Limit 3: Native `<details>` Enter/Space keyboard toggling

**Status:** Confirmed as MANUAL-VERIFY in `05-implementation.md` §5. Not closed. The comment in the test correctly states "jsdom implements `<details>` toggling on click but not the Enter-key activation a real browser gives `<summary>`." Isolated to browser-automation tooling in this session (control-tested against a bare native `<details>` element), not evidence of a product defect.

### Limit 4: Two pre-existing load-sensitive flakes

**Status:** Confirmed documented. `05-implementation.md` footnote cites `composition-root.test.ts` D12 race and `preflight.test.tsx` `allClearMs` timing. Both pass on isolated re-run. Noted as pre-existing, not new.

### Limit 5: Stale Playwright E2E suite

**Status:** Confirmed. The suite describes a sign-in screen deleted this phase and cannot run past step one. Not in the verify recipe; nothing goes red. Correctly filed and left in place.

### Limit 6: `backlog.md`'s structured channel is "poisoned"

**Status:** Confirmed accurate. The file has been hand-edited: every backlog item now carries a `[QA-XXXX]` prefix (e.g., `[QA-0001]`, `[QA-0002]`). This violates the structured format that `backlog_add` expects. A tool attempting to add to this backlog would refuse it. Someone must reconcile the file before it can be edited via structured tools again.

---

## 5. Signed-off convention compliance

**`05-implementation.md` §1 header note present:** Confirmed. The document explicitly states:

> **§1 and §8 contain a claim that was false when written.** Both assert the production boot fail-fasts on `GOOGLE_PROVIDER_MODE`. It did not, until §9. Left in place rather than quietly corrected: the comparison a reviewer needs is stated-premise against built-code, and a premise edited to match the code destroys exactly that.

This convention is correctly followed: §1 and §8 still contain the false claim, §9 revises it to truth, and the top-level note explains why. Reviewers can now compare stated premise against built code as intended. **Convention verified as correctly applied.**

---

## 6. Quality budgets — all 16/16 pass

Spot-verified in this run:
- `test:budget:dedupe` (blocking): 2/2 pass — duplicateTitleCreates=0
- `test:budget:reauth-resume` (blocking): 10/10 pass — pass2Creates=0, pass2Topics=0
- `test:budget:f1`: 1/1 pass
- `test:budget:f12`: 1/1 pass
- `test:budget:f13`: 1/1 pass
- `test:budget:a11y`: 47/47 pass
- `test:budget:coldstart`: 8/8 pass
- `test:budget:reconciliation`: 9/9 pass

All observed passing. The budget rows are wired and active.

---

## 7. Findings (for next stage/decision)

| ID | Severity | Summary | Where | Status |
|---|---|---|---|---|
| QC-1 | blocker | None | — | READY FOR DECISION |
| QC-2 | major | QA-2/QA-3/QA-4 commits exist and code reads correctly, but not independently reproduced as live UI behavioral verification in this pass (outside QC scope) | Requires UI-level E2E retest | For QA or acceptance driver |
| QC-3 | minor | QA-5 (Google button radius 20px vs. 3px) not addressed in any commit | `client/src/styles/tokens.css:132` | Open, low-priority |
| QC-4 | minor | `backlog.md` poisoned with `[QA-XXXX]` prefixes; cannot be edited via `backlog_add` tool; requires manual reconciliation | `docs/features/real-google-integration/backlog.md` | Must be resolved before structured tool use |
| QC-5 | note | No test exists for the all-duplicate re-run case (Acceptance Scenario 13, "0 of Y posts"); only unrelated v1 "0 posts scanned" case is covered | QA Cycle 1 §3.3 finding | Noted, deferred to product decision |

---

## 8. Exact observed numbers vs. reported

### Tests (reported: 631 pass / 0 fail)
- **Shared:** 26 pass (2 files)
- **Server:** 337 pass (35 files)
- **Client:** 268 pass (12 files)
- **Total:** 631 pass / 0 fail
- **Status:** EXACT MATCH ✓

### Build
- **Exit code:** 0
- **Client bundle:** 305.75 kB / 93.09 kB gzip
- **Status:** MATCH (prior report: 304.59 kB / 92.75 kB — negligible variance, both clean) ✓

### Lint
- **Exit code:** 0
- **Violations:** 0
- **Status:** EXACT MATCH ✓

### Citations
- **Total:** 260 citations across 18 docs
- **Unresolved:** 0
- **Status:** EXACT MATCH ✓

### Quality budgets
- **Declared:** 16 (2 blocking, 14 advisory)
- **Passing:** 16/16
- **Status:** EXACT MATCH ✓

---

## 9. Verdict

**Status: READY WITH CAVEATS**

### Why READY

1. **All executables pass exactly as reported.** npm test (631), npm run build (exit 0), npm run lint (exit 0), npm run check:citations (260/0), quality budgets (16/16).
2. **Production fail-fast contract verified live.** The commit `4e186fc` correctly implements the server's refusal to boot with `GOOGLE_PROVIDER_MODE` unset/mock/typo under `NODE_ENV=production`. QA-1 blocker is genuinely fixed.
3. **QA cycle 1 blockers have commits addressing them.** QA-2/3/4 commits exist; code inspection confirms changes are present; test assertions updated.
4. **All six disclosed limits verified still accurately stated.** No silent assumptions, no false negatives.
5. **Backlog.md poisoning confirmed, not masked.** The structural corruption is documented so the next handler knows.

### Caveats

1. **QA-2/3/4 (duplicate warning text, X-of-Y count, focus management) verified by code inspection only, not by live UI reproduction.** The commits exist, the code reads correctly, and the tests assert the new behavior, but this QC run did not drive the UI to those screens in a real browser. For live products: this is correct QC scope (verify binaries run). For acceptance: the acceptance driver should retest against a live running instance before sign-off.

2. **QA-5 (Google button radius) and backlog.md reconciliation remain open.** Both are documented, low-priority (cosmetic and tooling respectively), but not resolved. No blockers, but noted for completeness.

3. **The UI behavioral tests (QA-2/3/4) cannot be independently re-verified by reading alone** — must be asserted live. Code inspection confirms they changed and tests passed, but the specific rendering of the duplicate-run notice, the X-of-Y headline, and focus movement are not machine-checkable from source alone.

---

## 10. Disclosure summary

**No live Google call has been made.** The app has never connected to a real Google Classroom or Drive. The entire test and build suite runs against injected doubles. `docs/handoff/connecting-to-live-google.md` Part 4 (live round-trip verification) is the acceptance test for the real integration and remains unrun. This is the honest headline limit — disclosed, not hidden.

---

## Recommendation

**READY WITH CAVEATS:** Recommend forward to acceptance driver for live UI verification of QA-2/3/4 findings. The backend is solid, the fail-fast contract holds, and all numbers check out. The UI behavioral changes have commits and pass tests; live retest as a gate to ship, not as a blocker to proceeding.
