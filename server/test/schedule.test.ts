import { describe, expect, it } from 'vitest';

import {
  ScheduleError,
  addWallDays,
  isMissed,
  nextOccurrence,
  parseCalendarDate,
  parseLocalTime,
  retentionExpiry,
  upcomingOccurrences,
  wallClockInZone,
  wallClockToInstant,
  weekdayOf,
  type WakeSchedule,
} from '@/domain/schedule';

const KOLKATA = 'Asia/Kolkata';
const NEW_YORK = 'America/New_York';

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

describe('input parsing', () => {
  it('reads 24-hour times', () => {
    expect(parseLocalTime('07:00')).toEqual({ hour: 7, minute: 0 });
    expect(parseLocalTime('23:59')).toEqual({ hour: 23, minute: 59 });
    expect(parseLocalTime('0:05')).toEqual({ hour: 0, minute: 5 });
  });

  it('rejects times that are not times', () => {
    for (const bad of ['', '7', '24:00', '12:60', '7:00 AM', '07-00', 'noon']) {
      expect(() => parseLocalTime(bad)).toThrow(ScheduleError);
    }
  });

  it('reads calendar dates and rejects malformed ones', () => {
    expect(parseCalendarDate('2026-03-08')).toEqual({ year: 2026, month: 3, day: 8 });
    for (const bad of ['', '2026-3-8', '08-03-2026', '2026-13-01', '2026-01-32']) {
      expect(() => parseCalendarDate(bad)).toThrow(ScheduleError);
    }
  });

  it('rejects an unknown timezone rather than defaulting to UTC', () => {
    const schedule: WakeSchedule = {
      scheduleType: 'daily',
      localTime: '07:00',
      timezone: 'Mars/Olympus_Mons',
    };
    expect(() => nextOccurrence(schedule)).toThrow(/Unknown timezone/);
  });
});

