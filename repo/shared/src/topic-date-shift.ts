/**
 * Topic date-shifting — detects dates in topic names that belong to any past
 * school year and computes the equivalent dates for the current school year.
 *
 * The typical US school year runs August through June. A topic named
 * "May 11-15" or "Nov. 3-7" carries a date range that, if it came from a
 * previous school year, should be shifted to the current school year's
 * calendar. The calendar shifts roughly one day earlier each year, so we
 * shift each date forward by 364 days (52 weeks) per year of gap to land
 * on the same weekday in the current school year.
 */

import type { TopicDateUpdate } from './api-types.js'

const MONTH_NAMES: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
}

/**
 * The school year that is "current" as of `now`.
 * School year 2024-25 means Aug 2024 through Jun 2025.
 */
export function currentSchoolYear(now: Date = new Date()): { startYear: number; endYear: number } {
  const month = now.getMonth()
  // Aug–Dec: current school year started this calendar year
  if (month >= 7) return { startYear: now.getFullYear(), endYear: now.getFullYear() + 1 }
  // Jan–Jul: current school year started the previous calendar year
  return { startYear: now.getFullYear() - 1, endYear: now.getFullYear() }
}

/**
 * Returns the school year that is `n` years before the current one.
 * n=1 gives the immediately previous school year, n=2 gives two years ago, etc.
 */
export function schoolYearNYearsAgo(n: number, now: Date = new Date()): { startYear: number; endYear: number } {
  const current = currentSchoolYear(now)
  return { startYear: current.startYear - n, endYear: current.endYear - n }
}

interface ParsedDate {
  month: number
  day: number
}

interface DateRange {
  start: ParsedDate
  end: ParsedDate
  /** The raw text matched in the topic name, e.g. "May 11-15" or "Nov. 3-7". */
  raw: string
  /** Character offset of the match in the original string. */
  index: number
}

/**
 * Parses a month name (full or abbreviated, optional trailing period) from
 * the start of `s`. Returns the 0-based month index and the number of
 * characters consumed, or null if no month name is found.
 */
function parseMonthName(s: string): { month: number; consumed: number } | null {
  const lower = s.toLowerCase()
  // Try 3-letter abbreviations first (jan, feb, etc.), then full names.
  // Match optional trailing period.
  const match = /^([a-z]{3,9})\.?\s+/.exec(lower)
  if (!match) return null
  const name = match[1]
  if (!name) return null
  // Try exact abbreviation
  if (name.length === 3 && MONTH_NAMES[name] != null) {
    return { month: MONTH_NAMES[name], consumed: match[0].length }
  }
  // Try full name
  if (MONTH_NAMES[name] != null) {
    return { month: MONTH_NAMES[name], consumed: match[0].length }
  }
  return null
}

function parseDay(s: string): { day: number; consumed: number } | null {
  const match = /^(\d{1,2})\b/.exec(s)
  if (!match || !match[1]) return null
  const day = parseInt(match[1], 10)
  if (day < 1 || day > 31) return null
  return { day, consumed: match[0].length }
}

/**
 * Finds all date ranges in a topic name. Supports formats like:
 *   "May 11-15", "May 11 - 15", "Nov. 3-7", "November 3 - 7"
 *   "May 11 to 15", "Sept. 8-12", "May 28 - Jun 1"
 */
export function findDateRanges(topicName: string): DateRange[] {
  const ranges: DateRange[] = []
  const s = topicName
  let i = 0
  while (i < s.length) {
    const monthResult = parseMonthName(s.slice(i))
    if (!monthResult) {
      i += 1
      continue
    }
    const afterMonth = i + monthResult.consumed
    const dayResult = parseDay(s.slice(afterMonth))
    if (!dayResult) {
      i += 1
      continue
    }
    const afterStartDay = afterMonth + dayResult.consumed
    // Look for a separator: "-", "–", "—", "to", surrounded by optional spaces
    const rest = s.slice(afterStartDay)
    const sepMatch = /^\s*(?:[-–—]|to)\s*/i.exec(rest)
    if (!sepMatch) {
      i += 1
      continue
    }
    const afterSep = afterStartDay + sepMatch[0].length

    // The end of the range may have its own month prefix, e.g. "May 28 - Jun 1"
    const endMonthResult = parseMonthName(s.slice(afterSep))
    let endMonth = monthResult.month
    let endConsumed = 0
    if (endMonthResult) {
      endMonth = endMonthResult.month
      endConsumed = endMonthResult.consumed
    }

    const endDayResult = parseDay(s.slice(afterSep + endConsumed))
    if (!endDayResult) {
      i += 1
      continue
    }
    const rawEnd = afterSep + endConsumed + endDayResult.consumed
    ranges.push({
      start: { month: monthResult.month, day: dayResult.day },
      end: { month: endMonth, day: endDayResult.day },
      raw: s.slice(i, rawEnd),
      index: i,
    })
    i = rawEnd
  }
  return ranges
}

