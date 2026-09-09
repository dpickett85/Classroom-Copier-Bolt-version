# Prior-session bug inventory

> Distilled by Agent-C kickoff (2026-08-23) from the 166-page Gemini chat log
> (`Copy Google Classroom Assignments Batch Gemini Chat log.pdf`, 186 user turns,
> 2026-08-16 → 2026-08-23), cross-checked against the actual repo at `06c3d05`.
>
> Purpose, in the user's words: "look through it so they can see what things we had to
> debug and what changes we've made. that way, they can avoid making the same mistakes."
>
> **Read this before touching build config or auth.** Roughly 120 of the 186 turns were
> spent on deployment plumbing, not product logic. Most of it is re-learnable from here.

---

## A. State of the repo RIGHT NOW — regressions introduced by the prior session

The prior session had the user hand-edit files **directly in the GitHub web UI**. Those
9 commits (`4a879d9`..`06c3d05`) landed on top of the finished, QC-approved v1 and
regressed it. Local `main` and `origin/main` are both at `06c3d05`, so this is also what
Render deploys. **Every item below is verified against the working tree, not inferred.**

| # | Regression | Verified how |
|---|---|---|
| A1 | Root `package.json` rewritten from 46 lines to 13. Lost `test`, `lint`, `dev:server`, `dev:client`, `setup`, `test:e2e`, `check:citations` and all 10 `test:budget:*` scripts. Lost every devDependency: eslint, typescript-eslint, @playwright/test, @axe-core/playwright, globals, typescript. Lost `"type": "module"` and `engines.node>=20`. | `git diff 0694779 HEAD -- package.json` |
| A2 | **`@classroom-copier/shared` was deleted from `server` dependencies.** This is the monorepo workspace link the server build depends on. | `git diff 0694779 HEAD -- server/package.json` |
| A3 | Dependencies silently downgraded across major versions: `@prisma/client` `6.19.3`→`^5.22.0`, `express` `^5.2.1`→`^4.21.1`, `zod` `^4.4.3`→`^3.23.8`. `jsonwebtoken`, `@types/jsonwebtoken`, `supertest`, `@types/supertest` removed outright. Client `zod` is still `^4.4.3` → **server and client now disagree on zod major**, across a `shared` package that uses zod schemas. | same diff |
| A4 | All 10 server test scripts repointed to `src/__tests__/…`, a directory that **does not exist**. Real tests live in `server/test/quality/`. Every quality budget is therefore unrunnable. | `ls server/src/__tests__` → No such file or directory; `ls server/test/quality` → 9 budget specs present |
| A5 | `seed` script repointed to `src/db/seed.ts`, which does not exist. Real seed is `server/prisma/seed.ts`. `server/src/db/` contains only `client.ts`. | `ls server/src/db` |
| A6 | Server scripts lost `--env-file-if-exists=.env` on `dev`/`start`, and `db:push` lost `&& prisma generate`. The missing `prisma generate` is the direct cause of bug B6 below. | same diff |
| A7 | `server/src/app.ts` cut 126 → 62 lines; `server/src/config.ts` cut 92 → 72. The composition root was rewritten by hand without reconciling what it wired up. | `wc -l`, `git show 0694779:server/src/app.ts` |
| A8 | `server/src/adapters/google/real-classroom-provider.ts` (305 lines) was created but never reconciled with `classroom-provider.interface.ts`. It is a starting point, not a working adapter. | file exists; interface unchanged since v1 |
| A9 | No `.env.example` anywhere in the repo. | `ls .env.example` |

**Implication for the engineer stage:** do not treat `06c3d05` as a baseline to patch.
The correct move is to restore the v1 build configuration from `0694779` and re-apply the
*intent* of the Gemini changes (real provider, real auth) on top of it properly.

---

## B. Bugs actually hit and diagnosed during the prior session

Ordered roughly as encountered. Each is a real failure with a real cause — worth knowing
so they aren't re-hit.

**B1 — `TS7006: Parameter 'x' implicitly has an 'any' type` (×~40), production build fails.**
Render runs the server `build` (`tsc`), which compiled **test files** under `strict`.
Test files use untyped callback params. Fix applied: added test globs to the server
`tsconfig` `exclude`. Keep this — production `tsc` must not compile specs.

**B2 — `TS2688: Cannot find type definition file for 'node' / 'vite/client' / '@testing-library/jest-dom'`.**
Render installs with `NODE_ENV=production`, so devDependencies (which carry the `@types/*`)
were skipped, then `tsc` demanded them. Fix applied: `NPM_CONFIG_PRODUCTION=false` on the
Render service. Note this interacts badly with A1/A3 — the devDeps must actually exist in
`package.json` for that flag to help.

