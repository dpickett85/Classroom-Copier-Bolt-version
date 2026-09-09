/**
 * D15 — the resolution → outcome mapping, as code.
 *
 * The `resolutions[]` contract used to appear in the REST table, in §4 and in
 * the sequence diagram, and its shape was specified nowhere; three modules sat
 * on it (the Action Sheet produced it, the job API accepted it, the engine
 * consumed it) and none declared the type. Worse, the mapping itself was
 * unstated, which left the exactly-once trace genuinely ambiguous for two of
 * the five options.
 *
 * The decided ambiguous row is `skip_attachment_and_note_draft` →
 * `fallback_shell`: the post IS created (so "transferred" is arguable), but a
 * note was injected, and the credit rule — "deduct only on a 100% clean
 * transfer; auto-refund on any fallback injection" — keys off exactly that
 * event. Under the alternative reading a teacher would be charged for a copy
 * carrying a "could not be linked" note, which the business rule forbids.
 */
import type { Outcome, Resolution, ResolutionKind, SkipReason } from '@classroom-copier/shared'

export interface ResolutionEffect {
  /** The bucket this resolution forces, if it forces one. */
  outcome: Extract<Outcome, 'transferred' | 'fallback_shell' | 'skipped'>
  skipReason: SkipReason | null
  /** Omit the flagged attachment from the create payload. */
  dropsAttachment: boolean
  /** Inject the canonical attachment-failure note into the description. */
  injectsNote: boolean
  /** Copy the file into the acting teacher's Drive before linking it. */
  copiesToMyDrive: boolean
  /** Skip the whole post — nothing is written to the target. */
  skipsPost: boolean
}

const EFFECTS: Record<ResolutionKind, ResolutionEffect> = {
  create_draft_shell_with_note: {
    outcome: 'fallback_shell',
    skipReason: null,
    dropsAttachment: true,
    injectsNote: true,
    copiesToMyDrive: false,
    skipsPost: false,
  },
  skip_post: {
    outcome: 'skipped',
    skipReason: 'user_skip_post',
    dropsAttachment: true,
    injectsNote: false,
    copiesToMyDrive: false,
    skipsPost: true,
  },
  copy_to_my_drive: {
    outcome: 'transferred',
    skipReason: null,
    dropsAttachment: false,
    injectsNote: false,
    copiesToMyDrive: true,
    skipsPost: false,
  },
  link_existing_file: {
    outcome: 'transferred',
    skipReason: null,
    dropsAttachment: false,
    injectsNote: false,
    copiesToMyDrive: false,
    skipsPost: false,
  },
  skip_attachment_and_note_draft: {
    outcome: 'fallback_shell',
    skipReason: null,
    dropsAttachment: true,
    injectsNote: true,
    copiesToMyDrive: false,
    skipsPost: false,
  },
}

export function effectOf(kind: ResolutionKind): ResolutionEffect {
  return EFFECTS[kind]
}

export interface ResolvedFinding {
  findingId: string
  scanItemId: string
  attachmentId: string
  attachmentName: string
}

/**
 * Per-post view of the teacher's choices, keyed by scan item. A post can carry
 * several flagged attachments; the strongest effect wins in the order
 * skip > fallback > transferred, which is the same precedence the
 * combined-outcome rule states (fallback-shell always wins the primary bucket
 * over transferred, since the draft-shell path already ran for that post).
 */
export interface PostResolutions {
  skipsPost: boolean
  forcedOutcome: 'transferred' | 'fallback_shell' | 'skipped' | null
  skipReason: SkipReason | null
  dropAttachmentIds: Set<string>
  copyToMyDriveIds: Set<string>
  notedAttachmentNames: string[]
  kinds: ResolutionKind[]
}

export function emptyPostResolutions(): PostResolutions {
  return {
    skipsPost: false,
    forcedOutcome: null,
    skipReason: null,
    dropAttachmentIds: new Set(),
    copyToMyDriveIds: new Set(),
    notedAttachmentNames: [],
    kinds: [],
  }
}

const RANK: Record<'transferred' | 'fallback_shell' | 'skipped', number> = {
  transferred: 0,
  fallback_shell: 1,
  skipped: 2,
}

export function buildPostResolutions(
  resolutions: Resolution[],
  findings: ResolvedFinding[],
): Map<string, PostResolutions> {
  const byFindingId = new Map(findings.map((f) => [f.findingId, f]))
  const perPost = new Map<string, PostResolutions>()

  for (const resolution of resolutions) {
    const finding = byFindingId.get(resolution.findingId)
    if (!finding) continue // an unknown findingId is ignored, never guessed at
    const effect = effectOf(resolution.kind)
    const current = perPost.get(finding.scanItemId) ?? emptyPostResolutions()

    current.kinds.push(resolution.kind)
    if (effect.dropsAttachment) current.dropAttachmentIds.add(finding.attachmentId)
    if (effect.copiesToMyDrive) current.copyToMyDriveIds.add(finding.attachmentId)
    if (effect.injectsNote) current.notedAttachmentNames.push(finding.attachmentName)
    if (effect.skipsPost) {
      current.skipsPost = true
      current.skipReason = effect.skipReason
    }
    if (current.forcedOutcome == null || RANK[effect.outcome] > RANK[current.forcedOutcome]) {
      current.forcedOutcome = effect.outcome
      if (effect.skipReason) current.skipReason = effect.skipReason
    }

    perPost.set(finding.scanItemId, current)
  }

  return perPost
}
