import { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import type { Theme } from '@/constants/theme';

/**
 * The bedtime surface. ZO-ZAR's one piece of atmosphere.
 *
 * This is the single place in the app where motion is allowed to be ambient rather than
 * informational, and it is deliberately fenced to the top of the night spine — the
 * bedtime end, looked at while winding down, never while deciding anything. Everything
 * below it is still.
 *
 * The approach is Endel's: layered silhouettes with a lit hairline along each crest,
 * slow particle fall, and film grain over the whole thing. Three details matter for it
 * to read as atmosphere instead of as a decorative header:
 *
 * 1. **It is slower than you expect.** The nearest layer takes 48 seconds to cross; the
 *    furthest takes two and a half minutes. Anything quick enough to watch is
 *    decoration, and the brief for this surface is the opposite of attention-getting.
 * 2. **The layers are near-invisible.** Each sits a few percent off the background, with
 *    a hairline crest doing almost all the work. The depth comes from the hairlines
 *    disagreeing about where the horizon is, not from contrast.
 * 3. **Nothing here carries information.** It never indicates state, so Reduce Motion
 *    can stop all of it and no meaning is lost — the layers simply hold still.
 *
 * Why it is drawn rather than shipped as an image: AGENTS.md forbids decorative
 * photography and gradients, the art has to recolour with the theme, and an asset that
 * covered the top third of a screen at 3× would cost more than the few hundred bytes of
 * path data here.
 */

/** Horizontal travel is a transform on the wrapping view, so it never re-renders the SVG. */
const OVERSCAN = 1.7;

/**
 * Samples a sum of two sines into a closed path.
 *
 * Two frequencies rather than one: a single sine reads as a graphic pattern, where two
 * that do not share a period never quite repeat across the width and read as a landscape.
 */
function crestPath(width: number, height: number, crest: number, amplitude: number, periods: number, phase: number) {
  const steps = 72;
  const points: string[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const fraction = index / steps;
    const x = fraction * width;
    const primary = Math.sin(fraction * Math.PI * 2 * periods + phase);
    const secondary = Math.sin(fraction * Math.PI * 2 * periods * 1.73 + phase * 1.4) * 0.38;
    const y = crest + (primary + secondary) * amplitude;
    points.push(`${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return {
    crest: points.join(' '),
    filled: `${points.join(' ')} L${width.toFixed(1)} ${height} L0 ${height} Z`,
  };
}

/**
 * Deterministic pseudo-randomness.
 *
 * Grain and particles must not move when the component re-renders — new positions on
 * every state change would read as flicker, which is exactly the failure mode this
 * surface cannot have. A seeded generator keeps every speck where it was.
 */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

type LayerSpec = { crest: number; amplitude: number; periods: number; phase: number; opacity: number; seconds: number };

const LAYERS: LayerSpec[] = [
  { crest: 0.46, amplitude: 0.055, periods: 1.2, phase: 0.0, opacity: 0.1, seconds: 150 },
  { crest: 0.62, amplitude: 0.045, periods: 1.6, phase: 2.1, opacity: 0.16, seconds: 96 },
  { crest: 0.79, amplitude: 0.038, periods: 2.1, phase: 4.3, opacity: 0.24, seconds: 48 },
];

function Layer({ spec, width, height, theme }: { spec: LayerSpec; width: number; height: number; theme: Theme }) {
  const reduced = useReducedMotion();
  const drift = useSharedValue(0);
  const span = width * (OVERSCAN - 1);

  useEffect(() => {
    if (reduced) {
      drift.value = 0;
      return;
    }
    drift.value = 0;
    drift.value = withRepeat(
      withTiming(-span, { duration: spec.seconds * 1000, easing: Easing.linear }),
      -1,
      false,
    );
  }, [drift, reduced, span, spec.seconds]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: drift.value }] }));
  const paths = useMemo(
    () => crestPath(width * OVERSCAN, height, height * spec.crest, height * spec.amplitude, spec.periods, spec.phase),
    [height, spec.amplitude, spec.crest, spec.periods, spec.phase, width],
  );

  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Svg width={width * OVERSCAN} height={height}>
        <Path d={paths.filled} fill={theme.text} opacity={spec.opacity * 0.5} />
        <Path d={paths.crest} stroke={theme.text} strokeWidth={1} fill="none" opacity={spec.opacity + 0.18} />
      </Svg>
    </Animated.View>
  );
}

/** Slow vertical fall, offset per column so the field never pulses in unison. */
function Particles({ width, height, theme }: { width: number; height: number; theme: Theme }) {
  const reduced = useReducedMotion();
  const fall = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      fall.value = 0;
      return;
    }
    fall.value = 0;
    fall.value = withRepeat(withTiming(height, { duration: 34_000, easing: Easing.linear }), -1, false);
  }, [fall, height, reduced]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: fall.value }] }));

  const specks = useMemo(() => {
    const random = seeded(90210);
    return Array.from({ length: 26 }, () => ({
      x: random() * width,
      y: random() * height - height,
      length: 3 + random() * 7,
      opacity: 0.1 + random() * 0.26,
    }));
  }, [height, width]);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Svg width={width} height={height * 2}>
        {specks.map((speck, index) => (
          <Rect
            key={index}
            x={speck.x}
            y={speck.y + height}
            width={1}
            height={speck.length}
            fill={theme.text}
            opacity={speck.opacity}
          />
        ))}
      </Svg>
    </Animated.View>
  );
}

/**
 * Film grain.
 *
 * Static, and the only part of this that is not animated — moving grain is television
 * static, which is agitation rather than calm. Its job is to stop the flat fills reading
 * as vector art.
 */
function Grain({ width, height, theme }: { width: number; height: number; theme: Theme }) {
  const specks = useMemo(() => {
    const random = seeded(1312);
    return Array.from({ length: 210 }, () => ({
      x: random() * width,
      y: random() * height,
      size: random() > 0.82 ? 2 : 1,
      opacity: 0.03 + random() * 0.07,
    }));
  }, [height, width]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height}>
        {specks.map((speck, index) => (
          <Rect
            key={index}
            x={speck.x}
            y={speck.y}
            width={speck.size}
            height={speck.size}
            fill={theme.text}
            opacity={speck.opacity}
          />
        ))}
      </Svg>
    </View>
  );
}

/**
 * @param height How tall the field is. The waves scale to it, so a short header and a
 *   full-bleed panel both stay in proportion rather than cropping.
 */
export function NightSky({ theme, height = 240 }: { theme: Theme; height?: number }) {
  const { width } = useWindowDimensions();

  return (
    <View
      style={[styles.container, { height }]}
      pointerEvents="none"
      // Purely atmospheric: nothing here is announced, because there is nothing to say.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {LAYERS.map((spec) => (
        <Layer key={spec.crest} spec={spec} width={width} height={height} theme={theme} />
      ))}
      <Particles width={width} height={height} theme={theme} />
      <Grain width={width} height={height} theme={theme} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', left: 0, right: 0, top: 0, overflow: 'hidden' },
});
