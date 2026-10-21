/**
 * Clock arithmetic shared by every screen that talks about the night.
 *
 * Alarm times are stored as 24-hour "HH:MM" strings in the plan's own timezone, and all
 * maths here is in minutes-of-day so that wrapping past midnight is a single modulo
 * rather than a Date calculation that can go wrong across a DST change.
 */

export const MINUTES_PER_DAY = 1440;

export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map((part) => Number.parseInt(part, 10));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
  return hours * 60 + minutes;
}

export function wrapMinutes(total: number): number {
  return ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** Back to the stored "HH:MM" form. */
export function formatMinutes(total: number): string {
  const wrapped = wrapMinutes(total);
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

export function nowMinutes(date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Minutes from `from` until `to`, always forward, so 23:00 → 06:30 is 450, not -990. */
export function minutesUntil(to: number, from: number): number {
  return wrapMinutes(to - from);
}

/** "7h 20m", "45m", "8h". For durations spoken about, never for clock times. */
export function describeDuration(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** The same duration for a screen reader, which reads "7h" as "seven h". */
export function speakDuration(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (rest || !hours) parts.push(`${rest} ${rest === 1 ? 'minute' : 'minutes'}`);
  return parts.join(' ');
}

let cachedTwelveHour: boolean | null = null;

/**
 * Whether this device writes times on a 12-hour clock.
 *
 * Hearth's reference shows "06:30 AM", but a bedside clock should read the way the
 * person's own phone does. Forcing 12-hour on someone in Germany is as wrong as forcing
 * 24-hour on someone in the US, so the device locale decides.
 */
export function usesTwelveHourClock(): boolean {
  if (cachedTwelveHour !== null) return cachedTwelveHour;
  // Format 13:00 and look at the result, rather than reading `resolvedOptions().hourCycle`.
  // Hermes on Android does not reliably report hourCycle, and a missing value would put
  // every Android phone on a 24-hour clock regardless of its setting. "13" in the output
  // means a 24-hour clock; anything else ("1 PM", "1 pm", "午後1時") means twelve.
  try {
    const sample = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2020, 0, 1, 13));
    cachedTwelveHour = !/13/.test(sample);
  } catch {
    cachedTwelveHour = false;
  }
  return cachedTwelveHour;
}

/**
 * A time split for display: the digits, and the period set separately so it can be
 * small. `period` is null on a 24-hour device.
 */
export function clockParts(total: number): { digits: string; period: 'AM' | 'PM' | null; spoken: string } {
  const wrapped = wrapMinutes(total);
  const hours = Math.floor(wrapped / 60);
  const minutes = String(wrapped % 60).padStart(2, '0');
  if (!usesTwelveHourClock()) {
    const digits = `${String(hours).padStart(2, '0')}:${minutes}`;
    return { digits, period: null, spoken: digits };
  }
  const period = hours >= 12 ? 'PM' : 'AM';
  const digits = `${hours % 12 || 12}:${minutes}`;
  return { digits, period, spoken: `${digits} ${period}` };
}

/** One string, for places where the time is part of a sentence. */
export function displayTime(time: string): string {
  return clockParts(minutesOf(time)).spoken;
}

/**
 * Which part of the day it is, computed rather than assumed.
 *
 * An earlier welcome screen said "Evening" unconditionally and greeted a 2am user with
 * the wrong half of the day. If the app cannot be accurate about the hour, it should not
 * mention the hour.
 */
export function dayPart(hour: number): 'late' | 'morning' | 'afternoon' | 'evening' | 'night' {
  if (hour < 4) return 'late';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

/** "Thursday, 22 October" in the device's own order and language. */
export function longDate(date = new Date()): string {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  } catch {
    return date.toDateString();
  }
}
