# Screens 1–2 — Sign-in landing & mock account picker (low-fi)

## Screen 1: Sign-in landing

```
+--------------------------------------------------------+
|  Classroom Copier                                       |
|                                                          |
|   Batch-copy your classwork into any existing course —  |
|   without duplicating Drive files.                       |
|                                                          |
|            [  Sign in with Google (mock)  ]             |
|                                                          |
|   v1 uses simulated Google accounts for demo/testing.    |
+--------------------------------------------------------+
```

- Single primary action. No account fields on this screen — the picker (below)
  is where account selection happens (forced, `prompt=select_account`
  semantics).
- Clicking Sign in may trigger the cold-start overlay (below) before the
  picker renders, if the mock backend has been idle.

## Cold-start overlay (conditional, reusable component)

```
+--------------------------------------------------------+
|                                                          |
|             (spinner)                                   |
|          Waking up server...                             |
|          This can take up to 50 seconds on first use.    |
|                                                          |
+--------------------------------------------------------+
```

- Appears on ANY first backend call after >15 min idle (not hardcoded to
  sign-in only) — reusable overlay bound to a "no response within ~2s"
  detector.
- Auto-dismisses the moment the backend responds; no user action required.
- **No fixture covers this state.** Cold-start is fixture-uncovered in the
  F1–F11 manifest (and F12) — it is not fixture-certified, only
  demonstrable via manual/local Render-free-tier testing. Its idle-tracking
  mechanism (client-clock-based vs. server-signaled) is also an unresolved
  architecture dependency, flagged in `02-ux-workflow.md` Deltas alongside
  the resumability job/poll contract.

## Screen 2: Mock account picker (forced)

```
+--------------------------------------------------------+
|  Choose an account                                       |
|                                                          |
|  ( o )  Jamie Rivera                                     |
|         jamie.rivera@pickettusd.mock.edu                 |
|                                                          |
|  ( o )  Dana Okafor                                       |
|         dana.okafor@pickettusd.mock.edu                  |
|                                                          |
|  [ Use another account ]  (disabled in v1 — tooltip:      |
|                             "not available in mock mode") |
|                                                          |
|  [ Cancel ]                                               |
+--------------------------------------------------------+
```

- Lists the ≥2 seeded mock teacher accounts (F10), each with a distinct
  course list once selected.
- Shown at EVERY fresh sign-in, and re-triggerable from the signed-in header's
  "Switch account" control (see 02-source-target-selection.md) — this is what
  exercises the "forced picker avoids multi-account collision" behavior end
  to end, not just once at first login.
- Selecting an account signs in and lands on Source & Target Selection with
  that account's course list loaded.
