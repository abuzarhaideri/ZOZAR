import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NightSky } from '@/components/night-sky';
import { useZOZARStore } from '@/components/zo-zar-store';
import { BackButton, Icon, Icons, SecondaryButton, useZOZARTheme } from '@/components/zo-zar-ui';
import { Radius, Spacing, Type, type Theme } from '@/constants/theme';
import {
  MINUTES_PER_DAY,
  clockParts,
  describeDuration,
  longDate,
  minutesOf,
  minutesUntil,
  nowMinutes,
  speakDuration,
} from '@/lib/time';

/**
 * Bedtime.
 *
 * A deliberately low-information screen: the next wake-up, how long until it, and one
 * way to change it. Everything else has already been decided on Wake. It is one of
 * the two places the ambient night sky is allowed, because nothing here asks for a
 * decision.
 *
 * Text sits at secondary weight wherever it can, so the screen is not a bright panel in
 * a dark room. The wake time is the one thing set large.
 *
 * Honesty rules this screen follows:
 * - The duration is "from now", a planned interval, never measured sleep.
 * - "Next wake-up" names the plan; whether the phone has actually armed it is stated
 *   separately, and only `deviceSchedule === 'scheduled'` is treated as armed.
 */

export default function BedtimeRoute() {
  const { theme } = useZOZARTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { height } = useWindowDimensions();
  const { wakePlans, deviceSchedule } = useZOZARStore();

  // The screen may be left open on the nightstand; keep "from now" honest by the minute.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    // Coming back from a locked screen, the last tick may be up to a minute old.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(new Date());
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  // Same choice as Wake: the soonest active plan.
  const wake = useMemo(() => {
    const active = wakePlans.filter((plan) => plan.status === 'Active' && !plan.isEmpty);
    return (
      [...active].sort((a, b) => {
        const left = a.occurrenceScheduledFor ? new Date(a.occurrenceScheduledFor).getTime() : Number.MAX_SAFE_INTEGER;
        const right = b.occurrenceScheduledFor ? new Date(b.occurrenceScheduledFor).getTime() : Number.MAX_SAFE_INTEGER;
        return left - right;
      })[0] ?? null
    );
  }, [wakePlans]);

  const hasAnyPlan = wakePlans.some((plan) => !plan.isEmpty);
  const deviceState = wake ? deviceSchedule[wake.id] : undefined;

  /**
   * Minutes until the wake-up. The concrete occurrence wins when the store has one,
   * because a weekly plan's next ring may be days away and clock arithmetic alone would
   * call it "tonight".
   */
  const until = useMemo(() => {
    if (!wake) return null;
    if (wake.occurrenceScheduledFor) {
      const at = new Date(wake.occurrenceScheduledFor);
      const diff = Math.round((at.getTime() - now.getTime()) / 60_000);
      if (!Number.isNaN(diff) && diff >= 0) return { minutes: diff, at };
    }
    return { minutes: minutesUntil(minutesOf(wake.time), nowMinutes(now)), at: null };
  }, [wake, now]);

  const clock = wake ? clockParts(minutesOf(wake.time)) : null;

  let distance: string | null = null;
  let spokenDistance: string | null = null;
  if (until) {
    if (until.minutes >= MINUTES_PER_DAY && until.at) {
      distance = longDate(until.at);
      spokenDistance = distance;
    } else {
      distance = `${describeDuration(until.minutes)} from now`;
      spokenDistance = `${speakDuration(until.minutes)} from now`;
    }
  }

  const notArmed = wake && deviceState && deviceState.status !== 'scheduled';

  const wakeSummary = wake && clock
    ? ['Next wake-up', clock.spoken, spokenDistance, wake.repeatLabel].filter(Boolean).join(', ')
    : hasAnyPlan
      ? 'Your alarm is off. Nothing is set to wake you.'
      : 'No alarm set. Nothing is set to wake you.';

  return (
    <View style={styles.root}>
      <NightSky theme={theme} height={height} />
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <BackButton />

          <View style={styles.center}>
            <View style={styles.moon}>
              <Icon as={Icons.moon} size={44} color={theme.accent} />
            </View>

            <Text style={styles.quiet}>That&apos;s enough for today</Text>
            <Text style={styles.heading} accessibilityRole="header">
              Rest easy.
            </Text>

            <View accessible accessibilityLabel={wakeSummary} style={styles.wakeGroup}>
              {wake && clock ? (
                <>
                  <Text style={styles.quiet}>Next wake-up</Text>
                  <View style={styles.clockLine}>
                    <Text style={styles.clock}>{clock.digits}</Text>
                    {clock.period ? <Text style={styles.period}>{clock.period}</Text> : null}
                  </View>
                  {distance ? <Text style={styles.muted}>{distance}</Text> : null}
                  {wake.repeatLabel ? <Text style={styles.muted}>{wake.repeatLabel}</Text> : null}
                </>
              ) : (
                <>
                  <Text style={styles.stateTitle}>{hasAnyPlan ? 'Your alarm is off' : 'No alarm set'}</Text>
                  <Text style={styles.muted}>Nothing is set to wake you.</Text>
                </>
              )}
            </View>

            {notArmed ? (
              <Text style={styles.warning}>
                {deviceState?.status === 'error'
                  ? "This phone couldn't set the alarm. Adjust wake-up to try again."
                  : "This alarm isn't set on this phone yet."}
              </Text>
            ) : null}
          </View>

          <View style={styles.action}>
            <SecondaryButton
              label={wake ? 'Adjust wake-up' : 'Set a wake-up'}
              icon={Icons.alarm}
              onPress={() => router.push('/wake')}
            />
          </View>

          <Text style={styles.footer}>You can put your phone down.</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    safeArea: { flex: 1 },
    content: {
      flexGrow: 1,
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.xl,
    },
    center: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: Spacing.xxl,
      paddingBottom: Spacing.lg,
    },
    moon: {
      width: 120,
      height: 120,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: theme.line,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: Spacing.xl,
    },
    quiet: { ...Type.callout, color: theme.textSecondary, textAlign: 'center' },
    heading: {
      ...Type.title,
      color: theme.text,
      textAlign: 'center',
      marginTop: Spacing.md,
      marginBottom: Spacing.xl,
    },
    wakeGroup: { alignItems: 'center', gap: Spacing.xs },
    clockLine: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
    // Large but not white-hot: the one number on the screen, at text colour.
    clock: { ...Type.clock, color: theme.text, textAlign: 'center' },
    period: { ...Type.heading, color: theme.textSecondary },
    stateTitle: { ...Type.heading, color: theme.text, textAlign: 'center' },
    muted: { ...Type.body, color: theme.textSecondary, textAlign: 'center' },
    warning: { ...Type.body, color: theme.warning, textAlign: 'center', marginTop: Spacing.lg },
    action: { marginTop: Spacing.xxl },
    footer: {
      ...Type.body,
      color: theme.subtle,
      textAlign: 'center',
      marginTop: Spacing.xl,
    },
  });
}
