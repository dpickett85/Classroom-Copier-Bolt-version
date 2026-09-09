# Verify-recipe baseline — measured, not inferred

> Run by Beast Mode at run entry, 2026-08-23, on branch `phase2/real-google-integration`
> at commit `06c3d05` (identical to `origin/main`, i.e. what Render deploys).
> Every line below is captured command output, not a claim.

The project's verify recipe (`docs/project-profile.md`) is: `npm test` → `npm run build` → `npm run lint`.
**Two of the three commands no longer exist.**

| Step | Result |
|---|---|
| `npm test` | ❌ `npm error Missing script: "test"` |
| `npm run lint` | ❌ `npm error Missing script: "lint"` |
| `npm run build` | ✅ passes — **but only builds `shared` + `client`.** The server is not in the root build script at all (v1's was `shared → server → client`). |
| `npm run build --workspace=server` | ❌ **19 TypeScript errors. The backend does not compile.** |

## The server does not compile — full error list

```
src/adapters/google/real-classroom-provider.ts(1,24):  TS2307: Cannot find module 'googleapis'
src/adapters/google/real-classroom-provider.ts(10,8):  TS2307: Cannot find module './classroom-provider.interface.js'
src/adapters/google/real-classroom-provider.ts(29,25): TS7006: Parameter 'c' implicitly has an 'any' type
src/adapters/google/real-classroom-provider.ts(45,24): TS7006: Parameter 't' implicitly has an 'any' type
src/adapters/google/real-classroom-provider.ts(80,50): TS7006: Parameter 'm' implicitly has an 'any' type
src/adapters/google/real-classroom-provider.ts(95,50): TS7006: Parameter 'm' implicitly has an 'any' type
src/adapters/google/real-classroom-provider.ts(178,47):TS7006: Parameter 'att' implicitly has an 'any' type
src/app.ts(6,10):   TS2724: '"./routes/courses.js"' has no exported member 'createCoursesRouter'. Did you mean 'coursesRouter'?
src/app.ts(7,38):   TS2307: Cannot find module './routes/transfer.js'
src/app.ts(8,39):   TS2307: Cannot find module './adapters/google/mock-classroom-provider.js'
src/app.ts(10,40):  TS2307: Cannot find module './adapters/google/classroom-provider.interface.js'
src/index.ts(1,10): TS2305: Module '"./app.js"' has no exported member 'buildApp'
src/routes/auth.ts(2,24): TS2307: Cannot find module 'googleapis'
src/routes/auth.ts(4,10): TS2305: Module '"../services/session.js"' has no exported member 'sessionStore'
test/api.integration.test.ts(4,10):            TS2305: no exported member 'buildApp'
test/composition-root.test.ts(13,10):          TS2305: no exported member 'buildApp'
test/csrf.test.ts(13,10):                      TS2305: no exported member 'buildApp'
test/quality/courses-list.budget.test.ts(18,10): TS2305: no exported member 'buildApp'
test/quality/f12-reconnect.budget.test.ts(11,10):TS2305: no exported member 'buildApp'
```

## What these errors actually say

They are not 19 independent bugs. They are five root causes:

1. **`googleapis` is declared but not installed.** It is in `server/package.json` dependencies,
   but `npm install` has not been run since that edit — the hand-edits were made in the GitHub
   web UI, where no install ever happens. Both `real-classroom-provider.ts` and `routes/auth.ts`
   fail on it.

2. **`real-classroom-provider.ts` imports the interface from the wrong directory.** It reaches for
   `./classroom-provider.interface.js` (i.e. inside `adapters/google/`); the interface actually
   lives one level up at `server/src/adapters/classroom-provider.interface.ts`.

3. **`app.ts` was rewritten against a directory layout that does not exist.** It imports the mock
   from `./adapters/google/mock-classroom-provider.js` (real location:
   `./adapters/mock/mock-classroom-provider.ts`), imports `./routes/transfer.js` (no such file),
   and imports `createCoursesRouter` from a module that exports `coursesRouter`.

4. **`app.ts` stopped exporting `buildApp`.** That single removal breaks `index.ts` — the server's
   own entry point — plus **five test files**, including two quality-budget specs. This is why the
   budgets are unrunnable independently of the script-path regression (A4).

5. **`routes/auth.ts` imports `sessionStore`, which `services/session.ts` does not export.**

## Consequences for this run

- **The 365-test suite and all 11 quality budgets cannot run.** Not "are failing" — cannot run.
  There is currently no measured verification of anything in this repo.
- **`npm run build` passing is misleading.** It exercises only `shared` and `client`. A CI or
  Render build using the root `build` script would go green while the backend is broken.
- The engineer stage must get `npm test`, `npm run lint`, and a server build back to green
  **before** any new feature work is credible. Restoring root `package.json` from `0694779`
  addresses the script and dependency half; causes 2–5 above are code and must be fixed directly.

## MANUAL-VERIFY

- **MANUAL-VERIFY:** Whether the currently-deployed Render backend is serving this code or a
  stale build from an earlier commit / different repository is not determinable from here.
  The prior session had at least three repos in play and, at one point, the frontend and
  backend Render services pointed at different ones.

---

# Addendum — `package-lock.json` was never regenerated

> Measured 2026-08-23, same run. This is a separate root cause from the 19 compile errors and
> is very likely behind several of the prior session's unexplained Render deploy failures.

`git log -- package-lock.json` shows its last commit is **`5e779e0`** — a v1 commit, predating
every one of the prior session's dependency edits. The edits were made in the GitHub web UI,
where npm never runs, so the lockfile still describes the **v1** dependency tree while
`package.json` describes a different one.

| Package | `package-lock.json` says | `package.json` now says | State |
|---|---|---|---|
| `googleapis` | **absent** | `^144.0.0` (server dep) | ❌ never locked, never installed |
| `@prisma/client` | `6.19.3` | `^5.22.0` | ❌ major conflict |
| `prisma` | `6.19.3` | `^5.22.0` | ❌ major conflict |
| `express` | `5.2.1` | `^4.21.1` | ❌ major conflict |
| `zod` (server) | `4.4.3` | `^3.23.8` | ❌ major conflict |
| `jsonwebtoken` | `9.0.3` | *(removed)* | ⚠️ orphaned in lock |
| `supertest` | `7.2.2` | *(removed)* | ⚠️ orphaned in lock |
| `eslint` | `9.39.5` | *(removed)* | ⚠️ orphaned in lock |
| `@playwright/test` | `1.62.1` | *(removed)* | ⚠️ orphaned in lock |

The lockfile's `server` workspace entry still lists `"@classroom-copier/shared": "*"` — the
dependency `package.json` dropped (regression A2).

Confirmed absent from disk as well: `node_modules/googleapis` and `server/node_modules/googleapis`
do not exist. That is the direct cause of `TS2307: Cannot find module 'googleapis'`.

## Why this matters for deployment

**`npm ci` cannot succeed on this tree.** It refuses when `package.json` and `package-lock.json`
disagree, and here they disagree on four packages across major versions plus one that is missing
from the lock entirely. Any Render build configured with `npm ci` fails before compiling anything.
A build using plain `npm install` instead would silently rewrite the lockfile and churn the entire
dependency tree — including downgrading Prisma and Express across majors against code written for
the newer ones.

## Why this strengthens the restore-from-`0694779` decision

The lockfile is an **intact, uncorrupted record of the v1 dependency tree** — it was never
successfully edited. Restoring `package.json` (root and server) from `0694779` makes the two
consistent again with essentially zero dependency churn, because the lockfile already describes
exactly that state. Patching `06c3d05` forward would instead mean regenerating the lockfile from
the downgraded versions and re-testing the whole stack against Prisma 5 / Express 4 / zod 3 —
code that was written and QC-certified against Prisma 6 / Express 5 / zod 4.

`googleapis` is the one genuinely new dependency and must be added deliberately on top of the
restored baseline, with the lockfile regenerated and committed.

**MANUAL-VERIFY:** whether the Render services use `npm ci` or `npm install` is not visible from
here — check the build command in each service's settings. The chat log shows the backend build
command being set to `npm install && npm run build --workspace=client` at one point, which is
also wrong for a backend service (it builds the client, not the server).
