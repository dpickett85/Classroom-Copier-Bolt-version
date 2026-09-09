/**
 * shared-contracts (D17) — the SINGLE declaration of every client<->server DTO.
 *
 * Each payload is declared exactly once, as a zod schema, and exported as both
 * a runtime validator and an inferred TypeScript type. The client imports these
 * types; it never redeclares a payload shape. Before this module existed, four
 * cross-tier edges were typed twice and drift between what the server returned
 * and what the client expected was invisible to the compiler — which
 * contradicted the architecture's own governing principle that the
 * reconciliation arithmetic has exactly one implementation in the system while
 * permitting the *type* of the payload carrying it to have two.
 */
import { z } from 'zod';
/** Which of the two structurally-separate coursework tables a post lives in. */
export declare const SourceTypeSchema: z.ZodEnum<{
    courseWork: "courseWork";
    courseWorkMaterial: "courseWorkMaterial";
}>;
export type SourceType = z.infer<typeof SourceTypeSchema>;
export declare const WorkTypeSchema: z.ZodEnum<{
    ASSIGNMENT: "ASSIGNMENT";
    QUIZ_ASSIGNMENT: "QUIZ_ASSIGNMENT";
    SHORT_ANSWER_QUESTION: "SHORT_ANSWER_QUESTION";
    MULTIPLE_CHOICE_QUESTION: "MULTIPLE_CHOICE_QUESTION";
}>;
export type WorkType = z.infer<typeof WorkTypeSchema>;
export declare const CourseStateSchema: z.ZodEnum<{
    ACTIVE: "ACTIVE";
    ARCHIVED: "ARCHIVED";
}>;
export type CourseState = z.infer<typeof CourseStateSchema>;
export declare const CourseWorkStateSchema: z.ZodEnum<{
    DRAFT: "DRAFT";
    PUBLISHED: "PUBLISHED";
}>;
export type CourseWorkState = z.infer<typeof CourseWorkStateSchema>;
export declare const ShareModeSchema: z.ZodEnum<{
    VIEW: "VIEW";
    EDIT: "EDIT";
    STUDENT_COPY: "STUDENT_COPY";
}>;
export type ShareMode = z.infer<typeof ShareModeSchema>;
/**
 * The single-valued, NOT-NULL outcome enum. There is no representable state in
 * which an item lands in two buckets. `pending` IS a fourth representable
 * state — the schema does not forbid fall-through, which is why the totality
 * obligations (D12) exist in `transfer-engine` with their own acceptance gates.
 */
export declare const OutcomeSchema: z.ZodEnum<{
    pending: "pending";
    transferred: "transferred";
    fallback_shell: "fallback_shell";
    skipped: "skipped";
}>;
export type Outcome = z.infer<typeof OutcomeSchema>;
/** Closed skip vocabulary. Exactly three of these are the teacher's choice. */
export declare const SkipReasonSchema: z.ZodEnum<{
    user_skip_post: "user_skip_post";
    user_skip_attachment: "user_skip_attachment";
    cancelled_by_user: "cancelled_by_user";
    provider_error: "provider_error";
    server_interrupted: "server_interrupted";
    rate_limit_exhausted: "rate_limit_exhausted";
    duplicate_title: "duplicate_title";
}>;
export type SkipReason = z.infer<typeof SkipReasonSchema>;
/** `cancelled_by_user` — the teacher clicked Cancel, so every item the
 *  cancellation drains is honestly "Skipped by you", the same as an
 *  Action-Sheet skip. */
export declare const USER_SKIP_REASONS: readonly SkipReason[];
export declare const SYSTEM_SKIP_REASONS: readonly SkipReason[];
/**
 * The third bucket. It has exactly one member today, and it is a named constant
 * rather than an inline comparison so that the three-way partition is one
 * declaration the exhaustiveness test can check against `SkipReasonSchema`.
 */
