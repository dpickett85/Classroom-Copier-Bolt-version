import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MockClassroomProvider } from '../adapters/mock/mock-classroom-provider.js'
import { FIXTURE_KEYS } from '../fixtures/index.js'
import { createTestDb, type TestDb } from '../../test/helpers/db.js'
import { PreflightEngine } from './preflight-engine.js'

let db: TestDb
let engine: PreflightEngine

beforeAll(async () => {
  db = await createTestDb()
  engine = new PreflightEngine(db.prisma, new MockClassroomProvider(db.prisma))
})
afterAll(async () => {
  await db.dispose()
})

const run = (sourceCourseId: string, targetCourseId = FIXTURE_KEYS.TARGET_JAMIE) =>
  engine.run({ accountId: 'acct-jamie', sourceCourseId, targetCourseId })

describe('F1 — silent auto-proceed on a healthy course', () => {
  it('produces zero findings', async () => {
    const result = await run(FIXTURE_KEYS.F1)
    expect(result.findings).toEqual([])
  })
})

describe('D11 — the scan is PERSISTED, and totalPostsScanned is count(scan items)', () => {
  it('writes a PreflightScan row whose item count equals totalPostsScanned', async () => {
    const result = await run(FIXTURE_KEYS.F1)
    const stored = await db.prisma.preflightScan.findUnique({
      where: { id: result.scanId },
      include: { items: true },
    })
    expect(stored).not.toBeNull()
    expect(stored!.totalPostsScanned).toBe(result.totalPostsScanned)
    expect(stored!.items).toHaveLength(result.totalPostsScanned)
  })

  it('stores the items in the enumerator total order, with contiguous createdOrder', async () => {
    const result = await run(FIXTURE_KEYS.F4)
    const items = await db.prisma.preflightScanItem.findMany({
      where: { scanId: result.scanId },
      orderBy: { createdOrder: 'asc' },
    })
    expect(items).toHaveLength(50)
    expect(items.map((i) => i.createdOrder)).toEqual(items.map((_, idx) => idx))
  })

  it('counts a 50-post course as 50, including its Draft posts (F4 + F8)', async () => {
    const result = await run(FIXTURE_KEYS.F4)
    expect(result.totalPostsScanned).toBe(50)
  })
})

describe('F2 — trashed/deleted findings with TYPE-AWARE skip labels', () => {
  it('labels the skip option from the flagged item\'s actual coursework type', async () => {
    const result = await run(FIXTURE_KEYS.F2)
    const materialFinding = result.findings.find((f) => f.sourceType === 'courseWorkMaterial')
    expect(materialFinding).toBeDefined()
    expect(materialFinding!.postTypeLabel).toBe('Material')
    const skip = materialFinding!.options.find((o) => o.kind === 'skip_post')
    expect(skip!.label).toBe('Skip Material')
    expect(skip!.label).not.toBe('Skip Assignment')
  })

  it('recommends Create Draft Shell with Note — never a silent skip', async () => {
    const result = await run(FIXTURE_KEYS.F2)
    const finding = result.findings[0]!
    const recommended = finding.options.filter((o) => o.recommended)
    expect(recommended).toHaveLength(1)
    expect(recommended[0]!.kind).toBe('create_draft_shell_with_note')
  })

  it('flags both a trashed and a deleted attachment', async () => {
    const result = await run(FIXTURE_KEYS.F2)
    expect(new Set(result.findings.map((f) => f.issue))).toEqual(new Set(['trashed', 'deleted']))
  })
})

