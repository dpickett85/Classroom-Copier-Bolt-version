/**
 * D6 — every note string the product can inject lives here, so a later content
 * pass is a one-line change rather than a grep across the engine. Tests assert
 * *distinctness* between the two fallback notes rather than hard-coding a
 * literal, which decouples the build from the pending copy confirmation (Δ2).
 *
 * The attachment-failure note is an EXACT product guarantee carried verbatim
 * from `01-pm-brief.md` §6 item 8 and `03-ui-direction.md` §4. It is rendered
 * in full, never truncated or ellipsized.
 */
/** Exact, non-negotiable. Do not reword. */
export declare function attachmentFallbackNote(attachmentName: string): string;
/**
 * 5b — content pass on the architect-proposed placeholder (03-ui-direction.md
 * §4 register: plainspoken, fact-then-action, never a hedge). Deliberately a
 * DIFFERENT string from the attachment note: the two describe different
 * events and F13's gate asserts they differ, not that either matches a
 * hard-coded literal (Δ2).
 */
export declare function rateLimitExhaustionNote(attempts: number): string;
export declare function attachmentNotVisibleNote(): string;
export declare function rubricDegradedNote(reason?: 'license' | 'permission' | 'oauth' | 'unknown', sheetUrl?: string): string;
/** F5 — attachments beyond the 20-attachment cap, appended as description links. */
export declare function attachmentOverflowNote(overflowCount: number): string;
/** Scenario 3, "Skip Attachment and Note Draft" (D15 -> fallback_shell). */
export declare function attachmentSkippedByUserNote(attachmentName: string): string;
/**
 * The mid-transfer Cancel control's drain note — the teacher chose to stop,
 * so plain, honest, house-register prose ("Cancelled by you…") is accurate
 * attribution, the same as the existing Skip Post note. Never the
 * "[Classroom Copier Note: …]" bracket form: that form marks text INJECTED
 * INTO a created post's description, and a drained item never had a post
 * created for it.
 */
export declare function cancelledByUserNote(): string;
/**
 * Decision C/G — the ledger note for a post that already exists in the
 * destination course.
 *
 * Plain prose, not the "[Classroom Copier Note: …]" bracket form: that form
 * marks text INJECTED INTO a created post's description, and a duplicate never
 * had a post created for it. It names the destination title verbatim and its
 * state, because "already there" and "already there as a draft you have not
 * published yet" send a teacher to two different places.
 */
export declare function duplicateSkipNote(matchedTitle: string, matchedState: string | null): string;
/** Header for the overflow links appended into a post's description. */
export declare const OVERFLOW_LINKS_HEADER = "Additional attachments (beyond the 20-attachment limit):";
/**
 * P0-1 — the post EXISTS in the target course, but a follow-up step (clearing
 * the rate-limit pause, reading or writing the rubric, patching the
 * description) failed afterwards. Saying "nothing was written" here is a
 * factual falsehood that sends the teacher to re-create a post that is already
 * there — the exact duplicate the no-auto-resume decision exists to prevent.
 */
export declare function postCreatedFollowUpFailedNote(step: string): string;
/**
 * APPLY-A — a Drive attachment whose sharing setting could not be read. The
 * brief's binding requirement is "preserve each attachment's shareMode … never
 * default to VIEW", so an unreadable shareMode becomes a FINDING and the file
 * is left unlinked with this note, never quietly re-shared as VIEW.
 */
export declare function shareModeUnknownNote(attachmentName: string): string;
