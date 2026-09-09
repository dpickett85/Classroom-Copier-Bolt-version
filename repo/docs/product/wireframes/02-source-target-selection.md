# Screen 3 — Source & Target Selection (low-fi)

```
+--------------------------------------------------------+
| [Jamie Rivera <jamie.rivera@...>] [Switch account] [Sign out] |
| Step: (1)Select  2 Pre-flight  3 Transfer  4 Summary     |
+--------------------------------------------------------+
|                                                          |
|  Copy FROM (source)                                      |
|  [ Dropdown: choose a course you teach            v ]    |
|    - shows ACTIVE and ARCHIVED courses                   |
|    - each row: course name, section, [Active/Archived]   |
|      badge, post count                                    |
|                                                          |
|  Copy TO (target)                                         |
|  [ Dropdown: choose a course you teach            v ]    |
|    - shows ACTIVE courses only                            |
|    - each row: course name, section, [SIS Roster Shell]   |
|      badge when applicable                                |
|                                                          |
|  (i) Running the same copy more than once creates         |
|      duplicate drafts — Classroom Copier does not check   |
|      for existing copies yet.                             |
|                                                          |
|  [ error, shown only if source == target: ]               |
|  "Choose two different courses."                          |
|                                                          |
|                                    [ Continue -> ]         |
|                                    (disabled until both    |
|                                     selected & distinct)   |
+--------------------------------------------------------+
```

- Step indicator is non-interactive (can't jump ahead); Back is available up
  through the Ready-to-Transfer screen, disabled once transfer starts.
- Source dropdown = active + archived courses where the signed-in account
  teaches. Target dropdown = active courses only (archived excluded from
  targets in v1, per PM brief Decision 14).
- The duplicate-run notice is always visible here (not just gated behind a
  final confirmation) — first of two touchpoints; the second is on the
  Ready-to-Transfer screen right before commit.
- Continue triggers the Pre-flight Scan (next screen).
