# Diagram — OAuth sign-in with the cold-start window (Decision E)

> Referenced from `../04-architecture.md` §4.1, with the security controls
> from **§8.0**. Shows the full real-OAuth sign-in sequence and marks the one
> segment that is architecturally unclosable by any client-side mechanism.

```mermaid
sequenceDiagram
    actor Teacher
    participant FE as Frontend (static, always warm)
    participant BE as Backend API (may be cold)
    participant G as Google (accounts.google.com)

    Teacher->>FE: click "Sign in with Google"
    FE->>BE: GET /api/auth/google/url (cold-start covered)
    Note over FE,BE: Blocks the redirect until this resolves —<br/>trades wait time for a lower chance of<br/>hitting the uncoverable window below.
    BE->>BE: generate PKCE verifier + S256 challenge (S1)
    BE-->>FE: 200 {authUrl incl. code_challenge}<br/>sets ONE cc_oauth_state cookie {nonce, verifier}<br/>HttpOnly, SameSite=Lax, Secure in prod, Max-Age 600 (S7)
    FE->>Teacher: window.location = authUrl
    Teacher->>G: navigates to Google's consent screen
    Note over Teacher,G: Unbounded, human-paced.<br/>The warm-up above has no visibility here.
    G-->>BE: 302 redirect: GET /api/auth/callback?code&state
    rect rgb(255, 230, 200)
    Note over BE: UNCLOSABLE WINDOW — if the backend went<br/>back to sleep while the user was on Google's<br/>screen, THIS request pays the full 30-50s<br/>wake cost. No page has loaded in the browser,<br/>so nothing can render an overlay into it.
    end
    BE->>BE: verify state nonce against cookie,<br/>exchange code WITH code_verifier (S1),<br/>encrypt + store access token + expiresAt,<br/>create GoogleAccount + Session,<br/>resume any paused job BY ACCOUNT (S8),<br/>clear cc_oauth_state on every exit path
    BE-->>Teacher: 302 to config.frontendOrigin — a boot-time<br/>constant (FRONTEND_ORIGIN, else CORS_ORIGINS[0]).<br/>NO part of the request contributes to it (S2).<br/>No code/token in the URL.
    Teacher->>FE: lands on frontend
    FE->>BE: GET /api/auth/me (cold-start covered)
    BE-->>FE: 200 {account}
    FE->>Teacher: Source & Target Selection
```

**Mitigations in place** (both already covered by the diagram above):
warm-up before the redirect, and routing the callback's *redirect target*
through the frontend so the confirmation step is cold-start-covered too.
**Not mitigated:** the shaded window — the callback route's own processing
time. See `04-architecture.md` §4.1 and Delta P0-A for the full reasoning
and the honest statement of residual risk.

**Security controls on this flow** (`04-architecture.md` §8.0): **S1** PKCE
`S256` on the code exchange — `state` alone defends the redirect leg against
CSRF but not the code against interception; **S2** the 302 target is a fixed
config value, never derived from `Referer`, `Origin`, a `returnTo`
parameter, or the `state` payload — the open-redirect this diagram's earlier
"redirect to frontend origin" left unspecified; **S7** the cookie's flags and
its 600-second lifetime; **S8** resume is resolved by session account, never
by a job id from the request.
