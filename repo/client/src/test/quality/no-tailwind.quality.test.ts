/**
 * Quality budget: `no_tailwind_under_client_src` (Decision J, §8.4).
 *
 * This project has no Tailwind. It never had: there is no `tailwind.config`, no
 * `@tailwind` directive, and no Tailwind dependency in `client/package.json`.
 * What it had was a session's worth of Tailwind class names left in two auth
 * components, which is worse than either alternative — the classes are INERT,
 * so the components rendered as unstyled user-agent defaults (the 898px SVG)
 * while looking, in the source, like they had been styled.
 *
 * SHAPE-BASED, deliberately, per §8.4. A guard that greps for the five class
 * strings those two files happened to contain would ship green the moment
 * someone typed a sixth, which makes it a record of one cleanup rather than a
 * guard. This matches the utility-class SHAPE: a known Tailwind prefix followed
 * by a hyphen, inside a `className` string.
 *
 * TDD discipline (§8.4): this was written and OBSERVED FAILING against
 * `AuthFlow.tsx` and `SignInLanding.tsx` before either was re-authored. A guard
 * that has never been seen to fail is not evidence of anything.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CLIENT_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * The utility-class shape. Every alternative is a real Tailwind scale prefix;
 * the trailing `-` plus a value character is what distinguishes `text-slate-800`
 * from this product's own `.error-state` or a CSS custom property.
 */
const TAILWIND_CLASS = new RegExp(
  String.raw`\b(?:bg|text|border|rounded|shadow|flex|items|justify|gap|space|grid|cols|font|leading|tracking|opacity|ring|divide|inset|top|bottom|left|right|w|h|p|m|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|min-h|min-w|max-w|max-h)-(?:\[?[a-z0-9])`,
)

/** Only what a `class`/`className` attribute or a classnames-style string holds. */
const CLASS_ATTRIBUTE = /\bclassName\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue
      out.push(...sourceFiles(full))
      continue
    }
    // This file states the pattern in order to test for it, so it excludes
    // itself — the ONLY exclusion, and it is a file, not a class name.
    if (full === fileURLToPath(import.meta.url)) continue
    if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

interface Offence {
  file: string
  line: number
  className: string
}

function scan(): Offence[] {
  const offences: Offence[] = []
  for (const file of sourceFiles(CLIENT_SRC)) {
    const contents = readFileSync(file, 'utf8')
    for (const match of contents.matchAll(CLASS_ATTRIBUTE)) {
      const value = match[1] ?? match[2] ?? match[3] ?? ''
      for (const token of value.split(/\s+/)) {
        if (token.length === 0 || !TAILWIND_CLASS.test(token)) continue
        offences.push({
          file: path.relative(CLIENT_SRC, file),
          line: contents.slice(0, match.index).split('\n').length,
          className: token,
        })
      }
    }
  }
  return offences
}

describe('[budget] no_tailwind_under_client_src', () => {
  it('finds zero Tailwind-shaped utility classes anywhere under client/src', () => {
    const offences = scan()
    const report = offences.map((o) => `${o.file}:${o.line} "${o.className}"`).join('\n')
    console.log(`[budget] no-tailwind: files scanned, offences=${offences.length}`)
    expect(
      offences,
      `Tailwind-shaped class names found. This project has no Tailwind, so these\n` +
        `are INERT and the element renders as a user-agent default:\n${report}`,
    ).toHaveLength(0)
  })

  it('the guard actually matches the shape it claims to (self-check)', () => {
    // Without this, a regex typo would make the case above pass vacuously
    // forever — the failure mode a guard is least likely to notice about itself.
    for (const positive of [
      'bg-slate-50',
      'text-2xl',
      'min-h-screen',
      'rounded-xl',
      'flex-col',
      'w-16',
      'py-3',
      'hover:bg-slate-50',
    ]) {
      expect(TAILWIND_CLASS.test(positive), `${positive} should match`).toBe(true)
    }
    // This product's own class names, which must NOT match.
    for (const negative of [
      'signin-screen',
      'google-signin-btn',
      'google-g-logo',
      'signin-error',
      'error-state',
      'interrupt-banner',
      'stat-tile',
      'outcome-pill',
      'app-shell',
    ]) {
      expect(TAILWIND_CLASS.test(negative), `${negative} must NOT match`).toBe(false)
    }
  })
})
