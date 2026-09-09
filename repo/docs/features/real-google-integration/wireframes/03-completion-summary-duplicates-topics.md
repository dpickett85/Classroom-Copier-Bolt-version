# Completion Summary — duplicate-skip & topic-reuse reporting (low-fi)

> Extends `docs/product/wireframes/05-completion-summary.md` for Phase 2.
> Structure only, no visual style (UI stage).

## 3a. Stat tiles (revised)

```
+--------------------------------------------------------+
|  Transfer complete.                                        |
|                                                          |
|  [ Topics: 4 created ] [ Topics: 2 reused ]                 |
|  [ Drafts transferred: 32 ] [ Fallback shells: 2 ]           |
|  [ Skipped, already existed: 5 ] [ Skipped by you: 1 ]       |
|  [ Rubric notes added: 1 ]                                  |
|                                                          |
|  (i) 32 + 2 + 1 + 5 = 40 of 40 items scanned — every item    |
|      resolved to a transfer, fallback, or skip.             |
|                                                          |
|  (i) Topics are reported separately and never counted in     |
|      the item total above — reusing an existing topic is     |
|      not an item outcome. 4 created + 2 reused = 6 topics    |
|      referenced by this transfer.                            |
+--------------------------------------------------------+
```

- **"Skipped, already existed"** is a new tile, split out from the existing
  **"Skipped by you"** tile — both feed the same `skipped` bucket in the
  reconciliation sum (PM §6.5, unchanged invariant shape), but are reported as
  two distinct, separately-labeled numbers so a teacher can tell "the product
  found this already there" from "I chose to skip this" at a glance, without
  opening the log. This is the concrete answer to the assignment's trust
  requirement: a skip must visibly mean "already there," never read as "we
  lost it."
- **Topics split into "created" and "reused"** (PM §6.8), replacing v1's single
  "Topics: N created/mapped" tile. Both numbers stay visually adjacent to each
  other but structurally separate from the item stat tiles — a second visual
  grouping, not a sixth term jammed into the reconciliation line.
- **Reconciliation line** is otherwise unchanged in shape from v1 (transferred
  + fallback + skipped == count(items)) — it now simply has more terms feeding
  the same "skipped" side, spelled out for transparency rather than
  collapsed into one number, so the arithmetic is checkable by eye against the
  tiles above it.
- **Topics callout line** is new: makes explicit, in words, that topics are
  outside the item sum — directly satisfies PM §6.8's requirement that the
  parallel accounting line not imply topics are items.

## 3b. Itemized log — duplicate & user-skip rows distinguished

```
|  Itemized log:               [filter: All v]                |
|  --------------------------------------------------------|
|  Title       Type    Topic  Outcome              Note        |
|  Week 1      Material Unit1 Already in course     Matches    |
|  Reading                                          existing   |
|                                                    Draft      |
|  Essay 1     Assignm. Unit2 Already in course     Matches    |
|                                                    existing   |
|                                                    Published  |
|                                                    post       |
|  Rubric Q    Question (none)Skipped — you chose   Skip       |
|                             to skip                Question   |
|  Quiz: Ch.2  Quiz     Unit2 Transferred                       |
|  Final       Assignm. Unit3 Transferred           Rubric not  |
|  Project                                          copied      |
|                                                    (license)   |
|  ...                                                        |
+--------------------------------------------------------+
```

- **Outcome column wording is deliberately different between the two skip
  kinds:** "Already in course" for `duplicate_title` rows vs. "Skipped — you
  chose to skip" for `skippedByUser` rows. Same underlying bucket, different
  label — the distinction the assignment calls out has to be legible from the
  Outcome column alone, without reading the Note.
- **Note column for duplicate rows** carries the destination match (title +
  state), same content as the Ready-to-Transfer disclosure list — a teacher
  who expands neither screen can still find this by scanning the log later.
- **Filter dropdown extended:** `All / Transferred / Fallback / Already in
  course / Skipped by you` — splitting the old single "Skipped" filter option
  into the two kinds, so a teacher auditing "what got skipped and why" doesn't
  have to read every row to separate the two populations.
- **Type-specific fields column (v1, unchanged):** duplicate rows populate it
  per the same per-type table as any other row (e.g. a duplicate Assignment
  still shows "Due: cleared · Max pts: N") — being a duplicate doesn't exempt
  a row from the existing per-type display rule, since the field describes the
  *source* item, not the outcome.
- **CSV export (PM §6.4, unchanged structurally):** the reason column already
  exists in the export; `duplicate_title` is simply a new value in it,
  matching the on-screen "Already in course" label's underlying reason code.

## 3c. Topic detail panel (new)

```
|  Topics referenced by this transfer:        [expand]        |
|  --------------------------------------------------------|
|  "Unit 1"  — created                                        |
|  "Unit 2"  — reused (exact name match)                       |
|  "Unit 3"  — reused (matched after ignoring case/spacing)     |
|             Note: 2 existing topics were named "Unit 3" —     |
|             reused the first one Google returned.             |
|  "Unit 4"  — created                                         |
+--------------------------------------------------------+
```

- Sits near the Topics tiles (3a), collapsed by default like the pre-flight
  disclosure lists. Gives the "created vs. reused" tiles a per-topic breakdown
  without turning topics into log rows (they are containers, not items — PM
  §6.5) and without inventing a second table with different columns from the
  itemized log.
- **Ambiguity note carries through from pre-flight (2c) to here** — a teacher
  who skipped the pre-flight disclosure still sees it post-hoc, satisfying the
  same "never silently resolved" principle the duplicate-skip rows already
  follow.

## Worked example (for architect/engineer/QA reconciliation math)

40 items scanned. 32 transferred cleanly. 2 became fallback shells (one of
which is also rubric-degraded — combined-outcome rule, v1 §4, unchanged). 1
skipped by user choice (Action Sheet). 5 skipped as duplicates. 6 topics
referenced: 4 newly created, 2 reused (one of the 2 reused ambiguously, per
3c).

```
32 (transferred) + 2 (fallback shells) + 1 (skipped by you) + 5 (already existed) = 40 of 40 items scanned
4 (topics created) + 2 (topics reused) = 6 topics referenced — reported separately, never in the sum above
```

This is the fixture this wireframe is drawn from (see PM brief §6.6's new
dedupe fixture) — QA should be able to point at this exact worked example when
checking the Completion Summary against the fixture's seeded counts.
