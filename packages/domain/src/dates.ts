/**
 * Calendar-date helpers. Dates are YYYY-MM-DD strings everywhere in the
 * domain; instants (a moment in time) are JavaScript Dates in UTC.
 * No library: the few rules we need are short enough to read.
 */

export type ISODate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DateParts = { year: number; month: number; day: number };

export function parseDate(date: ISODate): DateParts {
  const m = ISO_DATE.exec(date);
  if (!m) throw new TypeError(`expected YYYY-MM-DD, got ${date}`);
  const parts = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  if (
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > daysInMonth(parts.year, parts.month)
  ) {
    throw new TypeError(`not a calendar date: ${date}`);
  }
  return parts;
}

export function formatDate({ year, month, day }: DateParts): ISODate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

export function addDays(date: ISODate, days: number): ISODate {
  const { year, month, day } = parseDate(date);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().slice(0, 10);
}

/** Days from a to b; negative when b is earlier. */
export function daysBetween(a: ISODate, b: ISODate): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  const ms = Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day);
  return Math.round(ms / 86_400_000);
}

export function compareDates(a: ISODate, b: ISODate): number {
  parseDate(a);
  parseDate(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Add months while keeping the anchor day of month where the month allows it.
 * 31 January plus one month is 28 (or 29) February; plus two months is 31
 * March again, because the anchor is 31, not "the last day of February".
 */
export function addMonthsAnchored(date: ISODate, months: number, anchorDay: number): ISODate {
  const { year, month } = parseDate(date);
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return formatDate({ year: y, month: m, day: Math.min(anchorDay, daysInMonth(y, m)) });
}

/**
 * The UTC instant for a wall-clock time in an IANA timezone, e.g. 09:00 in
 * Europe/Berlin on a given date. Handles DST by asking the timezone for its
 * offset at the guessed instant and correcting once.
 */
export function zonedTimeToUtc(
  date: ISODate,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const { year, month, day } = parseDate(date);
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offset1 = timeZoneOffsetMs(asIfUtc, timeZone);
  const guess = asIfUtc - offset1;
  const offset2 = timeZoneOffsetMs(guess, timeZone);
  return new Date(offset1 === offset2 ? guess : asIfUtc - offset2);
}

/** The calendar date in a timezone at a given instant. */
export function dateInTimeZone(instant: Date, timeZone: string): ISODate {
  const parts = partsInTimeZone(instant, timeZone);
  return formatDate({ year: parts.year, month: parts.month, day: parts.day });
}

function timeZoneOffsetMs(instantMs: number, timeZone: string): number {
  const p = partsInTimeZone(new Date(instantMs), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

function partsInTimeZone(instant: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour! === 24 ? 0 : out.hour!,
    minute: out.minute!,
    second: out.second!,
  };
}
