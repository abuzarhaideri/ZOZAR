import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Rect } from 'react-native-svg';

import { useAppearance } from './appearance-provider';
import { Arrive } from './motion';
import { useZOZARStore } from './zo-zar-store';
import { Radius, Spacing, Type, type Theme } from '@/constants/theme';
import { computeWakeStreak } from '@/lib/streak';

const BADGE_SIZE = 72;
const HORIZON = 46;

/**
 * The streak illustration: a sun on the horizon inside soft rings that echo the Hearth
 * dial. Drawn rather than an emoji so it takes theme colours and reads the same on every
 * Android version. With no streak yet the sun is only just at the horizon; once there is
 * one it has risen. Purely decorative: the card carries the accessible label.
 */
export function StreakBadge({ risen, size = BADGE_SIZE }: { risen: boolean; size?: number }) {
  const { theme } = useAppearance();
  const center = 36;
  const sunY = risen ? HORIZON - 4 : HORIZON + 6;

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 72 72">
        <Defs>
          <ClipPath id="streak-sky">
            <Rect x={0} y={0} width={72} height={HORIZON} />
          </ClipPath>
        </Defs>
        <Circle cx={center} cy={center} r={36} fill={theme.warmSurface} />
        <G clipPath="url(#streak-sky)">
          <Circle cx={center} cy={sunY} r={30} fill="none" stroke={theme.accent} strokeOpacity={0.18} strokeWidth={1.5} />
          <Circle cx={center} cy={sunY} r={23} fill="none" stroke={theme.accent} strokeOpacity={0.32} strokeWidth={1.5} />
          <Circle cx={center} cy={sunY} r={13} fill={theme.fill} />
        </G>
        <Line
          x1={14}
          y1={HORIZON}
          x2={58}
          y2={HORIZON}
          stroke={theme.text}
          strokeOpacity={0.55}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <Line
          x1={24}
          y1={HORIZON + 7}
          x2={48}
          y2={HORIZON + 7}
          stroke={theme.text}
          strokeOpacity={0.3}
          strokeWidth={2}
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

function streakLabel(days: number) {
  return days === 1 ? 'day woke up on time' : 'days woke up on time';
}

/** The account sheet's streak card, read from the store's wake occurrences. */
export function StreakCard() {
  const { theme } = useAppearance();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { wakeOccurrences } = useZOZARStore();
  const days = useMemo(() => computeWakeStreak(wakeOccurrences), [wakeOccurrences]);
  const accessibilityLabel = days > 0
    ? `Wake streak: ${days} ${streakLabel(days)}.`
    : 'Wake streak: no days yet. Your streak starts with your next on-time wake-up.';

  return (
    <Arrive>
      <View accessible accessibilityRole="summary" accessibilityLabel={accessibilityLabel} style={styles.card}>
        <StreakBadge risen={days > 0} />
        <View style={styles.copy}>
          {days > 0 ? (
            <>
              <Text style={styles.number}>{days}</Text>
              <Text style={styles.label}>{streakLabel(days)}</Text>
            </>
          ) : (
            <>
              <Text style={styles.label}>Wake streak</Text>
              <Text style={styles.caption}>Your streak starts with your next on-time wake-up.</Text>
            </>
          )}
        </View>
      </View>
    </Arrive>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.surface,
      borderRadius: Radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      padding: Spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.lg,
    },
    copy: { flex: 1 },
    number: { ...Type.clock, fontSize: 48, lineHeight: 52, letterSpacing: -2, color: theme.text },
    label: { ...Type.callout, color: theme.text },
    caption: { ...Type.caption, color: theme.textSecondary, marginTop: Spacing.xs },
  });
}
