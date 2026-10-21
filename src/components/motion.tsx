import { useEffect, type PropsWithChildren } from 'react';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Motion, MinTarget } from '@/constants/theme';

/**
 * ZO-ZAR's motion primitives.
 *
 * Three rules, and the first is the one that gets broken most often:
 *
 * 1. **One orchestrated moment per screen, not motion everywhere.** A fade-and-slide on
 *    every section and a transition on every row is the generic default; it reads as
 *    decoration and, on a screen opened at 06:00, as a delay. Each screen animates its
 *    single most important element arriving, and nothing else moves unprompted.
 * 2. **Motion answers an action, or it explains an arrival.** Never decorates.
 * 3. **Motion is never the only signal.** Every animated change here is accompanied by a
 *    change in colour, text or layout, so Reduce Motion costs nothing but movement.
 *
 * Reduce Motion is honoured throughout, by *reducing* rather than removing: transforms
 * drop and a cross-fade remains, so an element still reads as having arrived.
 *
 * Everything runs through Reanimated on the UI thread, so animation survives a busy JS
 * thread — which matters most on the Wake screen, where the app is doing real work at the
 * moment the user is least patient.
 */

const standard = Easing.bezier(...Motion.easing.standard);
const decelerate = Easing.bezier(...Motion.easing.decelerate);

/**
 * Fades and lifts one element into place.
 *
 * Reserved for a screen's single orchestrated moment. If you are reaching for this on the
 * fourth element of a screen, the screen does not need it.
 */
export function Arrive({
  children,
  delay = 0,
  distance = Motion.enterOffset,
  duration = Motion.base,
  style,
}: PropsWithChildren<{
  delay?: number;
  distance?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}>) {
  const progress = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration, easing: decelerate }));
  }, [delay, duration, progress]);

  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: reduceMotion ? [] : [{ translateY: (1 - progress.value) * distance }],
  }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/**
 * The project's touchable.
 *
 * Feedback is Android's native ripple. AGENTS.md makes Android behaviour authoritative
 * for touch interaction, and the platform's answer to "what happened when I pressed
 * this" is a ripple from the point of contact — not the scale-down that iOS uses and
 * that cross-platform code tends to import by reflex. The ripple also satisfies the
 * stable-interaction rule: it changes colour in place rather than transforming bounds,
 * so nothing around it jitters.
 *
 * On any platform without ripple support, a short opacity change stands in.
 *
 * `hitSlop` defaults to expanding a small control out to the 48dp Android minimum, so an
 * icon drawn at 20px is still comfortably tappable without padding the layout.
 */
export function Touchable({
  children,
  style,
  rippleColor,
  borderless = false,
  expandHitSlop = 0,
  ...pressableProps
}: PropsWithChildren<
  PressableProps & {
    style?: StyleProp<ViewStyle>;
    rippleColor: string;
    borderless?: boolean;
    /** Pixels of invisible touch area to add on every side. */
    expandHitSlop?: number;
  }
>) {
  const slop = expandHitSlop || undefined;

  return (
    <Pressable
      {...pressableProps}
      android_ripple={{ color: rippleColor, borderless }}
      hitSlop={slop}
      style={({ pressed }) => [
        style,
        // Android draws the ripple itself; elsewhere, dim briefly so the press is still
        // confirmed.
        Platform.OS !== 'android' && pressed ? { opacity: 0.72 } : null,
      ]}
    >
      {children}
    </Pressable>
  );
}

/** The minimum comfortable Android target, exported so controls can declare it rather
 * than each re-deriving 48. */
export const minTargetStyle: ViewStyle = { minHeight: MinTarget, minWidth: MinTarget };

/**
 * Cross-fades when a displayed value changes in place.
 *
 * For a countdown or a status line, where swapping the text outright reads as a glitch.
 * Short enough not to delay the new value being readable.
 */
export function CrossFade({
  children,
  value,
  style,
}: PropsWithChildren<{ value: string | number; style?: StyleProp<ViewStyle> }>) {
  const progress = useSharedValue(1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    progress.value = 0;
    progress.value = withTiming(1, { duration: Motion.fast, easing: standard });
  }, [value, progress, reduceMotion]);

  const animated = useAnimatedStyle(() => ({ opacity: 0.45 + progress.value * 0.55 }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/**
 * A quiet indeterminate bar, for short inline waits.
 *
 * Preferred over a spinner because it does not imply a spinning-forever failure state.
 * It is the only looping animation in the system, so under Reduce Motion it stops
 * entirely and shows a static filled bar, keeping the "working" signal without the
 * repetition that accessibility guidance warns about.
 */
export function ProgressPulse({ color, height = 2 }: { color: string; height?: number }) {
  const progress = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    // withRepeat, not a self-calling completion callback: that callback is a worklet and
    // cannot invoke an ordinary JS closure. `true` reverses each cycle.
    progress.value = withRepeat(withTiming(1, { duration: Motion.slow * 2, easing: standard }), -1, true);
  }, [progress, reduceMotion]);

  const animated = useAnimatedStyle(() => ({
    width: `${20 + progress.value * 80}%`,
    opacity: reduceMotion ? 0.5 : 0.35 + progress.value * 0.4,
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]} pointerEvents="none">
      <Animated.View style={[{ height, borderRadius: height, backgroundColor: color }, animated]} />
    </Animated.View>
  );
}

/** Announces a change for screen readers where motion carried the meaning for sighted
 * users. Keeps rule 3 above honest. */
export function announce(message: string): void {
  AccessibilityInfo.announceForAccessibility(message);
}

/**
 * React Native Web colours a Switch's thumb in its "on" state from `activeThumbColor`, a
 * web-only prop missing from React Native's types, and falls back to a teal that clashes
 * with the palette. Spread this onto a Switch; on Android it is an empty object.
 */
export function webActiveThumb(colour: string): object {
  return Platform.OS === 'web' ? { activeThumbColor: colour } : {};
}
