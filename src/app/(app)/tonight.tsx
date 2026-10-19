import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AlarmTimePicker, formatAlarmTime } from '@/components/alarm-time-picker';
import { Touchable } from '@/components/motion';
import { NightSky } from '@/components/night-sky';
import {
  SleepGap,
  Spine,
  Stop,
  WakeBlock,
  describeDuration,
  formatMinutes,
  minutesOf,
} from '@/components/night-spine';
import { useZOZARStore } from '@/components/zo-zar-store';
import { BrandBar, Icon, Icons, Screen, TextField, useZOZARTheme } from '@/components/zo-zar-ui';
import { IconSize, Spacing, Type, type Theme } from '@/constants/theme';

/**
 * Tonight.
 *
 * One screen where there were three. Home, Wake and Plan all described the same night
 * from different angles and needed buttons to get between them; this draws the night
 * once, in order, and you touch the thing you mean.
 *
 * The copy follows mymind: second person, plain, and it never performs. The old greeting
 * read "Set tomorrow down gently, then let the day go", which is writing that wants to be
 * noticed. Every line here either tells you something true about tonight or says nothing.
 */

/** How long before the alarm the app starts treating the evening as bedtime. */
const WIND_DOWN_MINUTES = 8 * 60;

function nextHour() {
  const value = new Date();
  value.setHours(value.getHours() + 1, 0, 0, 0);
  return value;
}

/**
 * The line above the heading.
 *
 * Not a greeting. A greeting is the app talking about itself; this is the app saying what
 * part of the night you are in, which is the only context the screen can honestly add.
 */
function dayPart(hour: number) {
  if (hour < 4) return 'Late';
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  if (hour < 21) return 'Evening';
  return 'Tonight';
}

