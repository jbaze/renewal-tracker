/**
 * Renewal rules: when a subscription renews next, whether it is still active,
 * and when each reminder should go out. Pure functions over plain values, so
 * the tests need no database and the worker and API share one source of truth.
 */
import {
  addDays,
  addMonthsAnchored,
  compareDates,
  parseDate,
  zonedTimeToUtc,
  type ISODate,
} from './dates.js';

export type BillingCycle = 'monthly' | 'yearly';
export type SubscriptionStatus = 'trial' | 'active' | 'cancelling' | 'cancelled';

export type RenewalInput = {
  readonly billingCycle: BillingCycle;
  /** The anchor: renewals keep this day of month (or month and day for yearly). */
  readonly startedOn: ISODate;
  readonly renewsOn: ISODate;
};

export type ReminderInput = RenewalInput & {
  readonly status: SubscriptionStatus;
  readonly reminderOffsets: readonly number[];
  /** IANA timezone of the organisation, e.g. Europe/Berlin. */
  readonly timezone: string;
};

/** The hour of the day, in the organisation's timezone, at which reminders go out. */
export const REMINDER_HOUR = 9;

/** The renewal date after the given one, anchored on the day the subscription started. */
export function nextRenewalDate(input: RenewalInput, after: ISODate = input.renewsOn): ISODate {
  const anchor = parseDate(input.startedOn);
  if (input.billingCycle === 'monthly') {
    return addMonthsAnchored(after, 1, anchor.day);
  }
  // Yearly keeps the start month as well as the day: 29 February becomes 28 February
  // in a common year and comes back on the next leap year.
  const { year } = parseDate(after);
  return addMonthsAnchored(`${year}-${String(anchor.month).padStart(2, '0')}-01`, 12, anchor.day);
}

/**
 * The first renewal date on or after `today`. A subscription whose date has
 * slipped into the past (the worker was down, or the row was imported) is
 * brought forward cycle by cycle, never by more than it has to.
 */
export function rollForward(input: RenewalInput, today: ISODate): ISODate {
  let date = input.renewsOn;
  let guard = 0;
  while (compareDates(date, today) < 0) {
    date = nextRenewalDate(input, date);
    guard += 1;
    if (guard > 1200) throw new Error('rollForward: more than 100 years of cycles');
  }
  return date;
}

/** Whether a subscription can still be used on a date. Cancelling keeps the paid period. */
export function isActiveOn(status: SubscriptionStatus, renewsOn: ISODate, date: ISODate): boolean {
  switch (status) {
    case 'active':
    case 'trial':
      return true;
    case 'cancelling':
      return compareDates(date, renewsOn) <= 0;
    case 'cancelled':
      return false;
  }
}

/** Whether a subscription should still receive reminders at all. */
export function wantsReminders(status: SubscriptionStatus): boolean {
  return status === 'active' || status === 'trial' || status === 'cancelling';
}

export type ScheduledReminder = {
  readonly offsetDays: number;
  readonly date: ISODate;
  readonly at: Date;
};

/**
 * Every reminder for one renewal date: `offset` days before it, at 09:00 in
 * the organisation's timezone. Offsets are deduplicated and the list comes
 * back in sending order, furthest-out first.
 */
export function reminderSchedule(
  renewsOn: ISODate,
  offsets: readonly number[],
  timezone: string,
): ScheduledReminder[] {
  const unique = [...new Set(offsets.map((o) => Math.trunc(o)).filter((o) => o >= 0))];
  return unique
    .sort((a, b) => b - a)
    .map((offsetDays) => {
      const date = addDays(renewsOn, -offsetDays);
      return { offsetDays, date, at: zonedTimeToUtc(date, REMINDER_HOUR, 0, timezone) };
    });
}

/**
 * The next reminder instant strictly after `now` for the current renewal
 * date, or null when every reminder for it is in the past or the status no
 * longer wants reminders. The worker stores the result in next_reminder_at,
 * so the "what is due" query is an index lookup rather than a calculation.
 */
export function nextReminderAt(input: ReminderInput, now: Date): Date | null {
  if (!wantsReminders(input.status)) return null;
  const upcoming = reminderSchedule(input.renewsOn, input.reminderOffsets, input.timezone)
    .filter((r) => r.at.getTime() > now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  return upcoming[0]?.at ?? null;
}

/**
 * What happens to a subscription when its renewal date has passed, as seen
 * from the organisation's calendar date `today`.
 */
export type RenewalOutcome =
  { kind: 'unchanged' } | { kind: 'renewed'; renewsOn: ISODate } | { kind: 'cancelled' };

export function afterRenewalDate(
  input: ReminderInput & { readonly autoRenew: boolean },
  today: ISODate,
): RenewalOutcome {
  if (compareDates(input.renewsOn, today) >= 0) return { kind: 'unchanged' };
  if (input.status === 'cancelled') return { kind: 'unchanged' };
  if (input.status === 'cancelling' || !input.autoRenew) return { kind: 'cancelled' };
  return { kind: 'renewed', renewsOn: rollForward(input, today) };
}
