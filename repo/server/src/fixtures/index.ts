/**
 * fixture-seed-data — F1–F15.
 *
 * The mock layer is a first-class deliverable: every named v1 behaviour maps to
 * at least one fixture, and QC certifies only what a fixture exercises. Seeding
 * is idempotent and safe to re-run on every boot (D3), so a wiped disk
 * self-heals to a known-good state.
 *
 * Two things deliberately do NOT live here:
 *  - F12's slow-mode delay, which is a run-scoped provider option
 *    (`MockProviderOptions { perItemDelayMs }`), never course data (D25). Seeded
 *    as data it would mean `engine_throughput_f4_50posts` measures its own
 *    harness.
 *  - Cold start, which has no fixture in the manifest at all and is covered by
 *    an env-gated harness that is explicitly not fixture-certified.
 */
import type { AnswerConfig } from '../adapters/types.js'

export interface SeedAccount {
  id: string
  displayName: string
  email: string
  initials: string
}

export interface SeedAttachment {
  id: string
  parentType: 'courseWork' | 'courseWorkMaterial'
  parentId: string
  kind: 'driveFile' | 'youTubeVideo' | 'link' | 'form'
  title: string
  driveFileId?: string | null
  url?: string | null
  /** Copied from the source on transfer — never defaulted to VIEW. */
  shareMode?: 'VIEW' | 'EDIT' | 'STUDENT_COPY' | null
  driveState?: 'healthy' | 'trashed' | 'deleted' | 'permission_locked'
  ownerAccountId?: string | null
  /** D22 — makes "attachments 1–20" a total order. */
  sortOrder: number
}

export interface SeedRubricLevel {
  title: string
  description?: string | null
  points: number
  sortOrder: number
}
export interface SeedRubricCriterion {
  title: string
  description?: string | null
  sortOrder: number
  levels: SeedRubricLevel[]
}

export interface SeedCourseWork {
  id: string
  title: string
  description?: string | null
  workType: 'ASSIGNMENT' | 'QUIZ_ASSIGNMENT' | 'SHORT_ANSWER_QUESTION' | 'MULTIPLE_CHOICE_QUESTION'
  state: 'DRAFT' | 'PUBLISHED'
  dueDate?: string | null
  scheduledTime?: string | null
  maxPoints?: number | null
  answerConfig?: AnswerConfig | null
  quizFormLink?: string | null
  topicId?: string | null
  creationTime: string
  createdOrder: number
  attachments?: Omit<SeedAttachment, 'parentType' | 'parentId'>[]
  rubric?: SeedRubricCriterion[]
}

export interface SeedCourseWorkMaterial {
  id: string
  title: string
  description?: string | null
  state: 'DRAFT' | 'PUBLISHED'
  topicId?: string | null
  creationTime: string
  createdOrder: number
  attachments?: Omit<SeedAttachment, 'parentType' | 'parentId'>[]
}

export interface SeedTopic {
  id: string
  name: string
  sortOrder: number
}

export interface SeedCourse {
  id: string
  fixtureKey: string | null
  ownerAccountId: string
  name: string
  section?: string | null
  state: 'ACTIVE' | 'ARCHIVED'
  isSisShell?: boolean
  /** When false the mock rubrics API answers LicenseBlockedError on create (F7). */
  rubricsLicensed?: boolean
  topics?: SeedTopic[]
  courseWork?: SeedCourseWork[]
  courseWorkMaterials?: SeedCourseWorkMaterial[]
}

/* ------------------------------------------------------------------ *
 * F10 — mock identity: two teacher accounts with distinct course lists
 * ------------------------------------------------------------------ */

export const ACCOUNT_JAMIE = 'acct-jamie'
export const ACCOUNT_DANA = 'acct-dana'

export const SEED_ACCOUNTS: SeedAccount[] = [
  {
    id: ACCOUNT_JAMIE,
    displayName: 'Jamie Rivera',
    email: 'jamie.rivera@pickettusd.mock.edu',
    initials: 'JR',
  },
  {
    id: ACCOUNT_DANA,
    displayName: 'Dana Okafor',
    email: 'dana.okafor@pickettusd.mock.edu',
    initials: 'DO',
  },
]

/**
 * The mock's rate-limit simulation table keys on these EXACT post titles. They
 * are exported so `mock-classroom-provider` imports them rather than
 * duplicating string literals — the dependency direction the MDB declares
 * (mock depends on fixtures), and the reason no marker text leaks into the UI.
 */
export const F6_TRANSIENT_429_TITLE = 'Chapter 2 Reading Guide'
export const F13_PERSISTENT_429_TITLE = 'Semester Reflection Prompt'

const T = (iso: string) => iso

