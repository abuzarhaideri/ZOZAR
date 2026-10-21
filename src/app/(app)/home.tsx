import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { HearthDial } from '@/components/hearth-dial';
import { Touchable, announce, webActiveThumb } from '@/components/motion';
import { useZOZARStore, type Commitment, type WakePlan } from '@/components/zo-zar-store';
import {
  BrandBar,
  HearthRow,
  Icon,
  Icons,
  PrimaryButton,
  RowMark,
  Screen,
  useZOZARTheme,
} from '@/components/zo-zar-ui';
import { IconSize, Radius, Spacing, Type, type Theme } from '@/constants/theme';
import {
  dayPart,
  describeDuration,
  displayTime,
  formatMinutes,
  longDate,
  minutesOf,
  minutesUntil,
  nowMinutes,
  speakDuration,
} from '@/lib/time';

/**
 * Wake: the home tab, in the Hearth direction. Named for what it is always about — your
 * next wake-up — rather than "Tonight", which was wrong whenever it was opened by day.
 *
 * A bedside companion rather than a timeline: the date, one honest line about where the
 * night stands, the clock as the anchor, and below it the few things that belong to this
 * night. Everything else is a detail screen reached by touching the thing it belongs to.
 *
 * Every line here is derived from the store. The reference's sample bedtime, walk and
 * trusted person are example data; where the app has nothing to say, it says so plainly.
 */

/** Rows shown under the dial before the list hands off to the Plan screen. */
const COMMITMENT_LIMIT = 3;

function dateKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function validDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? null : value;
}

/** "Tomorrow's wake-up", only when the native occurrence says it is tomorrow. */
function dialLabel(plan: WakePlan, now: Date) {
  const next = validDate(plan.occurrenceScheduledFor);
  if (!next) return 'Next wake-up';
  if (dateKey(next) === dateKey(now)) return 'Today’s wake-up';
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (dateKey(next) === dateKey(tomorrow)) return 'Tomorrow’s wake-up';
  return 'Next wake-up';
}

/**
 * Minutes until the plan's next ring, as planned rather than measured.
 *
 * Prefers the occurrence the server scheduled, which knows about weekdays and one-off
 * dates. Clock arithmetic is only right for a daily alarm, so a weekly or one-off alarm
 * with no occurrence yet gets no figure rather than a wrong one.
 */
function minutesToRing(plan: WakePlan, now: Date): number | null {
  const next = validDate(plan.occurrenceScheduledFor);
  if (next && next.getTime() > now.getTime()) {
    return Math.round((next.getTime() - now.getTime()) / 60000);
  }
  if (plan.scheduleType !== 'daily') return null;
  return minutesUntil(minutesOf(plan.time), nowMinutes(now));
}

function commitmentWhen(item: Commitment, now: Date) {
  const starts = validDate(item.startsAt);
  const time = displayTime(item.time);
  if (!starts) return time;
  if (dateKey(starts) === dateKey(now)) return `Today, ${time}`;
  return `Tomorrow, ${time}`;
}

