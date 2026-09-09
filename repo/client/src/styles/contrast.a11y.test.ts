/**
 * Closes UI-Δ2.
 *
 * `03-ui-direction.md` §6 says the palette is "contrast-designed by
 * construction ... but was not run through a contrast-calculation tool in this
 * stage". This file is that tool: a real WCAG 2.x relative-luminance and
 * contrast-ratio implementation, run against the tokens as they are actually
 * declared in `tokens.css`, for every text/background pairing the design uses.
 *
 * The token values are read from the stylesheet, not retyped here, so a token
 * edit cannot pass this audit by being invisible to it.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const TOKENS_CSS = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')

/** Parse the `:root{...}` custom-property block into a token -> hex map. */
export function parseTokens(css: string): Record<string, string> {
  const root = /:root\s*\{([\s\S]*?)\}/.exec(css)
  if (!root?.[1]) throw new Error('tokens.css has no :root block')
  const out: Record<string, string> = {}
  for (const decl of root[1].split(';')) {
    const m = /^\s*(--[a-z0-9-]+)\s*:\s*(.+?)\s*$/i.exec(decl)
    if (m?.[1] && m[2]) out[m[1]] = m[2]
  }
  return out
}

const tokens = parseTokens(TOKENS_CSS)

function token(name: string): string {
  const v = tokens[name]
  if (!v) throw new Error(`tokens.css is missing ${name}`)
  return v
}

/* ------------------------------------------------------------------ *
 * WCAG 2.x relative luminance + contrast ratio
 * ------------------------------------------------------------------ */

export function channelLuminance(srgb8: number): number {
  const c = srgb8 / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m?.[1]) throw new Error(`not a 6-digit hex colour: ${hex}`)
  const n = parseInt(m[1], 16)
  const r = channelLuminance((n >> 16) & 0xff)
  const g = channelLuminance((n >> 8) & 0xff)
  const b = channelLuminance(n & 0xff)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

describe('contrast-ratio implementation', () => {
  it('matches the WCAG reference extremes', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
  })

  it('is order-independent', () => {
    expect(contrastRatio('#16231F', '#FBF9F4')).toBeCloseTo(contrastRatio('#FBF9F4', '#16231F'), 10)
  })
})

/* ------------------------------------------------------------------ *
 * The token table — 03-ui-direction.md §2
 * ------------------------------------------------------------------ */

/** Exactly the hexes published in `03-ui-direction.md` §2's table. */
const UI_DIRECTION_TABLE: ReadonlyArray<readonly [string, string]> = [
  ['--paper-0', '#FBF9F4'],
  ['--paper-1', '#F2EEE3'],
  ['--paper-2', '#EAE4D2'],
  ['--line', '#D8D2C2'],
  ['--line-strong', '#B9B29B'],
  ['--ink-900', '#16231F'],
  ['--ink-700', '#3C4A45'],
  ['--ink-500', '#5B6B67'],
  ['--teal-700', '#0F5C56'],
  ['--teal-600', '#147A72'],
  ['--teal-100', '#DCEEEB'],
  ['--amber-700', '#8A5A00'],
  ['--amber-100', '#FBEDD1'],
  ['--green-700', '#1E7A42'],
  ['--green-100', '#E1F3E7'],
  ['--red-700', '#A22C2C'],
  ['--red-100', '#FBE4E4'],
  ['--slate-600', '#5B6B67'],
  ['--focus', '#1857C9'],
]

describe('tokens.css matches 03-ui-direction.md §2', () => {
  it.each(UI_DIRECTION_TABLE)('%s is %s', (name, hex) => {
    expect(token(name).toUpperCase()).toBe(hex.toUpperCase())
  })

  it('declares the three font families and the 3px radius', () => {
    expect(token('--font-head')).toContain('Source Serif 4')
    expect(token('--font-body')).toContain('Public Sans')
    expect(token('--font-mono')).toContain('IBM Plex Mono')
    expect(token('--radius')).toBe('3px')
  })
})

/* ------------------------------------------------------------------ *
 * The audit itself
 * ------------------------------------------------------------------ */

const WHITE = '#FFFFFF'

/**
 * Every pairing the design actually puts on screen, with the WCAG AA threshold
 * that applies to it. 4.5:1 for body text; 3:1 for `--focus`, which is a UI
 * component boundary (the focus ring), not text.
 */
