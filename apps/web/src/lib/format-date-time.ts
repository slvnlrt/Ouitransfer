/**
 * Date/time format presets used across the file browser.
 *
 * - "table": Full date + time — "01/15/2025, 14:30"
 * - "compact": Short date only — "Jan 15, 2025"
 */

const TABLE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

const COMPACT_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

/**
 * Formats a date string for display in the file browser.
 *
 * @param dateString — ISO date string from the API
 * @param format — "table" for full date+time, "compact" for short date
 * @param locale — BCP 47 locale tag (e.g. "fr-FR"). Defaults to "en-US".
 */
export function formatDateTime(
  dateString: string,
  format: "table" | "compact" = "table",
  locale?: string,
): string {
  const options = format === "table" ? TABLE_FORMAT : COMPACT_FORMAT;
  return new Intl.DateTimeFormat(locale ?? "en-US", options).format(new Date(dateString));
}
