# Screen 4 — Pre-flight scan, Action Sheet Modal, Ready to Transfer (low-fi)

## 4a. Pre-flight scanning (transient, silent path — F1/F4)

```
+--------------------------------------------------------+
| Step: 1 Select  (2)Pre-flight  3 Transfer  4 Summary     |
+--------------------------------------------------------+
|                                                          |
|              (spinner / progress animation)              |
|          Checking topics...                              |
|          Verifying attachments...                        |
|          Checking permissions...                          |
|                                                          |
+--------------------------------------------------------+
```

- Healthy course (F1, F4): cycles through the status lines, briefly shows
  "All clear" (~1s), then auto-advances to 4c (Ready to Transfer). No modal.

## 4b. Action Sheet Modal (conditional — F2/F3 only)

```
+--------------------------------------------------------+
|  We found 2 items that need your attention before        |
|  copying.                                    [x Cancel]  |
|                                                          |
|  [ ] Apply recommended fixes automatically                |
|      (off by default — review each item, or turn this on |
|       to accept the recommended option for every row)     |
|  --------------------------------------------------------|
|  "Unit 1 Slides.pdf" — attached to "Week 1 Reading" (Material) |
|  Issue: File is trashed / deleted                          |
|   ( ) Create Draft Shell with Note   [recommended]         |
|   ( ) Skip Material                                          |
|  --------------------------------------------------------|
|  "Rubric Template.docx" — attached to "Essay 1"             |
|  Issue: Permission-locked (co-teacher owned)                |
|   ( ) Copy to My Drive (Become Owner)   [recommended]        |
|   ( ) Link Existing File (Risk Warning)                      |
|   ( ) Skip Attachment and Note Draft                          |
|  --------------------------------------------------------|
|                                                          |
|                       [ Continue -> ]  (disabled until    |
|                                          every row resolved|
|                                          or toggle is ON)  |
+--------------------------------------------------------+
```

- Renders ONLY when trashed/deleted (Scenario 2) or permission-locked
  (Scenario 3) files are detected — never on a healthy scan.
- Each row shows the flagged item's coursework type in parentheses next to
  the parent post title, and Scenario 2's skip button label is **type-aware**
  — "Skip \<Type\>" (e.g. "Skip Material," "Skip Question," "Skip Quiz
  Assignment," "Skip Assignment") — never hardcoded to "Skip Assignment"
  regardless of what type the flagged item actually is.
- Global toggle auto-selects the starred "recommended" option per row when
  turned on; rows stay individually expandable/overridable even with the
  toggle on.
- Recommended defaults (Beast Mode auto-accepted, see Decisions): Scenario 2
  → "Create Draft Shell with Note" (never silently skips); Scenario 3 →
  "Copy to My Drive (Become Owner)" (permanent fix, matches option order in
  the brief).
- Cancel returns to Source & Target Selection without transferring anything.

## 4c. Ready to Transfer (confirmation checkpoint — both paths converge here)

```
+--------------------------------------------------------+
| Step: 1 Select  (2)Pre-flight  3 Transfer  4 Summary     |
+--------------------------------------------------------+
|                                                          |
|  Ready to copy 42 posts from "US History (2025)"          |
|  into "US History — Period 3 (SIS Shell)".                 |
|                                                          |
|  Everything will land as Drafts with dates cleared —       |
|  nothing is visible to students until you publish it.      |
|                                                          |
|  (!) Running this copy again later will create duplicate   |
|      drafts — this check does not exist yet.               |
|                                                          |
|  [ <- Back ]                        [ Start Transfer ]    |
+--------------------------------------------------------+
```

- Second (final) touchpoint for the duplicate-run warning, immediately before
  the batch-write commits — belt-and-suspenders given the write is
  effectively irreversible from the UI (see Decisions).
