/**
 * Topic date-shifting — detects dates in topic names that belong to the
 * previous school year and computes the equivalent dates for the current
 * school year.
 *
 * The typical US school year runs August through June. A topic named
 * "May 11-15" or "Nov. 3-7" carries a date range that, if it came from the
 * previous school year, should be shifted to the current school year's
 * calendar. The calendar shifts roughly one day earlier each year, so we
 * subtract 7 days from each date to land on the same weekday in the new
 * school year.
 *
 * "Previous school year" is defined relative to the current date: if today
 * is in the first half of a school year (Aug–Dec), the previous school year
 * started in the prior calendar year. If today is in the second half
 * (Jan–Jun), the previous school year started two calendar years ago.
 */
const MONTH_NAMES = {
    january: 0, jan: 0,
    february: 1, feb: 1,
    march: 2, mar: 2,
    april: 3, apr: 3,
    may: 4,
    june: 4, jun: 4,
    july: 5, jul: 5,
    august: 6, aug: 6,
    september: 7, sep: 7, sept: 7,
    october: 8, oct: 8,
    november: 9, nov: 9,
    december: 10, dec: 10,
};
/**
 * The school year that is "current" as of `now`.
 * School year 2024-25 means Aug 2024 through Jun 2025.
 */
export function currentSchoolYear(now = new Date()) {
    const month = now.getMonth();
    // Aug–Dec: current school year started this calendar year
    if (month >= 7)
        return { startYear: now.getFullYear(), endYear: now.getFullYear() + 1 };
    // Jan–Jul: current school year started the previous calendar year
    return { startYear: now.getFullYear() - 1, endYear: now.getFullYear() };
}
/**
 * The school year that is "previous" relative to `now`.
 */
export function previousSchoolYear(now = new Date()) {
    const current = currentSchoolYear(now);
    return { startYear: current.startYear - 1, endYear: current.endYear - 1 };
}
/**
 * Parses a month name (full or abbreviated, optional trailing period) from
 * the start of `s`. Returns the 0-based month index and the number of
 * characters consumed, or null if no month name is found.
 */
function parseMonthName(s) {
    const lower = s.toLowerCase();
    // Try 3-letter abbreviations first (jan, feb, etc.), then full names.
    // Match optional trailing period.
    const match = /^([a-z]{3,9})\.?\s+/.exec(lower);
    if (!match)
        return null;
    const name = match[1];
    if (!name)
        return null;
    // Try exact abbreviation
    if (name.length === 3 && MONTH_NAMES[name] != null) {
        return { month: MONTH_NAMES[name], consumed: match[0].length };
    }
    // Try full name
    if (MONTH_NAMES[name] != null) {
        return { month: MONTH_NAMES[name], consumed: match[0].length };
    }
    return null;
}
function parseDay(s) {
    const match = /^(\d{1,2})\b/.exec(s);
    if (!match || !match[1])
        return null;
    const day = parseInt(match[1], 10);
    if (day < 1 || day > 31)
        return null;
    return { day, consumed: match[0].length };
}
/**
 * Finds all date ranges in a topic name. Supports formats like:
 *   "May 11-15", "May 11 - 15", "Nov. 3-7", "November 3 - 7"
 *   "May 11 to 15", "Sept. 8-12"
 *
 * Does NOT support cross-month ranges like "May 28 - Jun 1" (those are
 * ambiguous and rare in topic names — the month prefix applies to both
 * days, so "May 28 - Jun 1" would be misread as May 28 - May 1).
 */
