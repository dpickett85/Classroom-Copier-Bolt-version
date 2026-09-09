#!/usr/bin/env node
/**
 * check-doc-citations — QA-4.
 *
 * `05-implementation.md` claimed "a scripted grep confirms zero unresolved
 * citations". The claim about the RESULT was true; the claim about the SCRIPT
 * was not — nothing in the repository could re-verify it without a human
 * redoing the grep by hand. A claim of repeatability that nothing can repeat is
 * the same species of problem as a guarantee with no mechanism under it, so
 * here is the mechanism.
 *
 * It scans every doc under docs/product for decision-register and delta
 * citations and asserts each one is DEFINED — as a row in `04-architecture.md`'s
 * Design Decision Register or its Deltas table.
 *
 *   node scripts/check-doc-citations.mjs        # exits 1 on any unresolved token
 *   npm run check:citations
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const docsDir = path.join(repoRoot, 'docs', 'product')
const architecture = path.join(docsDir, '04-architecture.md')

/** `D12`, `Δ1`, `UI-Δ2`. Word-bounded so `D1` never matches inside `D12`. */
const CITATION = /(?<![A-Za-z0-9-])(UI-Δ\d+|Δ\d+|D\d+)(?![0-9])/g

/** A token is DEFINED where it appears as the first cell of a table row, or as
 *  a bolded/heading label — the two shapes the register and the deltas table use. */
const DEFINITION = (token) => [
  new RegExp(`^\\|\\s*\\*{0,2}${escape(token)}\\*{0,2}\\s*\\|`, 'm'),
  new RegExp(`^#+\\s.*\\b${escape(token)}\\b`, 'm'),
]

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Not scanned, and why: `critic-reports/` and `inputs/` are RECEIVED documents,
 * not artifacts this project maintains. A critic writes in its own frame and
 * may cite a token from a draft that no longer exists; rewriting a received
 * report to make a checker pass would be falsifying the record. The exclusion
 * is printed on every run so it is never a silent one.
 */
const EXCLUDED = ['critic-reports', 'inputs']

function listDocs(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (EXCLUDED.includes(entry.name)) continue
      out.push(...listDocs(full))
    } else if (entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

if (!fs.existsSync(architecture)) {
  console.error(`[citations] missing ${path.relative(repoRoot, architecture)}`)
  process.exit(1)
}

const registerText = fs.readFileSync(architecture, 'utf8')
const defined = new Set()
const seen = new Set()
for (const match of registerText.matchAll(CITATION)) seen.add(match[1])
for (const token of seen) {
  if (DEFINITION(token).some((pattern) => pattern.test(registerText))) defined.add(token)
}

const unresolved = []
let citations = 0
for (const file of listDocs(docsDir)) {
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split('\n')
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(CITATION)) {
      citations += 1
      if (!defined.has(match[1])) {
        unresolved.push(`${path.relative(repoRoot, file)}:${index + 1}  ${match[1]}`)
      }
    }
  }
}

console.log(
  `[citations] ${citations} citations across ${listDocs(docsDir).length} docs; ` +
    `${defined.size} tokens defined in 04-architecture.md; ` +
    `not scanned: ${EXCLUDED.join(', ')} (received documents)`,
)

if (unresolved.length > 0) {
  console.error(`[citations] ${unresolved.length} UNRESOLVED:`)
  for (const row of unresolved) console.error(`  ${row}`)
  process.exit(1)
}
console.log('[citations] zero unresolved citations')