export declare const DUPLICATE_SKIP_REASONS: readonly SkipReason[];
export declare function isSystemSkip(reason: SkipReason | null | undefined): boolean;
export declare function isDuplicateSkip(reason: SkipReason | null | undefined): boolean;
export declare function isUserSkip(reason: SkipReason | null | undefined): boolean;
/**
 * Job lifecycle. `rate_limited_pause` is deliberately NOT here — a rate-limit
 * pause is a nullable field on the job, not a status (D5), so the non-terminal
 * predicate that the partial unique index and `/active` both derive from is a
 * single definition rather than two that disagree.
 */
export declare const JobStatusSchema: z.ZodEnum<{
    queued: "queued";
    running: "running";
    completed: "completed";
    interrupted: "interrupted";
    failed: "failed";
}>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
/** The one definition of "terminal". Everything else derives from it (D5). */
export declare const TERMINAL_JOB_STATUSES: readonly JobStatus[];
export declare const NON_TERMINAL_JOB_STATUSES: readonly JobStatus[];
export declare function isTerminalJobStatus(status: JobStatus): boolean;
export declare const AccountSummarySchema: z.ZodObject<{
    id: z.ZodString;
    displayName: z.ZodString;
    email: z.ZodString;
    initials: z.ZodString;
    pictureUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export type AccountSummary = z.infer<typeof AccountSummarySchema>;
export declare const MockAccountsResponseSchema: z.ZodObject<{
    accounts: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        displayName: z.ZodString;
        email: z.ZodString;
        initials: z.ZodString;
        pictureUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type MockAccountsResponse = z.infer<typeof MockAccountsResponseSchema>;
export declare const SignInRequestSchema: z.ZodObject<{
    accountId: z.ZodString;
}, z.core.$strip>;
export type SignInRequest = z.infer<typeof SignInRequestSchema>;
export declare const SessionResponseSchema: z.ZodObject<{
    account: z.ZodObject<{
        id: z.ZodString;
        displayName: z.ZodString;
        email: z.ZodString;
        initials: z.ZodString;
        pictureUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
/**
 * `GET /api/auth/google/url` — the authorization URL to send the browser to.
 *
 * The URL is BUILT SERVER-SIDE and handed over ready-made, rather than
 * assembled in the client from a client id: the PKCE verifier and the state
 * nonce are minted in the same request and stored in an httpOnly cookie, so the
 * two halves of the flow cannot drift apart, and no client secret or PKCE
 * verifier ever exists in the public bundle.
 */
export declare const GoogleAuthUrlResponseSchema: z.ZodObject<{
    url: z.ZodString;
}, z.core.$strip>;
export type GoogleAuthUrlResponse = z.infer<typeof GoogleAuthUrlResponseSchema>;
/**
 * The three sign-in failure states (UX 1e/1f/1g), as the closed vocabulary the
 * server puts in `?authError=` and the client renders copy for. A closed set,
 * not a free string, so an unrecognised value degrades to the generic case
 * rather than rendering a server-supplied string into the page.
 */
export declare const AuthErrorSchema: z.ZodEnum<{
    denied: "denied";
    expired: "expired";
    generic: "generic";
}>;
export type AuthError = z.infer<typeof AuthErrorSchema>;
export declare const CourseRoleSchema: z.ZodEnum<{
    source: "source";
    target: "target";
}>;
export type CourseRole = z.infer<typeof CourseRoleSchema>;
export declare const CourseSummarySchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    section: z.ZodNullable<z.ZodString>;
    state: z.ZodEnum<{
        ACTIVE: "ACTIVE";
        ARCHIVED: "ARCHIVED";
    }>;
    isSisShell: z.ZodBoolean;
    postCount: z.ZodNumber;
}, z.core.$strip>;
export type CourseSummary = z.infer<typeof CourseSummarySchema>;
export declare const CourseListResponseSchema: z.ZodObject<{
    courses: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        section: z.ZodNullable<z.ZodString>;
        state: z.ZodEnum<{
            ACTIVE: "ACTIVE";
            ARCHIVED: "ARCHIVED";
        }>;
        isSisShell: z.ZodBoolean;
        postCount: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type CourseListResponse = z.infer<typeof CourseListResponseSchema>;
export declare const AttachmentIssueSchema: z.ZodEnum<{
    trashed: "trashed";
    deleted: "deleted";
    permission_locked: "permission_locked";
}>;
export type AttachmentIssue = z.infer<typeof AttachmentIssueSchema>;
/**
 * The five Action-Sheet options, as a closed set. `transfer-engine` maps each
 * to exactly one outcome bucket (D15) — the mapping is code, not inference.
 */
export declare const ResolutionKindSchema: z.ZodEnum<{
    create_draft_shell_with_note: "create_draft_shell_with_note";
    skip_post: "skip_post";
    copy_to_my_drive: "copy_to_my_drive";
    link_existing_file: "link_existing_file";
    skip_attachment_and_note_draft: "skip_attachment_and_note_draft";
}>;
export type ResolutionKind = z.infer<typeof ResolutionKindSchema>;
export declare const PreflightOptionSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        create_draft_shell_with_note: "create_draft_shell_with_note";
        skip_post: "skip_post";
        copy_to_my_drive: "copy_to_my_drive";
        link_existing_file: "link_existing_file";
        skip_attachment_and_note_draft: "skip_attachment_and_note_draft";
    }>;
    label: z.ZodString;
    recommended: z.ZodBoolean;
    riskWarning: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type PreflightOption = z.infer<typeof PreflightOptionSchema>;
export declare const PreflightFindingSchema: z.ZodObject<{
    id: z.ZodString;
    scanItemId: z.ZodString;
    sourceType: z.ZodEnum<{
        courseWork: "courseWork";
        courseWorkMaterial: "courseWorkMaterial";
    }>;
    sourceId: z.ZodString;
    postTitle: z.ZodString;
    postTypeLabel: z.ZodString;
    attachmentId: z.ZodString;
    attachmentName: z.ZodString;
    issue: z.ZodEnum<{
        trashed: "trashed";
        deleted: "deleted";
        permission_locked: "permission_locked";
    }>;
    scenario: z.ZodUnion<readonly [z.ZodLiteral<2>, z.ZodLiteral<3>]>;
    options: z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<{
            create_draft_shell_with_note: "create_draft_shell_with_note";
            skip_post: "skip_post";
            copy_to_my_drive: "copy_to_my_drive";
            link_existing_file: "link_existing_file";
            skip_attachment_and_note_draft: "skip_attachment_and_note_draft";
        }>;
        label: z.ZodString;
        recommended: z.ZodBoolean;
        riskWarning: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PreflightFinding = z.infer<typeof PreflightFindingSchema>;
/** A source post whose title already exists on the destination (Decision C). */
export declare const DuplicateDisclosureSchema: z.ZodObject<{
    scanItemId: z.ZodString;
    sourceType: z.ZodEnum<{
        courseWork: "courseWork";
        courseWorkMaterial: "courseWorkMaterial";
    }>;
    sourceId: z.ZodString;
    postTitle: z.ZodString;
    postTypeLabel: z.ZodString;
    matchedTitle: z.ZodString;
    matchedState: z.ZodEnum<{
        DRAFT: "DRAFT";
        PUBLISHED: "PUBLISHED";
    }>;
}, z.core.$strip>;
export type DuplicateDisclosure = z.infer<typeof DuplicateDisclosureSchema>;
/** A source topic that already exists on the destination and will be reused. */
export declare const TopicReuseDisclosureSchema: z.ZodObject<{
    sourceTopicId: z.ZodString;
    sourceTopicName: z.ZodString;
    destinationTopicId: z.ZodString;
    destinationTopicName: z.ZodString;
    ambiguous: z.ZodBoolean;
}, z.core.$strip>;
export type TopicReuseDisclosure = z.infer<typeof TopicReuseDisclosureSchema>;
export declare const PreflightRequestSchema: z.ZodObject<{
    targetId: z.ZodString;
}, z.core.$strip>;
export type PreflightRequest = z.infer<typeof PreflightRequestSchema>;
export declare const PreflightResponseSchema: z.ZodObject<{
    scanId: z.ZodString;
    sourceCourseId: z.ZodString;
    targetCourseId: z.ZodString;
    sourceCourseName: z.ZodString;
    targetCourseName: z.ZodString;
    totalPostsScanned: z.ZodNumber;
    scannedAt: z.ZodString;
    findings: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        scanItemId: z.ZodString;
        sourceType: z.ZodEnum<{
            courseWork: "courseWork";
            courseWorkMaterial: "courseWorkMaterial";
        }>;
        sourceId: z.ZodString;
        postTitle: z.ZodString;
        postTypeLabel: z.ZodString;
        attachmentId: z.ZodString;
        attachmentName: z.ZodString;
        issue: z.ZodEnum<{
            trashed: "trashed";
            deleted: "deleted";
            permission_locked: "permission_locked";
        }>;
        scenario: z.ZodUnion<readonly [z.ZodLiteral<2>, z.ZodLiteral<3>]>;
        options: z.ZodArray<z.ZodObject<{
            kind: z.ZodEnum<{
                create_draft_shell_with_note: "create_draft_shell_with_note";
                skip_post: "skip_post";
                copy_to_my_drive: "copy_to_my_drive";
                link_existing_file: "link_existing_file";
                skip_attachment_and_note_draft: "skip_attachment_and_note_draft";
            }>;
            label: z.ZodString;
            recommended: z.ZodBoolean;
            riskWarning: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    duplicates: z.ZodArray<z.ZodObject<{
        scanItemId: z.ZodString;
        sourceType: z.ZodEnum<{
            courseWork: "courseWork";
            courseWorkMaterial: "courseWorkMaterial";
        }>;
        sourceId: z.ZodString;
        postTitle: z.ZodString;
        postTypeLabel: z.ZodString;
        matchedTitle: z.ZodString;
        matchedState: z.ZodEnum<{
            DRAFT: "DRAFT";
            PUBLISHED: "PUBLISHED";
        }>;
    }, z.core.$strip>>;
    topicReuse: z.ZodArray<z.ZodObject<{
        sourceTopicId: z.ZodString;
        sourceTopicName: z.ZodString;
        destinationTopicId: z.ZodString;
        destinationTopicName: z.ZodString;
        ambiguous: z.ZodBoolean;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PreflightResponse = z.infer<typeof PreflightResponseSchema>;
/**
 * A resolution is a discriminated union over `kind`, so an unknown option is a
 * runtime rejection rather than a silently-ignored string.
 */
export declare const ResolutionSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"create_draft_shell_with_note">;
    findingId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"skip_post">;
    findingId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"copy_to_my_drive">;
    findingId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"link_existing_file">;
    findingId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"skip_attachment_and_note_draft">;
    findingId: z.ZodString;
}, z.core.$strip>], "kind">;
export type Resolution = z.infer<typeof ResolutionSchema>;
export declare const CreateTransferJobRequestSchema: z.ZodObject<{
    scanId: z.ZodString;
    resolutions: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"create_draft_shell_with_note">;
        findingId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"skip_post">;
        findingId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"copy_to_my_drive">;
        findingId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"link_existing_file">;
        findingId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"skip_attachment_and_note_draft">;
        findingId: z.ZodString;
    }, z.core.$strip>], "kind">>;
}, z.core.$strip>;
export type CreateTransferJobRequest = z.infer<typeof CreateTransferJobRequestSchema>;
export declare const CreateTransferJobResponseSchema: z.ZodObject<{
    jobId: z.ZodString;
}, z.core.$strip>;
export type CreateTransferJobResponse = z.infer<typeof CreateTransferJobResponseSchema>;
export declare const RateLimitPauseSchema: z.ZodObject<{
    retryInMs: z.ZodNumber;
    attempt: z.ZodNumber;
    itemTitle: z.ZodString;
}, z.core.$strip>;
export type RateLimitPause = z.infer<typeof RateLimitPauseSchema>;
export declare const CurrentItemSchema: z.ZodObject<{
    title: z.ZodString;
    outcome: z.ZodEnum<{
        pending: "pending";
        transferred: "transferred";
        fallback_shell: "fallback_shell";
        skipped: "skipped";
    }>;
    skipReason: z.ZodNullable<z.ZodEnum<{
        user_skip_post: "user_skip_post";
        user_skip_attachment: "user_skip_attachment";
        cancelled_by_user: "cancelled_by_user";
        provider_error: "provider_error";
        server_interrupted: "server_interrupted";
        rate_limit_exhausted: "rate_limit_exhausted";
        duplicate_title: "duplicate_title";
    }>>;
}, z.core.$strip>;
export type CurrentItem = z.infer<typeof CurrentItemSchema>;
export declare const TransferJobStatusSchema: z.ZodObject<{
    jobId: z.ZodString;
    status: z.ZodEnum<{
        queued: "queued";
        running: "running";
        completed: "completed";
        interrupted: "interrupted";
        failed: "failed";
    }>;
    sourceCourseName: z.ZodString;
    targetCourseName: z.ZodString;
    targetCourseId: z.ZodString;
    totalItems: z.ZodNumber;
    totalPostsScanned: z.ZodNumber;
    pending: z.ZodNumber;
    transferred: z.ZodNumber;
    fallbackShell: z.ZodNumber;
    skippedTotal: z.ZodNumber;
    skippedByUser: z.ZodNumber;
    skippedBySystem: z.ZodNumber;
    skippedDuplicate: z.ZodNumber;
    topicsCreatedOrMapped: z.ZodNumber;
    topicsCreatedCount: z.ZodNumber;
    topicsReusedCount: z.ZodNumber;
    googleReauthRequired: z.ZodBoolean;
    rubricNotesAdded: z.ZodNumber;
    currentItem: z.ZodNullable<z.ZodObject<{
        title: z.ZodString;
        outcome: z.ZodEnum<{
            pending: "pending";
            transferred: "transferred";
            fallback_shell: "fallback_shell";
            skipped: "skipped";
        }>;
        skipReason: z.ZodNullable<z.ZodEnum<{
            user_skip_post: "user_skip_post";
            user_skip_attachment: "user_skip_attachment";
            cancelled_by_user: "cancelled_by_user";
            provider_error: "provider_error";
            server_interrupted: "server_interrupted";
            rate_limit_exhausted: "rate_limit_exhausted";
            duplicate_title: "duplicate_title";
        }>>;
    }, z.core.$strip>>;
    rateLimitPause: z.ZodNullable<z.ZodObject<{
        retryInMs: z.ZodNumber;
        attempt: z.ZodNumber;
        itemTitle: z.ZodString;
    }, z.core.$strip>>;
    cancelRequested: z.ZodBoolean;
    cancelledAt: z.ZodNullable<z.ZodString>;
    startedAt: z.ZodNullable<z.ZodString>;
    finishedAt: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type TransferJobStatus = z.infer<typeof TransferJobStatusSchema>;
export declare const ActiveJobResponseSchema: z.ZodObject<{
    jobId: z.ZodString;
}, z.core.$strip>;
export type ActiveJobResponse = z.infer<typeof ActiveJobResponseSchema>;
/**
 * `POST /transfer-jobs/:id/cancel` — idempotent while the job is non-terminal.
 * A cancel on an already-finished job is a 409 `job_already_finished`
 * (`ApiErrorSchema`), never this shape.
 */
export declare const CancelTransferJobResponseSchema: z.ZodObject<{
    jobId: z.ZodString;
    cancelRequested: z.ZodLiteral<true>;
}, z.core.$strip>;
export type CancelTransferJobResponse = z.infer<typeof CancelTransferJobResponseSchema>;
/**
 * Per-type field payload for the itemized log's "Type-specific fields" column.
 * A discriminated union rather than a nullable bag, so no screen can render a
 * single generic "post" shape across all four coursework types: a Material
 * literally has no representation carrying points or an answer config.
 */
export declare const TypeSpecificFieldsSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"none">;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"graded">;
    maxPoints: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"multipleChoice">;
    optionCount: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"shortAnswer">;
}, z.core.$strip>], "kind">;
export type TypeSpecificFields = z.infer<typeof TypeSpecificFieldsSchema>;
export declare const TransferJobItemRowSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    sourceType: z.ZodEnum<{
        courseWork: "courseWork";
        courseWorkMaterial: "courseWorkMaterial";
    }>;
    workType: z.ZodNullable<z.ZodEnum<{
        ASSIGNMENT: "ASSIGNMENT";
        QUIZ_ASSIGNMENT: "QUIZ_ASSIGNMENT";
        SHORT_ANSWER_QUESTION: "SHORT_ANSWER_QUESTION";
        MULTIPLE_CHOICE_QUESTION: "MULTIPLE_CHOICE_QUESTION";
    }>>;
    typeLabel: z.ZodString;
    topicName: z.ZodNullable<z.ZodString>;
    outcome: z.ZodEnum<{
        pending: "pending";
        transferred: "transferred";
        fallback_shell: "fallback_shell";
        skipped: "skipped";
    }>;
    skipReason: z.ZodNullable<z.ZodEnum<{
        user_skip_post: "user_skip_post";
        user_skip_attachment: "user_skip_attachment";
        cancelled_by_user: "cancelled_by_user";
        provider_error: "provider_error";
        server_interrupted: "server_interrupted";
        rate_limit_exhausted: "rate_limit_exhausted";
        duplicate_title: "duplicate_title";
    }>>;
    skippedBy: z.ZodNullable<z.ZodEnum<{
        user: "user";
        system: "system";
        duplicate: "duplicate";
    }>>;
    typeSpecific: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"none">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"graded">;
        maxPoints: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"multipleChoice">;
        optionCount: z.ZodNumber;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"shortAnswer">;
    }, z.core.$strip>], "kind">;
    note: z.ZodNullable<z.ZodString>;
    rubricDegraded: z.ZodBoolean;
    attemptCount: z.ZodNumber;
    targetPostId: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type TransferJobItemRow = z.infer<typeof TransferJobItemRowSchema>;
