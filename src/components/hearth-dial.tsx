import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G } from 'react-native-svg';

import { useZOZARTheme } from '@/components/zo-zar-ui';
import { clockParts, describeDuration, minutesOf, minutesUntil, nowMinutes, speakDuration, wrapMinutes } from '@/lib/time';
import { Motion, Spacing, Type, type Theme } from '@/constants/theme';

/**
 * The Hearth dial: the home screen's anchor, and a real clock face.
 *
 * Hearth's thesis is that an alarm should feel like a familiar object beside the bed. The
 * most familiar object beside a bed is a clock, so the dial *is* one: a twelve-hour face
 * with the amber arc running from where the hour hand stands now to where your alarm
 * sits. "Seven hours until you wake" stops being a sentence you parse and becomes a shape
 * you see from across the room — the same way you read an analogue clock without
 * counting.
 *
 * Two ways to change the time, deliberately:
 *
 * - **Tap** opens the full alarm. This is the brief's rule and the discoverable path.
 * - **Turn** the dial like a knob. One revolution is one hour, snapping to five minutes,
 *   so a small adjustment at bedtime is a small movement of the thumb. This is the one
 *   addition to the reference, kept because it is the most physical thing a clock
 *   affords, and because the alternative for "ten minutes later" is three screens.
 *
 * The on/off switch is *not* in here. The brief is explicit that it stays outside the
 * dial's tap target, and the reason is the bug that rule prevents: a toggle nested in a
 * pressable fires both, and turning an alarm off would also throw the editor open.
 *
 * The ember behind the face breathes over seven seconds. It is the warmth in "warm and
 * welcoming", and it is fenced the same way the night sky is: it carries no information,
 * Reduce Motion holds it still, and it never appears on the screen that rings.
 */

const SIZE = 252;
const CENTRE = SIZE / 2;
const TRACK_RADIUS = 104;
const TRACK_WIDTH = 5;
const CIRCUMFERENCE = 2 * Math.PI * TRACK_RADIUS;
/** One full turn of the knob is an hour. Faster than that and a nudge overshoots. */
const MINUTES_PER_DEGREE = 60 / 360;
const SNAP = 5;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Position on a twelve-hour face, in degrees clockwise from twelve o'clock. */
function faceAngle(minutesOfDay: number) {
  return ((wrapMinutes(minutesOfDay) % 720) / 720) * 360;
}

function pointOnFace(degrees: number, radius: number) {
  const radians = (degrees * Math.PI) / 180;
  return { x: CENTRE + radius * Math.sin(radians), y: CENTRE - radius * Math.cos(radians) };
}

function angleOfTouch(x: number, y: number) {
  'worklet';
  const degrees = (Math.atan2(x - CENTRE, CENTRE - y) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

/** The slow ember behind the face. Concentric, solid, low-alpha: warmth without a gradient. */
function Ember({ theme }: { theme: Theme }) {
  const reduced = useReducedMotion();
  const breath = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      breath.value = 0.5;
      return;
    }
    breath.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 3500, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 3500, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
  }, [breath, reduced]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.55 + breath.value * 0.45,
    transform: [{ scale: 1 + breath.value * 0.035 }],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Svg width={SIZE} height={SIZE}>
        <Circle cx={CENTRE} cy={CENTRE} r={124} fill={theme.fill} opacity={0.035} />
        <Circle cx={CENTRE} cy={CENTRE} r={116} fill={theme.fill} opacity={0.04} />
        <Circle cx={CENTRE} cy={CENTRE} r={109} fill={theme.fill} opacity={0.045} />
      </Svg>
    </Animated.View>
  );
}

