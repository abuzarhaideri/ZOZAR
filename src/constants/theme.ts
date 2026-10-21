import { Platform, type TextStyle } from 'react-native';

/**
 * ZO-ZAR's semantic palette — Hearth.
 *
 * Hearth's thesis is that an alarm should feel like a familiar object beside the bed. The
 * night mode is a dark olive-charcoal and the day mode a warm limestone, so the two read
 * as the same object under lamplight and under daylight rather than as two products.
 *
 * Values are taken verbatim from the Hearth row of the design brief
 * (design-exports/ZO-ZAR-design-review/Design-brief-and-Claude-prompt.md). Where the
 * brief is silent — hairlines, error states, selected rows — values are derived on the
 * same olive axis and verified rather than invented on a different one.
 *
 * Amber is reserved for selected and primary actions. It is not decoration, and it is
 * not a status colour; if something is amber, it is something you can press or something
 * that is currently chosen.
 *
 * `fill` / `onFill` are the primary button. They are deliberately the same in both
 * appearances — a gold button with dark ink — because the brief specifies it that way and
 * because a primary action that changes colour between day and night is harder to find
 * half-asleep. `accent` is amber used as *text*, which does change: #E7BB72 is unreadable
 * on limestone, so light mode deepens it to #82500C.
 *
 * Every foreground/background pair is checked by `npm run verify:contrast`.
 */
export const Colors = {
  dark: {
    background: '#1C1C19',
    surface: '#292923',
    surfaceStrong: '#34342D',
    backgroundElement: '#292923',
    backgroundSelected: '#3A3324',

    text: '#F3EDDF',
    textSecondary: '#B7B2A4',
    muted: '#B7B2A4',
    subtle: '#A29D90',

    // `line` is decorative. `lineStrong` outlines controls and must clear 3:1.
    line: '#424239',
    lineStrong: '#77736A',

    accent: '#E7BB72',
    accentContrast: '#292319',
    fill: '#E7BB72',
    onFill: '#292319',

    inverseSurface: '#F3EDDF',
    inverseText: '#282820',
    inverseTextSecondary: '#5C5849',
    inverseLine: '#D3CCBC',

    success: '#9CCB94',
    successSurface: '#25301F',
    warning: '#E7BB72',
    warningSurface: '#332C1D',
    error: '#EE9A86',
    errorSurface: '#36231D',

    warm: '#E7BB72',
    warmSurface: '#332C1D',

    focus: '#E7BB72',
    scrim: 'rgba(12, 12, 10, 0.72)',
  },

  light: {
    background: '#F6F0E4',
    surface: '#EAE2D4',
    surfaceStrong: '#E6DDCC',
    backgroundElement: '#EAE2D4',
    backgroundSelected: '#F1DDB3',

    text: '#282820',
    textSecondary: '#666253',
    muted: '#666253',
    subtle: '#615D4F',

    line: '#D3CCBC',
    lineStrong: '#7C7768',

    accent: '#82500C',
    accentContrast: '#FFF8EC',
    fill: '#E7BB72',
    onFill: '#292319',

    inverseSurface: '#282820',
    inverseText: '#F3EDDF',
    inverseTextSecondary: '#B7B2A4',
    inverseLine: '#424239',

    success: '#2D5E2A',
    successSurface: '#DFE6CF',
    warning: '#7A4D0D',
    warningSurface: '#F1E2C3',
    error: '#9A3524',
    errorSurface: '#F3DDD3',

    warm: '#82500C',
    warmSurface: '#F1E2C3',

    focus: '#82500C',
    scrim: 'rgba(40, 40, 32, 0.46)',
  },
} as const;

export type Theme = { readonly [key in keyof typeof Colors.dark]: string };
export type ThemeColor = keyof Theme;

export const Fonts = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semibold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  mono: Platform.select({ ios: 'ui-monospace', android: 'monospace', default: 'ui-monospace' }),
  sans: 'Manrope_400Regular',
} as const;

/**
 * Type scale.
 *
 * Named by role rather than size, so a screen asks for a "page title" and cannot invent a
 * 34px heading that exists nowhere else. Alarm times use `tabular` with
 * `fontVariant: ['tabular-nums']`, so digits do not jitter as a clock ticks.
 */
