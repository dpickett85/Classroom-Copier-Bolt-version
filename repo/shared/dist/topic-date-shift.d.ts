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
import type { TopicDateUpdate } from './api-types.js';
/**
 * The school year that is "current" as of `now`.
 * School year 2024-25 means Aug 2024 through Jun 2025.
 */
export declare function currentSchoolYear(now?: Date): {
    startYear: number;
    endYear: number;
};
/**
 * The school year that is "previous" relative to `now`.
 */
export declare function previousSchoolYear(now?: Date): {
    startYear: number;
    endYear: number;
};
interface ParsedDate {
    month: number;
    day: number;
}
interface DateRange {
    start: ParsedDate;
    end: ParsedDate;
    /** The raw text matched in the topic name, e.g. "May 11-15" or "Nov. 3-7". */
    raw: string;
    /** Character offset of the match in the original string. */
    index: number;
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
export declare function findDateRanges(topicName: string): DateRange[];
/**
 * Scans a set of source topics for date ranges that belong to the previous
 * school year, and for each one that has them, produces an updated topic
 * name with the dates shifted to the current school year (7 days earlier).
 *
 * Topics with no date ranges, or whose dates are already in the current
 * school year, are NOT included in the result — the caller only needs to
 * know about the ones that changed.
 */
export declare function findTopicsWithStaleDates(topics: Array<{
    id: string;
    name: string;
}>, now?: Date): TopicDateUpdate[];
export {};