/* ------------------------------------------------------------------ *
 * F1 — healthy course.
 * Also carries F8 (all three source states), F9 (all four coursework
 * types incl. both Question configs), and F11 (>=2 topics + >=1
 * untopiced post) — exactly the distribution the PM brief sanctions.
 * D24: a rubric-bearing assignment on a licence-permitted target path so
 * createRubric's SUCCESS branch is fixtured, not just its denial.
 * ------------------------------------------------------------------ */

const f1: SeedCourse = {
  id: 'course-f1',
  fixtureKey: 'F1',
  ownerAccountId: ACCOUNT_JAMIE,
  name: 'US History (2025)',
  section: 'Period 3',
  state: 'ACTIVE',
  rubricsLicensed: true,
  topics: [
    { id: 'topic-f1-unit1', name: 'Unit 1 — Foundations', sortOrder: 0 },
    { id: 'topic-f1-unit2', name: 'Unit 2 — Expansion', sortOrder: 1 },
  ],
  courseWork: [
    {
      id: 'cw-f1-1',
      title: 'Essay 1: Founding Documents',
      description: 'Write a 500-word response comparing the two documents.',
      workType: 'ASSIGNMENT',
      state: 'PUBLISHED',
      dueDate: T('2025-09-12T23:59:00.000Z'),
      maxPoints: 100,
      topicId: 'topic-f1-unit1',
      creationTime: T('2025-08-01T09:00:00.000Z'),
      createdOrder: 1,
      attachments: [
        {
          id: 'att-f1-1a',
          kind: 'driveFile',
          title: 'Founding Documents Packet.pdf',
          driveFileId: 'drive-f1-packet',
          // STUDENT_COPY, deliberately not VIEW — the transfer must preserve it.
          shareMode: 'STUDENT_COPY',
          driveState: 'healthy',
          ownerAccountId: ACCOUNT_JAMIE,
          sortOrder: 0,
        },
      ],
      // D24 — the success path for getRubric + createRubric.
      rubric: [
        {
          title: 'Thesis',
          description: 'Clarity and defensibility of the central claim',
          sortOrder: 0,
          levels: [
            { title: 'Exceeds', description: 'Precise and arguable', points: 4, sortOrder: 0 },
            { title: 'Meets', description: 'Clear', points: 3, sortOrder: 1 },
            { title: 'Approaching', description: 'Vague', points: 2, sortOrder: 2 },
          ],
        },
        {
          title: 'Evidence',
          description: 'Use of primary sources',
          sortOrder: 1,
          levels: [
            { title: 'Exceeds', description: 'Three or more sources', points: 4, sortOrder: 0 },
            { title: 'Meets', description: 'Two sources', points: 3, sortOrder: 1 },
          ],
        },
      ],
    },
    {
      id: 'cw-f1-2',
      title: 'Quiz: Chapter 2',
      description: 'Ten questions on westward expansion.',
      workType: 'QUIZ_ASSIGNMENT',
      // Scheduled — which in Google's vocabulary is a DRAFT carrying
      // scheduledTime, not a state of its own (APPLY-D, resolved).
      state: 'DRAFT',
      scheduledTime: T('2025-09-20T15:00:00.000Z'),
      dueDate: T('2025-09-21T23:59:00.000Z'),
      maxPoints: 50,
      quizFormLink: 'https://forms.mock/f1-quiz-ch2',
      topicId: 'topic-f1-unit2',
      creationTime: T('2025-08-02T09:00:00.000Z'),
      createdOrder: 2,
      attachments: [
        {
          id: 'att-f1-2a',
          kind: 'form',
          title: 'Chapter 2 Quiz Form',
          url: 'https://forms.mock/f1-quiz-ch2',
          driveState: 'healthy',
          sortOrder: 0,
        },
      ],
    },
    {
      id: 'cw-f1-3',
      title: 'Discussion: Whose frontier?',
      description: 'Choose the interpretation you find strongest.',
      workType: 'MULTIPLE_CHOICE_QUESTION',
      state: 'DRAFT',
      maxPoints: 10,
      answerConfig: {
        type: 'multipleChoice',
        choices: ['Settler', 'Indigenous', 'Federal', 'Commercial'],
      },
      topicId: 'topic-f1-unit2',
      creationTime: T('2025-08-03T09:00:00.000Z'),
      createdOrder: 3,
    },
    {
      id: 'cw-f1-4',
      title: 'Exit ticket: one takeaway',
      description: 'One or two sentences.',
      workType: 'SHORT_ANSWER_QUESTION',
      state: 'PUBLISHED',
      maxPoints: 5,
      answerConfig: { type: 'shortAnswer' },
      // Deliberately untopiced — F11's "never miscategorized into a topic".
      topicId: null,
      creationTime: T('2025-08-04T09:00:00.000Z'),
      createdOrder: 4,
    },
  ],
  courseWorkMaterials: [
    {
      id: 'cwm-f1-1',
      title: 'Week 1 Reading',
      description: 'Read before Tuesday.',
      state: 'PUBLISHED',
      topicId: 'topic-f1-unit1',
      creationTime: T('2025-07-31T09:00:00.000Z'),
      createdOrder: 0,
      attachments: [
        {
          id: 'att-f1-m1a',
          kind: 'driveFile',
          title: 'Unit 1 Slides.pdf',
          driveFileId: 'drive-f1-slides',
          shareMode: 'VIEW',
          driveState: 'healthy',
          ownerAccountId: ACCOUNT_JAMIE,
          sortOrder: 0,
        },
        {
          id: 'att-f1-m1b',
          kind: 'youTubeVideo',
          title: 'Intro lecture',
          url: 'https://youtube.mock/watch?v=f1intro',
          driveState: 'healthy',
          sortOrder: 1,
        },
      ],
    },
    {
      id: 'cwm-f1-2',
      title: 'Reference: Timeline handout',
      state: 'DRAFT',
      topicId: 'topic-f1-unit2',
      creationTime: T('2025-08-05T09:00:00.000Z'),
      createdOrder: 5,
      attachments: [
        {
          id: 'att-f1-m2a',
          kind: 'link',
          title: 'Digital timeline',
          url: 'https://timeline.mock/us-history',
          driveState: 'healthy',
          sortOrder: 0,
        },
      ],
    },
  ],
}

