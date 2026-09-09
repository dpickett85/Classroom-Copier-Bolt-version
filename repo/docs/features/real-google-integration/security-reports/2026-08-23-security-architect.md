SECURITY ARCHITECTURE REVIEW — Classroom Copier / Real Google Integration (Phase 2)

Artifact: `docs/features/real-google-integration/04-architecture.md`          Artifact kind: architecture
Also read: `01-pm-brief.md`, `02-ux-workflow.md`, `03-ui-direction.md`, `inputs/google-api-facts-verified.md`,
`state.json`, `docs/product/04-architecture.md` (v1), `diagrams/oauth-cold-start-sequence.md`,
`diagrams/token-failure-pause-resume-sequence.md`, and — to test claims rather than accept them —
the actual current source of `server/src/middleware/auth.ts`, `server/src/middleware/csrf.ts`,
`server/src/services/session.ts`, `server/src/config.ts`, `server/src/routes/{courses,transfer-jobs}.ts`,
`server/prisma/schema.prisma`.

Compliance obligations named in 01: none named. Open question below.

Risk summary: 0 critical · 0 high · 4 medium · 5 low

| # | Dimension | Severity | Risk | Remediation |
|---|-----------|----------|------|--------------|
| S1 | OAuth flow (PKCE) | medium | No PKCE (`code_verifier`/`code_challenge`) on the authorization-code flow — only the `state` cookie is specified. | Add PKCE to `oauth-client.ts`'s authorization-URL construction and token exchange (`google-auth-library`'s `OAuth2Client` supports it natively). |
| S2 | OAuth flow (open redirect) | medium | The callback's outbound 302 to "the frontend origin" (§4.1, §6.3) has no named, fixed config source in the design — a real risk of it being derived from request data. | Name one fixed source (e.g. a new `FRONTEND_ORIGIN` env var, or `CORS_ORIGINS[0]`), used verbatim, never from request input; add a redirect-target test. |
| S3 | Token custody (key generation) | medium | `TOKEN_ENCRYPTION_KEY` has a presence-only fail-fast; no generation guidance for the non-developer audience the architecture itself designs for. | Live-OAuth checklist gives an exact `openssl rand -base64 32` (or equivalent) command; document that a human-typed value silently defeats the encryption. |
| S4 | Token custody (decrypt-failure handling) | medium | `token-crypto` decrypt failures (rotated/lost key, corruption) aren't routed into the existing `AuthExpiredError`/reauth UX. | Treat a decrypt failure identically to `AuthExpiredError` — same pause-and-reconnect path, not a raw 500. |
| S5 | `Session.accountId` un-FK'd | low | Removing the FK deletes the DB's own safety net for cross-account isolation; verified (not merely accepted) safe today by evidence, but nothing pins it going forward. | Add an explicit cross-account-isolation contract test as an acceptance criterion on `google-auth-core`/`google-oauth-routes`. |
| S6 | Token custody (logging) | low | No explicit rule against tokens/ciphertext/raw googleapis error payloads reaching logs. | State explicitly: never log token plaintext/ciphertext or unredacted Authorization headers; redact provider error payloads before logging. |
| S7 | OAuth flow (`cc_oauth_state` cookie attrs) | low | `Secure`/short TTL for the state cookie isn't stated (session cookie's is). | Mirror the session cookie's environment-conditional `Secure` behavior; short max-age (~10 min). |
| S8 | Token-failure resume (cross-account) | low | `resume(jobId)` account-scoping is shown in the diagram but not a stated acceptance criterion. | Add a test: reconnecting account B never resumes a job paused under account A. |
| S9 | Data flow (Drive scope blast radius) | low, informational | `drive.metadata.readonly` exposes metadata for the *entire* Drive, not just app-created files, for the life of any live token. | Already reasoned through on least-privilege grounds; just make the exposure surface explicit in §5.1/§7 rather than implicit. |

Open questions for the human: no compliance regime is named in `01-pm-brief.md`. This app reads
Classroom coursework/topic/attachment metadata (titles, states, attachment references) — it does not
appear to touch student roster or grade data. If any student PII ever flows through a future surface,
FERPA/COPPA become relevant; not asserting an opinion here, just flagging it as unresolved.

