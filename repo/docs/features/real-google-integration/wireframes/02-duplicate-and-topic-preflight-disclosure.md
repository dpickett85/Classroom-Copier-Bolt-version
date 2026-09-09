# Duplicate & topic reuse disclosure — pre-flight and Ready to Transfer (low-fi)

> Extends `docs/product/wireframes/03-preflight-and-action-sheet.md` for Phase 2.
> Structure only, no visual style (UI stage).

## 2a. Pre-flight scanning (revised status text)

```
+--------------------------------------------------------+
| Step: 1 Select  (2)Pre-flight  3 Transfer  4 Summary     |
+--------------------------------------------------------+
|                                                          |
|              (spinner / progress animation)              |
|          Checking topics...                              |
|          Checking for existing items...                   |
|          Verifying attachments...                          |
|          Checking permissions...                          |
|                                                          |
+--------------------------------------------------------+
```

- New cycling line "Checking for existing items..." reflects the new
  duplicate-detection pass (PM brief §6.3) added to the persisted scan
  alongside the existing topic/attachment/permission checks. Still silent and
  auto-advancing when nothing needs a decision — see 2c for what "nothing
  needs a decision" now means with duplicates in the mix.

## 2b. Action Sheet Modal (revised — duplicates never appear here)

```
+--------------------------------------------------------+
|  We found 1 item that needs your attention before        |
|  copying. 5 items already exist in the destination and    |
|  will be skipped automatically — see the next screen.     |
|                                              [x Cancel]    |
|                                                          |
|  [ ] Apply recommended fixes automatically                |
|  --------------------------------------------------------|
|  "Rubric Template.docx" — attached to "Essay 1"             |
|  Issue: Permission-locked (co-teacher owned)                |
|   ( ) Copy to My Drive (Become Owner)   [recommended]        |
|   ( ) Link Existing File (Risk Warning)                      |
|   ( ) Skip Attachment and Note Draft                          |
|  --------------------------------------------------------|
|                       [ Continue -> ]                       |
+--------------------------------------------------------+
```

- **Precedence rule (PM §6.3, decided):** a `duplicate_title` item never enters
  this modal, even if it also carries a trashed/locked attachment — the
  duplicate skip short-circuits the health check entirely. The modal's count
  ("We found N items that need your attention") reflects **only** non-duplicate
  flagged items.
- The one-line mention of duplicate items here ("5 items already exist...")
  is informational only, not actionable — it exists so a teacher who *does*
  see this modal isn't left wondering why the count seems low relative to the
  course size. It is not a substitute for the full disclosure in 2c, which is
  where the inspectable list lives.
- If there are **zero** non-duplicate flagged items, this modal never renders
  at all — the flow goes straight from 2a to 2c, same silent-when-clean
  principle as v1, now scoped to "clean of *actionable* issues" rather than
  "clean of everything."

## 2c. Ready to Transfer — with duplicate & topic-reuse disclosure (revised)

```
+--------------------------------------------------------+
| Step: 1 Select  (2)Pre-flight  3 Transfer  4 Summary     |
+--------------------------------------------------------+
|                                                          |
|  Ready to copy 37 of 42 posts from "US History (2025)"    |
|  into "US History — Period 3 (SIS Shell)".                 |
|                                                          |
|  Everything will land as Drafts with dates cleared —       |
|  nothing is visible to students until you publish it.      |
|                                                          |
|  (i) Classroom Copier checks for items that already exist  |
|      and skips them — safe to run more than once.          |
|      Matches are found by title only (§6.7 non-goal note:   |
|      content changes since the last run aren't detected).   |
|                                                          |
|  ▸ 5 items already exist in the destination and will be    |
|    be skipped  [expand]                                    |
|                                                          |
|  ▸ 2 topics already exist and will be reused, not          |
|    recreated  [expand]                                     |
|                                                          |
|  [ <- Back ]                        [ Start Transfer ]    |
+--------------------------------------------------------+
```

### Expanded duplicate-items list

```
|  ▾ 5 items already exist in the destination and will be    |
|    be skipped  [collapse]                                  |
|  --------------------------------------------------------|
|  "Week 1 Reading" (Material) — matches existing Draft       |
|  "Essay 1" (Assignment) — matches existing Published post   |
|  "Unit 1 Quiz" (Quiz assignment) — matches existing Draft    |
|  "Syllabus" (Material) — matches existing Published post     |
|  "Discussion: Ch.3" (Question) — matches existing Draft      |
+--------------------------------------------------------+
```

- Each row: source item title + coursework type, and which destination item it
  matched (title + state — draft or published), per PM §6.4. This is the
  "inspectable list of which items will be skipped and which destination item
  each matched" the brief requires.
- The whole disclosure — count line, expandable list, and topics line — is
  the **only** required change to this screen's content beyond the count
  correction. It renders even when the count is 0 (nothing hidden, nothing
  padded away) so the disclosure principle holds uniformly.

### Expanded topic-reuse list

```
|  ▾ 2 topics already exist and will be reused, not          |
|    recreated  [collapse]                                   |
|  --------------------------------------------------------|
|  "Unit 2" — reused (exact name match)                        |
|  "Unit 3" — reused (matched after ignoring case/spacing)      |
+--------------------------------------------------------+
```

- Mirrors the duplicate-items list structurally, but for topics (PM §6.8).
  Topics have no draft/published state, so the match description is simpler —
  just the matched destination topic name and, where relevant, a short note on
  *why* it matched (exact vs. normalized).
- If a topic name matched more than one existing destination topic
  (ambiguous — PM §6.8), that row carries a visible note: *"2 existing topics
  are named 'Unit 2' — reusing the first one Google returned."* This is the
  only place the ambiguity surfaces before commit; it recurs in the Completion
  Summary's topic detail panel (see `03-completion-summary-duplicates-topics.md`).

### All-duplicate edge case (re-running a fully-completed transfer)

```
+--------------------------------------------------------+
|  Ready to copy 0 of 42 posts from "US History (2025)"      |
|  into "US History — Period 3 (SIS Shell)".                 |
|                                                          |
|  All 42 items already exist in the destination — there's   |
|  nothing new to copy. Running this will skip everything     |
|  and won't create any duplicates.                           |
|                                                          |
|  ▸ 42 items already exist... [expand]                       |
|                                                          |
|  [ <- Back ]                        [ Start Transfer ]    |
+--------------------------------------------------------+
```

- Extends v1's existing "0 posts to copy" empty-course treatment (v1 §5) to
  the "all posts are duplicates" case, which is the *expected* result of the
  product's own headline promise ("run it as many times as you like") and
  must never read as an error or a stuck state. `Start Transfer` still works —
  it produces a Completion Summary with 0 transferred and N duplicate-skipped,
  which is the honest, correct outcome of a clean re-run.

## Notes for architect/engineer

- The persisted-scan pattern (v1: "one measurement read twice," `preflight-
  engine.ts`) is retained — the duplicate/topic-match pass writes into the
  same persisted scan the Action Sheet and Ready to Transfer both read, rather
  than re-querying the destination twice.
- The disclosure lists (duplicate items, topic reuse) are collapsed by default
  to keep the confirmation screen scannable, expandable via keyboard
  (`Enter`/`Space` on the disclosure triangle, matching standard `<details>`-
  equivalent semantics) — not a new interaction pattern, just applying the
  existing accessibility bar (v1 §6) to a new element.