/* ------------------------------------------------------------------ *
 * F2 — trashed / deleted attachments
 * ------------------------------------------------------------------ */

const f2: SeedCourse = {
  id: 'course-f2',
  fixtureKey: 'F2',
  ownerAccountId: ACCOUNT_JAMIE,
  name: 'Civics (2025) — broken links',
  section: 'Period 1',
  state: 'ACTIVE',
  topics: [{ id: 'topic-f2-unit1', name: 'Unit 1', sortOrder: 0 }],
  courseWork: [
    {
      id: 'cw-f2-1',
      title: 'Essay: Local government',
      workType: 'ASSIGNMENT',
      state: 'PUBLISHED',
      maxPoints: 40,
      topicId: 'topic-f2-unit1',
      creationTime: T('2025-08-10T09:00:00.000Z'),
      createdOrder: 1,
      attachments: [
        {
          id: 'att-f2-1a',
          kind: 'driveFile',
          title: 'Council Minutes.docx',
          driveFileId: 'drive-f2-minutes',
          shareMode: 'VIEW',
          // Deleted outright.
          driveState: 'deleted',
          ownerAccountId: ACCOUNT_JAMIE,
          sortOrder: 0,
        },
      ],
    },
  ],
  courseWorkMaterials: [
    {
      id: 'cwm-f2-1',
      title: 'Week 1 Reading',
      state: 'PUBLISHED',
      topicId: 'topic-f2-unit1',
      creationTime: T('2025-08-09T09:00:00.000Z'),
      createdOrder: 0,
      attachments: [
        {
          id: 'att-f2-m1a',
          kind: 'driveFile',
          title: 'Unit 1 Slides.pdf',
          driveFileId: 'drive-f2-slides',
          shareMode: 'VIEW',
          // Trashed — the Action Sheet's "Skip Material" label must be
          // type-aware here, which is exactly what F2 exists to prove.
          driveState: 'trashed',
          ownerAccountId: ACCOUNT_JAMIE,
          sortOrder: 0,
        },
      ],
    },
    {
      id: 'cwm-f2-2',
      title: 'Healthy handout',
      state: 'PUBLISHED',
      topicId: 'topic-f2-unit1',
      creationTime: T('2025-08-11T09:00:00.000Z'),
      createdOrder: 2,
      attachments: [
        {
          id: 'att-f2-m2a',
          kind: 'link',
          title: 'Reference site',
          url: 'https://ref.mock/civics',
          driveState: 'healthy',
          sortOrder: 0,
        },
      ],
    },
  ],
}

/* ------------------------------------------------------------------ *
 * F3 — permission-locked / co-teacher-owned attachment
 * ------------------------------------------------------------------ */

