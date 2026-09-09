# Real OAuth sign-in — landing, redirect round-trip, return, failures (low-fi)

> Replaces `docs/product/wireframes/01-sign-in-and-account-picker.md` for Phase 2.
> The mock account-picker screen in that file is **retired** — Google's own account
> chooser replaces it entirely, off-domain. Structure only, no visual style (UI stage).

## 1a. Sign-in landing (revised — real OAuth, no seeded accounts)

```
+--------------------------------------------------------+
|  Classroom Copier                                       |
|                                                          |
|   Batch-copy your classwork into any existing course —  |
|   without duplicating Drive files.                       |
|                                                          |
|            [  Sign in with Google  ]                    |
|                                                          |
|   First sign-in today can take up to a minute while      |
|   the app wakes up. That's normal.                        |
|                                                          |
|  [ inline error banner slot — hidden unless returning     |
|    from a failed attempt, see 1d/1e/1f below ]            |
+--------------------------------------------------------+
```

- Single primary action, same as v1. No account fields, no seeded list — the
  account chooser is Google's, not ours.
- **New reassurance line** replaces v1's "v1 uses simulated Google accounts"
  disclaimer: sets cold-start expectations *before* the user leaves the site,
  because once they leave for Google's domain we lose the ability to narrate
  anything (see Delta P0-1, "dead-screen risk").
- **New error banner slot**: renders only when the app lands back here after a
  failed round trip (1d/1e/1f). Never a dead page — every failure path returns
  here with a specific, human message and the same CTA to retry.
- **Session check on mount (unchanged principle from v1 IA):** before this
  screen paints, the client checks for an existing valid session. If valid, the
  landing screen is skipped entirely and the user lands directly on Source &
  Target Selection — same "skip to selection if already signed in" rule as v1,
  now against a real session cookie instead of a mock one.

## 1b. Pre-redirect warm-up (new — mitigates the dead-screen risk)

```
+--------------------------------------------------------+
|                                                          |
|             (spinner)                                   |
|          Waking up server...                             |
|          This can take up to a minute on first use.       |
|                                                          |
+--------------------------------------------------------+
```

- Clicking "Sign in with Google" does **not** navigate immediately. It first
  fires a normal fetch to the backend to obtain the Google authorization URL
  (state/nonce included) — an ordinary API call, so it is fully covered by the
  **existing** cold-start machine (`frontend-api-client`, D4): overlay at 2s
  unresolved, held to a 60s ceiling, then the existing distinct error state.
- Only once that call resolves does the browser navigate to Google. This is
  the one leg of the OAuth round trip the client can protect with the overlay
  it already has — see Delta P0-1 for why the *other* leg cannot be protected
  the same way, and why front-loading the warm-up here matters.
- Reuses the existing `ColdStartOverlay` component (`client/src/components/
  shared/`) verbatim — no new component needed for this state.

## 1c. On Google's domain (off-site, not ours to design)

```
        (browser is now on accounts.google.com)
   Google's own account chooser — forced every sign-in
   via prompt=select_account, same semantics v1's mock
   picker exercised, now real and off our domain.
   Google's own consent screen lists the scopes (§8 of
   the PM brief) in Google's own copy, not ours.
```

- Nothing here is designed by this project. Included only to mark the boundary:
  from the moment the browser leaves for Google until it returns to our
  callback URL, our app has **zero** ability to render anything. Every
  mitigation on this page is about the two edges of that gap, never the middle.
- **Known off-app dead end (flag for the checklist, not fixable in-app):** if
  the signed-in Google account is not on the OAuth consent screen's test-user
  list (testing-mode cap, §8 of the PM brief), Google shows its own "app not
  verified for this account" / "access blocked" screen here — entirely outside
  this app's control, un-narratable by us, and not distinguishable from any
  other Google-side denial once the browser returns (see 1e). The live-OAuth
  checklist (§7 below) must tell the user to add themselves as a test user
  **before** attempting sign-in, precisely so they never see this screen.

## 1d. Return leg — "Signing you in…" (new — the callback landing state)

```
+--------------------------------------------------------+
|                                                          |
|             (spinner)                                   |
|          Signing you in...                                |
|                                                          |
+--------------------------------------------------------+
```

- Google redirects the browser to the backend's callback route, which
  exchanges the code for tokens, stores them server-side, sets the session
  cookie, then redirects the browser again to the **frontend** origin (the
  static site, which does not cold-start the way the backend web service
  does) at a dedicated route that renders this screen.
- This screen's own confirmation is a normal fetch (`GET /api/auth/me` or
  equivalent) back to the backend — covered by the same existing cold-start
  machine as 1b (2s overlay, 60s ceiling, distinct error). If that call is
  slow, this screen's spinner silently becomes the cold-start overlay's
  copy rather than sitting mute — never a spinner with no text.