describe('zone conversion', () => {
  it('converts a wall clock to the instant it denotes', () => {
    // 07:00 in Kolkata is UTC+05:30 year round.
    const instant = wallClockToInstant({ year: 2026, month: 1, day: 15, hour: 7, minute: 0 }, KOLKATA);
    expect(instant.toISOString()).toBe('2026-01-15T01:30:00.000Z');
  });

  it('round-trips through the zone it came from', () => {
    const wall = { year: 2026, month: 6, day: 30, hour: 21, minute: 45 };
    expect(wallClockInZone(wallClockToInstant(wall, NEW_YORK), NEW_YORK)).toEqual(wall);
  });

  it('applies the offset in force at that date, not today’s offset', () => {
    const winter = wallClockToInstant({ year: 2026, month: 3, day: 7, hour: 7, minute: 0 }, NEW_YORK);
    const summer = wallClockToInstant({ year: 2026, month: 3, day: 9, hour: 7, minute: 0 }, NEW_YORK);
    expect(winter.toISOString()).toBe('2026-03-07T12:00:00.000Z'); // EST, UTC-5
    expect(summer.toISOString()).toBe('2026-03-09T11:00:00.000Z'); // EDT, UTC-4
  });

  it('resolves a wall time skipped by spring-forward to the hour before the jump', () => {
    // 02:30 on 2026-03-08 does not exist in New York: 02:00 EST jumps to 03:00 EDT.
    // Ringing early beats not ringing, so the earlier instant is the intended resolution.
    const instant = wallClockToInstant({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, NEW_YORK);
    expect(instant.toISOString()).toBe('2026-03-08T06:30:00.000Z');
    expect(wallClockInZone(instant, NEW_YORK)).toMatchObject({ hour: 1, minute: 30 });
  });

  it('resolves a wall time repeated by autumn-back to the first occurrence', () => {
    // 01:30 on 2026-11-01 happens twice, at 05:30Z in EDT and again at 06:30Z in EST.
    const instant = wallClockToInstant({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, NEW_YORK);
    expect(instant.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('numbers weekdays from Sunday, matching Date.getDay()', () => {
    expect(weekdayOf({ year: 2026, month: 3, day: 8 })).toBe(0); // Sunday
    expect(weekdayOf({ year: 2026, month: 10, day: 19 })).toBe(1); // Monday
    expect(weekdayOf({ year: 2026, month: 10, day: 21 })).toBe(3); // Wednesday
  });

  it('rolls wall dates over month and year boundaries', () => {
    expect(addWallDays({ year: 2026, month: 12, day: 31, hour: 7, minute: 0 }, 1)).toEqual({
      year: 2027, month: 1, day: 1, hour: 7, minute: 0,
    });
    expect(addWallDays({ year: 2028, month: 2, day: 28, hour: 7, minute: 0 }, 1)).toEqual({
      year: 2028, month: 2, day: 29, hour: 7, minute: 0, // leap year
    });
  });
});

describe('one-time plans', () => {
  const base: WakeSchedule = {
    scheduleType: 'once',
    scheduledDate: '2026-10-21',
    localTime: '06:30',
    timezone: KOLKATA,
  };

  it('returns the scheduled instant when it is still ahead', () => {
    expect(iso(nextOccurrence(base, new Date('2026-10-19T00:00:00Z')))).toBe('2026-10-21T01:00:00.000Z');
  });

  it('returns null once it has passed, rather than throwing', () => {
    // An expired one-time plan is a normal terminal state, not an error.
    expect(nextOccurrence(base, new Date('2026-10-22T00:00:00Z'))).toBeNull();
  });

  it('treats the exact scheduled instant as passed', () => {
    expect(nextOccurrence(base, new Date('2026-10-21T01:00:00Z'))).toBeNull();
  });

  it('requires a date', () => {
    expect(() => nextOccurrence({ ...base, scheduledDate: null })).toThrow(/needs a date/);
  });
});

describe('daily plans', () => {
  const daily: WakeSchedule = { scheduleType: 'daily', localTime: '07:00', timezone: KOLKATA };

  it('rings today when today’s time is still ahead', () => {
    // 2026-10-19T00:00Z is 05:30 in Kolkata, before 07:00.
    expect(iso(nextOccurrence(daily, new Date('2026-10-19T00:00:00Z')))).toBe('2026-10-19T01:30:00.000Z');
  });

  it('rolls to tomorrow once today’s time has passed', () => {
    expect(iso(nextOccurrence(daily, new Date('2026-10-19T02:00:00Z')))).toBe('2026-10-20T01:30:00.000Z');
  });

  it('holds the local time across a daylight-saving change instead of drifting', () => {
    // Saturday 08:00 EST. The next 07:00 is Sunday, after the spring-forward jump, so the
    // gap is 23 hours rather than 24. Adding a fixed day would ring at 08:00 local.
    const next = nextOccurrence(
      { scheduleType: 'daily', localTime: '07:00', timezone: NEW_YORK },
      new Date('2026-03-07T13:00:00Z'),
    );
    expect(iso(next)).toBe('2026-03-08T11:00:00.000Z');
    expect(wallClockInZone(next!, NEW_YORK)).toMatchObject({ hour: 7, minute: 0 });
  });
});

describe('weekly plans', () => {
  const weekly = (weekdays: number[]): WakeSchedule => ({
    scheduleType: 'weekly',
    localTime: '07:00',
    timezone: KOLKATA,
    weekdays,
  });

  it('finds the next matching weekday', () => {
    // 2026-10-19 is a Monday; asking for Wednesday (3) gives the 21st.
    expect(iso(nextOccurrence(weekly([3]), new Date('2026-10-19T00:00:00Z')))).toBe('2026-10-21T01:30:00.000Z');
  });

  it('rings today when today matches and the time is still ahead', () => {
    expect(iso(nextOccurrence(weekly([1]), new Date('2026-10-19T00:00:00Z')))).toBe('2026-10-19T01:30:00.000Z');
  });

  it('skips a full week when today matches but the time has passed', () => {
    // This is why the search runs to offset 7 and not 6.
    expect(iso(nextOccurrence(weekly([1]), new Date('2026-10-19T02:00:00Z')))).toBe('2026-10-26T01:30:00.000Z');
  });

  it('picks the soonest of several weekdays regardless of array order', () => {
    expect(iso(nextOccurrence(weekly([5, 3, 0]), new Date('2026-10-19T00:00:00Z')))).toBe('2026-10-21T01:30:00.000Z');
  });

  it('crosses a month boundary', () => {
    // 2026-10-31 is a Saturday; the next Sunday is 2026-11-01.
    expect(iso(nextOccurrence(weekly([0]), new Date('2026-10-31T00:00:00Z')))).toBe('2026-11-01T01:30:00.000Z');
  });

  it('requires at least one weekday', () => {
    expect(() => nextOccurrence(weekly([]))).toThrow(/at least one weekday/);
  });

  it('rejects weekday numbers outside 0-6', () => {
    for (const bad of [-1, 7, 1.5]) {
      expect(() => nextOccurrence(weekly([bad]))).toThrow(/Sunday/);
    }
  });
});

describe('materialising a horizon', () => {
  it('produces consecutive daily instants', () => {
    const instants = upcomingOccurrences(
      { scheduleType: 'daily', localTime: '07:00', timezone: KOLKATA },
      3,
      new Date('2026-10-19T02:00:00Z'),
    );
    expect(instants.map((d) => d.toISOString())).toEqual([
      '2026-10-20T01:30:00.000Z',
      '2026-10-21T01:30:00.000Z',
      '2026-10-22T01:30:00.000Z',
    ]);
  });

  it('never repeats an instant', () => {
    const instants = upcomingOccurrences(
      { scheduleType: 'weekly', localTime: '07:00', timezone: KOLKATA, weekdays: [1, 3] },
      5,
      new Date('2026-10-19T00:00:00Z'),
    );
    expect(new Set(instants.map((d) => d.getTime())).size).toBe(instants.length);
    expect(instants).toHaveLength(5);
  });

  it('yields at most one instant for a one-time plan', () => {
    const instants = upcomingOccurrences(
      { scheduleType: 'once', scheduledDate: '2026-10-21', localTime: '06:30', timezone: KOLKATA },
      5,
      new Date('2026-10-19T00:00:00Z'),
    );
    expect(instants).toHaveLength(1);
  });

  it('yields nothing for an expired one-time plan', () => {
    expect(
      upcomingOccurrences(
        { scheduleType: 'once', scheduledDate: '2026-01-01', localTime: '06:30', timezone: KOLKATA },
        5,
        new Date('2026-10-19T00:00:00Z'),
      ),
    ).toEqual([]);
  });
});

describe('missed detection', () => {
  const scheduledFor = new Date('2026-10-19T01:30:00Z');

  it('is not missed before the grace period elapses', () => {
    expect(isMissed({ scheduledFor, graceMinutes: 10, status: 'scheduled' }, new Date('2026-10-19T01:35:00Z'))).toBe(false);
  });

  it('is not missed exactly at the deadline', () => {
    expect(isMissed({ scheduledFor, graceMinutes: 10, status: 'ringing' }, new Date('2026-10-19T01:40:00Z'))).toBe(false);
  });

  it('is missed once the deadline passes', () => {
    expect(isMissed({ scheduledFor, graceMinutes: 10, status: 'ringing' }, new Date('2026-10-19T01:40:01Z'))).toBe(true);
  });

  it('never re-escalates an occurrence that already settled', () => {
    const late = new Date('2026-10-20T00:00:00Z');
    for (const status of ['confirmed', 'missed', 'escalated', 'cancelled']) {
      expect(isMissed({ scheduledFor, graceMinutes: 10, status }, late)).toBe(false);
    }
  });

  it('handles a zero grace period', () => {
    expect(isMissed({ scheduledFor, graceMinutes: 0, status: 'scheduled' }, new Date('2026-10-19T01:30:01Z'))).toBe(true);
  });
});

describe('chat retention', () => {
  it('expires messages seven or thirty days out', () => {
    const now = new Date('2026-10-19T00:00:00Z');
    expect(retentionExpiry('7d', now).toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(retentionExpiry('30d', now).toISOString()).toBe('2026-11-18T00:00:00.000Z');
  });
});
