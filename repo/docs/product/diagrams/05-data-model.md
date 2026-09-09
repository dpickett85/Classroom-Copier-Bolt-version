# Data model (ER) — Classroom Copier (architecture theme 5)

Two structurally separate tables for `CourseWork` and `CourseWorkMaterial`
(per-type fidelity — see 04-architecture.md §5/§7 ADR) — no generic "post"
table.

```mermaid
erDiagram
    ACCOUNT ||--o{ COURSE : "teaches"
    ACCOUNT ||--o{ SESSION : "has"
    ACCOUNT ||--o{ TRANSFER_JOB : "runs"
    ACCOUNT ||--o| CREDIT_LEDGER : "stub, unused v1"

    COURSE ||--o{ TOPIC : "has"
    COURSE ||--o{ COURSE_WORK : "has"
    COURSE ||--o{ COURSE_WORK_MATERIAL : "has"

    TOPIC ||--o{ COURSE_WORK : "assigned to (nullable)"
    TOPIC ||--o{ COURSE_WORK_MATERIAL : "assigned to (nullable)"

    COURSE_WORK ||--o{ ATTACHMENT : "has (parentType=courseWork)"
    COURSE_WORK_MATERIAL ||--o{ ATTACHMENT : "has (parentType=courseWorkMaterial)"
    COURSE_WORK ||--o| RUBRIC : "may have"

    TRANSFER_JOB ||--o{ TRANSFER_JOB_ITEM : "scans"
    TRANSFER_JOB_ITEM }o--|| COURSE_WORK : "sourceType=courseWork (polymorphic, no FK)"
    TRANSFER_JOB_ITEM }o--|| COURSE_WORK_MATERIAL : "sourceType=courseWorkMaterial (polymorphic, no FK)"

    PREFLIGHT_SCAN ||--o{ PREFLIGHT_SCAN_ITEM : "scans"
    PREFLIGHT_SCAN ||--o{ TRANSFER_JOB : "job created from scan"

    RUBRIC ||--o{ RUBRIC_CRITERION : "has"
    RUBRIC_CRITERION ||--o{ RUBRIC_LEVEL : "has"

    ACCOUNT {
        string id PK
        string name
        string email
        string avatarUrl
    }
    COURSE {
        string id PK
        string name
        string section
        string state "ACTIVE | ARCHIVED"
        bool isSisRosterShell
    }
    TOPIC {
        string id PK
        string courseId FK
        string name
    }
    COURSE_WORK {
        string id PK
        string courseId FK
        string topicId FK "nullable"
        string workType "ASSIGNMENT|QUIZ_ASSIGNMENT|SHORT_ANSWER_QUESTION|MULTIPLE_CHOICE_QUESTION"
        string title
        string description
        string state "DRAFT|PUBLISHED|SCHEDULED"
        datetime creationTime
        datetime dueDate "nullable"
        int maxPoints "nullable"
        string answerConfig "jsonb, question types only"
        string quizFormLink "nullable, QUIZ_ASSIGNMENT only"
        string rubricId FK "nullable"
    }
    COURSE_WORK_MATERIAL {
        string id PK
        string courseId FK
        string topicId FK "nullable"
        string title
        string description
        string state
        datetime creationTime
        note NOTE "no dueDate column. no maxPoints column."
    }
    ATTACHMENT {
        string id PK
        string parentType "courseWork|courseWorkMaterial"
        string parentId FK
        string kind "driveFile|youTubeVideo|link|form"
        int sortOrder "total order for attachments 1-20 (D22)"
        string driveFileId "nullable"
        string url "nullable"
        string shareMode "VIEW|EDIT|STUDENT_COPY"
        string driveState "healthy|trashed|deleted|permission_locked"
        string ownerAccountId "nullable"
    }
    RUBRIC {
        string id PK
        string courseWorkId FK
        bool licenseBlocked
    }
    RUBRIC_CRITERION {
        string id PK
        string rubricId FK
        string title
        string description
        int sortOrder
    }
    RUBRIC_LEVEL {
        string id PK
        string criterionId FK
        string title
        string description
        int points
        int sortOrder
    }
    PREFLIGHT_SCAN {
        string id PK
        string accountId FK
        string sourceCourseId FK
        string targetCourseId FK
        int totalPostsScanned
        datetime scannedAt
    }
    PREFLIGHT_SCAN_ITEM {
        string id PK
        string scanId FK
        string sourceType "courseWork|courseWorkMaterial"
        string sourceId "polymorphic ref, no FK"
        string title
        string workType
        string topicId "nullable"
        int createdOrder "oldest-first sequence"
    }
    SESSION {
        string id PK
        string accountId FK
        datetime issuedAt
        datetime expiresAt
    }
    TRANSFER_JOB {
        string id PK
        string accountId FK
        string scanId FK "job created FROM this persisted scan (D11)"
        string sourceCourseId FK
        string targetCourseId FK
        string status "queued|running|completed|interrupted|failed"
        string rateLimitPause "nullable — {active, retryAfterSeconds}; a FIELD, not a status (D5)"
        int topicsCreatedOrMapped
        datetime createdAt
        datetime updatedAt
        datetime lastHeartbeatAt
    }
    TRANSFER_JOB_ITEM {
        string id PK
        string jobId FK
        string scanItemId FK "sourced from the persisted PreflightScanItem (D11, D14)"
        string sourceType "courseWork|courseWorkMaterial"
        string sourceId "polymorphic ref, no FK"
        string title
        string type "Assignment|QuizAssignment|Question|Material"
        string topicId "nullable, mapped"
        string outcome "pending|transferred|fallback_shell|skipped"
        string skipReason "nullable, closed vocabulary — see Notes (D14)"
        bool rubricDegraded "non-additive subset tag, never touches outcome"
        string typeSpecificFields "jsonb, shape per type"
        string notesJson "string[] — fallback note / rubric note / cap-overflow note"
        int attemptCount
        datetime nextAttemptAt "nullable"
        datetime attemptedAt "nullable, written immediately before provider call (D14)"
        string targetPostId "nullable, written in same statement as outcome=transferred (D14)"
        int createdOrder "oldest-first sequence"
    }
    CREDIT_LEDGER {
        string id PK
        string accountId FK
        int balance
        string lastTransactionReason
    }
```

