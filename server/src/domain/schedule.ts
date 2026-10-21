/**
 * Wake plan recurrence, computed in the plan's own IANA timezone.
 *
 * The client used to do this with plain `Date` setters, which operate in whatever zone the
 * device happens to be in. That was survivable on a phone and is wrong on a Lambda, where
 * the process runs in UTC: a 07:00 Asia/Kolkata alarm would have been materialised at
 * 07:00Z, five and a half hours late. Everything here is therefore explicit about zones.
 *
 * Arithmetic is done on wall-clock fields and only then converted to an instant. That is
 * the behaviour an alarm needs: "07:00 every day" must stay 07:00 across a daylight-saving
 * shift, rather than drifting by an hour because a fixed duration was added.
 *
 * Weekday numbering matches JavaScript's `Date.getDay()`, 0 = Sunday through 6 = Saturday,
 * because that is the convention the existing client already stores.
 */

export type ScheduleType = 'once' | 'daily' | 'weekly';

export type WakeSchedule = {
  scheduleType: ScheduleType;
  /** 'YYYY-MM-DD', required for a one-time plan and ignored otherwise. */
  scheduledDate?: string | null;
  /** 'HH:MM', 24-hour. */
  localTime: string;
  /** IANA zone name, for example 'Asia/Kolkata'. */
  timezone: string;
  /** 0 = Sunday. Required for a weekly plan. */
  weekdays?: readonly number[];
};

export type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleError';
  }
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Throws for an unknown zone rather than silently falling back to UTC, which would
 * schedule a real alarm at the wrong time. */
export function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new ScheduleError(`Unknown timezone: ${timezone}`);
  }
}

export function parseLocalTime(localTime: string): { hour: number; minute: number } {
  const match = localTime.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new ScheduleError(`Expected a 24-hour HH:MM time, received: ${localTime}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new ScheduleError(`Not a valid time of day: ${localTime}`);
  return { hour, minute };
}

export function parseCalendarDate(value: string): { year: number; month: number; day: number } {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new ScheduleError(`Expected a YYYY-MM-DD date, received: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new ScheduleError(`Not a valid calendar date: ${value}`);
  }
  return { year, month, day };
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatterCache.set(timezone, formatter);
  }
  return formatter;
}

/** The wall-clock reading a person in `timezone` would see at `instant`. */
export function wallClockInZone(instant: Date, timezone: string): WallClock {
  const parts = partsFormatter(timezone).formatToParts(instant);
  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type)?.value;
    if (found === undefined) throw new ScheduleError(`Timezone ${timezone} produced no ${type} field.`);
    return Number(found);
  };
  return {
    year: field('year'),
    month: field('month'),
    day: field('day'),
    hour: field('hour'),
    minute: field('minute'),
  };
}

/** Zone offset in milliseconds at a given instant, east of UTC positive. */
function zoneOffsetMs(instant: Date, timezone: string): number {
  const wall = wallClockInZone(instant, timezone);
  const parts = partsFormatter(timezone).formatToParts(instant);
  const second = Number(parts.find((part) => part.type === 'second')?.value ?? '0');
  const asIfUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, second);
  // Drop sub-second precision on both sides so the difference is a clean offset.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Converts a wall-clock reading in `timezone` to the UTC instant it denotes.
 *
 * The offset depends on the instant, and the instant is what we are solving for, so this
 * guesses using the offset at the naive interpretation and then refines once. A single
 * refinement is sufficient because daylight-saving offsets shift by at most a couple of
 * hours and never twice within one day.
 *
 * Two edge cases are inherent to wall-clock scheduling rather than bugs here, and both
 * are pinned by tests because the behaviour falls out of the refinement step rather than
 * being chosen:
 *
 * - A time skipped by a spring-forward transition does not exist. It resolves to the
 *   instant one hour earlier, immediately before the jump: asking for 02:30 on the US
 *   transition date yields 01:30 local. An alarm set in the lost hour therefore rings
 *   early rather than not at all, which is the safer failure for a wake-up app.
 * - A time repeated by an autumn-back transition is ambiguous. It resolves to the first
 *   of the two occurrences, so such an alarm rings once, on the earlier pass.
 */