export function findDateRanges(topicName) {
    const ranges = [];
    const s = topicName;
    let i = 0;
    while (i < s.length) {
        const monthResult = parseMonthName(s.slice(i));
        if (!monthResult) {
            i += 1;
            continue;
        }
        const afterMonth = i + monthResult.consumed;
        const dayResult = parseDay(s.slice(afterMonth));
        if (!dayResult) {
            i += 1;
            continue;
        }
        const afterStartDay = afterMonth + dayResult.consumed;
        // Look for a separator: "-", "–", "—", "to", surrounded by optional spaces
        const rest = s.slice(afterStartDay);
        const sepMatch = /^\s*(?:[-–—]|to)\s*/i.exec(rest);
        if (!sepMatch) {
            i += 1;
            continue;
        }
        const afterSep = afterStartDay + sepMatch[0].length;
        const endDayResult = parseDay(s.slice(afterSep));
        if (!endDayResult) {
            i += 1;
            continue;
        }
        const rawEnd = afterSep + endDayResult.consumed;
        ranges.push({
            start: { month: monthResult.month, day: dayResult.day },
            end: { month: monthResult.month, day: endDayResult.day },
            raw: s.slice(i, rawEnd),
            index: i,
        });
        i = rawEnd;
    }
    return ranges;
}
/**
 * Given a parsed date range and a school year, constructs the actual start
 * and end Dates. A date range like "May 11-15" in school year 2024-25
 * means May 2025 (the spring of the ending year). "Nov. 3-7" in the same
 * school year means November 2024 (the fall of the starting year).
 *
 * Months Aug–Dec belong to the start year; Jan–Jul belong to the end year.
 */
function datesForSchoolYear(range, schoolYear) {
    const year = range.start.month >= 7 ? schoolYear.startYear : schoolYear.endYear;
    const start = new Date(year, range.start.month, range.start.day);
    const end = new Date(year, range.end.month, range.end.day);
    if (isNaN(start.getTime()) || isNaN(end.getTime()))
        return null;
    return { start, end };
}
/**
 * Determines whether a date range belongs to the previous school year
 * relative to `now`.
 */
function isInPreviousSchoolYear(range, now) {
    const prev = previousSchoolYear(now);
    const dates = datesForSchoolYear(range, prev);
    if (!dates)
        return false;
    // The date must be valid and within the previous school year's span.
    // We check that it falls between Aug 1 of the start year and Jul 31 of
    // the end year.
    const schoolStart = new Date(prev.startYear, 7, 1);
    const schoolEnd = new Date(prev.endYear, 6, 31);
    return dates.start >= schoolStart && dates.start <= schoolEnd;
}
/**
 * Shifts a date backward by 7 days (one calendar week), so the same weekday
 * is preserved in the new school year.
 */
function shiftDateBack7Days(date) {
    const result = new Date(date);
    result.setDate(result.getDate() - 7);
    return result;
}
const MONTH_DISPLAY = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
/**
 * Formats a date as it would appear in a topic name: "May 11", "Nov. 3".
 * Uses the 3-letter abbreviation with a period, matching common Classroom
 * topic naming conventions.
 */
const MONTH_ABBR = [
    'Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.',
    'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.',
];
function formatDate(d) {
    const month = MONTH_ABBR[d.getMonth()];
    const day = d.getDate();
    return `${month} ${day}`;
}
/**
 * Scans a set of source topics for date ranges that belong to the previous
 * school year, and for each one that has them, produces an updated topic
 * name with the dates shifted to the current school year (7 days earlier).
 *
 * Topics with no date ranges, or whose dates are already in the current
 * school year, are NOT included in the result — the caller only needs to
 * know about the ones that changed.
 */
export function findTopicsWithStaleDates(topics, now = new Date()) {
    const result = [];
    for (const topic of topics) {
        const ranges = findDateRanges(topic.name);
        const staleRanges = ranges.filter((r) => isInPreviousSchoolYear(r, now));
        if (staleRanges.length === 0)
            continue;
        // Build the updated name by replacing each stale range's raw text with
        // the shifted dates, working right-to-left so indices don't shift.
        let updatedName = topic.name;
        const shifts = [];
        for (let i = staleRanges.length - 1; i >= 0; i--) {
            const range = staleRanges[i];
            if (!range)
                continue;
            const prev = previousSchoolYear(now);
            const dates = datesForSchoolYear(range, prev);
            if (!dates)
                continue;
            const newStart = shiftDateBack7Days(dates.start);
            const newEnd = shiftDateBack7Days(dates.end);
            const replacement = `${formatDate(newStart)}-${formatDate(newEnd)}`;
            updatedName =
                updatedName.slice(0, range.index) +
                    replacement +
                    updatedName.slice(range.index + range.raw.length);
            shifts.unshift({ original: range.raw, updated: replacement });
        }
        if (shifts.length > 0) {
            result.push({
                sourceTopicId: topic.id,
                sourceTopicName: topic.name,
                updatedTopicName: updatedName,
                shifts,
            });
        }
    }
    return result;
}
