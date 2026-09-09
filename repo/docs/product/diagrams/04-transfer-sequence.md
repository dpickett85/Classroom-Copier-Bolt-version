# Sequence diagram — Batch transfer, rate-limit pause, and interrupt/reconnect (F12)

Architecture theme 4: runtime behavior for the core scenario, including the
job/poll contract (UX P0-2) and the retry-exhaustion path (UX P0-3, F13).

```mermaid
sequenceDiagram
    actor T as Teacher (browser tab)
    participant FE as frontend-api-client
    participant CAPI as courses-api
    participant PFE as preflight-engine
    participant API as transfer-job-api
    participant TE as transfer-engine
    participant DB as SQLite (PreflightScan/Item, TransferJob/Item)
    participant MP as mock-classroom-provider

    T->>FE: Confirm source/target on Selection screen
    FE->>CAPI: POST /courses/:sourceId/preflight {targetId}
    CAPI->>PFE: scan(sourceId, targetId)
    PFE->>MP: post-enumerator: paginated listCourseWork / listCourseWorkMaterials (merge, total order)
    MP-->>PFE: posts[] (oldest-first)
    PFE->>DB: Insert PreflightScan + one PreflightScanItem per post (D11)
    DB-->>PFE: scanId
    PFE-->>CAPI: {scanId, totalPostsScanned, findings[]}
    CAPI-->>FE: {scanId, totalPostsScanned, findings[]}
    FE-->>T: Action Sheet Modal (if findings) or silent auto-advance to Ready to Transfer

    T->>FE: Click "Start Transfer"
    FE->>API: POST /api/transfer-jobs {scanId, resolutions[]}
    API->>DB: Insert TransferJob(status=queued, scanId)
    API->>DB: Insert TransferJobItem(outcome=pending) per stored PreflightScanItem row (D2, D11 — from the scan, never re-enumerated)
    API-->>FE: 202 {jobId}
    FE-->>T: Navigate to Batch Transfer Progress

    par Async execution (survives the HTTP response)
        API->>TE: run(jobId)
        TE->>DB: mark job status=running
        TE->>MP: listTopics / createTopic (old→new map)
        TE->>DB: persist topic map, topicsCreatedOrMapped count
        loop each item, in scan order (oldest-first)
            alt resolution = "Skip <Type>" (user skip, pre-resolved by Action Sheet)
                TE->>DB: item.outcome=skipped, skipReason=user_skip_post (no provider call — the only branch that legitimately writes no post)
            else attachment healthy, or resolution requires a create (Create Draft Shell with Note / Skip Attachment and Note Draft / Copy to My Drive / Link Existing File)
                TE->>DB: item.attemptedAt=now() (D14 — written immediately before the provider call)
                alt resolution = fallback-shell (F2/F3: Create Draft Shell with Note / Skip Attachment and Note Draft)
                    TE->>MP: createCourseWork (shell payload, attachment omitted, note appended)
                else attachment healthy, or resolution = Copy to My Drive / Link Existing File
                    TE->>MP: createCourseWork / createCourseWorkMaterial (full payload, materials[] included)
                end
                alt success
                    MP-->>TE: id
                    TE->>DB: item.outcome=transferred|fallback_shell, targetPostId=id (same statement, D14)
                else HTTP 429 (F6: transient / F13: persistent)
                    MP-->>TE: RateLimitError{retryAfterMs}
                    TE->>DB: job.rateLimitPause={active:true, retryAfterSeconds}
                    TE->>TE: exponential backoff, up to 5 attempts
                    alt retry succeeds (F6)
                        TE->>MP: retry createCourseWork / createCourseWorkMaterial
                        MP-->>TE: id
                        TE->>DB: item.outcome=transferred, targetPostId=id, rateLimitPause=null
                    else 5 attempts exhausted (F13, D13)
                        TE->>MP: createCourseWork (BARE shell — no materials[], rate-limit-exhaustion note — a DIFFERENT call, distinct payload from the primary create)
                        alt bare shell succeeds
                            MP-->>TE: id
                            TE->>DB: item.outcome=fallback_shell, targetPostId=id, note="rate-limit exhaustion" (D6 constant), rateLimitPause=null
                        else bare shell also fails
                            TE->>DB: item.outcome=skipped, skipReason=rate_limit_exhausted, rateLimitPause=null
                        end
                    end
                else any other provider error / unexpected exception (D12)
                    MP-->>TE: PermissionError | NotFoundError | throw
                    alt a shell post was already created
                        TE->>DB: item.outcome=fallback_shell, targetPostId=id
                    else no shell exists
                        TE->>DB: item.outcome=skipped, skipReason=provider_error
                    end
                end
            end
        end
        TE->>DB: sweep — resolve any remaining outcome=pending items (skipped/provider_error); assert count(pending)==0 (D12)
        TE->>DB: job.status=completed
    and Poll loop (client-driven, independent of execution)
        loop every ~1.5s while status not terminal
            FE->>API: GET /transfer-jobs/:id/status
            API->>DB: aggregate counts (GROUP BY outcome)
            DB-->>API: compact status
            API-->>FE: {status, counts, currentItem, rateLimitPause}
            FE-->>T: update progress bar / rate-limit banner
        end
    end

    Note over TE,DB: If the executor's top-level try/catch catches an unhandled<br/>exception, it resolves every remaining pending item and sets<br/>job.status=failed instead of completed (D12).

    Note over T,FE: Browser tab refreshed or closed here — server-side<br/>execution above is unaffected (not tied to the HTTP connection).

    T->>FE: (reload) app mounts
    FE->>API: GET /transfer-jobs/active
    API->>DB: find non-terminal job for signed-in account
    DB-->>API: jobId
    API-->>FE: {jobId}
    FE->>API: GET /transfer-jobs/:id/status
    API-->>FE: current accurate progress (no restart, no duplication)
    FE-->>T: resume Batch Transfer Progress view

    T->>FE: transfer reaches status=completed
    FE->>API: GET /transfer-jobs/:id/items
    API->>DB: full itemized log
    API-->>FE: items[] (fetched once, not streamed per-item)
    FE-->>T: render Completion Summary
```