export function HearthDial({
  time,
  label,
  detail,
  enabled = true,
  onPress,
  onCommitMinutes,
}: {
  /** "HH:MM", or null when there is no alarm to show. */
  time: string | null;
  /** The line above the time: "Tomorrow's wake-up". */
  label: string;
  /** The line below it: the repeat rule. */
  detail?: string;
  enabled?: boolean;
  onPress: () => void;
  /** Called once, on release, with the new minutes-of-day. */
  onCommitMinutes?: (minutes: number) => void;
}) {
  const { theme } = useZOZARTheme();
  const local = useMemo(() => makeStyles(theme), [theme]);
  const reduced = useReducedMotion();

  const committed = time ? minutesOf(time) : null;
  const [preview, setPreview] = useState<number | null>(null);
  const [now, setNow] = useState(() => nowMinutes());

  // The arc starts at the hour hand, so it has to move with it. Once a minute is enough:
  // the arc's start moves half a degree per minute, below anything the eye can see.
  useEffect(() => {
    const timer = setInterval(() => setNow(nowMinutes()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const shown = committed === null ? null : wrapMinutes(committed + (preview ?? 0));
  const until = shown === null ? 0 : minutesUntil(shown, now);
  const sweep = Math.min(until, 720) / 720;
  const startAngle = faceAngle(now);
  const markerAngle = shown === null ? 0 : faceAngle(shown);
  const marker = pointOnFace(markerAngle, TRACK_RADIUS);

  // The arc draws in once, when the screen arrives: the screen's single orchestrated
  // moment. Under Reduce Motion it is simply there.
  const drawn = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    drawn.value = reduced ? 1 : withTiming(1, { duration: 720, easing: Easing.bezier(...Motion.easing.decelerate) });
  }, [drawn, reduced]);

  const arcProps = useAnimatedProps(
    () => ({ strokeDashoffset: CIRCUMFERENCE * (1 - sweep * drawn.value) }),
    [sweep],
  );

  // Gesture plumbing. Callbacks go through refs because the gestures are memoised and the
  // parent passes inline arrows; a memoised gesture would otherwise hold the first ones.
  const pressRef = useRef(onPress);
  pressRef.current = onPress;
  const commitRef = useRef(onCommitMinutes);
  commitRef.current = onCommitMinutes;

  const lastAngle = useSharedValue(0);
  const turned = useSharedValue(0);
  const snapped = useSharedValue(0);

  function commit(delta: number) {
    setPreview(null);
    if (delta !== 0 && committed !== null) commitRef.current?.(wrapMinutes(committed + delta));
  }
  function clear() {
    setPreview(null);
  }
  function open() {
    pressRef.current();
  }

  const canTurn = committed !== null && Boolean(onCommitMinutes);

  const gesture = useMemo(() => {
    const turn = Gesture.Pan()
      .enabled(canTurn)
      .minDistance(6)
      .onBegin((event) => {
        lastAngle.value = angleOfTouch(event.x, event.y);
        turned.value = 0;
        snapped.value = 0;
      })
      .onUpdate((event) => {
        const angle = angleOfTouch(event.x, event.y);
        let delta = angle - lastAngle.value;
        // Crossing twelve o'clock jumps 359° in one frame; unwrap it to the short way round.
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        lastAngle.value = angle;
        turned.value += delta;
        const next = Math.round((turned.value * MINUTES_PER_DEGREE) / SNAP) * SNAP;
        if (next !== snapped.value) {
          snapped.value = next;
          runOnJS(setPreview)(next);
        }
      })
      .onEnd(() => {
        runOnJS(commit)(snapped.value);
      })
      .onFinalize(() => {
        // onEnd does not run on a cancelled gesture; without this the preview would stay
        // on the face showing a time that was never saved.
        snapped.value = 0;
        runOnJS(clear)();
      });

    // A tap is a gesture too, composed with Exclusive. A Pressable nested inside the
    // detector would see the click at the end of a turn and open the editor as well.
    const tap = Gesture.Tap()
      .maxDuration(300)
      .onEnd((_event, success) => {
        if (success) runOnJS(open)();
      });

    return Gesture.Exclusive(turn, tap);
    // commit/clear/open read refs or setters; rebuilding on `committed` keeps commit's base current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canTurn, committed]);

  const parts = shown === null ? null : clockParts(shown);
  const turning = preview !== null;

  const spoken =
    parts === null
      ? 'No alarm set. Double tap to set one.'
      : `${label}, ${parts.spoken}. ${enabled ? `In ${speakDuration(until)}.` : 'The alarm is off.'}`;

  return (
    <View style={local.wrap}>
      <GestureDetector gesture={gesture}>
        <View
          style={local.face}
          accessible
          accessibilityRole={canTurn ? 'adjustable' : 'button'}
          accessibilityLabel={spoken}
          accessibilityValue={parts ? { text: parts.spoken } : undefined}
          accessibilityHint={
            canTurn
              ? 'Swipe up or down to move the alarm by five minutes. Double tap to open the alarm.'
              : 'Double tap to open the alarm.'
          }
          accessibilityActions={
            canTurn
              ? [
                  { name: 'increment', label: 'Five minutes later' },
                  { name: 'decrement', label: 'Five minutes earlier' },
                  { name: 'activate', label: 'Open the alarm' },
                ]
              : [{ name: 'activate', label: 'Open the alarm' }]
          }
          onAccessibilityAction={(event) => {
            const action = event.nativeEvent.actionName;
            if (action === 'increment') commit(SNAP);
            if (action === 'decrement') commit(-SNAP);
            if (action === 'activate') open();
          }}
        >
          {enabled && parts ? <Ember theme={theme} /> : null}

          <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill} pointerEvents="none">
            {/* The bezel. */}
            <Circle cx={CENTRE} cy={CENTRE} r={CENTRE - 1} stroke={theme.line} strokeWidth={1} fill="none" />
            {/* Twelve hour ticks, so the face reads as a clock and the arc as time on it. */}
            {Array.from({ length: 12 }, (_, hour) => {
              const outer = pointOnFace(hour * 30, TRACK_RADIUS + 13);
              const inner = pointOnFace(hour * 30, TRACK_RADIUS + (hour % 3 === 0 ? 7 : 9));
              return (
                <Circle
                  key={hour}
                  cx={(outer.x + inner.x) / 2}
                  cy={(outer.y + inner.y) / 2}
                  r={hour % 3 === 0 ? 1.6 : 1}
                  fill={theme.lineStrong}
                />
              );
            })}
            {/* The track. */}
            <Circle
              cx={CENTRE}
              cy={CENTRE}
              r={TRACK_RADIUS}
              stroke={theme.surface}
              strokeWidth={TRACK_WIDTH}
              fill="none"
            />
            {/* Now → alarm, on a twelve-hour face. */}
            {parts && enabled ? (
              <G transform={`rotate(${startAngle - 90} ${CENTRE} ${CENTRE})`}>
                <AnimatedCircle
                  cx={CENTRE}
                  cy={CENTRE}
                  r={TRACK_RADIUS}
                  stroke={theme.fill}
                  strokeWidth={TRACK_WIDTH}
                  strokeLinecap="round"
                  fill="none"
                  strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
                  animatedProps={arcProps}
                />
              </G>
            ) : null}
            {/* The hand: where the alarm sits on the face. */}
            {parts ? (
              <Circle
                cx={marker.x}
                cy={marker.y}
                r={turning ? 10 : 8}
                fill={enabled ? theme.fill : theme.surfaceStrong}
                stroke={theme.background}
                strokeWidth={3}
              />
            ) : null}
          </Svg>

          <View style={local.centre} pointerEvents="none">
            {parts ? (
              <>
                <Text style={local.label}>{turning ? 'Release to set' : label}</Text>
                <Text style={[local.time, !enabled && local.timeOff]} maxFontSizeMultiplier={1.25}>
                  {parts.digits}
                  {parts.period ? <Text style={local.period}> {parts.period}</Text> : null}
                </Text>
                {detail ? (
                  <Text style={local.detail} numberOfLines={1}>
                    {enabled ? detail : 'Off'}
                  </Text>
                ) : null}
                <Text style={local.hint}>{turning ? describeDuration(until) + ' from now' : 'Tap to edit'}</Text>
              </>
            ) : (
              <>
                <Text style={local.emptyTitle}>No alarm</Text>
                <Text style={local.hint}>Tap to set one</Text>
              </>
            )}
          </View>
        </View>
      </GestureDetector>
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: { alignItems: 'center', marginTop: Spacing.xl, marginBottom: Spacing.md },
    face: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
    centre: { alignItems: 'center', paddingHorizontal: Spacing.xl, maxWidth: TRACK_RADIUS * 2 - 24 },
    label: { ...Type.label, color: theme.textSecondary, textAlign: 'center' },
    time: {
      ...Type.clock,
      fontSize: 52,
      lineHeight: 58,
      letterSpacing: -2.5,
      color: theme.text,
      marginTop: Spacing.xs,
      textAlign: 'center',
    },
    timeOff: { color: theme.subtle },
    period: { ...Type.callout, fontSize: 16, letterSpacing: 0, color: theme.textSecondary },
    detail: { ...Type.caption, color: theme.textSecondary, marginTop: 2, textAlign: 'center' },
    hint: { ...Type.caption, color: theme.subtle, marginTop: Spacing.xs, textAlign: 'center' },
    emptyTitle: { ...Type.title, color: theme.text, textAlign: 'center' },
  });