## Notes
- `outcome` is a **single-valued, NOT NULL** enum (`pending` only until the
  engine resolves it) — this is what makes the reconciliation formula
  `(transferred) + (fallback_shell) + (skipped) = total items` a schema-level
  guarantee rather than a documentation claim. See §5/§7 ("Reconciliation-by-
  construction").
- `rubricDegraded` never touches `outcome` — it is a strictly orthogonal
  boolean, which is what makes "non-additive subset tag" true by
  construction.
- `TRANSFER_JOB_ITEM` rows are inserted as `pending` **before** any provider
  call is attempted (D2), so `total posts scanned = count(items)` by
  definition — a crash mid-transfer cannot produce a missing row, only a
  stuck `pending` one (resolved by the boot-time reconciliation pass, D1).
- `COURSE_WORK` and `COURSE_WORK_MATERIAL` share no table — a Material row
  physically cannot carry a `dueDate` or `maxPoints` value because those
  columns do not exist on it.
- **The pre-flight scan is persisted** (D11): `PREFLIGHT_SCAN` +
  `PREFLIGHT_SCAN_ITEM` (one row per enumerated post, in `post-enumerator`'s
  total order) so `totalPostsScanned` is `count(PreflightScanItem)` — one
  measurement, read twice. `POST /transfer-jobs` inserts `TRANSFER_JOB_ITEM`
  rows **from these stored rows**, never a fresh re-enumeration, which is why
  `TRANSFER_JOB_ITEM.scanItemId` references a `PREFLIGHT_SCAN_ITEM` and a
  `TRANSFER_JOB` is created FROM a `PREFLIGHT_SCAN`.
- **`TransferJob.status` is a clean lifecycle enum** —
  `queued | running | completed | interrupted | failed`. Rate-limit pause is
  a **nullable `rateLimitPause` field**, not a status (D5): the non-terminal
  predicate the unique index and `/active` both derive from is a single
  definition, `status NOT IN ('completed','interrupted','failed')`.
- `TRANSFER_JOB_ITEM.skipReason` is a closed vocabulary, split by who caused
  it: **user skips** — `user_skip_post`, `user_skip_attachment`; **system
  skips** — `provider_error`, `server_interrupted`, `rate_limit_exhausted`.
  The API exposes `skippedByUser` and `skippedBySystem` as separate counts;
  only the labelling splits — the reconciliation sum stays three-term over
  `skipped_total` (D14).
- `RUBRIC_CRITERION` and `RUBRIC_LEVEL` exist so rubric criteria/levels copy
  **verbatim** rather than being flattened into a note (D23) — `getRubric`
  then `createRubric` is the real API's get-then-create shape.
