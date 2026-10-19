import { useMemo, useState, type PropsWithChildren, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Touchable } from '@/components/motion';
import { Icon, Icons, useZOZARTheme } from '@/components/zo-zar-ui';
import { IconSize, Motion, Radius, Spacing, Type, type Theme } from '@/constants/theme';

/**
 * The night spine.
 *
 * ZO-ZAR has always *been* a timeline and the old design hid it behind a dashboard. One
 * night runs: you go to bed, you sleep, the alarm rings, you confirm — and if you do not
 * confirm, the person you chose is told. That is a sequence with a handoff at the end,
 * and four tabs full of buttons were the wrong shape for it.
 *
 * The model is Structured's: a continuous rail, times in a fixed left gutter, and blocks
 * whose **height is their duration**. The payoff here is the grace window. "15 minutes to
 * confirm" is an abstraction in a settings row; as a block you can see the length of,
 * sitting between the alarm and the moment your friend's phone buzzes, it is the clearest
 * statement the product can make about what it actually does.
 *
 * Two departures from Structured, both because a night is not a workday:
 *
 * - **The sleep gap is compressed.** Eight hours at a readable scale is 550px of empty
 *   rail. The gap collapses to a fixed height with a broken rail and states its real
 *   duration in words, so nothing is misrepresented — the only thing lost is scrolling
 *   through nothing. Proportionality is kept where it informs and dropped where it
 *   only costs.
 * - **The wake block is draggable.** It is the one value worth making physical, and the
 *   gesture replaces a screen, a time picker and two buttons.
 */

/** Pixels per minute in the parts of the night drawn to scale. */
const PX_PER_MINUTE = 1.15;
/** Drag resolution. Minute-accurate dragging is a tremor test, not a control. */
const SNAP_MINUTES = 5;
const MIN_BLOCK = 76;
const MAX_BLOCK = 208;

const GUTTER = 52;
const RAIL = 38;
/** Where the rail sits inside its column, so segments and nodes share one centre line. */
const RAIL_CENTRE = RAIL / 2;

export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map((part) => Number.parseInt(part, 10));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
  return hours * 60 + minutes;
}