/**
 * Given a parsed date range and a school year, constructs the actual start
 * and end Dates. A date range like "May 11-15" in school year 2024-25
 * means May 2025 (the spring of the ending year). "Nov. 3-7" in the same
 * school year means November 2024 (the fall of the starting year).
 *
 * Months Aug–Dec belong to the start year; Jan–Jul belong to the end year.
 */
function datesForSchoolYear(
  range: DateRange,
  schoolYear: { startYear: number; endYear: number },
): { start: Date; end: Date } | null {
  const startYear = range.start.month >= 7 ? schoolYear.startYear : schoolYear.endYear
  const endYear = range.end.month >= 7 ? schoolYear.startYear : schoolYear.endYear
  const start = new Date(startYear, range.start.month, range.start.day)
  const end = new Date(endYear, range.end.month, range.end.day)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null
  return { start, end }
}

/**
 * Determines how many school years a date range is behind the current one.
 * Returns 0 if the date belongs to the current school year (not stale),
 * 1 if it's one year behind, 2 if two years behind, etc.
 * Returns -1 only when no valid candidate school year exists.
 *
 * A fall date like "Oct 26-30" is representable in BOTH the previous school
 * year and the current one — the calendar alone cannot disambiguate. Resolved
 * by PROXIMITY: the candidate school year whose start date is closest to
 * today wins. A topic named for this week is current; one whose only close
 * match is on a previous year's calendar is stale.
 */
function yearsBehindCurrent(range: DateRange, now: Date): number {
  let best: { n: number; distance: number } | null = null
  for (let n = 0; n <= 10; n++) {
    const sy = n === 0 ? currentSchoolYear(now) : schoolYearNYearsAgo(n, now)
    const dates = datesForSchoolYear(range, sy)
    if (!dates) continue
    const distance = Math.abs(dates.start.getTime() - now.getTime())
    // Strict `<` keeps the smaller n on a tie, preferring the more recent year.
    if (best == null || distance < best.distance) best = { n, distance }
  }
  return best ? best.n : -1
}

/**
 * Shifts a date forward by `n * 364` days (n * 52 weeks), so the same weekday
 * is preserved and the date lands in the same calendar week n years later.
 */
function shiftDateForwardNYears(date: Date, n: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + 364 * n)
  return result
}

/**
 * Formats a date as it would appear in a topic name: "May 11", "Nov. 3".
 * Uses the 3-letter abbreviation with a period, matching common Classroom
 * topic naming conventions.
 */
const MONTH_ABBR: string[] = [
  'Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.',
  'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.',
]

function formatDate(d: Date): string {
  const month = MONTH_ABBR[d.getMonth()]
  const day = d.getDate()
  return `${month} ${day}`
}

/**
 * Scans a set of source topics for date ranges that belong to any past school
 * year, and for each one that has them, produces an updated topic name with
 * the dates shifted forward to the current school year. A topic from two
 * years ago gets shifted forward two years; one from three years ago gets
 * three years, and so on.
 *
 * Topics with no date ranges, or whose dates are already in the current (or
 * a future) school year, are NOT included in the result.
 */
export function findTopicsWithStaleDates(
  topics: Array<{ id: string; name: string }>,
  now: Date = new Date(),
): TopicDateUpdate[] {
  const result: TopicDateUpdate[] = []
  for (const topic of topics) {
    const ranges = findDateRanges(topic.name)
    if (ranges.length === 0) continue

    // Pair each range with how many years it needs to shift (0 or -1 = skip).
    const rangeShifts: Array<{ range: DateRange; n: number }> = []
    for (const range of ranges) {
      const n = yearsBehindCurrent(range, now)
      if (n > 0) rangeShifts.push({ range, n })
    }
    if (rangeShifts.length === 0) continue

    // Build the updated name by replacing each stale range's raw text with
    // the shifted dates, working right-to-left so indices don't shift.
    let updatedName = topic.name
    const shifts: Array<{ original: string; updated: string }> = []
    for (let i = rangeShifts.length - 1; i >= 0; i--) {
      const entry = rangeShifts[i]
      if (!entry) continue
      const { range, n } = entry
      const sy = schoolYearNYearsAgo(n, now)
      const dates = datesForSchoolYear(range, sy)
      if (!dates) continue
      const newStart = shiftDateForwardNYears(dates.start, n)
      const newEnd = shiftDateForwardNYears(dates.end, n)
      const replacement = `${formatDate(newStart)}-${formatDate(newEnd)}`
      updatedName =
        updatedName.slice(0, range.index) +
        replacement +
        updatedName.slice(range.index + range.raw.length)
      shifts.unshift({ original: range.raw, updated: replacement })
    }

    if (shifts.length > 0) {
      result.push({
        sourceTopicId: topic.id,
        sourceTopicName: topic.name,
        updatedTopicName: updatedName,
        shifts,
      })
    }
  }
  return result
}
