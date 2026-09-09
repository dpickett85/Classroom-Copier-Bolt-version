#!/usr/bin/env node
/**
 * Generates `server/prisma/schema.prisma` from `schema.template.prisma`.
 *
 * The template holds the model bodies and nothing else; this script prepends the
 * `generator` + `datasource` blocks, picking the datasource provider from
 * DATABASE_PROVIDER. Dev and test run on sqlite (the default); production sets
 * DATABASE_PROVIDER=postgresql and points DATABASE_URL at Render Postgres.
 *
 * Runs as a `pre*` hook of the prisma scripts in server/package.json, so nobody
 * has to remember it. The generated file is gitignored — never hand-edit it, and
 * never commit it with a stale provider baked in.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const TEMPLATE = path.join(REPO_ROOT, 'server', 'prisma', 'schema.template.prisma')
const OUTPUT = path.join(REPO_ROOT, 'server', 'prisma', 'schema.prisma')

/** The only providers this schema is portable across. Anything else is a typo. */
const SUPPORTED = new Set(['sqlite', 'postgresql'])

const provider = process.env.DATABASE_PROVIDER || 'sqlite'
if (!SUPPORTED.has(provider)) {
  console.error(
    `prisma-datasource: DATABASE_PROVIDER="${provider}" is not supported. ` +
      `Expected one of: ${[...SUPPORTED].join(', ')}.`,
  )
  process.exit(1)
}

const template = fs.readFileSync(TEMPLATE, 'utf8')

const banner = `// GENERATED FILE — DO NOT EDIT.
//
// Written by scripts/prisma-datasource.mjs from schema.template.prisma.
// Edit the template; re-run \`npm run -w server generate\` (or db:push / db:reset,
// which regenerate this first). Gitignored on purpose: the provider baked in
// below is whatever the last local command asked for, which is not a fact that
// belongs in version control.
//
// datasource provider: ${provider} (DATABASE_PROVIDER)

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${provider}"
  url      = env("DATABASE_URL")
}

`

fs.writeFileSync(OUTPUT, banner + template)
