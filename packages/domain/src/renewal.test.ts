import { describe, expect, it } from 'vitest';

import {
  afterRenewalDate,
  isActiveOn,
  nextReminderAt,
  nextRenewalDate,
  reminderSchedule,
  rollForward,
  wantsReminders,
} from './renewal.js';

const monthlyFromJan31 = {
  billingCycle: 'monthly',
  startedOn: '2025-01-31',
  renewsOn: '2025-01-31',
} as const;

describe('next renewal date', () => {
  it('monthly from 31 January gives 28 February, then 31 March again', () => {
    const feb = nextRenewalDate(monthlyFromJan31);
    expect(feb).toBe('2025-02-28');
    expect(nextRenewalDate(monthlyFromJan31, feb)).toBe('2025-03-31');
    expect(nextRenewalDate(monthlyFromJan31, '2025-03-31')).toBe('2025-04-30');
  });

  it('monthly in a leap year lands on 29 February', () => {
    const input = {
      billingCycle: 'monthly',
      startedOn: '2024-01-31',
      renewsOn: '2024-01-31',
    } as const;
    expect(nextRenewalDate(input)).toBe('2024-02-29');
  });

  it('yearly keeps the start month and day, 29 February falls back to the 28th', () => {
    const input = {
      billingCycle: 'yearly',
      startedOn: '2024-02-29',
      renewsOn: '2024-02-29',
    } as const;
    expect(nextRenewalDate(input)).toBe('2025-02-28');
    expect(nextRenewalDate(input, '2025-02-28')).toBe('2026-02-28');
    expect(nextRenewalDate(input, '2027-02-28')).toBe('2028-02-29');
  });

  it('yearly from an ordinary date is the same date next year', () => {
    const input = {
      billingCycle: 'yearly',
      startedOn: '2025-06-15',
      renewsOn: '2026-06-15',
    } as const;
    expect(nextRenewalDate(input)).toBe('2027-06-15');
  });
});

describe('a renewal date already in the past', () => {
  it('rolls forward cycle by cycle to the first date on or after today', () => {
    const input = {
      billingCycle: 'monthly',
      startedOn: '2025-01-01',
      renewsOn: '2025-11-01',
    } as const;
    expect(rollForward(input, '2026-11-06')).toBe('2026-12-01');
    expect(rollForward(input, '2025-11-01')).toBe('2025-11-01');
    expect(rollForward(input, '2025-10-01')).toBe('2025-11-01');
  });

  it('keeps the anchor day through the roll', () => {
    expect(rollForward(monthlyFromJan31, '2025-04-01')).toBe('2025-04-30');
    expect(rollForward(monthlyFromJan31, '2025-05-01')).toBe('2025-05-31');
  });
});

describe('cancelling and cancelled', () => {
  it('a cancelled subscription stays active until the end of the paid period', () => {
    expect(isActiveOn('cancelling', '2026-03-31', '2026-03-15')).toBe(true);
    expect(isActiveOn('cancelling', '2026-03-31', '2026-03-31')).toBe(true);
    expect(isActiveOn('cancelling', '2026-03-31', '2026-04-01')).toBe(false);
    expect(isActiveOn('cancelled', '2026-03-31', '2026-03-15')).toBe(false);
    expect(isActiveOn('active', '2026-03-31', '2027-01-01')).toBe(true);
  });

  it('only cancelled subscriptions stop getting reminders', () => {
    expect(wantsReminders('cancelling')).toBe(true);
    expect(wantsReminders('trial')).toBe(true);
    expect(wantsReminders('cancelled')).toBe(false);
  });
});

describe('reminder schedule', () => {
  it('sends 30, 7 and 1 days before, at 09:00 in the organisation timezone', () => {
    const schedule = reminderSchedule('2026-03-31', [30, 7, 1], 'Europe/Berlin');
    expect(schedule.map((r) => [r.offsetDays, r.date, r.at.toISOString()])).toEqual([
      [30, '2026-03-01', '2026-03-01T08:00:00.000Z'],
      [7, '2026-03-24', '2026-03-24T08:00:00.000Z'],
      [1, '2026-03-30', '2026-03-30T07:00:00.000Z'], // summer time started on the 29th
    ]);
  });

  it('is in the organisation timezone, not the server one', () => {
    const berlin = reminderSchedule('2026-06-10', [1], 'Europe/Berlin')[0]!.at;
    const toronto = reminderSchedule('2026-06-10', [1], 'America/Toronto')[0]!.at;
    expect(berlin.toISOString()).toBe('2026-06-09T07:00:00.000Z');
    expect(toronto.toISOString()).toBe('2026-06-09T13:00:00.000Z');
  });

  it('deduplicates offsets, drops negatives and allows a same-day reminder', () => {
    const schedule = reminderSchedule('2026-03-31', [7, 7, 0, -3], 'UTC');
    expect(schedule.map((r) => r.offsetDays)).toEqual([7, 0]);
    expect(schedule[1]!.date).toBe('2026-03-31');
  });
});

describe('next reminder', () => {
  const base = {
    billingCycle: 'monthly',
    startedOn: '2026-01-31',
    renewsOn: '2026-03-31',
    status: 'active',
    reminderOffsets: [30, 7, 1],
    timezone: 'Europe/Berlin',
  } as const;

  it('is the first reminder strictly after now', () => {
    expect(nextReminderAt(base, new Date('2026-02-01T00:00:00Z'))?.toISOString()).toBe(
      '2026-03-01T08:00:00.000Z',
    );
    expect(nextReminderAt(base, new Date('2026-03-01T08:00:00Z'))?.toISOString()).toBe(
      '2026-03-24T08:00:00.000Z',
    );
    expect(nextReminderAt(base, new Date('2026-03-29T00:00:00Z'))?.toISOString()).toBe(
      '2026-03-30T07:00:00.000Z',
    );
  });

  it('is null once every reminder for the renewal date has passed', () => {
    expect(nextReminderAt(base, new Date('2026-03-30T07:00:00Z'))).toBeNull();
  });

  it('is null for a cancelled subscription', () => {
    expect(
      nextReminderAt({ ...base, status: 'cancelled' }, new Date('2026-02-01T00:00:00Z')),
    ).toBeNull();
  });
});

describe('after the renewal date passes', () => {
  const base = {
    billingCycle: 'monthly',
    startedOn: '2026-01-31',
    renewsOn: '2026-03-31',
    status: 'active',
    reminderOffsets: [7],
    timezone: 'UTC',
    autoRenew: true,
  } as const;

  it('is unchanged until the day after', () => {
    expect(afterRenewalDate(base, '2026-03-31')).toEqual({ kind: 'unchanged' });
  });

  it('renews an auto-renewing subscription to the next anchored date', () => {
    expect(afterRenewalDate(base, '2026-04-01')).toEqual({
      kind: 'renewed',
      renewsOn: '2026-04-30',
    });
    // A long outage: it rolls to the first date on or after today, not just one cycle.
    expect(afterRenewalDate(base, '2026-07-15')).toEqual({
      kind: 'renewed',
      renewsOn: '2026-07-31',
    });
  });

  it('cancels a cancelling subscription, and one that does not auto-renew', () => {
    expect(afterRenewalDate({ ...base, status: 'cancelling' }, '2026-04-01')).toEqual({
      kind: 'cancelled',
    });
    expect(afterRenewalDate({ ...base, autoRenew: false }, '2026-04-01')).toEqual({
      kind: 'cancelled',
    });
    expect(afterRenewalDate({ ...base, status: 'cancelled' }, '2026-04-01')).toEqual({
      kind: 'unchanged',
    });
  });
});
