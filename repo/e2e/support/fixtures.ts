/**
 * Constants mirroring the seeded fixture world (server/src/fixtures/index.ts).
 * Not imported from the server — the E2E suite is a black-box consumer of the
 * running app, so these are duplicated deliberately, the way any external
 * client would know these ids/names from the product, not from its source.
 */

export const JAMIE = {
  accountId: 'acct-jamie',
  displayName: 'Jamie Rivera',
}

export const COURSE_IDS = {
  /** F1 — clean 6-post course. */
  F1: 'course-f1',
  /** F2 — trashed/deleted attachments, triggers the Action Sheet. */
  F2: 'course-f2',
  /** F4 / F12 — 50 posts, reused for the reconnect/refresh-resume spec. */
  F4: 'course-f4',
  /** SIS-shell target owned by Jamie. Rendered label: "US History — Period 3 — 2026 Spring · Active · SIS Roster Shell" */
  TARGET_JAMIE: 'course-target-jamie',
  /** Plain (non-SIS-shell) target owned by Jamie. */
  TARGET_JAMIE_PLAIN: 'course-target-jamie-2',
} as const

/** The exact, non-negotiable canonical fallback note (shared/src/notes.ts). */
export const FALLBACK_NOTE_UNIT_1_SLIDES =
  "[Classroom Copier Note: Original attachment 'Unit 1 Slides.pdf' could not be linked due to a permission error or deleted file.]"

/** F2's two Action Sheet findings, by the attachment name that identifies them. */
export const F2_FINDINGS = {
  /** cwm-f2-1 "Week 1 Reading" — trashed. Recommended = Create Draft Shell with Note. */
  TRASHED_ATTACHMENT: 'Unit 1 Slides.pdf',
  /** cw-f2-1 "Essay: Local government" (Assignment) — deleted. Type-aware skip = "Skip Assignment". */
  DELETED_ATTACHMENT: 'Council Minutes.docx',
} as const