const f3: SeedCourse = {
  id: 'course-f3',
  fixtureKey: 'F3',
  ownerAccountId: ACCOUNT_JAMIE,
  name: 'Government (2025) — shared files',
  section: 'Period 5',
  state: 'ACTIVE',
  topics: [{ id: 'topic-f3-unit1', name: 'Unit 1', sortOrder: 0 }],
  courseWork: [
    {
      id: 'cw-f3-1',
      title: 'Essay 1',
      workType: 'ASSIGNMENT',
      state: 'PUBLISHED',
      maxPoints: 100,
      topicId: 'topic-f3-unit1',
      creationTime: T('2025-08-12T09:00:00.000Z'),
      createdOrder: 0,
      attachments: [
        {
          id: 'att-f3-1a',
          kind: 'driveFile',
          title: 'Rubric Template.docx',
          driveFileId: 'drive-f3-rubric-template',
          shareMode: 'EDIT',
          driveState: 'permission_locked',
          // Owned by the other teacher — this is what "co-teacher owned" means.
          ownerAccountId: ACCOUNT_DANA,
          sortOrder: 0,
        },
      ],
    },
    {
      id: 'cw-f3-2',
      title: 'Reflection',
      workType: 'SHORT_ANSWER_QUESTION',
      state: 'DRAFT',
      maxPoints: 5,
      answerConfig: { type: 'shortAnswer' },
      topicId: 'topic-f3-unit1',
      creationTime: T('2025-08-13T09:00:00.000Z'),
      createdOrder: 1,
    },
  ],
}

/* ------------------------------------------------------------------ *
 * F4 — exactly 50 posts (also the course F12 reuses)
 * ------------------------------------------------------------------ */

function buildF4(): SeedCourse {
  const courseWork: SeedCourseWork[] = []
  const courseWorkMaterials: SeedCourseWorkMaterial[] = []
  const base = Date.parse('2025-06-01T08:00:00.000Z')

  for (let i = 0; i < 50; i += 1) {
    const creationTime = new Date(base + i * 3_600_000).toISOString()
    const topicId = i % 3 === 2 ? null : i % 2 === 0 ? 'topic-f4-a' : 'topic-f4-b'
    if (i % 5 === 4) {
      courseWorkMaterials.push({
        id: `cwm-f4-${i}`,
        title: `Reading ${i + 1}`,
        state: 'PUBLISHED',
        topicId,
        creationTime,
        createdOrder: i,
        attachments: [
          {
            id: `att-f4-${i}-0`,
            kind: 'driveFile',
            title: `Reading ${i + 1}.pdf`,
            driveFileId: `drive-f4-${i}`,
            shareMode: 'VIEW',
            driveState: 'healthy',
            ownerAccountId: ACCOUNT_JAMIE,
            sortOrder: 0,
          },
        ],
      })
    } else {
      courseWork.push({
        id: `cw-f4-${i}`,
        title: `Assignment ${i + 1}`,
        description: `Auto-generated throughput fixture post ${i + 1}.`,
        workType: 'ASSIGNMENT',
        state: i % 7 === 0 ? 'DRAFT' : 'PUBLISHED',
        dueDate: new Date(base + i * 3_600_000 + 86_400_000).toISOString(),
        maxPoints: 20,
        topicId,
        creationTime,
        createdOrder: i,
        attachments: [
          {
            id: `att-f4-${i}-0`,
            kind: 'driveFile',
            title: `Worksheet ${i + 1}.pdf`,
            driveFileId: `drive-f4-${i}`,
            shareMode: 'STUDENT_COPY',
            driveState: 'healthy',
            ownerAccountId: ACCOUNT_JAMIE,
            sortOrder: 0,
          },
        ],
      })
    }
  }

  return {
    id: 'course-f4',
    fixtureKey: 'F4',
    ownerAccountId: ACCOUNT_JAMIE,
    name: 'World History (2025) — full year',
    section: 'Period 2',
    state: 'ACTIVE',
    topics: [
      { id: 'topic-f4-a', name: 'Semester 1', sortOrder: 0 },
      { id: 'topic-f4-b', name: 'Semester 2', sortOrder: 1 },
    ],
    courseWork,
    courseWorkMaterials,
  }
}

/* ------------------------------------------------------------------ *
 * F5 — 21+ attachments on one post (deterministic sortOrder, D22)
 * ------------------------------------------------------------------ */

