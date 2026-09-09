/**
 * Title normalization — PM §6.2, one implementation.
 *
 * Duplicate detection and topic reuse both need "are these the same name?", and
 * two independently written answers to that question are two answers that will
 * eventually disagree about one teacher's course. So it lives here, in shared,
 * where the client can also use it if it ever needs to explain a match.
 *
 * Deliberately CONSERVATIVE. It fixes the four ways the same title gets typed
 * differently — Unicode composition, stray whitespace, internal double spaces,
 * capitalisation — and nothing else. It does not strip punctuation and does not
 * do fuzzy or prefix matching, because every over-normalisation makes a
 * DIFFERENT post look like a duplicate, and a duplicate is silently skipped: the
 * failure mode is a post the teacher wanted that never arrives, which is worse
 * than the duplicate it was trying to prevent.
 */
export declare function normalizeTitle(title: string): string;
