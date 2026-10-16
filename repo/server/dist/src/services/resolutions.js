const EFFECTS = {
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
};
export function effectOf(kind) {
    return EFFECTS[kind];
}
export function emptyPostResolutions() {
    return {
        skipsPost: false,
        forcedOutcome: null,
        skipReason: null,
        dropAttachmentIds: new Set(),
        copyToMyDriveIds: new Set(),
        notedAttachmentNames: [],
        kinds: [],
    };
}
const RANK = {
    transferred: 0,
    fallback_shell: 1,
    skipped: 2,
};
export function buildPostResolutions(resolutions, findings) {
    const byFindingId = new Map(findings.map((f) => [f.findingId, f]));
    const perPost = new Map();
    for (const resolution of resolutions) {
        const finding = byFindingId.get(resolution.findingId);
        if (!finding)
            continue; // an unknown findingId is ignored, never guessed at
        const effect = effectOf(resolution.kind);
        const current = perPost.get(finding.scanItemId) ?? emptyPostResolutions();
        current.kinds.push(resolution.kind);
        if (effect.dropsAttachment)
            current.dropAttachmentIds.add(finding.attachmentId);
        if (effect.copiesToMyDrive)
            current.copyToMyDriveIds.add(finding.attachmentId);
        if (effect.injectsNote)
            current.notedAttachmentNames.push(finding.attachmentName);
        if (effect.skipsPost) {
            current.skipsPost = true;
            current.skipReason = effect.skipReason;
        }
        if (current.forcedOutcome == null || RANK[effect.outcome] > RANK[current.forcedOutcome]) {
            current.forcedOutcome = effect.outcome;
            if (effect.skipReason)
                current.skipReason = effect.skipReason;
        }
        perPost.set(finding.scanItemId, current);
    }
    return perPost;
}