Verdict: **remediate before build is not required — this is a proportionate design for its stated
context (single-tenant, school-scoped, OAuth Testing mode, ≤100 explicitly-listed test users, run by
one teacher).** No finding here is exploitable-by-design or a critical/blocking risk. S1–S4 are worth
folding into the engineer's implementation pass because they are cheap and this is genuinely the first
phase holding a real third-party credential; S5–S9 are hygiene/test-coverage items, not design flaws.

---

## Detail

### 1. Token custody end to end

**Decision A (no offline access, no refresh token) materially reduces blast radius — confirmed, not just
asserted.** With no refresh token, a compromise of the encrypted-token store yields, at most, a set of
access tokens that each expire within ~1 hour and cannot be renewed. This is a real, structural
reduction versus the alternative design (`access_type=offline` + stored refresh tokens), which in
Testing status would have expired on the *same* 7-day cycle anyway — the architecture's own reasoning
in §7 (ADR row A) holds up under scrutiny. Nothing in the rest of the design silently reintroduces a
long-lived credential: `GoogleAccount` stores only `accessTokenCiphertext`/`Iv`/`Tag`/`ExpiresAt`, no
refresh-token column exists in the schema fragment (§5.1), and Decision F's pause-and-resume mechanism
is explicitly designed to *not* assume a refresh token exists (§5.1, "it assumes a human will
re-consent"). **Pass.**

**AES-256-GCM with a dedicated key, separate from `SESSION_SECRET`, is current, correct practice.**
Verified current as of 2026-08-23 against OWASP's Cryptographic Storage Cheat Sheet and the 2025
OWASP Top 10 (A04, Cryptographic Failures) guidance: an authenticated cipher (AES-256-GCM or
ChaCha20-Poly1305) for data at rest, with the encryption key kept separate from the ciphertext and
from other secrets, is exactly what's specified. The IV-randomness acceptance criterion
("ciphertext/iv/tag are never equal across two calls with the same plaintext") is the correct thing to
test for AES-GCM and is explicitly in the module's acceptance criteria (§ Module declarations,
`google-auth-core`). **Pass, dimension 5 (encryption).**

