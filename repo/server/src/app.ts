/**
 * composition-root — the ONLY module with a runtime dependency on a CONCRETE
 * `ClassroomProvider`. Everything else depends on the type-only port, which
 * emits no JavaScript, so nothing can import a concrete provider by accident.
 */
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { MockClassroomProvider, type MockProviderOptions } from './adapters/mock/mock-classroom-provider.js'
import { GoogleClassroomProvider } from './adapters/google/google-classroom-provider.js'
import type { ClassroomProvider } from './adapters/classroom-provider.interface.js'
import {
  LicenseBlockedError,
  NotFoundError,
  PermissionError,
  RateLimitError,
} from './adapters/types.js'
import { config } from './config.js'
import { logger } from './logger.js'
import { requireCsrfHeader } from './middleware/csrf.js'
import { authRouter, type OAuthClient } from './routes/auth.js'
import { mockAuthRouter } from './routes/auth-mock.js'
import { coursesRouter } from './routes/courses.js'
import { healthRouter } from './routes/health.js'
import { transferJobsRouter } from './routes/transfer-jobs.js'
import { createAccountDirectory, type AccountDirectory } from './services/account-directory.js'
import { JobReconciler } from './services/job-reconciler.js'
import { createMonetizationService, type MonetizationService } from './services/monetization.js'
import { TransferEngine, type TransferEngineOptions } from './services/transfer-engine.js'

export interface AppDeps {
  prisma: PrismaClient
  provider?: ClassroomProvider
  accounts?: AccountDirectory
  /** Test seam for the Google OAuth flow — the ClassroomProvider precedent. */
  oauth?: OAuthClient
  providerOptions?: MockProviderOptions
  engineOptions?: Omit<TransferEngineOptions, 'onJobComplete'>
  monetization?: MonetizationService
}

export interface BuiltApp {
  app: Express
  provider: ClassroomProvider
  accounts: AccountDirectory
  engine: TransferEngine
  reconciler: JobReconciler
  monetization: MonetizationService
}

function createClassroomProvider(
  prisma: PrismaClient,
  providerOptions: MockProviderOptions | undefined,
): ClassroomProvider {
  if (config.googleProviderMode === 'google') return new GoogleClassroomProvider(prisma)
  return new MockClassroomProvider(prisma, {
    perItemDelayMs: config.mockProviderDelayMs,
    ...providerOptions,
  })
}

export function buildApp(deps: AppDeps): BuiltApp {
  const { prisma } = deps

  // GOOGLE_PROVIDER_MODE selects the concrete adapter, and this is the one place
  // that knows it. `GoogleClassroomProvider` binds a `RealClassroomProvider` to
  // whichever account is acting (see its header); the mock is account-agnostic
  // and needs no such binding.
  const provider = deps.provider ?? createClassroomProvider(prisma, deps.providerOptions)

  // Fail-fast: a google-mode boot that is still serving the fixture world is the
  // exact defect this guard exists for — real OAuth completes, and then every
  // course read, coursework read and post creation runs against the mock. It is
  // checked on the RESOLVED provider, so an injected one is caught too; the
  // `deps.provider` seam is exempt only under NODE_ENV=test, never in production.
  const injectedUnderTest = deps.provider != null && config.isTest
  if (config.googleProviderMode === 'google' && !injectedUnderTest && !(provider instanceof GoogleClassroomProvider)) {
    throw new Error(
      `[composition-root] GOOGLE_PROVIDER_MODE=google but the resolved ClassroomProvider is ${provider.constructor.name}. Refusing to boot — a real sign-in served by the fixture world is worse than no boot at all.`,
    )
  }

  // QA-1 — the OTHER direction, and the one a real deploy actually hits. The
  // guard above fires only when the mode is explicitly `google`; it was silent
  // on `NODE_ENV=production` with the mode `mock` or simply unset, which is how
  // a Render deploy that forgot one variable booted into the fixture world and
  // served invented courses to a real teacher.
  //
  // `config.ts` now refuses to RESOLVE that combination, so in a plain boot
  // this can never fire. It is kept because `buildApp` is also reached with a
  // config object mutated after import (the test seams do exactly that, and so
  // would any future embedding of the app), and a guard that only exists at
  // import time does not cover those callers.
  if (config.isProductionLike && !config.isTest && config.googleProviderMode !== 'google') {
    throw new Error(
      '[composition-root] NODE_ENV=production requires GOOGLE_PROVIDER_MODE=google, and the resolved mode is ' +
        `"${config.googleProviderMode}". Refusing to boot — a live deployment serving the built-in demo courses ` +
        'is worse than no boot at all. Set GOOGLE_PROVIDER_MODE=google in the Render service\'s Environment settings.',
    )
  }

  // Same discriminator as the provider above — one mode check, two ports.
  const accounts = deps.accounts ?? createAccountDirectory(prisma, config.googleProviderMode)

  const monetization = deps.monetization ?? createMonetizationService(prisma)

  // D28 — the monetization completion hook, injected as a callback so the
  // dependency edge still points from monetization toward the engine's caller
  // rather than the other way around.
  const engine = new TransferEngine(prisma, provider, {
    ...deps.engineOptions,
    onJobComplete: (summary) => monetization.onJobComplete(summary),
  })

  const reconciler = new JobReconciler(prisma, provider, {
    staleAfterMs: config.jobStaleAfterMs,
    reauthGraceMs: config.googleReauthGraceMs,
  })

  const app = express()
  app.use(
    cors({
      // Never `*` with credentials — a pinned allowlist, because the frontend
      // and API are split-origin Render services.
      origin: config.corsOrigins,
      credentials: true,
    }),
  )
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  // CSRF hardening — every state-changing method needs the custom header
  // (see middleware/csrf.ts). Mounted ahead of ALL routers, health included,
  // so no future route can be added state-changing without it; health has no
  // state-changing methods so this is a no-op for it in practice.
  app.use(requireCsrfHeader())

  // Mount order matters: health and auth are never behind the monetization
  // gate, and the status endpoint must never be gated by a credit check.
  app.use('/api', healthRouter())
  app.use('/api', authRouter(prisma, {
    accounts,
    oauth: deps.oauth,
    // Decision F — a job that paused for re-auth resumes the moment the
    // teacher's new token lands, without them touching anything.
    onReauthenticated: (jobId) => {
      void engine.resume(jobId).catch((error: unknown) => {
        logger.error('resume after re-authentication rejected outside the engine', {
          jobId,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    },
  }))
  // §8.4 — the mock account picker is REGISTERED ONLY in mock mode. Not disabled
  // inside a handler: absent from the routing table entirely, so a production
  // boot has no path that mints a session without Google.
  if (config.googleProviderMode === 'mock') {
    app.use('/api', mockAuthRouter(prisma))
  }
  app.use('/api', coursesRouter(prisma, provider))
  app.use('/api', transferJobsRouter(prisma, engine, monetization))

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.path}` } })
  })

  // One error-handling middleware normalises provider errors into consistent
  // HTTP responses.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof RateLimitError) {
      res.status(429).json({ error: { code: 'rate_limited', message: error.message } })
      return
    }
    if (error instanceof PermissionError) {
      res.status(403).json({ error: { code: 'permission_denied', message: error.message } })
      return
    }
    if (error instanceof NotFoundError) {
      res.status(404).json({ error: { code: 'not_found', message: error.message } })
      return
    }
    if (error instanceof LicenseBlockedError) {
      res.status(409).json({ error: { code: 'license_blocked', message: error.message } })
      return
    }
    logger.error('unhandled request error', {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    })
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong.' } })
  })

  return { app, provider, accounts, engine, reconciler, monetization }
}
