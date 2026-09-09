# Screen 6 — Completion Summary (low-fi)

Rendered as a full-screen report surface (not a small modal dialog) — see
Decisions in 02-ux-workflow.md for why this departs from the PRD's literal
"modal" wording.

```
+--------------------------------------------------------+
| Step: 1 Select  2 Pre-flight  3 Transfer  (4)Summary       |
+--------------------------------------------------------+
|  Transfer complete.                                        |
|                                                          |
|  [ Topics: 6 created/mapped ] [ Drafts transferred: 39 ]   |
|  [ Fallback shells: 2 ]        [ Skipped by you: 1 ]        |
|  [ Rubric notes added: 1 ]                                  |
|                                                          |
|  (i) 39 + 2 + 1 = 42 of 42 posts scanned — every post       |
|      resolved to a transfer, fallback, or skip.             |
|                                                          |
|  Itemized log:                        [filter: All v]      |
|  --------------------------------------------------------|
|  Title       Type    Topic  Outcome    Type-specific    Note|
|                                         fields               |
|  Week 1      Material Unit1 Transferred (—)              —  |
|  Reading                                                    |
|  Essay 1     Assignm. Unit2 Fallback    Due: cleared ·   [Classroom|
|                                         Max pts: 100      Copier   |
|                                                            Note:...]|
|  Quiz: Ch.2  Quiz     Unit2 Transferred Due: cleared ·    —  |
|                                         Max pts: 50          |
|  Discussion  Question (none)Transferred Answer: Multiple  —  |
|  Q1                                     choice (4 opts)      |
|  Final       Assignm. Unit3 Transferred Due: cleared ·   Rubric|
|  Project                                Max pts: 100      not   |
|                                                            copied|
|                                                            (license)|
|  ...                                                        |
|  --------------------------------------------------------|
|                                                          |
|  [ Open target course (mock link) ]  [ Start another        |
|                                         transfer ]           |
+--------------------------------------------------------+
```

- Stat tiles reconcile exactly to the total posts scanned (zero-silent-drop
  guarantee from the brief §5) — the reconciliation line is shown explicitly,
  not left implicit. **Only drafts transferred + fallback shells + skipped
  sum to the post total (39+2+1=42 above); topics (6) and rubric notes (1)
  are shown as separate tiles and are never terms in that sum** — see
  Acceptance Scenario #15 in `02-ux-workflow.md`.
- Rubric-degradation is its own tracked count, distinct from fallback shells
  — the assignment itself transferred successfully; only the rubric didn't
  copy (see Deltas). **Combined case:** a post that is both a fallback shell
  and rubric-degraded counts once under "Fallback shells" in the sum, and is
  additionally tagged under "Rubric notes added" as a non-exclusive
  secondary marker — see the combined-outcome rule in `02-ux-workflow.md`
  §4.
- Attachment-cap overflow (F5) appears as a Note in the itemized log row for
  that post ("5 attachments appended as links — 20 max per post"), not as a
  separate stat tile.
- Itemized log is filterable by outcome (All / Transferred / Fallback /
  Skipped) given F4's 50-post volume.
- **Type-specific fields column** renders per the brief's per-type
  transformation table: empty for Materials (no due date, no max points);
  "Due: cleared · Max pts: N" for Assignments and Quiz assignments; "Answer:
  Multiple choice (N opts)" or "Answer: Short answer" for Questions. No row
  renders a single generic "post" shape — see §6 of `02-ux-workflow.md`.
- "Start another transfer" returns to Source & Target Selection with the same
  signed-in account; no history/dashboard of past runs in v1.
