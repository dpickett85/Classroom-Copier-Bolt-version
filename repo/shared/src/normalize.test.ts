import { describe, expect, it } from 'vitest'
import { normalizeTitle } from './normalize.js'

/**
 * PM §6.2's normalization, pinned case by case. The near-misses matter as much
 * as the matches: a normalizer that collapses "Unit 1" and "Unit 11" would make
 * duplicate detection skip a post the teacher meant to copy, which is a silent
 * data loss rather than a duplicate.
 */
describe('normalizeTitle', () => {
  it('is identity for an already-normal title', () => {
    expect(normalizeTitle('Unit 1 Reading')).toBe('unit 1 reading')
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalizeTitle('  Unit 1  ')).toBe(normalizeTitle('Unit 1'))
  })

  it('collapses runs of internal whitespace, including tabs and newlines', () => {
    expect(normalizeTitle('Unit   1\tReading\nNotes')).toBe('unit 1 reading notes')
  })

  it('lowercases, locale-independently', () => {
    expect(normalizeTitle('UNIT 1')).toBe(normalizeTitle('unit 1'))
    expect(normalizeTitle('Ünit Ì')).toBe(normalizeTitle('ünit ì'))
    // Turkish dotless-i: the key must not depend on the server's locale.
    expect(normalizeTitle('TITLE')).toBe('title')
  })

  it('is lowercasing, not full case folding — and says so', () => {
    // "Straße" vs "STRASSE" stays a NON-match. Documented as a deliberate limit:
    // a missed match copies a post twice (visible, fixable); an over-eager match
    // silently drops a post the teacher wanted (invisible).
    expect(normalizeTitle('Straße')).not.toBe(normalizeTitle('STRASSE'))
  })

  it('applies NFC so a composed and a decomposed accent match', () => {
    const composed = 'Café'
    const decomposed = 'Café'
    expect(composed).not.toBe(decomposed)
    expect(normalizeTitle(composed)).toBe(normalizeTitle(decomposed))
  })

  it('does NOT collapse a near-miss into a match', () => {
    expect(normalizeTitle('Unit 1')).not.toBe(normalizeTitle('Unit 11'))
    expect(normalizeTitle('Lab 2')).not.toBe(normalizeTitle('Lab 2b'))
  })

  it('does NOT strip punctuation — "Quiz: Cells" is not "Quiz Cells"', () => {
    expect(normalizeTitle('Quiz: Cells')).not.toBe(normalizeTitle('Quiz Cells'))
  })

  it('reduces an all-whitespace title to the empty string rather than throwing', () => {
    expect(normalizeTitle('   \t\n ')).toBe('')
  })
})