const f5: SeedCourse = {
  id: 'course-f5',
  fixtureKey: 'F5',
  ownerAccountId: ACCOUNT_JAMIE,
  name: 'Art History (2025) — heavy attachments',
  state: 'ACTIVE',
  topics: [{ id: 'topic-f5-unit1', name: 'Portfolio', sortOrder: 0 }],
  courseWork: [
    {
      id: 'cw-f5-1',
      title: 'Portfolio submission',
      description: 'Everything you need is attached.',
      workType: 'ASSIGNMENT',
      state: 'PUBLISHED',
      maxPoints: 100,
      topicId: 'topic-f5-unit1',
      creationTime: T('2025-08-14T09:00:00.000Z'),
      createdOrder: 0,
      // 23 attachments: 1–20 link directly, 21+ become description URLs.
      // sortOrder is contiguous and distinct so WHICH 20 survive is a total
      // order rather than whatever the query planner happened to return.
      attachments: Array.from({ length: 23 }, (_, i) => ({
        id: `att-f5-${i}`,
        kind: 'driveFile' as const,
        title: `Plate ${String(i + 1).padStart(2, '0')}.jpg`,
        driveFileId: `drive-f5-${i}`,
        shareMode: 'VIEW' as const,
        driveState: 'healthy' as const,
        ownerAccountId: ACCOUNT_JAMIE,
        sortOrder: i,
      })),
    },
  ],
}

/* ------------------------------------------------------------------ *
 * F6 — a single transient 429 that succeeds on retry
 * ------------------------------------------------------------------ */

const f6: SeedCourse = {
  id: 'course-f6',
  fixtureKey: 'F6',
  ownerAccountId: ACCOUNT_DANA,
  name: 'Biology (2025) — rate-limit demo',
  state: 'ACTIVE',
  topics: [{ id: 'topic-f6-unit1', name: 'Cells', sortOrder: 0 }],
  courseWork: [
    {
      id: 'cw-f6-1',
      title: F6_TRANSIENT_429_TITLE,
      description: 'The mock 429s this post once, then lets it through.',
      workType: 'ASSIGNMENT',
      state: 'PUBLISHED',
      maxPoints: 25,
      topicId: 'topic-f6-unit1',
      creationTime: T('2025-08-15T09:00:00.000Z'),
      createdOrder: 0,
    },
    {
      id: 'cw-f6-2',
      title: 'Lab safety check',
      workType: 'MULTIPLE_CHOICE_QUESTION',
      state: 'PUBLISHED',
      maxPoints: 5,
      answerConfig: { type: 'multipleChoice', choices: ['Yes', 'No'] },
      topicId: 'topic-f6-unit1',
      creationTime: T('2025-08-16T09:00:00.000Z'),
      createdOrder: 1,
    },
  ],
}

/* ------------------------------------------------------------------ *
 * F7 — rubric licence denial (graceful degradation to a note)
 * ------------------------------------------------------------------ */

const f7: SeedCourse = {
  id: 'course-f7',
  fixtureKey: 'F7',
  ownerAccountId: ACCOUNT_DANA,
  name: 'Chemistry (2025) — rubric course',
  state: 'ACTIVE',
  rubricsLicensed: true,
  topics: [{ id: 'topic-f7-unit1', name: 'Stoichiometry', sortOrder: 0 }],
  courseWork: [
    {
      id: 'cw-f7-1',
      title: 'Lab report: titration',
      workType: 'ASSIGNMENT',
      state: 'PUBLISHED',
      maxPoints: 60,
      topicId: 'topic-f7-unit1',
      creationTime: T('2025-08-17T09:00:00.000Z'),
      createdOrder: 0,
      rubric: [
        {
          title: 'Procedure',
          description: 'Accuracy of method',
          sortOrder: 0,
          levels: [
            { title: 'Exceeds', description: null, points: 3, sortOrder: 0 },
            { title: 'Meets', description: null, points: 2, sortOrder: 1 },
          ],
        },
      ],
    },
  ],
}

/* ------------------------------------------------------------------ *
 * F13 — persistent 429, SCOPED TO ATTACHMENT-BEARING CREATES (D13).
 *
 * The previous definition ("the mock call ALWAYS returns 429 regardless of
 * attempt count") made the guaranteed draft shell unreachable: the fallback was
 * executed by the same call that had just refused five times, so the sixth
 * attempt 429'd exactly like the first five and the item could never reach
 * `fallback_shell`. Scoping the refusal to creates carrying materials[] means a
 * BARE shell create still succeeds — which is both the reachable design and the
 * more faithful simulation, since a real Classroom 429 is a quota condition,
 * not a permanent per-item refusal.
 * ------------------------------------------------------------------ */