export const Type = {
  display: { fontFamily: Fonts.bold, fontSize: 40, lineHeight: 46, letterSpacing: -1.2 },
  /** Hearth's page heading: large, semibold, tight. "A softer start." */
  title: { fontFamily: Fonts.semibold, fontSize: 30, lineHeight: 34, letterSpacing: -1.1 },
  heading: { fontFamily: Fonts.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  body: { fontFamily: Fonts.regular, fontSize: 16, lineHeight: 24 },
  callout: { fontFamily: Fonts.medium, fontSize: 15, lineHeight: 22 },
  /** Button and control text. */
  action: { fontFamily: Fonts.semibold, fontSize: 15, lineHeight: 20 },
  caption: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18 },
  /**
   * Section labels, in sentence case.
   *
   * These were tracked-out uppercase. A tracked ALL-CAPS label above every heading is one
   * of the most reliable tells of generated design, and it costs legibility twice over:
   * uppercase removes the word-shape that makes text scannable, and it is read here in
   * the dark by someone barely awake. Sentence case at a quiet weight says the same thing
   * without shouting.
   */
  label: { fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18, letterSpacing: 0 },

  /**
   * The clock. This is where the design spends its boldness.
   *
   * A wake time is the one piece of information that matters on this screen, and it is
   * read half asleep in a dark room. It is set enormous, tight, and tabular: without
   * tabular figures the digits change width as the minutes tick and the whole number
   * shifts, which reads as a glitch rather than a clock.
   */
  clock: {
    fontFamily: Fonts.bold,
    fontSize: 60,
    lineHeight: 64,
    letterSpacing: -3,
    fontVariant: ['tabular-nums'] as TextStyle['fontVariant'],
  },
  clockSmall: {
    fontFamily: Fonts.semibold,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'] as TextStyle['fontVariant'],
  },
  /** Times inside list rows, where the row label carries the meaning and the time is the
   * value being scanned down a column. */
  clockRow: {
    fontFamily: Fonts.medium,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'] as TextStyle['fontVariant'],
  },
} as const;

/** A 4pt grid. Named steps stop screens inventing 13px gaps. */
export const Spacing = {
  hair: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  huge: 64,
  // Retained so existing screens keep compiling while they are migrated.
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 48,
  seven: 64,
} as const;

/**
 * Radii, assigned by what a container *is* rather than applied uniformly.
 *
 * A single radius on every surface is the SaaS-card look: it flattens the difference
 * between a list row, an object you can act on, and a sheet that slid up from the bottom.
 * Here the radius grows with how much the surface is meant to feel like a separate thing.
 */
export const Radius = {
  /** Chips, small inline controls. */
  tight: 8,
  /** Rows and inputs: present, but barely. */
  row: 12,
  /** Cards: a discrete object with its own actions. Hearth's note card is 22. */
  card: 22,
  /** Hearth's buttons: soft, but still recognisably a button rather than a pill. */
  button: 16,
  /** Sheets and modals: something that arrived over the top of the screen. */
  sheet: 28,
  pill: 999,
  // Retained so existing screens compile while they are migrated.
  small: 12,
  medium: 16,
  large: 20,
  xlarge: 28,
} as const;

/**
 * Icon sizes as tokens, so the set stays rhythmic instead of drifting to 20/22/24/26 as
 * screens are written. Lucide draws on a 24px grid at stroke-width 2, and that stroke is
 * held constant across the whole interface.
 */
export const IconSize = { sm: 16, md: 20, lg: 24, xl: 32 } as const;
export const IconStroke = 2;

/**
 * Motion.
 *
 * Durations are short on purpose. `motion.md › Providing feedback` asks for brevity and
 * precision, and warns against adding motion to frequent interactions — so a press is a
 * near-instant scale, not a bounce.
 *
 * `decelerate` is the standard easing for something arriving on screen; `standard` for
 * state changes in place. Nothing here loops or draws attention to itself.
 */
export const Motion = {
  instant: 90,
  fast: 160,
  base: 220,
  /** Opening a detail, per the Hearth brief: 180ms opacity and translation. */
  detail: 180,
  slow: 320,
  /** Cubic-bezier control points, consumed by Reanimated's `Easing.bezier`. */
  easing: {
    standard: [0.2, 0, 0, 1] as const,
    decelerate: [0, 0, 0.2, 1] as const,
    accelerate: [0.3, 0, 1, 1] as const,
  },
  /** Press feedback. Subtle enough to read as physical rather than animated. */
  pressScale: 0.97,
  /** Vertical offset for content entering a screen. */
  enterOffset: 10,
  /** Stagger between list items, capped so a long list does not crawl in. */
  stagger: 45,
  maxStaggered: 8,
} as const;

/** Android's minimum comfortable target is 48dp, stricter than the 44pt iOS floor in
 * `accessibility.md`, and AGENTS.md makes Android authoritative for touch. */
export const MinTarget = 48;

export const BottomTabInset = 0;
export const MaxContentWidth = 720;
