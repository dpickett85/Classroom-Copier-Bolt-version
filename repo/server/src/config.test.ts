/**
 * QA-1 — the production provider-mode fail-fast.
 *
 * The cycle-1 guard (in `app.ts`) only caught ONE direction: "mode says google
 * but the resolved provider is not a Google adapter". It was silent on the
 * direction that a real Render deploy actually hits — `NODE_ENV=production`
 * with `GOOGLE_PROVIDER_MODE` simply *omitted*, which fell through the
 * `?? 'mock'` default and booted happily into the fixture world, serving
 * invented courses to a real signed-in teacher. QA reproduced that live.
 *
 * These cases pin the second direction at its source: config resolution.
 * `composition-root.test.ts` pins the first direction plus a defence-in-depth
 * copy of this one, so neither can regress without the other going red.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  process.env = { ...ORIGINAL }
})

/** config.ts resolves once at import; a boot is a fresh module graph. */
async function boot(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  return (await import('./config.js')).config
}

/**
 * A production-like environment with everything google mode needs EXCEPT the
 * mode itself — so the only variable under test is `GOOGLE_PROVIDER_MODE`.
 * `VITEST` must be cleared or `isTest` stays true and nothing is production.
 */
const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  VITEST: undefined,
  SESSION_SECRET: 'a-session-secret',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_REDIRECT_URI: 'https://api.example.com/api/auth/callback',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
}

describe('config — GOOGLE_PROVIDER_MODE production fail-fast (PM §7.1a)', () => {
  it('refuses to boot when GOOGLE_PROVIDER_MODE is UNSET under NODE_ENV=production', async () => {
    // The exact live reproduction from the QA report: no GOOGLE_PROVIDER_MODE
    // at all. Before this guard existed the `?? 'mock'` default swallowed it.
    await expect(boot({ ...PRODUCTION_ENV, GOOGLE_PROVIDER_MODE: undefined })).rejects.toThrow(
      /GOOGLE_PROVIDER_MODE/,
    )
  })

  it('refuses to boot when GOOGLE_PROVIDER_MODE is explicitly "mock" under NODE_ENV=production', async () => {
    await expect(boot({ ...PRODUCTION_ENV, GOOGLE_PROVIDER_MODE: 'mock' })).rejects.toThrow(
      /GOOGLE_PROVIDER_MODE/,
    )
  })

  it('refuses to boot on an unrecognised GOOGLE_PROVIDER_MODE value, in ANY environment', async () => {
    // A typo (`gogle`, `Google`, `real`) previously cast straight through the
    // `as 'mock' | 'google'` assertion and then behaved as mock everywhere,
    // because every consumer tests `=== 'google'`. Silent-typo-means-mock is
    // the same defect as unset-means-mock with a different spelling.
    await expect(boot({ ...PRODUCTION_ENV, GOOGLE_PROVIDER_MODE: 'real' })).rejects.toThrow(
      /GOOGLE_PROVIDER_MODE/,
    )
    await expect(
      boot({ NODE_ENV: 'development', VITEST: undefined, SESSION_SECRET: 's', GOOGLE_PROVIDER_MODE: 'Google' }),
    ).rejects.toThrow(/GOOGLE_PROVIDER_MODE/)
  })

  /**
   * The message is read by a teacher looking at a Render deploy log, not by a
   * developer with the source open. It must name the variable, the value, and
   * where to put it — and say what the wrong boot would have DONE, because
   * "invalid configuration" tells that reader nothing actionable.
   */
  it('names the variable, the exact value to set, and the consequence — for a teacher, not a developer', async () => {
    const error = await boot({ ...PRODUCTION_ENV, GOOGLE_PROVIDER_MODE: undefined }).then(
      () => null,
      (caught: unknown) => caught as Error,
    )
    expect(error, 'the boot did not fail at all').not.toBeNull()
    const message = error!.message
    expect(message).toContain('GOOGLE_PROVIDER_MODE')
    expect(message).toContain('google')
    expect(message, 'no deployment surface named').toMatch(/Render/i)
    expect(message, 'no environment-variable instruction').toMatch(/environment/i)
    expect(message, 'the consequence of the wrong value is not stated').toMatch(
      /demo|sample|example|fixture|made-up|not your real/i,
    )
  })

  it('boots in production when GOOGLE_PROVIDER_MODE=google', async () => {
    const cfg = await boot({ ...PRODUCTION_ENV, GOOGLE_PROVIDER_MODE: 'google' })
    expect(cfg.googleProviderMode).toBe('google')
    expect(cfg.isProductionLike).toBe(true)
  })

  it('still allows mock mode outside production — dev and test are unaffected', async () => {
    const dev = await boot({
      NODE_ENV: 'development',
      VITEST: undefined,
      SESSION_SECRET: 'dev-secret',
      GOOGLE_PROVIDER_MODE: 'mock',
    })
    expect(dev.googleProviderMode).toBe('mock')
    expect(dev.isProductionLike).toBe(false)

    // Unset outside production keeps defaulting to mock: that default is the
    // right one for a developer's laptop and the wrong one for Render, which is
    // precisely why the guard is on the environment and not on the default.
    const unset = await boot({
      NODE_ENV: 'development',
      VITEST: undefined,
      SESSION_SECRET: 'dev-secret',
      GOOGLE_PROVIDER_MODE: undefined,
    })
    expect(unset.googleProviderMode).toBe('mock')
  })
})
