# Screen 5 — Batch Transfer Progress (low-fi)

## Normal progress

```
+--------------------------------------------------------+
| Step: 1 Select  2 Pre-flight  (3)Transfer  4 Summary      |
+--------------------------------------------------------+
|                                                          |
|  Transferring 23 of 50 posts...                           |
|  [########################--------------------] 46%       |
|                                                          |
|  Recent activity:                                          |
|   [check] "Week 3 Reading" -> transferred                  |
|   [check] "Quiz: Ch.2" -> transferred                      |
|   [note]  "Essay 1" -> fallback shell (attachment locked)  |
|                                                          |
|  (No Cancel control in v1 — partial-cancel is undefined;   |
|   see backlog.)                                            |
+--------------------------------------------------------+
```

## Rate-limited pause (F6)

```
+--------------------------------------------------------+
|  Transferring 31 of 50 posts...                           |
|  [##################################----------] 62%        |
|                                                          |
|  (!) Google is rate-limiting requests — retrying           |
|      automatically in 8s...                                |
|      (progress pauses here; resumes on its own)            |
+--------------------------------------------------------+
```

- Progress bar + fraction counter + a scrolling ticker of the last few
  processed items, each tagged with its outcome icon (transferred / fallback
  shell / skipped).
- Cold-start overlay (see 01-sign-in-and-account-picker.md) can also appear
  here if the backend has gone idle mid-review (e.g., user left the Ready-to-
  Transfer screen open >15 min before clicking Start Transfer).
- 429 pause is informational-only (theme 4, not an edge case) — it doesn't
  change the interaction, just narrates it, UNLESS retries are exhausted, in
  which case that single item resolves as a fallback/skip in the summary
  (assumption — see Deltas; not fully specified by fixture F6).
- No mid-transfer cancel in v1 (deferred to backlog) — see Decisions.