export default function TonightRoute() {
  const { theme, styles } = useZOZARTheme();
  const local = useMemo(() => makeStyles(theme), [theme]);
  const {
    userName,
    commitments,
    wakePlans,
    deviceSchedule,
    members,
    hydrationError,
    toggleCommitment,
    addCommitment,
    updateWakePlan,
    retryHydration,
  } = useZOZARStore();

  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [time, setTime] = useState(nextHour);
  const [saving, setSaving] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const firstName = (userName || 'you').split(/\s+/)[0];
  const guardian = members.find((member) => member.status === 'Accepted')?.name.split(/\s+/)[0];

  const wake = useMemo(() => {
    const active = wakePlans.filter((plan) => plan.status === 'Active' && !plan.isEmpty);
    return (
      active.sort((a, b) => {
        const left = a.occurrenceScheduledFor ? new Date(a.occurrenceScheduledFor).getTime() : Number.MAX_SAFE_INTEGER;
        const right = b.occurrenceScheduledFor ? new Date(b.occurrenceScheduledFor).getTime() : Number.MAX_SAFE_INTEGER;
        return left - right;
      })[0] ?? null
    );
  }, [wakePlans]);

  const deviceState = wake ? deviceSchedule[wake.id] : undefined;
  const wakeMinutes = wake ? minutesOf(wake.time) : null;

  /** Minutes from now until the alarm, wrapping past midnight. */
  const untilWake = wakeMinutes === null ? null : ((wakeMinutes - nowMinutes) % 1440 + 1440) % 1440;
  const sleeping = untilWake !== null && untilWake <= WIND_DOWN_MINUTES;

  /**
   * Commitments that still lie ahead on this spine.
   *
   * Sorted by clock time, and anything already past is dropped rather than greyed: the
   * spine is what is coming, and a timeline that opens with four struck-through rows
   * buries the part you opened it for.
   */
  const upcoming = useMemo(
    () =>
      commitments
        .filter((item) => !item.done)
        .slice()
        .sort((a, b) => minutesOf(a.time) - minutesOf(b.time)),
    [commitments],
  );

  const headline = (() => {
    if (!wake) return 'No alarm set';
    if (deviceState?.status === 'error') return 'This alarm cannot ring';
    if (untilWake !== null && sleeping) return `${describeDuration(untilWake)} until ${wake.time}`;
    return `Up at ${wake.time}`;
  })();

  const subhead = (() => {
    if (!wake) return `Pick a time you need to be up, ${firstName}, and choose who should know if you sleep through it.`;
    if (deviceState?.status === 'error') return deviceState.error ?? 'Android is blocking the alarm permission.';
    if (guardian) return `${guardian} hears about it if you sleep through.`;
    return 'Nobody is watching this one yet.';
  })();

  async function save() {
    if (!title.trim() || saving) return;
    setSaving(true);
    setComposerError(null);
    try {
      await addCommitment(title.trim(), formatAlarmTime(time));
      setTitle('');
      setTime(nextHour());
      setComposerOpen(false);
    } catch (caught) {
      setComposerError(caught instanceof Error ? caught.message : 'That could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function moveWake(minutes: number) {
    if (!wake) return;
    try {
      await updateWakePlan(wake.id, { time: formatMinutes(minutes) });
    } catch {
      // The spine re-renders from the store, so a rejected move simply snaps back to the
      // committed time. Surfacing a toast here would interrupt a gesture the user has
      // already finished, for a change they can see did not happen.
    }
  }

  return (
    <Screen>
      {/*
        The one ambient surface in the app. It sits at the bedtime end of the spine and
        nothing below it moves. See `night-sky.tsx` for why this is the only exception to
        the motion rule.
      */}
      <View style={local.sky}>
        <NightSky theme={theme} height={300} />
        <View style={local.skyContent}>
          <BrandBar />
          <View style={local.headline}>
            <Text style={local.kicker}>{dayPart(now.getHours())}</Text>
            <Text style={local.heading}>{headline}</Text>
            <Text style={local.subhead}>{subhead}</Text>
          </View>
        </View>
      </View>

      {hydrationError ? (
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Your data did not load. Try again."
          onPress={() => void retryHydration()}
          rippleColor={theme.error}
          style={[local.notice, { borderColor: theme.error, backgroundColor: theme.errorSurface }]}
        >
          <Text style={[Type.callout, { color: theme.error }]}>Your data did not load</Text>
          <Text style={local.noticeDetail}>{hydrationError} Tap to try again.</Text>
        </Touchable>
      ) : null}

      <Spine>
        <Stop
          time={formatMinutes(nowMinutes)}
          title="Now"
          tone="now"
          first
          detail={sleeping && wake ? 'Put the phone down.' : undefined}
        />

        {wake && untilWake !== null && sleeping ? <SleepGap minutes={untilWake} /> : null}

        {wake ? (
          <WakeBlock
            time={wake.time}
            graceMinutes={wake.graceMinutes}
            guardian={guardian}
            ringing={deviceState?.status === 'scheduled' && untilWake === 0}
            onCommitMinutes={(minutes) => void moveWake(minutes)}
            onPress={() => router.push(`/wake/${wake.id}` as never)}
          />
        ) : (
          <Stop
            title="Set a wake time"
            detail="Tap to choose when you need to be up."
            tone="alert"
            icon={Icons.alarm}
            onPress={() => router.push('/wake' as never)}
            accessibilityHint="Opens the alarm editor"
          />
        )}

        {upcoming.map((item) => (
          <Stop
            key={item.id}
            time={item.time}
            title={item.title}
            tone="quiet"
            onPress={() => void toggleCommitment(item.id)}
            accessibilityLabel={`${item.title} at ${item.time}`}
            accessibilityHint="Double tap to mark this done"
            trailing={
              <View style={local.ring} accessible={false}>
                {item.done ? <Icon as={Icons.check} size={12} color={theme.accent} /> : null}
              </View>
            }
          />
        ))}

        {/*
          Adding is a stop on the rail, not a floating button. mymind's lesson is that the
          interface should be made of the things themselves — an empty node at the end of
          the timeline says "the night continues here" in a way a + in the corner cannot.
        */}
        {composerOpen ? (
          <View style={local.composerRow}>
            <View style={local.composerRail} />
            <View style={local.composerBody}>
              <TextField
                label="What are you up for"
                value={title}
                onChangeText={setTitle}
                placeholder="Database Systems"
                autoCapitalize="sentences"
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => void save()}
                error={composerError}
              />
              <AlarmTimePicker value={time} onChange={setTime} />
              <Text style={local.composerHint}>
                {saving ? 'Saving…' : 'Press done on the keyboard to add it.'}
              </Text>
            </View>
          </View>
        ) : (
          <Stop
            title="Add something to the morning"
            tone="quiet"
            icon={Icons.plus}
            last
            onPress={() => setComposerOpen(true)}
            accessibilityHint="Opens a field to name what you are up for"
          />
        )}
      </Spine>

      <Touchable
        accessibilityRole="link"
        accessibilityLabel="See all your alarms"
        onPress={() => router.push('/wake' as never)}
        rippleColor={theme.surfaceStrong}
        style={local.footLink}
      >
        <Text style={local.footLabel}>All alarms</Text>
        <Icon as={Icons.chevronRight} size={IconSize.sm} color={theme.subtle} />
      </Touchable>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    /** Bleeds past the Screen's 24pt gutter so the waves reach both edges. */
    sky: { marginHorizontal: -Spacing.xl, minHeight: 300, justifyContent: 'flex-end' },
    skyContent: { paddingHorizontal: Spacing.xl },
    headline: { paddingTop: Spacing.huge, paddingBottom: Spacing.xl },
    kicker: { ...Type.label, color: theme.warm },
    heading: { ...Type.title, color: theme.text, marginTop: Spacing.xs },
    subhead: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.sm, maxWidth: 420 },

    notice: { borderWidth: 1, borderRadius: 20, padding: Spacing.lg, marginTop: Spacing.lg },
    noticeDetail: { ...Type.caption, color: theme.textSecondary, marginTop: Spacing.xs },

    ring: {
      width: 22,
      height: 22,
      borderRadius: 999,
      borderWidth: 1.5,
      borderColor: theme.lineStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },

    composerRow: { flexDirection: 'row' },
    composerRail: { width: 52 + 38 },
    composerBody: { flex: 1, paddingLeft: Spacing.md, paddingBottom: Spacing.xl, gap: Spacing.md },
    composerHint: { ...Type.caption, color: theme.subtle },

    footLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      minHeight: 48,
      alignSelf: 'flex-start',
    },
    footLabel: { ...Type.action, color: theme.subtle },
  });