const f13: SeedCourse = {
  id: 'course-f13',
  fixtureKey: 'F13',
  ownerAccountId: ACCOUNT_DANA,
  name: 'Physics (2025) — quota exhaustion',
  state: 'ACTIVE',
  topics: [{ id: 'topic-f13-unit1', name: 'Motion', sortOrder: 0 }],
  courseWork: [
    {
      id: 'cw-f13-1',
      title: F13_PERSISTENT_429_TITLE,
      description: 'The mock 429s every attachment-bearing create of this post.',
      workType: 'ASSIGNMENT',
      state: 'PUBLISHED',
      maxPoints: 30,
      topicId: 'topic-f13-unit1',
      creationTime: T('2025-08-18T09:00:00.000Z'),
      createdOrder: 0,
      attachments: [
        {
          id: 'att-f13-1a',
          kind: 'driveFile',
          title: 'Reflection prompt.docx',
          driveFileId: 'drive-f13-prompt',
          shareMode: 'VIEW',
          driveState: 'healthy',
          ownerAccountId: ACCOUNT_DANA,
          sortOrder: 0,
        },
      ],
    },
    {
      id: 'cw-f13-2',
      title: 'Kinematics problem set',
      workType: 'ASSIGNMENT',
      state: 'PUBLISHED',
      maxPoints: 20,
      topicId: 'topic-f13-unit1',
      creationTime: T('2025-08-19T09:00:00.000Z'),
      createdOrder: 1,
    },
  ],
}

/* ------------------------------------------------------------------ *
 * F14 — empty course (0 posts). D26 / finding O.
 * ------------------------------------------------------------------ */

const f14: SeedCourse = {
  id: 'course-f14',
  fixtureKey: 'F14',
  ownerAccountId: ACCOUNT_DANA,
  name: 'Study Hall (2025) — nothing to copy',
  state: 'ACTIVE',
  topics: [],
  courseWork: [],
  courseWorkMaterials: [],
}

/* ------------------------------------------------------------------ *
 * F15 — the duplicate/topic dedupe PAIR (PM §6.6).
 *
 * This is the first fixture that is a *pair*: dedupe is a relation between two
 * courses, so a single course cannot express it. `F15_SOURCE` is copied into
 * `F15_TARGET`, which is pre-populated so that every case in §6.6 has a
 * concrete row on both sides:
 *
 *   draft match         Angle Pairs Practice        -> destination DRAFT
 *   published match     Proof Writing Quiz          -> destination PUBLISHED
 *   normalization-only  'Triangle Congruence  Notes' vs 'triangle congruence notes'
 *   near-miss           'Unit 1'                    vs 'Unit 11'          (NOT a dup)
 *   cross-surface       Material 'Lab Notes'        vs CourseWork 'Lab Notes' (NOT a dup)
 *   combined case       Circle Theorems Packet, duplicate AND trashed attachment
 *   control             Coordinate Geometry Lab, trashed attachment, NOT a duplicate
 *
 * plus four topic cases: exact, normalization-only, near-miss, and an ambiguous
 * multi-match (two destination topics normalizing to the same name).
 *
 * The odd whitespace and casing live on ONE side of each pair on purpose, so a
 * regression that drops normalization changes the result rather than leaving
 * both sides equally wrong.
 * ------------------------------------------------------------------ */

