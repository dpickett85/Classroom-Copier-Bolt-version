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
 * Returns the school year that is `n` years before the current one.
 * n=1 gives the immediately previous school year, n=2 gives two years ago, etc.
 */
export declare function schoolYearNYearsAgo(n: number, now?: Date): {
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
 *   "May 11 to 15", "Sept. 8-12", "May 28 - Jun 1"
 */
export declare function findDateRanges(topicName: string): DateRange[];
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
export declare function findTopicsWithStaleDates(topics: Array<{
    id: string;
    name: string;
}>, now?: Date): TopicDateUpdate[];
export {};
