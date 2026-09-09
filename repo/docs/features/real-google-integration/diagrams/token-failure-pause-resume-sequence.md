# Diagram — Google token-failure pause-and-resume (Decision F)

> Referenced from `../04-architecture.md` §4.2 and **§4.3**. Shows the
> DB-durable pause mechanism end to end, including the reconciler's
> grace-period branch that fires only if the user never reconnects.
>
> **Revised after P0-B resolved NEGATIVE.** The previous version of this
> diagram showed `execute()` resuming "from the first `outcome='pending'`
> item" as existing behavior. It is not — the item query filters on `jobId`
> alone (`transfer-engine.ts:476-489`), so a resume re-creates every
> already-transferred post in the destination course. The resume leg below
> now shows the **fixed** engine, and marks which steps are new work.

```mermaid
sequenceDiagram
    participant TE as transfer-engine (execute loop)
    participant DB as TransferJob row (Postgres/SQLite)
    participant JR as job-reconciler (interval tick)
    actor Teacher
    participant Auth as google-oauth-routes

    Note over TE,DB: PRE-LOOP PHASE — buildTopicMap + enumeratePosts.<br/>AuthExpiredError here is OUTSIDE processItem's try (FIX F7):<br/>route it to the same pauseForReauth(), with no item to mark.
    TE->>DB: buildTopicMap: seed from topicMapJson (own prior work),<br/>then topicReuseJson (preflight snapshot); createTopic ONLY<br/>for unmapped topics; persist map each step (FIX 2)
    TE->>TE: item N: provider call throws AuthExpiredError
    TE->>DB: item N -> outcome=skipped, skipReason=provider_error
    TE->>DB: googleReauthRequiredAt=now(), executorId=null<br/>status STAYS 'running', activeAccountId UNCHANGED<br/>('running' + null executorId is what resume's lease re-claims)
    Note over TE: returns — NO in-process wait.<br/>Items N+1..k stay outcome=pending, durable in the DB.

    loop every reconciler interval
        JR->>DB: read jobs needing reconciliation
        alt googleReauthRequiredAt set AND younger than GOOGLE_REAUTH_GRACE_MS
            JR->>JR: SKIP — legitimately paused, not stale
        else googleReauthRequiredAt set AND older than GOOGLE_REAUTH_GRACE_MS
            JR->>DB: resolve pending items -> skipped/server_interrupted<br/>status='interrupted' (existing status, no new value)
        else ordinary staleness rule (heartbeat-based)
            JR->>DB: existing wedge-recovery behavior (unchanged from v1)
        end
    end

    Teacher->>Auth: clicks "Reconnect Google account"<br/>(full-page OAuth redirect, same flow as sign-in)
    Auth->>Auth: exchanges code, stores fresh encrypted token
    Auth->>DB: finds the paused job BY ACCOUNT<br/>{accountId: session account, googleReauthRequiredAt: not null}<br/>never a job id from the request (S8)
    Auth->>DB: clear googleReauthRequiredAt, bump lastHeartbeatAt
    Auth->>TE: resume(jobId) — same entry point job creation uses
    TE->>DB: re-check accessTokenExpiresAt remaining<br/>(FIX F9 — re-pause rather than start on a dying token)
    rect rgb(255, 240, 240)
        Note over TE,DB: THE FIX — NOT current behavior.<br/>Today the item query is `where: { jobId }` with no outcome<br/>filter and no outcome in the select, so EVERY terminal item<br/>re-enters and is re-created in the destination course.
        TE->>DB: findMany where { jobId, outcome: 'pending' }<br/>select adds outcome, attemptedAt, claimedTargetPostId (FIX 1)
        TE->>TE: pending + attemptedAt NOT NULL = evidence-ambiguous:<br/>resolve from claimedTargetPostId, do NOT dispatch (FIX 3)
    end
    TE->>DB: items N+1..k transfer; ZERO provider calls for<br/>anything terminal after pass 1 (the acceptance assertion)
    TE->>DB: job reaches status=completed, reconciliation sum balances
```

**Why this is durable, not just simple:** the pause state lives entirely in
`TransferJob` rows, not in a process-memory `await`. A Render restart at any
point during the pause loses nothing — the job is exactly as resumable as
any other interrupted job in this architecture.

**Why a balanced reconciliation sum is not sufficient evidence.** The last
step above is necessary but *not* sufficient, and this is the trap that hid
P0-B. `finish()` writes through `updateMany({ where: { id, outcome:
'pending' } })`, so a re-run of an already-terminal item has its ledger write
**refused** — the counts still balance and `checkInvariant` still returns
`holds: true` while duplicate posts sit in the teacher's real course. The
only assertion that distinguishes the fixed engine from the broken one is a
**count of provider create calls**. See `04-architecture.md` §4.3 and §6.1;
Decision F's ADR row carries the pause-mechanism reasoning.