**S3 — key generation guidance is missing, and this design explicitly targets a non-developer.**
`config.ts`'s existing `required()` helper (confirmed by reading the current file) only checks for a
non-empty string — it validates *presence*, not *strength*. The architecture explicitly proposes
mirroring this exact pattern for `TOKEN_ENCRYPTION_KEY` (§8.2). Node's AES-256-GCM implementation will
throw at runtime if the key isn't exactly 32 bytes after decoding, which self-enforces *length* — but
it will silently accept any 32-byte value regardless of *entropy*. Architectural driver 9
("deployability by a non-developer... every environment variable... written as if the person
configuring it cannot read a stack trace") is exactly the driver this gap violates: a teacher told to
"set `TOKEN_ENCRYPTION_KEY` to a 32-byte secret" with no further guidance could type a memorable phrase
that passes every check in this design while defeating the encryption's actual purpose.
**Remediation:** the `deployment-config` module's live-OAuth checklist and `.env.example` comment must
give an exact, copy-pasteable generation command (`openssl rand -base64 32`, or a Node one-liner using
`crypto.randomBytes(32)`), not just name the variable. **Severity: medium** — cheap to fix, and it's
the one place in this design where "encryption at rest" could become decorative without anyone
noticing at review time.

**S4 — decrypt-failure handling isn't routed through the existing reauth UX.** The design has a well-built
pause-and-resume path for `AuthExpiredError` (Google-side 401/`invalid_grant`), but says nothing about
what happens if `token-crypto`'s decrypt call itself fails — which would happen after any
`TOKEN_ENCRYPTION_KEY` change (rotation, redeploy with a different value, corruption of a stored
ciphertext). Today that would most likely surface as an unhandled exception → a generic 500, not the
routine "reconnect Google, this happens about once a week" experience the rest of the design
deliberately builds toward (§4.2's copy is explicitly "never alarmed"). **Remediation:** in
`real-classroom-provider.ts`/`oauth-client.ts`, catch a decrypt failure from `token-crypto` and treat it
identically to `AuthExpiredError` — same pause field, same reconnect banner. **Severity: medium** — not
because it's likely (key rotation isn't part of this design's normal operation), but because if it
*does* happen the failure mode is currently unhandled rather than merely rare.

**S6 — no explicit no-log-tokens rule.** Nothing in §5.1/§6/§8 states that decrypted tokens, ciphertext,
or raw googleapis/`google-auth-library` error payloads (which can echo request headers, including
`Authorization`, in some SDK error objects) must never reach logs, the run-log, or error envelopes sent
to the client. The sign-out revoke failure is explicitly "logged at WARN" (§5.1) with no stated content
constraint. **Remediation:** state the rule explicitly and have `security-engineer` verify it against
the actual log call sites once code exists — this is exactly the kind of finding that belongs at both
ends of the design/code split named in this skill's own framing. **Severity: low** (the design's overall
shape — server-side-only custody, tokens never reaching the client bundle — already does the hard part;
this is a discipline gap, not a structural one).

### 2. The un-foreign-keyed `Session.accountId` — tested, not just accepted

This was the assignment's specific instruction to verify rather than take on faith. I read the actual
current code rather than reasoning from the design doc alone:

- `server/src/middleware/auth.ts` (`requireAuth`) resolves `req.auth.accountId` **exclusively** from a
  DB-backed `Session` row looked up by the signed session-cookie's `sid` claim — never from any
  client-suppliable field. `resolveSession` in `server/src/services/session.ts` additionally checks
  `row.accountId !== claims.accountId` (JWT and DB row must agree) and rejects revoked/expired rows.
- Every existing (Keep) route that touches an account-scoped resource derives the account from
  `req.auth!.accountId` and re-checks resource ownership explicitly — confirmed by grep against
  `server/src/routes/courses.ts` and `server/src/routes/transfer-jobs.ts`:
  `if (!job || job.accountId !== req.auth!.accountId)` appears at both the job-status and job-log read
  paths (lines 173 and 256), not just on writes.
- `Session.accountId` is set only inside server-controlled code (today, `POST /api/auth/sign-in`; in
  Phase 2, the OAuth callback after Google's own token exchange returns a verified `sub` claim) — there
  is no route in this design that accepts an `accountId` as client input and uses it to create or
  resolve a session.

**Conclusion: as designed, removing the FK does not currently permit a session to point at another
user's `GoogleAccount`, accidentally or deliberately.** The polymorphic-column idiom itself
(`MockAttachment.parentType`/`parentId` precedent) is a reasonable fit for "this column means one of two
tables depending on a discriminator, which Prisma can't express as a FK" — the same justification the
architecture gives (§7, ADR row B) holds up against the actual code.

**S5 — but the FK was the DB's own safety net, and nothing pins the invariant going forward.** The
design carries this pattern forward by reference ("Keep") rather than by an explicit new test scoped to
the *new* account type. A future change to `google-oauth-routes` or `account-directory` that trusts an
`accountId` from anywhere other than the resolved session would now have no database-level check to
catch it — Prisma's referential integrity is exactly what a FK would have provided, and it's gone.
**Remediation:** add an explicit cross-account-isolation contract test — e.g., account A's session
attempting to fetch account B's `AccountSummary`, or B's `TransferJob`, fails — as a stated acceptance
criterion on the `google-auth-core` and `google-oauth-routes` modules, not left implicit in "Keep."
**Severity: low** (verified safe today; this is a regression-prevention gap, not a live hole).

**S8 — same category, for Decision F's `resume(jobId)`.** The pause-resume diagram shows the callback
"finds this account's paused job" (i.e., scoped by the *reconnecting* account, not by a client-supplied
job ID), which is the right shape. But it isn't named as an acceptance criterion the way the
resume-safety property (P0-B) is. **Remediation:** add a test that reconnecting as account B never
resumes a job paused under account A. **Severity: low.**

### 3. Authorization on every path

Confirmed by the same code reading above: every Google-reaching route in the current (Keep) code derives
its acting account from the resolved session, not from a route/body parameter, and re-verifies ownership
on read paths as well as write paths (the more commonly missed half, per this skill's own dimension-3
guidance). The new paths this phase adds — `GET /api/auth/me` (now via `account-directory`),
`real-classroom-provider`'s per-call `buildAuthorizedClient(accountId)` — are specified to receive
`accountId` from the same session-derived context (job/scan rows already ownership-checked before any
engine call touches them), not from a new client-facing parameter. **Pass**, contingent on the engineer
preserving this pattern for every new route exactly as the existing ones do — worth a line in the
engineer's own acceptance pass, since this is precisely the kind of thing that erodes silently one route
at a time.

### 4. CSRF + CORS interaction

Read `server/src/middleware/csrf.ts` and the `cors()` call in `app.ts` directly. `requireCsrfHeader()`
guards `POST`/`PATCH`/`DELETE` only, via a custom `X-Classroom-Copier` header that a cross-site request
cannot attach without first clearing a CORS preflight. The CORS config
(`cors({ origin: config.corsOrigins, credentials: true })`) uses a **fixed array**, not `origin: true`
and not a function that reflects the request's `Origin` — the `cors` package only sends
`Access-Control-Allow-Origin` back for origins present in that array, so this does not undo the CSRF
defense. The unset `allowedHeaders` (defaulting to reflecting `Access-Control-Request-Headers`) governs
which headers a preflight permits, not which origins are trusted — a different axis, correctly reasoned
in §9.2. The two new GET routes (`/api/auth/google/url`, `/api/auth/callback`) correctly fall outside
`PROTECTED_METHODS`, matching every other read route. `CORS_ORIGINS`'s default
(`http://localhost:5173`) is a safe fail-closed default in production (an unset var in Render breaks
cross-origin calls loudly rather than opening them). **Pass**, dimension 4, and the architecture's own
§9.2 reasoning about B11 (CORS misdiagnosis) checks out against the real code.

### 5. The OAuth flow itself

**`state` parameter — present and correctly shaped.** A random nonce in a short-lived, HttpOnly,
`SameSite=Lax` cookie (`cc_oauth_state`), verified against the callback's `state` query param — this is
the standard "double-submit via cookie" CSRF defense for the OAuth redirect leg, appropriate for a case
with no DB row needed. **Pass.**

**S1 — PKCE is absent.** Verified current as of 2026-08-23 against IETF RFC 9700 (OAuth 2.0 Security
Best Current Practice, published Jan 2025) and the OAuth 2.1 draft: RFC 9700 requires PKCE for public
clients and **recommends it for confidential clients** (this app, holding a Client Secret, is
confidential); the OAuth 2.1 draft goes further, defaulting PKCE for *all* authorization-code clients
regardless of type. `google-auth-library`'s `OAuth2Client` supports `code_verifier`/`code_challenge`
natively, so this is a low-cost addition, not new infrastructure. Given this app is explicitly designed
around school-network/Chromebook environments (UX Decision 1's own rationale cites "popup blockers are a
common classroom-device failure mode," implying shared/managed-device conditions), the marginal defense
PKCE adds against authorization-code interception is proportionate to add even though the `state`
cookie already covers CSRF specifically. **Severity: medium** — current best practice, cheap fix, not
exploitable today given the state-cookie CSRF defense and server-side-only code exchange, but a real gap
against RFC 9700.

**S2 — the callback's redirect-to-frontend target has no named, fixed source.** §4.1 and the route table
(§6.3) both state the callback "302s to the frontend origin" but never name which config value supplies
that origin. This is exactly the shape of bug that produces an open redirect off an OAuth callback (a
classic phishing primitive: an attacker crafts a link to the *legitimate* `/api/auth/callback` with a
manipulated redirect target, and after a real user authenticates, they land somewhere attacker-chosen).
The design is very likely *intending* a fixed, server-configured value — the surrounding reasoning about
cold-start coverage assumes one canonical frontend origin — but the architecture never says so in words
a reviewer or an engineer could hold it to. **Remediation:** name the source explicitly (a new
`FRONTEND_ORIGIN` env var, or reuse `CORS_ORIGINS[0]` with a comment that it must be exactly one value
in this single-frontend deployment), and add a test asserting the `Location` header on the callback's
302 is always exactly that fixed string — never influenced by `state`, `code`, query params, or headers.
**Severity: medium.**

**Redirect-URI validation** — `GOOGLE_REDIRECT_URI` is a fixed config value that must exact-match
Google Cloud Console's registration (already learned the hard way per bug B13 in the prior-session
inventory); Google itself rejects a mismatch. **Pass**, no additional design risk.

**Authorization-code handling** — the code is exchanged server-side only and explicitly never reaches
the frontend URL (§4.1: "no code/token in the URL"); the `?authError=` value that *is* passed is a
closed three-value enum (`denied|expired|generic`), immediately stripped via
`history.replaceState`, not an open reflection point. **Pass.**

**S7 — `cc_oauth_state` cookie attributes.** The session cookie's `Secure`/`SameSite` behavior is spelled
out precisely (§5.1, and confirmed matching the actual `cookieOptions()` in `session.ts`), but the
state cookie's equivalent attributes and TTL are not stated. Since it must survive a full top-level
navigation to `accounts.google.com` and back, it needs `SameSite=Lax` (not `Strict`), and should carry
`Secure` in production and a short max-age (e.g. 10 minutes) to limit any window where a captured cookie
value could be replayed against a still-valid `state`. **Severity: low** — likely already the intended
implementation, just not written down.

### 6. Secrets in the repo and in deployment

`.env.example` is scoped, by module acceptance criterion, to placeholders only, verified by a grep
against `config.ts`'s actual reads — a concrete, checkable acceptance test rather than a hope. No
`VITE_`-prefixed variable in this design ever carries a secret: the only `VITE_` var named anywhere
(`VITE_API_BASE_URL`, in `client/.env.example`) is a public API base URL, not a credential. Critically,
this design's shape means `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` never need to reach the client
bundle at all — the client calls the backend's `GET /api/auth/google/url`, and the backend builds the
authorization URL server-side. This is a materially better shape than designs that construct the
authorization URL client-side (which would require `GOOGLE_CLIENT_ID` in a `VITE_`-prefixed var).
**Pass, and worth naming as a deliberate strength**, not just an absence of failure.

### 7. Data flow and classification

**S9 — Drive scope blast radius, made explicit.** `drive.metadata.readonly` is confirmed (via the
project's own verified-facts doc, itself checked against Google's current Drive API auth guide) to be a
**restricted** scope granting metadata visibility across the *entire* Drive, not just files the app
created or touched. The architecture reaffirms this scope choice on least-privilege/fidelity grounds
(§7, ADR row, "Scope reconciliation") — a reasonable choice — but the practical consequence (any live
token, for its ~1-hour life, can enumerate metadata for the account holder's whole Drive, not just
Classroom-related files) is never stated as a named trade-off anywhere in `04`. This doesn't change the
scope decision; it just means the decision's actual cost isn't written where a reader — or the user
approving what they're granting on the consent screen — would see it stated plainly. **Severity: low,
informational** — recommend one sentence added to §5.1 or §7 naming this explicitly, since the checklist
already needs to explain the scope list to a non-developer end user (driver 9) who is the one actually
consenting to it.

**Retention/deletion** — the design does not specify a `GoogleAccount` deletion or token-purge path
(e.g., on account inactivity, or if a teacher leaves the school). At this scale (≤100 test users, one
operator) this is a reasonable v1-of-Phase-2 omission rather than a gap, but it's worth a backlog line:
"we keep everything" should eventually be a stated decision, not silence, exactly per this skill's own
dimension-4 guidance. Not scored as a numbered finding — flagging only, matching the "don't inflate"
instruction for something genuinely out of proportion to this deployment's stakes today.

### 8. Currency notes (dimension 11)

- **Verified current as of 2026-08-23:** AES-256-GCM for token-at-rest encryption with a dedicated,
  separately-held key is aligned with OWASP's 2025 Cryptographic Storage Cheat Sheet and Top 10 A04
  guidance. Source: OWASP Cheat Sheet Series, OWASP Top 10:2025 A04.
- **Verified current as of 2026-08-23:** PKCE is recommended for confidential (server-side) OAuth
  clients under RFC 9700 (IETF, Jan 2025) and defaulted for all authorization-code clients under the
  OAuth 2.1 draft — this app's authorization-code flow (S1 above) is measured against that standard, not
  older guidance that scoped PKCE to public clients only.

## Backlog items recorded

Per this skill's handoff contract, the following were recorded as backlog items rather than left as
silent findings (severities as scored above; `stage: "architect"`, since this review runs at the
architect stage): S1 (PKCE), S2 (open-redirect target for callback), S3 (key generation guidance), S4
(decrypt-failure → reauth-path routing), S5 (cross-account isolation contract test), S6 (no-log-tokens
rule), S7 (`cc_oauth_state` attributes), S8 (resume cross-account test), S9 (Drive-scope blast-radius
disclosure). None are ship-blocking; all are cheap, concrete, and appropriately scoped to land during
the `engineer` stage's implementation of `google-auth-core`, `google-oauth-routes`, and
`real-classroom-provider`.

## Handoff note

This review reads the design only; it does not re-verify any of this against the eventual code. The
carry-forward findings for `security-engineer` (per this skill's "carry findings forward" contract) are
S1, S2, S4, S5, S6, S7, S8 — each names a specific file/module where the code should be checked once it
exists.