**B3 — `TS2345: Argument of type '{}' is not assignable to parameter of type 'HealthState'`**
at `server/src/adapters/mock/mock-classroom-provider.ts:358`
(`result.set(attachmentRefKey(ref), byId.get(ref.id) ?? 'deleted')`). A bare string was
passed where the union type wanted a structured value.

**B4 — `TS2322: Type '{ onSignedIn: … }' is not assignable to …` (×6 variants).**
`SignInLanding.tsx` / `AuthFlow.tsx` prop contracts drifted apart as the two files were
edited separately across turns, and the client tests were never updated to match. Watch
this: those two files are exactly where the OAuth redirect work lands.

**B5 — Root `package.json` contained the *server* package.** At one point the user pasted
`@classroom-copier/server` content into the ROOT `package.json`, so npm treated the whole
repo as the server workspace. Separately, `"workspaces"` went missing entirely, breaking
`npm run build --workspace=client`.

**B6 — `@prisma/client did not initialize yet`** at server boot on Render.
`prisma generate` was never run in the build. See A6 — the `&& prisma generate` that
prevented this was removed from `db:push`.

**B7 — `DATABASE_URL` was `file:./dev.db` on Render.** SQLite on an ephemeral filesystem;
no Postgres instance had been created yet. Directions now correctly specify PostgreSQL.
(This also intersects open backlog item: Render free-tier disk durability was never
empirically verified — moot once Postgres is real.)

**B8 — `{"error":{"code":"not_found","message":"No route for /health"}}`.**
Not a bug. The health route is `/api/health`. Returned `{"status":"ok","uptimeMs":…}` once
hit correctly. Recorded so it isn't "fixed" again.

**B9 — `GET /api/auth/me 401 (Unauthorized)` in console.** Also not a bug on its own — the
expected response when no session exists. It was repeatedly misread as the root cause of
the sign-in failure and burned many turns. The real cause was B11.

**B10 — CORS.** `CORS_ORIGINS` had to be set on the backend to the static site's origin.
Note the app requires a custom `X-Classroom-Copier` header on state-changing routes (CSRF
defense added in v1), which forces a preflight — the CORS config must allow that header.

**B11 — The deployed frontend kept calling `/api/auth/mock-accounts`.** Confirmed in the
Network tab and in the built bundle (`index-DwwRpvWe.js`). The backend was already logging
`"providerMode":"real"`, so the mismatch was entirely client-side. Two compounding causes:
(a) the client had a mock fallback baked in at build time, and (b) **the Render static site
was pointed at a different GitHub repository than the backend** — discovered late
("shoot…just realized that my front end site is pointed to a different github!"). At least
three repos were in play: `BrettSEvans/ClassroomCopier`, `dpickett85/ClassroomCopier2`, and
a fork. **Verify both Render services point at the same repo before debugging anything.**

**B12 — Provider-mode value mismatch.** The env var was set to `real`, but the rewritten
`config.ts`/`app.ts` checked for the literal `google`. Whatever selector survives, it needs
exactly one spelling and a fail-fast error naming the accepted values.

**B13 — `GOOGLE_REDIRECT_URI` mismatch.** Set to `…/api/auth/google/callback`; the route
was `…/api/auth/callback`. Must match Google Cloud Console **exactly**, character for
character, or Google refuses the exchange.

**B14 — `{"error":{"code":"not_found","message":"No route for /api/auth/sign-in"}}`.**
The static site was sending API calls to its own origin instead of the backend —
`VITE_API_BASE_URL` is baked in **at build time**, so changing it requires a frontend
**rebuild**, not just a restart. This was misunderstood repeatedly.

**B15 — "the frontend site looks all jacked up. it's got two big icons."**
Reported at the very end, never diagnosed. Still open. This plus "raw unstyled fallback
buttons" is Directions §3. **Not yet reproduced — the engineer must reproduce it in a
browser before fixing it.**

---

## C. Process lessons worth honoring

1. **The prior session could not read the repository.** It said so explicitly and
   repeatedly: it only ever saw pasted snippets. Every structural claim it made about the
   codebase was inferred from fragments. Treat its diagnoses as hypotheses, its *log
   excerpts* as evidence.
2. **It also lost conversational context mid-session** ("you seem to have memory loss"),
   after which its advice drifted from the actual architecture.
3. **The user is a teacher, not a developer** — stated many times. Any instructions handed
   back must be concrete, numbered, and free of unexplained jargon. Do not hand over a
   diagnosis and expect it to be actioned.
4. **Edits were made in the GitHub web UI with no tests run and no local build.** That is
   how A1–A9 shipped to `main` unnoticed. All Phase-2 work goes through the local repo with
   the suite green before pushing.
