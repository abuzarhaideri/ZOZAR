import { useEffect, useMemo, type PropsWithChildren } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, type PressableProps, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Motion } from '@/constants/theme';

/**
 * ZO-ZAR's motion primitives.
 *
 * Three rules, taken from `motion.md › Best practices` and encoded here so screens get
 * them for free rather than re-deciding each time:
 *
 * 1. Motion explains or confirms; it never decorates. Content arriving on screen moves a
 *    short distance in the direction it came from, and a press confirms itself. Nothing
 *    loops, pulses, or draws attention to itself.
 * 2. Motion is never the only signal. Every animated state change here is accompanied by
 *    a change in colour, text or layout, so a user with Reduce Motion enabled loses
 *    nothing but the movement.
 * 3. Motion is never blocking. `motion.md` asks that people be able to cancel it; these
 *    animations run on content that is already interactive, so a tap during an entrance
 *    is handled normally.
 *
 * Reduce Motion is honoured throughout. Per `accessibility.md › Reduce motion`, the
 * response is to *reduce* animation, not remove feedback: transforms are dropped and a
 * cross-fade remains, so an element still reads as having arrived.
 *
 * Everything runs through Reanimated on the UI thread, so animation survives a busy JS
 * thread — which matters most on the Wake screen, where the app is doing real work at the
 * moment the user is least patient.
 */

const standard = Easing.bezier(...Motion.easing.standard);
const decelerate = Easing.bezier(...Motion.easing.decelerate);

/**
 * Fades and lifts content into place.
 *
 * `delay` staggers a list. Callers should cap the stagger with `staggerDelay`, because a
 * long list animating item by item stops being an entrance and becomes a wait.
 */
export function FadeIn({
  children,
  delay = 0,
  distance = Motion.enterOffset,
  duration = Motion.base,
  style,
}: PropsWithChildren<{ delay?: number; distance?: number; duration?: number; style?: ViewStyle }>) {
  const progress = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration, easing: decelerate }));
  }, [delay, duration, progress]);

  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    // With Reduce Motion on, the fade stays and the movement goes.
    transform: reduceMotion ? [] : [{ translateY: (1 - progress.value) * distance }],
  }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/** Caps the stagger so item 30 does not arrive a second and a half late. */
export function staggerDelay(index: number): number {
  return Math.min(index, Motion.maxStaggered) * Motion.stagger;
}

/**
 * A pressable that confirms the touch by scaling slightly.
 *
 * This replaces the `opacity: 0.7` the app used before. Opacity dimming reads as
 * "disabled" as readily as "pressed"; a scale reads as physical. The change is small by
 * design — `motion.md` warns against adding motion to frequent interactions, and a button
 * press is the most frequent interaction there is.
 */
export function PressableScale({
  children,
  style,
  scaleTo = Motion.pressScale,
  ...pressableProps
}: PropsWithChildren<PressableProps & { style?: ViewStyle | ViewStyle[]; scaleTo?: number }>) {
  const pressed = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  const animated = useAnimatedStyle(() => ({
    transform: reduceMotion ? [] : [{ scale: 1 - pressed.value * (1 - scaleTo) }],
    // A small opacity shift remains under Reduce Motion so the press is still confirmed.
    opacity: 1 - pressed.value * (reduceMotion ? 0.25 : 0.1),
  }));

  return (
    <Animated.View style={animated}>
      <Pressable
        {...pressableProps}
        onPressIn={(event) => {
          pressed.value = withTiming(1, { duration: Motion.instant, easing: standard });
          pressableProps.onPressIn?.(event);
        }}
        onPressOut={(event) => {
          pressed.value = withTiming(0, { duration: Motion.fast, easing: standard });
          pressableProps.onPressOut?.(event);
        }}
        style={style}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/**
 * Cross-fades when `value` changes, for a label whose text is replaced in place.
 *
 * Used for things like a countdown or a status line, where a hard swap reads as a glitch.
 * The fade is short enough not to delay the new value being readable.
 */
export function CrossFade({ children, value, style }: PropsWithChildren<{ value: string | number; style?: ViewStyle }>) {
  const progress = useSharedValue(1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    progress.value = 0;
    progress.value = withTiming(1, { duration: Motion.fast, easing: standard });
  }, [value, progress, reduceMotion]);

  const animated = useAnimatedStyle(() => ({ opacity: 0.4 + progress.value * 0.6 }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/**
 * A quiet activity indicator: a bar that fills and recedes.
 *
 * Preferred over a spinner for inline, short waits. It is the one looping animation in the
 * system, so it stops entirely under Reduce Motion and shows a static filled bar, keeping
 * the "something is happening" signal without the repetition `accessibility.md` cautions
 * against.
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
    // cannot invoke an ordinary JS closure. `true` reverses each cycle, giving the
    // fill-and-recede motion without any recursion.
    progress.value = withRepeat(
      withTiming(1, { duration: Motion.slow * 2, easing: standard }),
      -1,
      true,
    );
  }, [progress, reduceMotion]);

  const animated = useAnimatedStyle(() => ({
    width: `${20 + progress.value * 80}%`,
    opacity: reduceMotion ? 0.5 : 0.35 + progress.value * 0.4,
  }));

  const track = useMemo(
    () => ({ height, borderRadius: height, backgroundColor: color, overflow: 'hidden' as const }),
    [color, height],
  );

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]} pointerEvents="none">
      <Animated.View style={[track, animated]} />
    </Animated.View>
  );
}

/** Imperatively announces a change for screen readers, where motion carried the meaning
 * for sighted users. Keeps rule 2 above honest. */
export function announce(message: string): void {
  AccessibilityInfo.announceForAccessibility(message);
}
