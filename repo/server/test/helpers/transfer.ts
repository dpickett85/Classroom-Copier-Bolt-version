import type { PrismaClient } from '@prisma/client'
import type { Resolution } from '@classroom-copier/shared'
import {
  MockClassroomProvider,
  type MockProviderOptions,
} from '../../src/adapters/mock/mock-classroom-provider.js'
import type { ClassroomProvider } from '../../src/adapters/classroom-provider.interface.js'
import { PreflightEngine } from '../../src/services/preflight-engine.js'
import {
  TransferEngine,
  createTransferJob,
  type TransferEngineOptions,
} from '../../src/services/transfer-engine.js'

/** Backoff that does not actually sleep — five real waits per item would make
 *  the suite the slow one everyone skips. */
export const FAST_ENGINE: TransferEngineOptions = {
  backoff: { baseDelayMs: 1, multiplier: 1, maxDelayMs: 1, jitterRatio: 0 },
  sleep: async () => {},
}

export interface TransferRun {
  jobId: string
  scanId: string
  provider: ClassroomProvider
  engine: TransferEngine
}

export async function scanAndCreateJob(
  prisma: PrismaClient,
  input: {
    accountId: string
    sourceCourseId: string
    targetCourseId: string
    resolutions?: Resolution[]
    providerOptions?: MockProviderOptions
    engineOptions?: TransferEngineOptions
  },
): Promise<TransferRun> {
  const provider = new MockClassroomProvider(prisma, input.providerOptions)
  const scan = await new PreflightEngine(prisma, provider).run({
    accountId: input.accountId,
    sourceCourseId: input.sourceCourseId,
    targetCourseId: input.targetCourseId,
  })
  const { jobId } = await createTransferJob(prisma, {
    accountId: input.accountId,
    scanId: scan.scanId,
    resolutions: input.resolutions ?? [],
  })
  const engine = new TransferEngine(prisma, provider, {
    ...FAST_ENGINE,
    ...input.engineOptions,
  })
  return { jobId, scanId: scan.scanId, provider, engine }
}

/** Scan, create, and run to completion. */
export async function runTransfer(
  prisma: PrismaClient,
  input: Parameters<typeof scanAndCreateJob>[1],
): Promise<TransferRun> {
  const run = await scanAndCreateJob(prisma, input)
  await run.engine.run(run.jobId)
  return run
}
