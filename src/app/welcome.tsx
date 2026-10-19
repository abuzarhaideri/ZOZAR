import { router } from 'expo-router';
import { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Arrive, Touchable } from '@/components/motion';
import { NightSky } from '@/components/night-sky';
import { describeDuration, minutesOf } from '@/components/night-spine';
import { useZOZARStore } from '@/components/zo-zar-store';
import { useZOZARTheme } from '@/components/zo-zar-ui';
import { Fonts, Radius, Spacing, Type, type Theme } from '@/constants/theme';

/**
 * The threshold.
 *
 * What was here before was an interstitial that said "A calmer rhythm, made for you."
 * over a drawn sun — a mood with no information in it, four staggered entrance
 * animations, and an arrow glued to the button. It was the most generated-looking screen
 * in the app and it delayed you on the way to the thing you opened.
 *
 * It earns its place now by telling you something only this app knows: how long until
 * your alarm, and who is standing behind it. That is the whole product in two lines. If
 * there is no alarm it says so plainly rather than inventing calm.
 *
 * This is also the fullest statement of the Endel surface — the only screen given over
 * entirely to atmosphere, which is appropriate because it is the one screen with nothing
 * to do on it. One action, set quiet and low, the way Endel sets "Start".
 */
export default function WelcomeRoute() {
  const { theme } = useZOZARTheme();
  const local = useMemo(() => makeStyles(theme), [theme]);
  const { userName, wakePlans, members } = useZOZARStore();

  const firstName = (userName || 'there').split(/\s+/)[0];
  const guardian = members.find((member) => member.status === 'Accepted')?.name.split(/\s+/)[0];

  const wake = useMemo(
    () => wakePlans.find((plan) => plan.status === 'Active' && !plan.isEmpty) ?? null,
    [wakePlans],
  );

  const now = new Date();
  const untilWake = wake
    ? ((minutesOf(wake.time) - (now.getHours() * 60 + now.getMinutes())) % 1440 + 1440) % 1440
    : null;

  const headline = wake ? wake.time : 'No alarm set';
  const beneath = (() => {
    if (!wake || untilWake === null) return 'Nothing will wake you tomorrow.';
    if (untilWake < 60) return `In ${describeDuration(untilWake)}.`;
    return `${describeDuration(untilWake)} from now.`;
  })();

  const promise = guardian
    ? `${guardian} hears about it if you sleep through.`
    : 'Nobody is watching this one yet.';

  return (
    <SafeAreaView style={[local.safe, { backgroundColor: theme.background }]} edges={['top', 'bottom', 'left', 'right']}>
      <NightSky theme={theme} height={620} />

      <View style={local.content}>
        <View style={local.brandRow}>
          <Image
            source={require('../../assets/images/zo-zar-mark-flat.png')}
            style={local.brandLogo}
            resizeMode="contain"
          />
          <Text style={local.brand}>ZO-ZAR</Text>
        </View>

        {/*
          The screen's single orchestrated moment, and the only thing on it that moves of
          its own accord besides the sky. Everything else is already in place when you
          arrive, which is the point: nothing here is worth waiting for.
        */}
        <Arrive style={local.middle}>
          <Text style={local.greeting}>Evening, {firstName}</Text>
          <Text
            accessibilityRole="header"
            style={[local.time, !wake && local.timeEmpty]}
            maxFontSizeMultiplier={1.3}
          >
            {headline}
          </Text>
          <Text style={local.beneath}>{beneath}</Text>
          <Text style={local.promise}>{promise}</Text>
        </Arrive>

        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Open tonight"
          onPress={() => router.replace('/tonight' as never)}
          rippleColor={theme.surfaceStrong}
          style={local.enter}
        >
          <Text style={local.enterLabel}>Tonight</Text>
        </Touchable>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    safe: { flex: 1 },
    content: {
      flex: 1,
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.xl,
    },

    brandRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    brandLogo: { width: 30, height: 30, borderRadius: 10 },
    brand: { fontFamily: Fonts.bold, fontSize: 14, letterSpacing: 3, color: theme.textSecondary },

    middle: { flex: 1, justifyContent: 'center' },
    greeting: { ...Type.body, color: theme.textSecondary },
    /** Tabular, so the clock does not shift width between 11:00 and 06:30. */
    time: { ...Type.clock, color: theme.text, marginTop: Spacing.sm },
    /** "No alarm set" is a sentence, not a clock, and must not be set at 60px. */
    timeEmpty: { ...Type.title, marginTop: Spacing.md },
    beneath: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.xs },
    promise: { ...Type.callout, color: theme.warm, marginTop: Spacing.xl, maxWidth: 380 },

    /**
     * Endel's recessive action: outlined, not filled, and low on the screen. A full amber
     * button here would be the brightest thing in a dark room at bedtime, for a tap that
     * only continues what you already started.
     */
    enter: {
      minHeight: 56,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: theme.lineStrong,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Spacing.xl,
    },
    enterLabel: { ...Type.action, color: theme.text },
  });