export declare const TransferJobItemsResponseSchema: z.ZodObject<{
    jobId: z.ZodString;
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        sourceType: z.ZodEnum<{
            courseWork: "courseWork";
            courseWorkMaterial: "courseWorkMaterial";
        }>;
        workType: z.ZodNullable<z.ZodEnum<{
            ASSIGNMENT: "ASSIGNMENT";
            QUIZ_ASSIGNMENT: "QUIZ_ASSIGNMENT";
            SHORT_ANSWER_QUESTION: "SHORT_ANSWER_QUESTION";
            MULTIPLE_CHOICE_QUESTION: "MULTIPLE_CHOICE_QUESTION";
        }>>;
        typeLabel: z.ZodString;
        topicName: z.ZodNullable<z.ZodString>;
        outcome: z.ZodEnum<{
            pending: "pending";
            transferred: "transferred";
            fallback_shell: "fallback_shell";
            skipped: "skipped";
        }>;
        skipReason: z.ZodNullable<z.ZodEnum<{
            user_skip_post: "user_skip_post";
            user_skip_attachment: "user_skip_attachment";
            cancelled_by_user: "cancelled_by_user";
            provider_error: "provider_error";
            server_interrupted: "server_interrupted";
            rate_limit_exhausted: "rate_limit_exhausted";
            duplicate_title: "duplicate_title";
        }>>;
        skippedBy: z.ZodNullable<z.ZodEnum<{
            user: "user";
            system: "system";
            duplicate: "duplicate";
        }>>;
        typeSpecific: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"none">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"graded">;
            maxPoints: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"multipleChoice">;
            optionCount: z.ZodNumber;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"shortAnswer">;
        }, z.core.$strip>], "kind">;
        note: z.ZodNullable<z.ZodString>;
        rubricDegraded: z.ZodBoolean;
        attemptCount: z.ZodNumber;
        targetPostId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type TransferJobItemsResponse = z.infer<typeof TransferJobItemsResponseSchema>;
export declare const HealthResponseSchema: z.ZodObject<{
    status: z.ZodLiteral<"ok">;
    uptimeMs: z.ZodNumber;
}, z.core.$strip>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export declare const ApiErrorSchema: z.ZodObject<{
    error: z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
        jobId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