export function formatMinutes(total: number): string {
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** "7h 20m", "45m". Used for durations spoken about, never for clock times. */
export function describeDuration(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

export function Spine({ children }: PropsWithChildren) {
  return <View style={styles.spine}>{children}</View>;
}

type StopTone = 'now' | 'quiet' | 'done' | 'alert';

/**
 * One moment on the rail.
 *
 * The rail segment is drawn by each stop rather than once behind all of them, because
 * stops have different heights and a single absolutely-positioned line would need to
 * measure them. Stacked segments join seamlessly; `first` and `last` trim the ends so the
 * line does not escape the timeline.
 */
export function Stop({
  time,
  title,
  detail,
  tone = 'quiet',
  icon,
  trailing,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
  first = false,
  last = false,
}: {
  time?: string;
  title: string;
  detail?: string;
  tone?: StopTone;
  icon?: (typeof Icons)[keyof typeof Icons];
  trailing?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  first?: boolean;
  last?: boolean;
}) {
  const { theme } = useZOZARTheme();
  const local = useMemo(() => makeStyles(theme), [theme]);

  const nodeColour =
    tone === 'now' ? theme.text : tone === 'alert' ? theme.accent : tone === 'done' ? theme.subtle : theme.lineStrong;

  const body = (
    <View style={local.row}>
      <View style={local.gutter}>
        {time ? <Text style={[local.time, tone === 'done' && local.timeDone]}>{time}</Text> : null}
      </View>

      <View style={local.rail}>
        <View style={[local.segment, first && local.segmentFromNode, last && local.segmentToNode]} />
        <View
          style={[
            local.node,
            { borderColor: nodeColour },
            tone === 'now' && { backgroundColor: theme.text },
            tone === 'done' && { backgroundColor: theme.surfaceStrong },
          ]}
        >
          {icon ? <Icon as={icon} size={12} color={nodeColour} /> : null}
        </View>
      </View>

      <View style={local.content}>
        <Text style={[local.title, tone === 'done' && local.titleDone]} numberOfLines={2}>
          {title}
        </Text>
        {detail ? <Text style={local.detail}>{detail}</Text> : null}
      </View>

      {trailing ? <View style={local.trailing}>{trailing}</View> : null}
    </View>
  );

  if (!onPress && !onLongPress) return body;

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${title}${time ? `, ${time}` : ''}`}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      onLongPress={onLongPress}
      rippleColor={theme.surfaceStrong}
    >
      {body}
    </Touchable>
  );
}

/**
 * The hours nobody looks at.
 *
 * Drawn as a broken rail at a fixed height with the real duration stated in words. The
 * compression is visible — a dotted line reads as "something omitted here" in a way a
 * short solid line would not, which is what keeps this honest rather than merely tidy.
 */
export function SleepGap({ minutes }: { minutes: number }) {
  const { theme } = useZOZARTheme();
  const local = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View
      style={local.row}
      accessible
      accessibilityLabel={`${describeDuration(minutes)} of sleep before your alarm`}
    >
      <View style={local.gutter} />
      <View style={[local.rail, local.gapRail]}>
        {[0, 1, 2, 3, 4].map((index) => (
          <View key={index} style={local.gapDash} />
        ))}
      </View>
      <View style={[local.content, local.gapContent]}>
        <Text style={local.gapLabel}>{describeDuration(minutes)} of sleep</Text>
      </View>
    </View>
  );
}

/**
 * The alarm and its grace window, as one object you can grab.
 *
 * Height is `graceMinutes` to scale (clamped, so a 2-minute window is still a target and
 * a 60-minute one does not take the screen). `progress` fills it from the top while the
 * window is actually running, which is the same device Structured uses for a task in
 * flight: you read how much is left as a shape, before reading any number.
 *
 * Accessibility is not an afterthought on a dragged control. The block is an `adjustable`
 * with increment/decrement actions, so TalkBack users change the time by swiping up and
 * down — the same mental model, no gesture precision required. Tapping opens the full
 * editor, which is also the discoverable path for anyone who never thinks to drag.
 */
export function WakeBlock({
  time,
  graceMinutes,
  guardian,
  progress = 0,
  ringing = false,
  onCommitMinutes,
  onPress,
}: {
  time: string;
  graceMinutes: number;
  guardian?: string;
  progress?: number;
  ringing?: boolean;
  onCommitMinutes: (minutes: number) => void;
  onPress?: () => void;
}) {
  const { theme } = useZOZARTheme();
  const local = useMemo(() => makeStyles(theme), [theme]);

  const base = minutesOf(time);
  const height = Math.min(MAX_BLOCK, Math.max(MIN_BLOCK, graceMinutes * PX_PER_MINUTE));

  const offset = useSharedValue(0);
  const lifted = useSharedValue(0);
  const snapped = useSharedValue(0);
  const [preview, setPreview] = useState<number | null>(null);

  function commit(delta: number) {
    setPreview(null);
    if (delta !== 0) onCommitMinutes(((base + delta) % 1440 + 1440) % 1440);
  }

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Below this, a press that wobbles would start dragging the alarm. Above it, the
        // gesture feels sticky. It also leaves taps unambiguous without an Exclusive().
        .minDistance(8)
        .onBegin(() => {
          lifted.value = withTiming(1, { duration: Motion.instant });
        })
        .onUpdate((event) => {
          const step = PX_PER_MINUTE * SNAP_MINUTES;
          const next = Math.round(event.translationY / step) * SNAP_MINUTES;
          offset.value = next * PX_PER_MINUTE;
          if (next !== snapped.value) {
            snapped.value = next;
            // Only on a snap boundary, not every frame: a per-frame hop onto the JS
            // thread during a drag is how a gesture starts dropping frames.
            runOnJS(setPreview)(next);
          }
        })
        .onEnd(() => {
          runOnJS(commit)(snapped.value);
        })
        .onFinalize(() => {
          offset.value = withTiming(0, { duration: Motion.fast });
          lifted.value = withTiming(0, { duration: Motion.fast });
          snapped.value = 0;
        }),
    // `commit` closes over `base`, so the gesture is rebuilt when the committed time moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, lifted, offset, snapped],
  );

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
    opacity: 1 - lifted.value * 0.08,
  }));

  const shown = preview === null ? time : formatMinutes(base + preview);
  const handoff = formatMinutes(minutesOf(shown) + graceMinutes);
  const dragging = preview !== null;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={dragStyle}>
        <Touchable
          accessibilityRole="adjustable"
          accessibilityLabel={`Wake at ${shown}`}
          accessibilityValue={{ text: shown }}
          accessibilityHint="Swipe up or down to move the alarm in five-minute steps. Double tap to open the full alarm."
          accessibilityActions={[
            { name: 'increment', label: 'Five minutes later' },
            { name: 'decrement', label: 'Five minutes earlier' },
          ]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') commit(SNAP_MINUTES);
            if (event.nativeEvent.actionName === 'decrement') commit(-SNAP_MINUTES);
          }}
          onPress={onPress}
          rippleColor={theme.surfaceStrong}
        >
          <View style={local.row}>
            <View style={local.gutter}>
              <Text style={[local.time, local.timeLoud]}>{shown}</Text>
            </View>

            <View style={local.rail}>
              <View style={local.segment} />
              <View style={[local.block, { height }, dragging && { borderColor: theme.accent }]}>
                <View
                  style={[
                    local.blockFill,
                    { height: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` },
                  ]}
                />
                <View style={local.blockCap} />
              </View>
            </View>

            <View style={[local.content, { minHeight: height }]}>
              <Text style={local.blockTitle}>{ringing ? 'Ringing now' : 'Wake up'}</Text>
              <Text style={local.detail}>
                {dragging ? 'Release to set' : 'Hold and drag to move'}
              </Text>
              <View style={local.blockFoot}>
                <Text style={local.graceLabel}>
                  {describeDuration(graceMinutes)} to confirm, until {handoff}
                </Text>
              </View>
            </View>
          </View>

          <View style={local.row}>
            <View style={local.gutter}>
              <Text style={local.time}>{handoff}</Text>
            </View>
            <View style={local.rail}>
              <View style={local.segment} />
              <View style={[local.node, { borderColor: guardian ? theme.warm : theme.lineStrong }]}>
                <Icon as={guardian ? Icons.users : Icons.userPlus} size={12} color={guardian ? theme.warm : theme.subtle} />
              </View>
            </View>
            <View style={local.content}>
              <Text style={local.title}>
                {guardian ? `${guardian} is told` : 'Nobody is told'}
              </Text>
              <Text style={local.detail}>
                {guardian
                  ? 'Only if you have not confirmed by then.'
                  : 'Add someone and this alarm starts meaning something.'}
              </Text>
            </View>
          </View>
        </Touchable>
      </Animated.View>
    </GestureDetector>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'stretch', minHeight: 56 },

    gutter: { width: GUTTER, paddingTop: 1, alignItems: 'flex-end', paddingRight: Spacing.sm },
    time: { ...Type.clockRow, color: theme.subtle },
    timeLoud: { ...Type.clockRow, color: theme.accent },
    timeDone: { color: theme.subtle, textDecorationLine: 'line-through' },

    rail: { width: RAIL, alignItems: 'center' },
    segment: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: RAIL_CENTRE - 0.5,
      width: 1,
      backgroundColor: theme.line,
    },
    segmentFromNode: { top: 10 },
    segmentToNode: { bottom: 10 },

    node: {
      width: 20,
      height: 20,
      borderRadius: Radius.pill,
      borderWidth: 1.5,
      backgroundColor: theme.background,
      alignItems: 'center',
      justifyContent: 'center',
    },

    content: { flex: 1, paddingLeft: Spacing.md, paddingBottom: Spacing.xl },
    title: { ...Type.callout, color: theme.text },
    titleDone: { color: theme.subtle, textDecorationLine: 'line-through' },
    detail: { ...Type.caption, color: theme.subtle, marginTop: 2 },
    trailing: { justifyContent: 'flex-start', paddingLeft: Spacing.sm },

    gapRail: { justifyContent: 'space-between', paddingVertical: Spacing.sm },
    gapDash: { width: 1, height: 5, backgroundColor: theme.lineStrong, opacity: 0.6 },
    gapContent: { justifyContent: 'center', paddingBottom: 0, minHeight: 92 },
    gapLabel: { ...Type.caption, color: theme.subtle },

    /** The alarm itself: an amber capsule as tall as its grace window. */
    block: {
      width: 26,
      borderRadius: Radius.card,
      borderWidth: 1.5,
      borderColor: theme.warm,
      backgroundColor: theme.warmSurface,
      overflow: 'hidden',
      justifyContent: 'flex-start',
    },
    /** Fills downward as the window runs out. */
    blockFill: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: theme.accent, opacity: 0.85 },
    /** The ring itself — a solid amber head on the capsule, so the start is unambiguous. */
    blockCap: { height: 7, backgroundColor: theme.accent, borderRadius: Radius.pill, margin: 3 },

    blockTitle: { ...Type.heading, color: theme.text },
    blockFoot: { marginTop: 'auto', paddingTop: Spacing.md },
    graceLabel: { ...Type.caption, color: theme.warm },
  });

const styles = StyleSheet.create({
  spine: { marginTop: Spacing.xl },
});

export { IconSize };
