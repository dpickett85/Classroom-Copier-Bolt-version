/**
 * The engine's note strings.
 *
 * The canonical text lives in `@classroom-copier/shared` so the client can
 * assert it renders in full and untruncated against the same constant the
 * server injects — one string, two readers. This module is the engine's named
 * home for it (D6): a later content pass is still a one-line change, and F13's
 * gate asserts DISTINCTNESS between the two fallback notes rather than a
 * hard-coded literal, so a pending copy decision cannot break the build (Δ2).
 */
export {
  OVERFLOW_LINKS_HEADER,
  attachmentFallbackNote,
  attachmentOverflowNote,
  attachmentSkippedByUserNote,
  cancelledByUserNote,
  duplicateSkipNote,
  postCreatedFollowUpFailedNote,
  rateLimitExhaustionNote,
  rubricDegradedNote,
  shareModeUnknownNote,
} from '@classroom-copier/shared'