const PAIRINGS: ReadonlyArray<{
  label: string
  fg: string
  bg: string
  threshold: number
}> = [
  { label: 'ink-900 on paper-0', fg: token('--ink-900'), bg: token('--paper-0'), threshold: 4.5 },
  { label: 'ink-900 on paper-1', fg: token('--ink-900'), bg: token('--paper-1'), threshold: 4.5 },
  { label: 'ink-700 on paper-0', fg: token('--ink-700'), bg: token('--paper-0'), threshold: 4.5 },
  { label: 'ink-700 on paper-1', fg: token('--ink-700'), bg: token('--paper-1'), threshold: 4.5 },
  { label: 'ink-500 on paper-0', fg: token('--ink-500'), bg: token('--paper-0'), threshold: 4.5 },
  { label: 'ink-500 on paper-1', fg: token('--ink-500'), bg: token('--paper-1'), threshold: 4.5 },
  { label: 'teal-700 on paper-0', fg: token('--teal-700'), bg: token('--paper-0'), threshold: 4.5 },
  { label: 'white on teal-700', fg: WHITE, bg: token('--teal-700'), threshold: 4.5 },
  // QA-2 — this pairing was already shipping (`.outcome-duplicate`, the
  // "Already in course" pill) and was never in this list; `.reassurance-banner`
  // now uses it too. A pairing on screen and absent from the audit is exactly
  // the gap this audit exists to close.
  {
    label: 'teal-700 on teal-100',
    fg: token('--teal-700'),
    bg: token('--teal-100'),
    threshold: 4.5,
  },
  {
    label: 'amber-700 on amber-100',
    fg: token('--amber-700'),
    bg: token('--amber-100'),
    threshold: 4.5,
  },
  {
    label: 'green-700 on green-100',
    fg: token('--green-700'),
    bg: token('--green-100'),
    threshold: 4.5,
  },
  { label: 'red-700 on red-100', fg: token('--red-700'), bg: token('--red-100'), threshold: 4.5 },
  { label: 'slate-600 on paper-1', fg: token('--slate-600'), bg: token('--paper-1'), threshold: 4.5 },
  // The focus ring is a UI component boundary, not text: WCAG 1.4.11 -> 3:1.
  { label: 'focus on paper-0', fg: token('--focus'), bg: token('--paper-0'), threshold: 3 },
]

describe('WCAG AA contrast audit of the rendered palette (UI-Δ2)', () => {
  it.each(PAIRINGS)('$label clears $threshold:1', ({ fg, bg, threshold }) => {
    const ratio = contrastRatio(fg, bg)
    expect(
      ratio,
      `measured ${ratio.toFixed(3)}:1 against a ${threshold}:1 threshold`,
    ).toBeGreaterThanOrEqual(threshold)
  })
})

/* ------------------------------------------------------------------ *
 * §8.4a — Google's sign-in button, measured rather than assumed
 * ------------------------------------------------------------------ */

/**
 * The architecture ruled Google's button a documented exemption from THIS
 * PRODUCT'S contrast tokens, and flagged as MANUAL-VERIFY whether Google's spec
 * actually fails WCAG AA at the sizes used here — with the instruction to add a
 * suppression only if one is genuinely triggered, because "a suppression for a
 * violation that never fires is its own kind of lie."
 *
 * This is that verification, arithmetic rather than manual. Google's published
 * light-theme pair is #1F1F1F on #FFFFFF, and its border is #747775 — all read
 * back out of `tokens.css`'s `.google-signin-btn` rule rather than retyped, so
 * a future edit to the button cannot pass this by being invisible to it.
 *
 * It PASSES comfortably. No `color-contrast` suppression was added anywhere,
 * and none should be.
 */
function googleButtonColor(property: string): string {
  const rule = /\.google-signin-btn\s*\{([\s\S]*?)\}/.exec(TOKENS_CSS)
  if (!rule?.[1]) throw new Error('tokens.css has no .google-signin-btn rule')
  const m = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i').exec(rule[1])
  if (!m?.[1]) throw new Error(`.google-signin-btn declares no ${property}`)
  // `border` is shorthand; take its colour component.
  const hex = /#[0-9a-f]{6}/i.exec(m[1])
  if (!hex) throw new Error(`.google-signin-btn's ${property} is not a 6-digit hex`)
  return hex[0]
}

describe("Google's brand-mandated sign-in button (§8.4a)", () => {
  it('its own text-on-fill pair clears AA, so the exemption is never needed', () => {
    const ratio = contrastRatio(googleButtonColor('color'), googleButtonColor('background'))
    expect(ratio, `measured ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
  })

  it('its border clears the 3:1 non-text boundary threshold', () => {
    const ratio = contrastRatio(googleButtonColor('border'), googleButtonColor('background'))
    expect(ratio, `measured ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
  })
})