describe('F3 — permission-locked findings', () => {
  it('offers exactly the three Scenario 3 options with Copy to My Drive recommended', async () => {
    const result = await run(FIXTURE_KEYS.F3)
    const finding = result.findings.find((f) => f.issue === 'permission_locked')
    expect(finding).toBeDefined()
    expect(finding!.scenario).toBe(3)
    expect(finding!.options.map((o) => o.kind)).toEqual([
      'copy_to_my_drive',
      'link_existing_file',
      'skip_attachment_and_note_draft',
    ])
    expect(finding!.options.filter((o) => o.recommended).map((o) => o.kind)).toEqual([
      'copy_to_my_drive',
    ])
  })

  it('carries a risk warning on Link Existing File and on nothing else', async () => {
    const result = await run(FIXTURE_KEYS.F3)
    const finding = result.findings.find((f) => f.issue === 'permission_locked')!
    const withWarning = finding.options.filter((o) => o.riskWarning !== null)
    expect(withWarning.map((o) => o.kind)).toEqual(['link_existing_file'])
  })
})

describe('F14 — the empty-course path (D26)', () => {
  it('produces a scan with totalPostsScanned == 0 and no findings', async () => {
    const result = await engine.run({
      accountId: 'acct-dana',
      sourceCourseId: FIXTURE_KEYS.F14,
      targetCourseId: FIXTURE_KEYS.TARGET_DANA,
    })
    expect(result.totalPostsScanned).toBe(0)
    expect(result.findings).toEqual([])
    const stored = await db.prisma.preflightScan.findUnique({ where: { id: result.scanId } })
    expect(stored!.totalPostsScanned).toBe(0)
  })
})