const f15Source: SeedCourse = {
  id: 'course-f15-source',
  fixtureKey: 'F15_SOURCE',
  ownerAccountId: ACCOUNT_JAMIE,
  name: 'Geometry (2025) — re-run source',
  section: 'Period 6',
  state: 'ACTIVE',
  rubricsLicensed: true,
  topics: [
    { id: 'topic-f15-s-exact', name: 'Unit A — Angles', sortOrder: 0 },
    // Matches the destination only after trim + internal-whitespace collapse.
    { id: 'topic-f15-s-norm', name: '  Unit   B — Proofs ', sortOrder: 1 },
    // 'Unit C' vs the destination's 'Unit C1' — must NOT match.
    { id: 'topic-f15-s-near', name: 'Unit C', sortOrder: 2 },
    // Two destination topics normalize to this; the first by API order wins.
    { id: 'topic-f15-s-amb', name: 'Review', sortOrder: 3 },
  ],
  courseWork: [
    {
      id: 'cw-f15-s-draftmatch',
      title: 'Angle Pairs Practice',
      description: 'Already sitting in the destination as an unpublished draft.',
      workType: 'ASSIGNMENT',
      state: 'PUBLISHED',
      maxPoints: 20,
      topicId: 'topic-f15-s-exact',
      creationTime: T('2025-08-20T09:00:00.000Z'),
      createdOrder: 0,
    },
    {
      id: 'cw-f15-s-pubmatch',
      title: 'Proof Writing Quiz',
      workType: 'QUIZ_ASSIGNMENT',
      state: 'PUBLISHED',
      maxPoints: 40,
      quizFormLink: 'https://forms.mock/f15-proofs',
      topicId: 'topic-f15-s-norm',
      creationTime: T('2025-08-21T09:00:00.000Z'),
      createdOrder: 1,
    },
    {
      // Two internal spaces; the destination row is all-lowercase, single-spaced.
      id: 'cw-f15-s-normmatch',
      title: 'Triangle Congruence  Notes',
      workType: 'ASSIGNMENT',
      state: 'PUBLISHED',
      maxPoints: 10,
      topicId: 'topic-f15-s-norm',
      creationTime: T('2025-08-22T09:00:00.000Z'),
      createdOrder: 2,
    },
    {
      // The near-miss. 'Unit 1' must not match the destination's 'Unit 11'.
      id: 'cw-f15-s-nearmiss',
      title: 'Unit 1',
      workType: 'ASSIGNMENT',
      state: 'PUBLISHED',
      maxPoints: 15,
      topicId: 'topic-f15-s-near',
      creationTime: T('2025-08-23T09:00:00.000Z'),
      createdOrder: 3,
    },
    {
      // The combined case: a duplicate title AND a trashed attachment. PM §6.3
      // precedence says this resolves as ONE duplicate_title skip and produces
      // no finding at all.
      id: 'cw-f15-s-dupunhealthy',
      title: 'Circle Theorems Packet',
      workType: 'ASSIGNMENT',
      state: 'PUBLISHED',
      maxPoints: 30,
      topicId: 'topic-f15-s-amb',
      creationTime: T('2025-08-24T09:00:00.000Z'),
      createdOrder: 4,
      attachments: [
        {
          id: 'att-f15-s-dupunhealthy',
          kind: 'driveFile',
          title: 'Circle Theorems.pdf',
          driveFileId: 'drive-f15-circles',
          shareMode: 'VIEW',
          driveState: 'trashed',
          ownerAccountId: ACCOUNT_JAMIE,
          sortOrder: 0,
        },
      ],
    },
    {
      // The control for the combined case: same broken attachment, NOT a
      // duplicate. Without it, "no findings" would be satisfied by a scan that
      // simply stopped health-checking altogether.
      id: 'cw-f15-s-unhealthy',
      title: 'Coordinate Geometry Lab',
      workType: 'ASSIGNMENT',
      state: 'PUBLISHED',
      maxPoints: 25,
      topicId: 'topic-f15-s-amb',
      creationTime: T('2025-08-25T09:00:00.000Z'),
      createdOrder: 5,
      attachments: [
        {
          id: 'att-f15-s-unhealthy',
          kind: 'driveFile',
          title: 'Coordinate Lab.docx',
          driveFileId: 'drive-f15-coordlab',
          shareMode: 'VIEW',
          driveState: 'trashed',
          ownerAccountId: ACCOUNT_JAMIE,
          sortOrder: 0,
        },
      ],
    },
  ],
  courseWorkMaterials: [
    {
      // Cross-surface: the destination has a COURSEWORK with this exact title.
      // Same-surface matching means this is not a duplicate.
      id: 'cwm-f15-s-crosssurface',
      title: 'Lab Notes',
      state: 'PUBLISHED',
      topicId: 'topic-f15-s-exact',
      creationTime: T('2025-08-26T09:00:00.000Z'),
      createdOrder: 6,
    },
  ],
}

const f15Target: SeedCourse = {
  id: 'course-f15-target',
  fixtureKey: 'F15_TARGET',
  ownerAccountId: ACCOUNT_JAMIE,
  name: 'Geometry — Period 6 (2026)',
  section: '2026 Spring',
  state: 'ACTIVE',
  isSisShell: false,
  rubricsLicensed: true,
  topics: [
    { id: 'topic-f15-t-exact', name: 'Unit A — Angles', sortOrder: 0 },
    { id: 'topic-f15-t-norm', name: 'unit b — proofs', sortOrder: 1 },
    { id: 'topic-f15-t-near', name: 'Unit C1', sortOrder: 2 },
    // The ambiguous pair. 'Review' is first by sortOrder, so it is the one
    // reused; the second exists purely to make `ambiguous` true.
    { id: 'topic-f15-t-amb-1', name: 'Review', sortOrder: 3 },
    { id: 'topic-f15-t-amb-2', name: 'review ', sortOrder: 4 },
  ],
  courseWork: [
    {
      // DRAFT — invisible to an unfiltered courseWork.list, which is the exact
      // bug this fixture exists to catch.
      id: 'cw-f15-t-draftmatch',
      title: 'Angle Pairs Practice',
      workType: 'ASSIGNMENT',
      state: 'DRAFT',
      maxPoints: 20,
      topicId: 'topic-f15-t-exact',
      creationTime: T('2026-01-05T09:00:00.000Z'),
      createdOrder: 0,
    },
    {
      id: 'cw-f15-t-pubmatch',
      title: 'Proof Writing Quiz',
      workType: 'QUIZ_ASSIGNMENT',
      state: 'PUBLISHED',
      maxPoints: 40,
      topicId: 'topic-f15-t-norm',
      creationTime: T('2026-01-06T09:00:00.000Z'),
      createdOrder: 1,
    },
    {
      id: 'cw-f15-t-normmatch',
      title: 'triangle congruence notes',
      workType: 'ASSIGNMENT',
      state: 'PUBLISHED',
      maxPoints: 10,
      topicId: 'topic-f15-t-norm',
      creationTime: T('2026-01-07T09:00:00.000Z'),
      createdOrder: 2,
    },
    {
      id: 'cw-f15-t-nearmiss',
      title: 'Unit 11',
      workType: 'ASSIGNMENT',
      state: 'PUBLISHED',
      maxPoints: 15,
      topicId: 'topic-f15-t-near',
      creationTime: T('2026-01-08T09:00:00.000Z'),
      createdOrder: 3,
    },
    {
      id: 'cw-f15-t-dupunhealthy',
      title: 'Circle Theorems Packet',
      workType: 'ASSIGNMENT',
      state: 'DRAFT',
      maxPoints: 30,
      topicId: 'topic-f15-t-amb-1',
      creationTime: T('2026-01-09T09:00:00.000Z'),
      createdOrder: 4,
    },
    {
      // Same title as the SOURCE's Material — a CourseWork here, so not a match.
      id: 'cw-f15-t-crosssurface',
      title: 'Lab Notes',
      workType: 'ASSIGNMENT',
      state: 'PUBLISHED',
      maxPoints: 5,
      topicId: 'topic-f15-t-exact',
      creationTime: T('2026-01-10T09:00:00.000Z'),
      createdOrder: 5,
    },
  ],
}

