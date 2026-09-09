# Session expiry & Google token failures — mid-wizard and mid-transfer (low-fi)

> New states; nothing in v1 covers these because v1's mock session never expired
> and never depended on a real, revocable Google token. Structure only, no
> visual style (UI stage).

## 4a. Session expired — mid-wizard (Selection / Pre-flight / Action Sheet / Ready to Transfer)

```
+--------------------------------------------------------+
|                                                          |
|  (!) Your session expired.                                 |
|      Sign in again to continue — your course selections    |
|      weren't saved, so you'll need to pick them again.      |
|                                                          |
|                    [ Sign in again ]                       |
+--------------------------------------------------------+
```

- Triggered by any API call in these pre-write steps returning 401.
- Interrupts the current screen (banner or takeover, UI's call) rather than
  silently retrying or showing a generic error — the teacher needs to know
  *why* nothing is happening and *what will be lost*.
- "Sign in again" re-runs the real-OAuth flow (`01-real-oauth-sign-in.md`
  1a–1d). On success, lands on Source & Target Selection with a clean slate —
  same "discard in-progress, unconfirmed selection" rule v1 already applies to
  account switches (v1 §5), now also triggered by expiry, not just by choice.
- Nothing here is destructive of anything durable — no draft has been written
  yet at any of these steps, so "your selections weren't saved" is accurate,
  not just reassuring.

## 4b. Session expired — mid-transfer (batch write already running)

```
+--------------------------------------------------------+
| Step: 1 Select  2 Pre-flight  (3)Transfer  4 Summary       |
+--------------------------------------------------------+
|                                                          |
|  Transferring 23 of 50 posts...                           |
|  [########################--------------------] 46%       |
|                                                          |
|  (!) Your session expired, but your transfer is still       |
|      running in the background. Sign in again to keep       |
|      watching progress — nothing will be lost or             |
|      duplicated.                                            |
|                                                          |
|                    [ Sign in again ]                       |
+--------------------------------------------------------+
```

- **Critical distinction from 4a:** the transfer job is server-owned and
  survives the browser's session independently (same job/executor/lease
  machinery that already makes browser-refresh mid-transfer safe, v1 P0
  Delta #2 / F12) — session expiry here means the *client can no longer poll
  for progress*, not that the job stopped. The banner must say so explicitly;
  presenting this as a transfer failure would be a false alarm on top of an
  already-alarming word ("expired").
- The progress bar and ticker freeze at their last-known values (not reset,
  not hidden) while this banner is up — same visual discipline as the
  existing rate-limit pause banner (v1 §4), reused here for a different cause.
- "Sign in again" re-runs real-OAuth, and on return the client calls the
  existing reconnect endpoint (`GET /transfer-jobs/active`, F12's mechanism)
  to resume polling the **same** job — this is the same resumability path v1
  already built for browser refresh, now also entered via re-auth instead of
  only via reload.
- This state is visually and semantically **distinct** from 4c below — a
  session-cookie expiry (fixable by the teacher re-signing-in, job unaffected)
  is a different situation from the Google-side token dying (below), and
  conflating them would send the teacher down the wrong recovery path.

## 4c. Google access needs reconnecting — mid-transfer (token/consent failure)

```
+--------------------------------------------------------+
| Step: 1 Select  2 Pre-flight  (3)Transfer  4 Summary       |
+--------------------------------------------------------+
|                                                          |
|  Transferring 31 of 50 posts...                           |
|  [##################################----------] 62%        |
|                                                          |
|  (!) Google access needs to be reconnected before this      |
|      transfer can continue. Nothing has been lost or         |
|      duplicated — items already copied are safe.             |
|                                                          |
|                 [ Reconnect Google account ]                |
+--------------------------------------------------------+
```

- Triggered when the server-side Google token can no longer be refreshed
  (revoked consent, expired refresh token) — a *Google-side* auth failure,
  distinct from 4b's app-session expiry. The teacher's browser session is
  fine; what's broken is the backend's standing permission to keep calling
  Google on their behalf.
- **Visually and in wording, this is deliberately not the rate-limit pause
  banner** (v1 §4) — that one is purely informational and resolves on its
  own; this one requires the teacher to act, so it must not be mistaken for
  "just wait, it'll clear."
- "Reconnect Google account" re-runs the real-OAuth flow with the SAME
  `prompt=select_account`/consent semantics as any other sign-in — on success,
  the server refreshes its stored token for this account and the transfer
  resumes from the same job via the reconnect mechanism (as in 4b).
- **Zero-silent-drop still applies here.** Items already transferred before
  the token died are already durable (drafts exist in the destination) and
  must not be re-attempted or re-counted on resume. Items not yet attempted
  when the token died must resolve to a defined terminal state when the job
  finishes — never simply vanish from the eventual Completion Summary's
  reconciliation sum. **This is a P0 Delta** (see main workflow doc): the
  *exact* mechanism (does the engine pause-and-wait for reconnect, or does it
  fail the remaining items outright and let a subsequent identical run pick
  them up via duplicate-title skip on the retried items that already landed)
  is architect scope — UX's requirement is only that whichever mechanism is
  chosen, this screen's teacher-facing behavior and copy match it exactly and
  every item still resolves to transfer/fallback/skip with an honest count.

## Notes for architect/engineer

- 4b and 4c must be distinguishable **by cause**, not just by copy — the
  client needs a way to tell "our session cookie expired" (401 from our own
  API) apart from "the stored Google token can't be refreshed" (a distinct
  error the transfer-job status payload must be able to carry). This is a new
  status/error shape the job-status contract needs; flagged for architect,
  not designed here.
- Focus moves to the interrupt banner's heading when any of 4a/4b/4c appears,
  matching the existing focus-management pattern (v1 §6).
- None of these three states are fixture-covered by the F1–F14 manifest as it
  stands; PM §6.6 adds a dedupe fixture but not an auth-failure fixture — see
  the main workflow doc's Deltas for the fixture-gap flag, mirroring how v1
  flagged cold-start and resumability as fixture-uncovered rather than silently
  assuming coverage.
