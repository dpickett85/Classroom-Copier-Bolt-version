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
export function attachmentFallbackNote(attachmentName: string): string {
  return `[Classroom Copier Note: Original attachment '${attachmentName}' could not be linked due to a permission error or deleted file.]`
}

/**
 * 5b — content pass on the architect-proposed placeholder (03-ui-direction.md
 * §4 register: plainspoken, fact-then-action, never a hedge). Deliberately a
 * DIFFERENT string from the attachment note: the two describe different
 * events and F13's gate asserts they differ, not that either matches a
 * hard-coded literal (Δ2).
 */
export function rateLimitExhaustionNote(attempts: number): string {
  return `[Classroom Copier Note: Google was rate-limiting requests. This post could not be copied in full after ${attempts} attempts, so a draft shell was created here instead. Re-attach any files and check the details before publishing.]`
}

export function attachmentNotVisibleNote(): string {
  return '[Classroom Copier Note: One or more original attachments were not visible to the connected Google account. A draft shell was created; check and re-attach those files before publishing.]'
}

/** Rubric creation can be refused by licensing, permissions, or the OAuth client used to create the assignment. */
export function rubricDegradedNote(): string {
  return '[Classroom Copier Note: The rubric could not be added to this assignment because Google refused rubric creation for the target course or account. The assignment itself transferred; check the target course permissions and rubric availability.]'
}

/** F5 — attachments beyond the 20-attachment cap, appended as description links. */
export function attachmentOverflowNote(overflowCount: number): string {
  return `${overflowCount} attachment${overflowCount === 1 ? '' : 's'} appended as links — 20 max per post.`
}

/** Scenario 3, "Skip Attachment and Note Draft" (D15 -> fallback_shell). */
export function attachmentSkippedByUserNote(attachmentName: string): string {
  return attachmentFallbackNote(attachmentName)
}

/**
 * The mid-transfer Cancel control's drain note — the teacher chose to stop,
 * so plain, honest, house-register prose ("Cancelled by you…") is accurate
 * attribution, the same as the existing Skip Post note. Never the
 * "[Classroom Copier Note: …]" bracket form: that form marks text INJECTED
 * INTO a created post's description, and a drained item never had a post
 * created for it.
 */
export function cancelledByUserNote(): string {
  return 'Cancelled by you before this post was attempted.'
}

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
export function duplicateSkipNote(matchedTitle: string, matchedState: string | null): string {
  const where =
    matchedState === 'DRAFT'
      ? 'as an unpublished draft'
      : matchedState === 'PUBLISHED'
        ? 'as a published post'
        : 'already'
  return `Already in the destination course ${where}, under the title "${matchedTitle}". Nothing was copied for this post.`
}

/** Header for the overflow links appended into a post's description. */
export const OVERFLOW_LINKS_HEADER = 'Additional attachments (beyond the 20-attachment limit):'

/**
 * P0-1 — the post EXISTS in the target course, but a follow-up step (clearing
 * the rate-limit pause, reading or writing the rubric, patching the
 * description) failed afterwards. Saying "nothing was written" here is a
 * factual falsehood that sends the teacher to re-create a post that is already
 * there — the exact duplicate the no-auto-resume decision exists to prevent.
 */
export function postCreatedFollowUpFailedNote(step: string): string {
  return `[Classroom Copier Note: This post WAS created in the target course, but a follow-up step (${step}) did not complete. Open the draft and check it before publishing.]`
}

/**
 * APPLY-A — a Drive attachment whose sharing setting could not be read. The
 * brief's binding requirement is "preserve each attachment's shareMode … never
 * default to VIEW", so an unreadable shareMode becomes a FINDING and the file
 * is left unlinked with this note, never quietly re-shared as VIEW.
 */
export function shareModeUnknownNote(attachmentName: string): string {
  return `[Classroom Copier Note: Original attachment '${attachmentName}' was not linked because its sharing setting could not be read. Re-attach it and set the sharing option you want — we will not guess one for you.]`
}