/* ------------------------------------------------------------------ *
 * Targets and an archived source, so list scoping is exercisable
 * ------------------------------------------------------------------ */

const targetJamie: SeedCourse = {
  id: 'course-target-jamie',
  fixtureKey: 'TARGET_JAMIE_SIS',
  ownerAccountId: ACCOUNT_JAMIE,
  name: 'US History — Period 3',
  section: '2026 Spring',
  state: 'ACTIVE',
  isSisShell: true,
  rubricsLicensed: true,
}

const targetJamieSecond: SeedCourse = {
  id: 'course-target-jamie-2',
  fixtureKey: 'TARGET_JAMIE_PLAIN',
  ownerAccountId: ACCOUNT_JAMIE,
  name: 'World History — Period 2',
  section: '2026 Spring',
  state: 'ACTIVE',
  isSisShell: false,
  rubricsLicensed: true,
}

const archivedJamie: SeedCourse = {
  id: 'course-archived-jamie',
  fixtureKey: 'ARCHIVED_JAMIE',
  ownerAccountId: ACCOUNT_JAMIE,
  name: 'US History (2024) — archived',
  section: 'Period 3',
  state: 'ARCHIVED',
  courseWorkMaterials: [
    {
      id: 'cwm-arch-1',
      title: 'Old syllabus',
      state: 'PUBLISHED',
      creationTime: T('2024-08-01T09:00:00.000Z'),
      createdOrder: 0,
    },
  ],
}

/** Dana's target is licence-blocked, which is what F7 degrades against. */
const targetDana: SeedCourse = {
  id: 'course-target-dana',
  fixtureKey: 'TARGET_DANA_SIS',
  ownerAccountId: ACCOUNT_DANA,
  name: 'Science — Period 4',
  section: '2026 Spring',
  state: 'ACTIVE',
  isSisShell: true,
  rubricsLicensed: false,
}

export const SEED_COURSES: SeedCourse[] = [
  f1,
  f2,
  f3,
  buildF4(),
  f5,
  f6,
  f7,
  f13,
  f14,
  f15Source,
  f15Target,
  targetJamie,
  targetJamieSecond,
  archivedJamie,
  targetDana,
]

export const FIXTURE_KEYS = {
  F1: 'course-f1',
  F2: 'course-f2',
  F3: 'course-f3',
  F4: 'course-f4',
  F5: 'course-f5',
  F6: 'course-f6',
  F7: 'course-f7',
  /** F8 (all three states), F9 (all four types) and F11 (topics + untopiced)
   *  are properties of F1 — the distribution the PM brief explicitly allows. */
  F8: 'course-f1',
  F9: 'course-f1',
  F11: 'course-f1',
  /** F10 is the two seeded accounts, not a course. */
  F12: 'course-f4',
  F13: 'course-f13',
  F14: 'course-f14',
  /** F15 is a PAIR — dedupe is a relation between two courses. */
  F15_SOURCE: 'course-f15-source',
  F15_TARGET: 'course-f15-target',
  TARGET_JAMIE: 'course-target-jamie',
  TARGET_DANA: 'course-target-dana',
  ARCHIVED_JAMIE: 'course-archived-jamie',
} as const