export function wallClockToInstant(wall: WallClock, timezone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0, 0);
  const firstGuess = naive - zoneOffsetMs(new Date(naive), timezone);
  const refined = naive - zoneOffsetMs(new Date(firstGuess), timezone);
  return new Date(refined);
}

/** 0 = Sunday, matching `Date.prototype.getDay()`. */
export function weekdayOf(wall: Pick<WallClock, 'year' | 'month' | 'day'>): number {
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
}

/** Adds whole days to a wall-clock date, letting `Date.UTC` normalise month and year
 * rollover. Operating on fields rather than an instant is what keeps the local time
 * fixed across a daylight-saving boundary. */
export function addWallDays(wall: WallClock, days: number): WallClock {
  const shifted = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days, wall.hour, wall.minute));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: wall.hour,
    minute: wall.minute,
  };
}

/**
 * The next instant this plan should ring, strictly after `now`.
 *
 * Returns null for a one-time plan whose moment has passed, because an expired one-time
 * plan is a normal terminal state rather than an error. Genuinely invalid input — an
 * unparseable time, a weekly plan with no weekdays — throws `ScheduleError`.
 */
export function nextOccurrence(schedule: WakeSchedule, now: Date = new Date()): Date | null {
  assertValidTimezone(schedule.timezone);
  const { hour, minute } = parseLocalTime(schedule.localTime);

  if (schedule.scheduleType === 'once') {
    if (!schedule.scheduledDate) {
      throw new ScheduleError('A one-time wake plan needs a date.');
    }
    const date = parseCalendarDate(schedule.scheduledDate);
    const instant = wallClockToInstant({ ...date, hour, minute }, schedule.timezone);
    return instant.getTime() > now.getTime() ? instant : null;
  }

  const today = wallClockInZone(now, schedule.timezone);
  const base: WallClock = { year: today.year, month: today.month, day: today.day, hour, minute };

  if (schedule.scheduleType === 'daily') {
    const candidate = wallClockToInstant(base, schedule.timezone);
    if (candidate.getTime() > now.getTime()) return candidate;
    return wallClockToInstant(addWallDays(base, 1), schedule.timezone);
  }

  const selected = new Set(schedule.weekdays ?? []);
  if (selected.size === 0) {
    throw new ScheduleError('A weekly wake plan needs at least one weekday.');
  }
  for (const day of selected) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new ScheduleError(`Weekday must be 0 (Sunday) through 6 (Saturday), received: ${day}`);
    }
  }

  // Eight steps, not seven: the matching weekday may be today but already past, in which
  // case the answer is the same weekday next week.
  for (let offset = 0; offset <= 7; offset += 1) {
    const wall = addWallDays(base, offset);
    if (!selected.has(weekdayOf(wall))) continue;
    const candidate = wallClockToInstant(wall, schedule.timezone);
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  throw new ScheduleError('No upcoming weekday matched this wake plan.');
}

/**
 * The upcoming instants for a plan, used by the worker to materialise occurrence rows
 * ahead of time. Walks forward by recomputing from each result so that a daylight-saving
 * transition mid-horizon is handled by the same logic as a single lookup.
 */
export function upcomingOccurrences(schedule: WakeSchedule, count: number, now: Date = new Date()): Date[] {
  const instants: Date[] = [];
  let cursor = now;
  for (let index = 0; index < count; index += 1) {
    const next = nextOccurrence(schedule, cursor);
    if (!next) break;
    instants.push(next);
    // Step one minute past the result so the next call cannot return the same instant.
    cursor = new Date(next.getTime() + MINUTE_MS);
    if (schedule.scheduleType === 'once') break;
  }
  return instants;
}

/** An occurrence is missed once its grace period has fully elapsed without confirmation.
 * The worker uses this to decide when to escalate to the trusted person. */
export function isMissed(
  occurrence: { scheduledFor: Date; graceMinutes: number; status: string },
  now: Date = new Date(),
): boolean {
  if (occurrence.status !== 'scheduled' && occurrence.status !== 'ringing') return false;
  const deadline = occurrence.scheduledFor.getTime() + occurrence.graceMinutes * MINUTE_MS;
  return now.getTime() > deadline;
}

/** Message expiry from a thread's retention setting. */
export function retentionExpiry(retention: '7d' | '30d', now: Date = new Date()): Date {
  return new Date(now.getTime() + (retention === '7d' ? 7 : 30) * DAY_MS);
}
