import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Builds one schema-only SQLite template that every test file copies. Test
 * isolation needs a per-file database: a shared file plus SQLite's single
 * writer produces flaky SQLITE_BUSY failures that look like product bugs.
 *
 * The Prisma CLI is invoked by resolved path rather than through `npx`, which
 * under vitest's globalSetup env resolved to a freshly-downloaded major version
 * with a different flag set.
 */
export default function setup(): void {
  const serverDir = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
  const repoRoot = path.resolve(serverDir, '..')
  // Prisma resolves a relative SQLite URL against the SCHEMA directory, not the
  // cwd — so the template lives under prisma/data, and everything else must
  // agree with that rather than guessing.
  const dataDir = path.join(serverDir, 'prisma', 'data')
  const template = path.join(dataDir, 'test-template.db')
  fs.mkdirSync(dataDir, { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(template + suffix, { force: true })

  // schema.prisma is generated and gitignored — a fresh clone has only the
  // template, so write it before the CLI is asked to read it.
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'prisma-datasource.mjs')], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_PROVIDER: 'sqlite' },
    stdio: 'pipe',
  })

  const prismaCli = path.join(repoRoot, 'node_modules', 'prisma', 'build', 'index.js')
  execFileSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: 'file:./data/test-template.db' },
    stdio: 'pipe',
  })

  // Clean up databases left behind by an interrupted previous run.
  for (const entry of fs.readdirSync(dataDir)) {
    if (entry.startsWith('test-') && entry !== 'test-template.db') {
      fs.rmSync(path.join(dataDir, entry), { force: true })
    }
  }
}