## Notes
- **The pre-flight scan is persisted, not re-enumerated** (D11): `POST
  /courses/:sourceId/preflight` writes one `PreflightScan` + one
  `PreflightScanItem` per enumerated post and returns `{scanId,
  totalPostsScanned}`; `POST /transfer-jobs {scanId, resolutions[]}` inserts
  `TransferJobItem` rows **from those stored rows** — one measurement, two
  readers, never a fresh re-enumeration between scan and job creation.
- **Every field on `TransferJobItem` is named `outcome`, not `status`**
  (the schema field is `outcome`; `status` is reserved for `TransferJob`'s
  own lifecycle enum). Every `item.*` write above uses `item.outcome=…`.
- **The F2/F3 fallback resolution check happens before the provider call,
  not after it.** A pre-resolved "Create Draft Shell with Note" or "Skip
  Attachment and Note Draft" finding still results in an actual
  `createCourseWork`/`createCourseWorkMaterial` call (shell payload,
  attachment omitted, note appended) — a fallback shell is a real post, not
  just a ledger row. Only "Skip \<Type\>" legitimately writes no post at all.
- **The rate-limit-exhaustion fallback is a distinct call with a distinct
  payload** (D13): a bare shell create with no `materials[]`, issued only
  after 5 backoff attempts are exhausted on the *primary* create — never a
  retry of the same call that just failed. If that bare-shell create itself
  fails, the item resolves `skipped` / `rate_limit_exhausted` rather than
  looping forever.
- **The outcome function is total** (D12): success, 429-exhaustion, and any
  other provider error or unexpected exception all resolve to a terminal
  outcome — `fallback_shell` where a shell was actually created, otherwise
  `skipped` with `skipReason=provider_error`. No code path leaves an item
  `pending` after the item loop completes; a pre-`completed` sweep and the
  executor's top-level `.catch()` (→ `job.status=failed`) are the last two
  backstops.
- The **202 + poll** shape is what makes browser-refresh resumability (F12)
  free: recovery is "ask the server what's true," never "reconstruct client
  state." See 04-architecture.md §7 ADR "Job-progress transport."
- The itemized `/items` fetch happens once, at completion — this is also
  what keeps the `aria-live` region from having to announce up to 50 per-item
  events (UX §6 accessibility constraint); the poll payload is intentionally
  compact.
- **Cold start** is orthogonal to this diagram: it wraps *every* individual
  HTTP call in `frontend-api-client` (a 2s-then-overlay, 60s-then-error state
  machine — see §4/§8), not just the ones shown here. Because polling
  produces steady traffic during an active job, Render's 15-minute idle
  timer cannot fire mid-transfer — cold start realistically only occurs at
  the session's first action, or after the user leaves an idle screen
  untouched for >15 minutes.
