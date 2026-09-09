import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * F13 — provider portability of the Prisma schema.
 *
 * `schema.prisma` is GENERATED: `scripts/prisma-datasource.mjs` concatenates
 * `schema.template.prisma` (the single source of truth) with a datasource block
 * chosen by DATABASE_PROVIDER. This file proves the property that is actually at
 * risk — a model body that is not provider-portable — without needing a live
 * Postgres: `prisma validate` parses and type-checks the schema against the named
 * provider WITHOUT connecting.
 *
 * MANUAL-VERIFY: a real `db push` against a real Postgres instance happens once,
 * by the operator, during the live-OAuth checklist's first production deploy.
 */

const SERVER_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const REPO_ROOT = path.resolve(SERVER_DIR, '..')
const TEMPLATE = path.join(SERVER_DIR, 'prisma', 'schema.template.prisma')
const GENERATED = path.join(SERVER_DIR, 'prisma', 'schema.prisma')
const GENERATOR = path.join(REPO_ROOT, 'scripts', 'prisma-datasource.mjs')
const PRISMA_CLI = path.join(REPO_ROOT, 'node_modules', 'prisma', 'build', 'index.js')

function generate(provider: string): string {
  execFileSync(process.execPath, [GENERATOR], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_PROVIDER: provider },
    stdio: 'pipe',
  })
  return fs.readFileSync(GENERATED, 'utf8')
}

/**
 * `prisma validate` checks that DATABASE_URL's protocol matches the datasource
 * provider, so each branch needs a URL of the right shape. It never connects —
 * the Postgres URL below is a syntactically valid placeholder that points at
 * nothing, which is the whole reason this gate is runnable without a database.
 */
const PLACEHOLDER_URL: Record<string, string> = {
  sqlite: 'file:./data/test-template.db',
  postgresql: 'postgresql://user:password@localhost:5432/classroom_copier',
}

function prisma(provider: string, ...args: string[]): void {
  execFileSync(process.execPath, [PRISMA_CLI, ...args], {
    cwd: SERVER_DIR,
    env: { ...process.env, DATABASE_URL: PLACEHOLDER_URL[provider] },
    stdio: 'pipe',
  })
}

afterAll(() => {
  // Leave the working tree — and the generated Prisma client — on the dev/test
  // provider no matter how this file exits.
  generate('sqlite')
  prisma('sqlite', 'generate')
})

describe('templated Prisma datasource', () => {
  it('keeps the template free of a datasource block — one source of truth', () => {
    const template = fs.readFileSync(TEMPLATE, 'utf8')
    expect(template).not.toMatch(/^\s*datasource\s+db\s*\{/m)
    expect(template).toMatch(/^model\s+Session\s*\{/m)
  })

  it('generates a sqlite schema from the template and validates it', () => {
    const schema = generate('sqlite')
    expect(schema).toMatch(/provider\s*=\s*"sqlite"/)
    expect(schema).toMatch(/url\s*=\s*env\("DATABASE_URL"\)/)
    expect(() => prisma('sqlite', 'validate')).not.toThrow()
    expect(() => prisma('sqlite', 'generate')).not.toThrow()
  })

  it('generates a postgresql schema from the SAME template, unedited, and validates it', () => {
    const before = fs.readFileSync(TEMPLATE, 'utf8')
    const schema = generate('postgresql')
    expect(fs.readFileSync(TEMPLATE, 'utf8')).toBe(before)
    expect(schema).toMatch(/provider\s*=\s*"postgresql"/)
    expect(() => prisma('postgresql', 'validate')).not.toThrow()
    expect(() => prisma('postgresql', 'generate')).not.toThrow()
  })

  it('defaults to sqlite when DATABASE_PROVIDER is unset', () => {
    execFileSync(process.execPath, [GENERATOR], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_PROVIDER: undefined },
      stdio: 'pipe',
    })
    expect(fs.readFileSync(GENERATED, 'utf8')).toMatch(/provider\s*=\s*"sqlite"/)
  })

  it('rejects an unknown provider rather than emitting an unusable schema', () => {
    expect(() =>
      execFileSync(process.execPath, [GENERATOR], {
        cwd: REPO_ROOT,
        env: { ...process.env, DATABASE_PROVIDER: 'mysql' },
        stdio: 'pipe',
      }),
    ).toThrow()
  })

  it('gitignores the generated schema so a stale provider can never be committed', () => {
    const ignored = execFileSync('git', ['check-ignore', '--quiet', GENERATED], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    })
    expect(ignored).toBeDefined()
    // and it must not be tracked from an earlier life
    const tracked = execFileSync('git', ['ls-files', '--', 'server/prisma/schema.prisma'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    expect(tracked.trim()).toBe('')
  })
})
