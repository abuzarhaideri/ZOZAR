import { router } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Arrive } from '@/components/motion';
import { NightSky } from '@/components/night-sky';
import { useZOZARStore } from '@/components/zo-zar-store';
import { PrimaryButton, useZOZARTheme } from '@/components/zo-zar-ui';
import { Radius, Spacing, Type, type Theme } from '@/constants/theme';
import {
  clockParts,
  dayPart,
  describeDuration,
  minutesOf,
  minutesUntil,
  nowMinutes,
  speakDuration,
} from '@/lib/time';
import { ZozarMark } from '@/components/zozar-mark';

/**
 * The threshold, in Hearth.
 *
 * It earns its place by telling you something only this app knows: when your alarm is
 * and who is standing behind it. If there is no alarm it says so plainly rather than
 * inventing calm, and the trusted-person line never claims protection the circle does not
 * actually provide: a pending invitation is named as pending.
 *
 * One of the two places NightSky is allowed (the other is bedtime). It carries no
 * information, so Reduce Motion stops it with nothing lost.
 */

/** Words for the shared day part. "Good night" is a farewell, so late evening is still
 * "Good evening"; small hours get a plain hello rather than a remark about being awake. */
const greetingFor: Record<ReturnType<typeof dayPart>, string> = {
  late: 'Hello',
  morning: 'Good morning',
  afternoon: 'Good afternoon',
  evening: 'Good evening',
  night: 'Good evening',
};

export default function WelcomeRoute() {
  const { theme } = useZOZARTheme();
  const local = useMemo(() => makeStyles(theme), [theme]);
  const { userName, wakePlans, members, deviceSchedule } = useZOZARStore();

  const firstName = (userName || '').trim().split(/\s+/)[0];

  const wake = useMemo(
    () => wakePlans.find((plan) => plan.status === 'Active' && !plan.isEmpty) ?? null,
    [wakePlans],
  );

  // The server notifies only the person whose connection is attached to this alarm, so
  // that is the only person this screen may name as protection. Anyone else accepted is
  // in the circle but not on this alarm.
  const linked = wake?.circleId ? members.find((member) => member.circleId === wake.circleId) : undefined;
  const accepted = linked?.status === 'Accepted' ? linked : undefined;
  const pending = linked?.status === 'Pending' ? linked : undefined;
  const someoneAccepted = members.find((member) => member.status === 'Accepted');

  const now = new Date();
  const greeting = firstName ? `${greetingFor[dayPart(now.getHours())]}, ${firstName}.` : `${greetingFor[dayPart(now.getHours())]}.`;
  const wakeMinutes = wake ? minutesOf(wake.time) : null;
  const time = wakeMinutes === null ? null : clockParts(wakeMinutes);
  const untilWake = wakeMinutes === null ? null : minutesUntil(wakeMinutes, nowMinutes(now));
  const schedule = wake ? deviceSchedule[wake.id]?.status : undefined;

  // "From now" is the planned gap to the alarm, never a claim about sleep.
  const beneath = (() => {
    if (untilWake === null) return 'No alarm is set for tomorrow.';
    if (untilWake < 60) return `In ${describeDuration(untilWake)}.`;
    return `${describeDuration(untilWake)} from now.`;
  })();
  const beneathSpoken =
    untilWake === null ? beneath : untilWake < 60 ? `In ${speakDuration(untilWake)}.` : `${speakDuration(untilWake)} from now.`;

  // Only the native module's own confirmation counts as scheduled; anything else is
  // stated, not hidden, because this is the screen people glance at before sleeping.
  const scheduleNote =
    wake && schedule === 'error'
      ? 'This alarm could not be set on this phone. Open it from Wake to try again.'
      : wake && schedule !== 'scheduled'
        ? 'Not confirmed on this phone yet.'
        : null;

  const first = (name: string) => name.trim().split(/\s+/)[0];
  const promise = accepted
    ? `${first(accepted.name)} hears about it if you sleep through.`
    : pending
      ? `Your invitation to ${first(pending.name)} is still waiting. Nobody is notified yet.`
      : wake && someoneAccepted
        ? `Nobody is notified if you sleep through this alarm yet. You can add ${first(someoneAccepted.name)} to it from Wake.`
        : 'Nobody is notified if you sleep through yet.';

  return (
    <SafeAreaView style={[local.safe, { backgroundColor: theme.background }]} edges={['top', 'bottom', 'left', 'right']}>
      <NightSky theme={theme} height={620} />

      <ScrollView
        style={local.scroll}
        contentContainerStyle={local.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={local.brandRow}>
          <ZozarMark height={22} decorative />
          <Text style={local.brand}>ZO-ZAR</Text>
        </View>

        {/* The screen's single orchestrated moment. Everything else is already in place. */}
        <Arrive style={local.middle}>
          <Text accessibilityRole="header" style={local.greeting}>
            {greeting}
          </Text>

          {time ? (
            <View
              accessible
              accessibilityLabel={`Your alarm is at ${time.spoken}. ${beneathSpoken}`}
              style={local.timeBlock}
            >
              <Text style={local.timeLabel}>Your alarm</Text>
              <View style={local.timeRow}>
                <Text style={local.time} maxFontSizeMultiplier={1.3}>
                  {time.digits}
                </Text>
                {time.period ? <Text style={local.period}>{time.period}</Text> : null}
              </View>
              <Text style={local.beneath}>{beneath}</Text>
            </View>
          ) : (
            <View style={local.timeBlock}>
              <Text style={local.beneath}>{beneath}</Text>
            </View>
          )}

          {scheduleNote ? <Text style={local.note}>{scheduleNote}</Text> : null}

          <View style={local.promiseCard}>
            <Text style={local.promise}>{promise}</Text>
          </View>
        </Arrive>

        {/*
          Gold, as Hearth's one primary action. It is the only control on the screen and
          its amber is a warm, mid-luminance colour rather than white, so it is findable
          half-asleep without being the brightest thing in the room.
        */}
        <PrimaryButton label="Open ZO-ZAR" onPress={() => router.replace('/home' as never)} />
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    safe: { flex: 1 },
    scroll: { flex: 1 },
    /** Grows to fill the screen, and scrolls instead of clipping when text is scaled up. */
    content: {
      flexGrow: 1,
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.xl,
    },

    brandRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    brand: { ...Type.label, color: theme.textSecondary, letterSpacing: 1.6 },

    middle: { flex: 1, justifyContent: 'center', paddingVertical: Spacing.xl },
    greeting: { ...Type.title, color: theme.text },

    timeBlock: { marginTop: Spacing.xxl },
    timeLabel: { ...Type.label, color: theme.textSecondary },
    timeRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm, marginTop: Spacing.xs },
    /** Tabular, so the clock does not shift width between 11:00 and 06:30. */
    time: { ...Type.clock, color: theme.text },
    period: { ...Type.heading, color: theme.textSecondary },
    beneath: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.xs },
    note: { ...Type.callout, color: theme.textSecondary, marginTop: Spacing.md },

    promiseCard: {
      marginTop: Spacing.xl,
      borderRadius: Radius.card,
      backgroundColor: theme.surface,
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.lg,
    },
    promise: { ...Type.body, color: theme.text },
  });
