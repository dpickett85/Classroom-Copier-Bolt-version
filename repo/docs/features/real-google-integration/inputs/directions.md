# Handoff Directions (verbatim source: Directions.pdf, 2026-08-23)

> Authored by the prior LLM session (Gemini) at the user's request, as a handoff brief.
> Reproduced here as the authoritative statement of Phase-2 scope.
> ANNOTATIONS by Agent-C kickoff are marked `> NOTE:` and are NOT part of the original.

Re-architect and complete the **ClassroomCopier** repository
(https://github.com/BrettSEvans/ClassroomCopier). The project is a full-stack web
application designed to replicate Google Classroom assignments from a source class to a
destination class.

## Context & Past Hangups (Review Chat Log)

1. **Build Configuration**: The project is set up as an npm monorepo with `/client`,
   `/server`, and `/shared`. Root `package.json` must maintain
   `"workspaces": ["shared", "client", "server"]`. Ensure all package scripts and Vite
   configurations parse valid JSON and bundle cleanly without strict `tsc -b` blocks
   failing production static deploys.

2. **Deployment Target**: Render. The frontend deploys as a Static Site
   (Publish Directory: `client/dist`), and the backend deploys as a Node Web Service
   running Express + Prisma with PostgreSQL. Ensure API proxy rewrites or base URLs are
   cleanly mapped.

## Core Requirements to Implement

### 1. Production Google OAuth & Auth Flow
- Remove all mock/test auth states.
- Implement full Google OAuth 2.0 authentication using `googleapis` with necessary
  Google Classroom API scopes
  (`https://www.googleapis.com/auth/classroom.courses.readonly`,
  `https://www.googleapis.com/auth/classroom.coursework.students`).
- Store user session/tokens securely and pass Google access tokens to server routes for
  API calls.

> NOTE (kickoff, confirmed with user): "Remove all mock/test auth states" is scoped to
> the DEPLOYED application — no mock sign-in, no demo accounts, no reachable mock
> provider mode in a production build. The mock provider is RETAINED behind the provider
> interface as a test-only double so the 365-test suite and 11 quality budgets survive.
> Deleting it outright would delete the entire verification surface.

> NOTE (carried from v1 PM brief, decision 2026-08-14): this scope list is INCOMPLETE for
> the feature set. `classroom.courseworkmaterials` is required for Materials (a separate
> API surface from `coursework.students`), and `drive.file` (write) is required for the
> "Copy to My Drive" pre-flight scenario — `drive.readonly` cannot perform a copy. The
> architect must reconcile the final scope list.

### 2. Google Classroom Duplication Engine
- Fetch user courses (source and destination).
- Fetch assignments/coursework from the selected source course.
- **Duplicate Prevention Logic (Crucial Update)**: Before creating any assignment in the
  destination Google Classroom, query the destination class coursework via the Google
  Classroom API. If an assignment with an identical title already exists — whether as a
  **draft** or a **published assignment** — skip copying that assignment to avoid
  duplicates.
- Copy non-duplicate assignments along with instructions, attachments, materials, and
  point values.

> NOTE (kickoff): this SUPERSEDES the v1 PM decision "v1 performs no dedupe — a re-run
> creates a second set of drafts". It also closes open backlog item
> "Idempotent re-run / duplicate detection". Requires design, not an ad-hoc code edit:
> listing BOTH draft and published coursework requires the correct
> `courseWorkStates` filter, and "identical title" needs a defined normalization rule
> (trim/case/whitespace) plus a defined behavior for CourseWorkMaterials vs CourseWork.

### 3. Frontend UI Cleanup
- Audit `client/src` to ensure stylesheets (Tailwind/CSS) are imported in `main.tsx`.
- Ensure login pages, loading spinners, and classroom selectors render cleanly without
  broken asset paths or raw unstyled fallback buttons.

> NOTE (kickoff, confirmed with user): the app does NOT and never did use Tailwind. It
> uses a hand-built design-token CSS system (`client/src/styles/tokens.css`) produced by
> the v1 UI stage and verified at WCAG 2.1 AA with axe-core in real Chromium. `main.tsx`
> ALREADY imports it correctly. Do NOT convert to Tailwind. Fix the reported rendering
> defects ("two big icons", raw unstyled fallback buttons) WITHIN the token system.

### 4. Environment Variables Template (`.env.example`)
Provide placeholder templates for:
- `DATABASE_URL` (PostgreSQL on Render)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `JWT_SECRET` / `SESSION_SECRET`

> NOTE (kickoff): no `.env.example` exists in the repo today. The server's real config
> surface is broader than this list (CORS_ORIGINS, NODE_ENV, provider-mode selector,
> VITE_API_BASE_URL on the client). The template must cover what the code actually reads,
> and the placeholders must never contain real secrets.