describe('topic names travel with the scan (F11)', () => {
  it('records the topic name for topiced posts and null for untopiced ones', async () => {
    const result = await run(FIXTURE_KEYS.F1)
    const items = await db.prisma.preflightScanItem.findMany({ where: { scanId: result.scanId } })
    expect(items.some((i) => i.topicName !== null)).toBe(true)
    expect(items.some((i) => i.topicId === null && i.topicName === null)).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * F15 — duplicate detection and topic reuse (Decision C/D, PM §6.1-§6.6)
 * ------------------------------------------------------------------ */

const runF15 = () =>
  engine.run({
    accountId: 'acct-jamie',
    sourceCourseId: FIXTURE_KEYS.F15_SOURCE,
    targetCourseId: FIXTURE_KEYS.F15_TARGET,
  })

describe('F15 — duplicate detection (PM §6.1, §6.2, §6.6)', () => {
  it('matches a destination DRAFT — the state an unfiltered list would hide', async () => {
    const result = await runF15()
    const dup = result.duplicates.find((d) => d.postTitle === 'Angle Pairs Practice')
    expect(dup).toBeDefined()
    expect(dup!.matchedState).toBe('DRAFT')
    expect(dup!.matchedTitle).toBe('Angle Pairs Practice')
  })

  it('matches a destination PUBLISHED item', async () => {
    const result = await runF15()
    const dup = result.duplicates.find((d) => d.postTitle === 'Proof Writing Quiz')
    expect(dup).toBeDefined()
    expect(dup!.matchedState).toBe('PUBLISHED')
  })

  it('matches only after normalization, and quotes the destination title verbatim', async () => {
    const result = await runF15()
    const dup = result.duplicates.find((d) => d.postTitle === 'Triangle Congruence  Notes')
    expect(dup).toBeDefined()
    // Un-normalized, so the disclosure can say what the teacher will actually see.
    expect(dup!.matchedTitle).toBe('triangle congruence notes')
  })

  it('does NOT match the near-miss "Unit 1" against "Unit 11"', async () => {
    const result = await runF15()
    expect(result.duplicates.map((d) => d.postTitle)).not.toContain('Unit 1')
  })

  it('does NOT match across coursework surfaces (Material "Lab Notes" vs CourseWork "Lab Notes")', async () => {
    const result = await runF15()
    expect(result.duplicates.map((d) => d.postTitle)).not.toContain('Lab Notes')
  })

  it('flags exactly the four intended duplicates and no others', async () => {
    const result = await runF15()
    expect(new Set(result.duplicates.map((d) => d.postTitle))).toEqual(
      new Set([
        'Angle Pairs Practice',
        'Proof Writing Quiz',
        'Triangle Congruence  Notes',
        'Circle Theorems Packet',
      ]),
    )
  })

  it('carries the type-aware label the disclosure list renders', async () => {
    const result = await runF15()
    const dup = result.duplicates.find((d) => d.postTitle === 'Proof Writing Quiz')!
    expect(dup.postTypeLabel).toBe('Quiz assignment')
  })
})

describe('F15 — §6.3 precedence: a duplicate never enters findings[]', () => {
  it('produces NO finding for the combined duplicate + trashed-attachment item', async () => {
    const result = await runF15()
    const combined = result.findings.filter((f) => f.postTitle === 'Circle Theorems Packet')
    expect(combined).toEqual([])
    // ...and it IS disclosed as a duplicate, so the item is accounted for exactly once.
    expect(result.duplicates.map((d) => d.postTitle)).toContain('Circle Theorems Packet')
  })

  it('still flags the CONTROL item — the same broken attachment on a non-duplicate', async () => {
    const result = await runF15()
    const control = result.findings.filter((f) => f.postTitle === 'Coordinate Geometry Lab')
    expect(control).toHaveLength(1)
    expect(control[0]!.issue).toBe('trashed')
  })

  it('persists duplicateOfTitle/duplicateOfState on the scan item, and null on the rest', async () => {
    const result = await runF15()
    const items = await db.prisma.preflightScanItem.findMany({ where: { scanId: result.scanId } })
    const dup = items.find((i) => i.title === 'Circle Theorems Packet')!
    expect(dup.duplicateOfTitle).toBe('Circle Theorems Packet')
    expect(dup.duplicateOfState).toBe('DRAFT')
    const nearMiss = items.find((i) => i.title === 'Unit 1')!
    expect(nearMiss.duplicateOfTitle).toBeNull()
    expect(nearMiss.duplicateOfState).toBeNull()
    // §6.5 — duplicates are still SCANNED, so the ledger invariant is unchanged.
    expect(result.totalPostsScanned).toBe(items.length)
    expect(items).toHaveLength(7)
  })
})

describe('F15 — topic reuse (Decision D, PM §6.8)', () => {
  it('reuses an exactly-matching destination topic', async () => {
    const result = await runF15()
    const reuse = result.topicReuse.find((t) => t.sourceTopicName === 'Unit A — Angles')
    expect(reuse).toBeDefined()
    expect(reuse!.destinationTopicId).toBe('topic-f15-t-exact')
    expect(reuse!.ambiguous).toBe(false)
  })

  it('reuses a topic matching only after normalization', async () => {
    const result = await runF15()
    const reuse = result.topicReuse.find((t) => t.sourceTopicName === '  Unit   B — Proofs ')
    expect(reuse).toBeDefined()
    expect(reuse!.destinationTopicId).toBe('topic-f15-t-norm')
    expect(reuse!.destinationTopicName).toBe('unit b — proofs')
  })

  it('does NOT reuse on a near-miss ("Unit C" vs "Unit C1")', async () => {
    const result = await runF15()
    expect(result.topicReuse.map((t) => t.sourceTopicName)).not.toContain('Unit C')
  })

  it('reuses the FIRST of an ambiguous multi-match and says it was ambiguous', async () => {
    const result = await runF15()
    const reuse = result.topicReuse.find((t) => t.sourceTopicName === 'Review')
    expect(reuse).toBeDefined()
    expect(reuse!.ambiguous).toBe(true)
    expect(reuse!.destinationTopicId).toBe('topic-f15-t-amb-1')
  })

  it('persists the reuse map on the scan row, the same idiom as findingsJson', async () => {
    const result = await runF15()
    const stored = await db.prisma.preflightScan.findUnique({ where: { id: result.scanId } })
    expect(JSON.parse(stored!.topicReuseJson)).toEqual(result.topicReuse)
  })

  it('records no reuse at all when the destination has no topics', async () => {
    const result = await run(FIXTURE_KEYS.F1)
    expect(result.topicReuse).toEqual([])
  })
})