- On success: lands directly on Source & Target Selection (same "no
  intermediate dashboard" rule as v1's Decision 2), with the account header
  populated from the real profile (avatar/name/email now sourced from Google,
  not a seeded mock record).
- **The gap this screen cannot close:** the window between Google's redirect
  landing on the backend's callback route and that route's own redirect to
  this screen is real server processing time (token exchange + DB write), and
  if the backend is cold, a Node process boot is *inside* that window too. No
  page has loaded yet during that window, so nothing in this app can render
  into it — this is the residual, architecturally-unclosable slice of the
  dead-screen risk. See Delta P0-1 for the required mitigation (front-loaded
  warm-up in 1b) and the honest statement of what remains unmitigated.

## 1e. Return leg — consent denied

```
+--------------------------------------------------------+
|  Classroom Copier                                       |
|                                                          |
|   Batch-copy your classwork into any existing course —  |
|   without duplicating Drive files.                       |
|                                                          |
|            [  Sign in with Google  ]                    |
|                                                          |
|  (!) You didn't grant access, so we couldn't sign you    |
|      in. Nothing was changed. [ Try again ]               |
+--------------------------------------------------------+
```

- Triggered when Google's callback carries `error=access_denied` (user clicked
  Cancel/Deny on the consent screen).
- Lands back on the sign-in landing screen (1a) with the error banner
  populated — never a dead page, per the assignment's "never dead-end
  silently" requirement.
- Copy is deliberately blame-free: the teacher didn't do anything wrong by
  declining; the CTA re-starts the same flow from a single click.

## 1f. Return leg — expired or invalid sign-in link

```
+--------------------------------------------------------+
|  Classroom Copier                                       |
|  ...                                                      |
|  (!) This sign-in link has expired. [ Try again ]         |
+--------------------------------------------------------+
```

- Triggered by a state/nonce mismatch or an already-used/expired callback
  (e.g. a bookmarked or reloaded callback URL, or the exchange step racing a
  second attempt). Distinguishable copy from consent-denial (1e) and from the
  generic catch-all (1g) so a teacher who hits this twice knows it's not the
  same problem repeating.

## 1g. Return leg — generic Google/network sign-in failure

```
+--------------------------------------------------------+
|  Classroom Copier                                       |
|  ...                                                      |
|  (!) Something went wrong signing in with Google.         |
|      [ Try again ]                                         |
|      Reference: auth-4f2a  (for support, not required)    |
+--------------------------------------------------------+
```

- Catch-all for any other OAuth error code or a failed token exchange (network
  failure, Google-side 5xx, malformed response). Extends v1's existing
  generic-catch-all pattern (`02-ux-workflow.md` §5) to the auth surface
  specifically, rather than inventing a fourth unrelated error shape.
- The short reference code is optional, low-emphasis, and exists only so a
  teacher can quote something useful if they ask for help — it is never
  presented as something the teacher must interpret themselves.

## 1h. Switch account (header control, reachable anytime once signed in)

```
+--------------------------------------------------------+
| [Jamie Rivera <jamie.rivera@...>] [Switch account] [Sign out] |
+--------------------------------------------------------+
```

- "Switch account" re-runs the **exact same real-OAuth redirect** described in
  1a–1d (same `prompt=select_account` forcing), not an in-app picker — there is
  no in-app picker left to re-trigger. Carries forward v1 Decision 3 (forced
  chooser reachable anytime, not just first login) onto the real flow.
- Any in-progress, unconfirmed selection on Source & Target Selection is
  discarded when the new account lands — same rule v1 already specified for
  account switches, reaffirmed here because it now involves leaving the site.
- "Sign out" clears the server-side session and returns to 1a.
  **MANUAL-VERIFY:** whether sign-out also revokes the stored Google
  token server-side, or only clears the session cookie — architect/engineer
  decision; UX has no preference but flags it so it isn't accidentally left
  unspecified.

## Notes for architect/engineer

- The pre-redirect warm-up (1b) and the post-callback confirmation (1d) are
  the only two legs of this flow reachable by the existing cold-start state
  machine. The middle (1c, and the un-rendered slice inside 1d) is not, and
  cannot be, by construction — a page cannot render before it has loaded. See
  the main workflow doc's Delta P0-1 for the full reasoning and the required
  mitigation (front-load the warm-up call the instant "Sign in with Google" is
  clicked, in parallel with/ahead of the Google redirect).
- Focus management: on landing on 1d, 1e, 1f, or 1g, focus moves to that
  screen's primary heading/error banner, matching the existing focus-on-
  screen-change pattern from `02-ux-workflow.md` §6 (Completion Summary
  heading on mount).
