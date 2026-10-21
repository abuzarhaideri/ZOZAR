/**
 * Wake streak: how many recent days the person woke up on time.
 *
 * Pure and dependency-free so it can be checked with plain node and reused by any
 * repository (local fallback or REST) — it only reads `scheduledFor` and `status`.
 *
 * A day is the LOCAL calendar date of an occurrence's `scheduledFor`:
 * - success: at least one 'confirmed' occurrence and no 'missed'/'escalated' one;
 * - failure: any 'missed' or 'escalated' occurrence;
 * - neutral: no alarms, or only scheduled/ringing/cancelled ones (for example today's
 *   alarm that has not rung yet). Neutral days neither count nor break the streak.
 *
 * Walking back from today, neutral days are skipped, successes are counted, and the walk
 * stops at the first failure or at the oldest recorded day. There is no cap: a streak is
 * as long as the history the app holds. Occurrences scheduled after `now` are ignored.
 */

export type StreakOccurrence = {
  scheduledFor: string;
  status: string;
};

type DayOutcome = 'success' | 'failure';

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function computeWakeStreak(
  occurrences: readonly StreakOccurrence[],
  now: Date = new Date(),
): number {
  const nowMs = now.getTime();
  const days = new Map<string, DayOutcome>();
  let oldestMs = Number.POSITIVE_INFINITY;

  for (const occurrence of occurrences) {
    const scheduled = new Date(occurrence.scheduledFor);
    const scheduledMs = scheduled.getTime();
    if (Number.isNaN(scheduledMs) || scheduledMs > nowMs) continue;
    const key = localDayKey(scheduled);
    oldestMs = Math.min(oldestMs, scheduledMs);
    if (occurrence.status === 'missed' || occurrence.status === 'escalated') {
      days.set(key, 'failure');
    } else if (occurrence.status === 'confirmed' && days.get(key) !== 'failure') {
      days.set(key, 'success');
    }
  }

  let streak = 0;
  // Step back by calendar day (not by 24h) so DST changes cannot skip or repeat a date.
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  if (!Number.isFinite(oldestMs)) return 0;
  const oldest = new Date(oldestMs);
  const stop = new Date(oldest.getFullYear(), oldest.getMonth(), oldest.getDate(), 0).getTime();
  while (cursor.getTime() >= stop) {
    const outcome = days.get(localDayKey(cursor));
    if (outcome === 'failure') break;
    if (outcome === 'success') streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