export default function WakeHomeRoute() {
  const { theme } = useZOZARTheme();
  const local = useMemo(() => makeStyles(theme), [theme]);
  const {
    userName,
    commitments,
    wakePlans,
    deviceSchedule,
    members,
    hydrationError,
    toggleCommitment,
    toggleWakePlan,
    updateWakePlan,
    retryHydration,
  } = useZOZARStore();

  /** Ticks once a minute so "from now" and the heading stay true while the screen is open. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  /**
   * The plan last switched from this screen. Without it, turning the featured alarm off
   * would make it vanish from the dial mid-gesture, taking its switch with it.
   */
  const [heldId, setHeldId] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // The hold only matters while the thumb is here. Once you leave, the dial goes back to
  // featuring the alarm that rings soonest.
  useFocusEffect(
    useCallback(() => () => setHeldId(null), []),
  );

  const plan = useMemo(() => {
    const real = wakePlans.filter((item) => !item.isEmpty);
    const held = heldId ? real.find((item) => item.id === heldId) : undefined;
    if (held) return held;
    const active = real
      .filter((item) => item.status === 'Active')
      .sort((a, b) => {
        const left = validDate(a.occurrenceScheduledFor)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const right = validDate(b.occurrenceScheduledFor)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return left - right;
      });
    // With every alarm switched off, feature one of them as off rather than claiming
    // there is no alarm: the switch beside the dial is then one tap from turning it back on.
    return active[0] ?? real[0] ?? null;
  }, [wakePlans, heldId]);

  const enabled = plan?.status === 'Active';
  const device = plan ? deviceSchedule[plan.id] : undefined;
  const blocked = enabled && device?.status === 'error';
  const until = plan && enabled && !blocked ? minutesToRing(plan, now) : null;

  /**
   * This night's commitments: anything from the start of today through the next day.
   * Done items stay, dimmed, so a mistaken tap can be undone where it was made.
   */
  const { shown, remaining } = useMemo(() => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    // Through the end of tomorrow, so "Today" and "Tomorrow" are exact and an empty list
    // can honestly say nothing is planned for tomorrow.
    const endOfTomorrow = new Date(start);
    endOfTomorrow.setDate(start.getDate() + 2);
    const end = endOfTomorrow.getTime();
    const upcoming = commitments
      .map((item) => ({ item, at: validDate(item.startsAt)?.getTime() ?? null }))
      .filter(({ at }) => at !== null && at >= start.getTime() && at < end)
      .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
      .map(({ item }) => item);
    return { shown: upcoming.slice(0, COMMITMENT_LIMIT), remaining: Math.max(0, upcoming.length - COMMITMENT_LIMIT) };
  }, [commitments, now]);

  /**
   * Who hears about a missed alarm. Only a person whose accepted connection is the one
   * attached to this plan counts; an accepted person on a different alarm, or an
   * invitation still pending, is shown as exactly that.
   */
  const linked = plan?.circleId ? members.find((member) => member.circleId === plan.circleId) : undefined;
  const watcher = linked?.status === 'Accepted' ? linked : undefined;
  const pendingWatcher = linked?.status === 'Pending' ? linked : undefined;
  const someoneAccepted = members.find((member) => member.status === 'Accepted');

  const firstName = (userName || '').trim().split(/\s+/)[0];
  const part = dayPart(now.getHours());

  const heading = (() => {
    if (!plan) return part === 'morning' || part === 'afternoon' ? 'No alarm set yet.' : 'Nothing set for the morning.';
    if (!enabled) return 'This alarm is off.';
    if (blocked) return 'This alarm can’t ring yet.';
    if (part === 'morning') return firstName ? `Good morning, ${firstName}.` : 'Good morning.';
    if (part === 'afternoon') return 'Plan a softer start.';
    return 'A softer start.';
  })();

  const subhead = (() => {
    if (!plan) return 'Choose a time you need to be up, and someone to check on you if you sleep through it.';
    if (!enabled) return 'Turn it back on below, or tap the clock to change it.';
    return null;
  })();

  async function toggleDone(item: Commitment) {
    try {
      await toggleCommitment(item.id);
    } catch {
      announce(`${item.title} could not be changed. Try again.`);
    }
  }

  function openAlarm() {
    router.push('/wake' as never);
  }

  async function moveWake(minutes: number) {
    if (!plan) return;
    try {
      await updateWakePlan(plan.id, { time: formatMinutes(minutes) });
    } catch {
      // The dial re-renders from the store, so a rejected turn settles back on the saved
      // time. A toast here would interrupt a gesture that has already ended.
    }
  }

  async function toggle() {
    if (!plan || toggling) return;
    setHeldId(plan.id);
    setToggling(true);
    setToggleError(null);
    const turningOn = !enabled;
    try {
      await toggleWakePlan(plan.id);
      announce(turningOn ? 'Alarm on' : 'Alarm off');
    } catch (caught) {
      setToggleError(caught instanceof Error ? caught.message : 'That alarm could not be changed.');
    } finally {
      setToggling(false);
    }
  }

  const switchLabel = plan ? `Wake alarm at ${displayTime(plan.time)}` : 'Wake alarm';

  return (
    <Screen>
      <BrandBar />

      <View style={local.header}>
        <Text style={local.date}>{longDate(now)}</Text>
        <Text style={local.heading} accessibilityRole="header">
          {heading}
        </Text>
        {subhead ? <Text style={local.subhead}>{subhead}</Text> : null}
      </View>

      {hydrationError ? (
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={`Your data did not load. ${hydrationError} Double tap to try again.`}
          onPress={() => void retryHydration()}
          rippleColor={theme.error}
          style={local.notice}
        >
          <Text style={local.noticeTitle}>Your data did not load</Text>
          <Text style={local.noticeDetail}>{hydrationError} Tap to try again.</Text>
        </Touchable>
      ) : null}

      <View style={local.dial}>
        <HearthDial
          time={plan?.time ?? null}
          label={plan ? dialLabel(plan, now) : 'Wake-up'}
          detail={plan?.repeatLabel || undefined}
          enabled={enabled}
          onPress={openAlarm}
          onCommitMinutes={plan ? (minutes) => void moveWake(minutes) : undefined}
        />
      </View>

      {plan ? (
        <View style={local.statusRow}>
          <Text
            style={local.statusText}
            accessibilityLabel={
              until !== null
                ? `${speakDuration(until)} from now, as planned`
                : !enabled
                  ? 'This alarm is off.'
                  : blocked
                    ? 'This alarm cannot ring yet.'
                    : 'This alarm is on.'
            }
          >
            {until !== null ? `${describeDuration(until)} from now` : !enabled ? 'Off' : blocked ? 'Can’t ring yet' : 'On'}
          </Text>
          <View style={local.switchTarget}>
            <Switch
              accessibilityLabel={switchLabel}
              accessibilityHint={enabled ? 'Turns this alarm off' : 'Turns this alarm on'}
              disabled={toggling}
              value={enabled}
              onValueChange={() => void toggle()}
              trackColor={{ false: theme.lineStrong, true: theme.fill }}
              thumbColor={theme.surface}
              // React Native Web ignores thumbColor for the "on" state and draws its own teal.
              {...webActiveThumb(theme.surface)}
            />
          </View>
        </View>
      ) : null}

      {blocked || toggleError ? (
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={`${blocked ? 'This alarm cannot ring.' : 'The alarm could not be changed.'} ${
            (blocked ? device?.error : toggleError) ?? ''
          } Double tap to review Android alarm permissions.`}
          onPress={() => router.push('/permissions' as never)}
          rippleColor={theme.error}
          style={local.notice}
        >
          <Text style={local.noticeTitle}>{blocked ? 'Android is blocking this alarm' : 'That did not change'}</Text>
          <Text style={local.noticeDetail}>
            {(blocked ? device?.error : toggleError) ?? 'Android has not allowed the alarm to be scheduled.'}
          </Text>
          <View style={local.noticeAction}>
            <Text style={local.noticeLink}>Review permissions</Text>
            <Icon as={Icons.chevronRight} size={IconSize.sm} color={theme.error} />
          </View>
        </Touchable>
      ) : null}

      <View style={local.rows}>
        <HearthRow
          title="Settle in"
          detail="A quiet screen for the night"
          leading={<RowMark icon={Icons.moon} />}
          onPress={() => router.push('/bedtime' as never)}
          accessibilityHint="Opens the bedtime screen"
        />

        {shown.map((item) => (
          <HearthRow
            key={item.id}
            title={item.title}
            detail={item.done ? `Done, ${commitmentWhen(item, now)}` : commitmentWhen(item, now)}
            leading={<RowMark icon={item.done ? Icons.check : Icons.clock} />}
            dimmed={item.done}
            navigates={false}
            onPress={() => void toggleDone(item)}
            onLongPress={() => router.push('/plan' as never)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.done }}
            accessibilityLabel={`${item.title}, ${commitmentWhen(item, now)}`}
            accessibilityHint={`Double tap to mark ${item.done ? 'not done' : 'done'}. Long press to open your plan.`}
          />
        ))}

        <HearthRow
          title={shown.length ? 'See the days ahead' : 'Nothing planned for tomorrow'}
          detail={
            remaining
              ? `${remaining} more today and tomorrow`
              : shown.length
                ? undefined
                : 'Add something you need to be up for'
          }
          leading={<RowMark icon={Icons.listChecks} />}
          onPress={() => router.push('/plan' as never)}
          accessibilityHint="Opens your plan"
        />

        {watcher ? (
          <HearthRow
            title={watcher.name}
            detail="Hears about it if you sleep through"
            leading={<RowMark letter={watcher.name.charAt(0).toLocaleUpperCase()} />}
            onPress={() => router.push(`/chat/${watcher.id}` as never)}
            accessibilityHint={`Opens your conversation with ${watcher.name}`}
            last
          />
        ) : pendingWatcher ? (
          <HearthRow
            title="Nobody is watching this alarm yet"
            detail={`${pendingWatcher.name} hasn’t accepted your invitation`}
            leading={<RowMark letter={pendingWatcher.name.charAt(0).toLocaleUpperCase()} />}
            onPress={() => router.push('/people' as never)}
            accessibilityHint="Opens People"
            last
          />
        ) : plan && someoneAccepted ? (
          <HearthRow
            title="Nobody is watching this alarm yet"
            detail={`Choose ${someoneAccepted.name} in the alarm to have them told`}
            leading={<RowMark icon={Icons.shield} />}
            onPress={openAlarm}
            accessibilityHint="Opens your alarms"
            last
          />
        ) : !plan && someoneAccepted ? (
          <HearthRow
            title={someoneAccepted.name}
            detail="Not watching an alarm yet"
            leading={<RowMark letter={someoneAccepted.name.charAt(0).toLocaleUpperCase()} />}
            onPress={() => router.push('/people' as never)}
            accessibilityHint="Opens People"
            last
          />
        ) : (
          <HearthRow
            title={plan ? 'Nobody is watching this alarm yet' : 'No trusted person yet'}
            detail="Invite someone who can check on you"
            leading={<RowMark icon={Icons.userPlus} />}
            onPress={() => router.push('/people' as never)}
            accessibilityHint="Opens People"
            last
          />
        )}
      </View>

      <View style={local.primary}>
        <PrimaryButton label="Begin wind-down" onPress={() => router.push('/bedtime' as never)} />
      </View>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    header: { paddingTop: Spacing.lg, gap: Spacing.xs },
    date: { ...Type.body, color: theme.textSecondary },
    heading: { ...Type.title, color: theme.text },
    subhead: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.xs, maxWidth: 420 },

    dial: { alignItems: 'center', marginTop: Spacing.xl },

    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.md,
      marginTop: Spacing.lg,
    },
    statusText: { ...Type.body, color: theme.textSecondary, flexShrink: 1 },
    switchTarget: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },

    notice: {
      borderWidth: 1,
      borderColor: theme.error,
      backgroundColor: theme.errorSurface,
      borderRadius: Radius.card,
      padding: Spacing.lg,
      marginTop: Spacing.lg,
      gap: Spacing.xs,
    },
    noticeTitle: { ...Type.callout, color: theme.error },
    noticeDetail: { ...Type.body, color: theme.text },
    noticeAction: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.xs },
    noticeLink: { ...Type.action, color: theme.error },

    rows: { marginTop: Spacing.xl },
    primary: { marginTop: Spacing.xl, marginBottom: Spacing.xl },
  });
