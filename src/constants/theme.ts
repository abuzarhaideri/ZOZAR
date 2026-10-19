import { Platform, type TextStyle } from 'react-native';

/**
 * ZO-ZAR's semantic palette. Components consume roles, never raw mode colors.
 *
 * The palette is night-first: the dark set is the reference design and the light set is
 * derived from it. An alarm app is used in bed, in the dark, and at 06:00 — a
 * full-brightness white screen is the wrong default for every one of those moments.
 * Night-first describes which mode was designed first, not which mode is forced; the
 * user's System, Light or Dark choice is always honoured, and the light set is held to
 * the same contrast bar.
 *
 * Dark mode uses two background levels, `background` (base) and `surface` (elevated),
 * which is how iOS conveys depth when one dark surface sits above another
 * (`dark-mode.md › Mobile`). Pure black is avoided: it makes OLED smearing obvious when
 * scrolling and removes any room to show elevation.
 *
 * Text is a warm off-white rather than #FFFFFF. Pure white on near-black glows and
 * halates, which `dark-mode.md › Dark Mode colors` warns about from the opposite
 * direction ("soften the color of white backgrounds").
 *
 * Every foreground/background pair here is verified against the contrast table in
 * `accessibility.md › Color and effects` — 4.5:1 for text up to 17pt, 3:1 at 18pt or
 * bold. Run `npm run verify:contrast` after changing any value.
 */
export const Colors = {
  dark: {
    // Base and elevated. Warm brown-black rather than blue-black ink.
    //
    // Daylight's screen is amber paper lit by its own warm frontlight; nothing in that
    // world is cool-toned. Shifting the base from #0D1117 (blue-black) to #100E0A moves
    // every surface onto the same warm axis as the accent, so amber now reads as *more*
    // of the room's light rather than as a colour laid on top of a cold one.
    background: '#100E0A',
    surface: '#1A1711',
    surfaceStrong: '#26221A',
    backgroundElement: '#1A1711',
    backgroundSelected: '#2E2415',

    // Warm off-white; secondary and subtle both clear 4.5:1 on base and elevated.
    text: '#F4EFE4',
    textSecondary: '#BCB2A2',
    muted: '#BCB2A2',
    subtle: '#9B9183',

    line: '#2B261D',
    // `line` is decorative — dividers and hairlines, carrying no information on its own.
    // `lineStrong` outlines inputs and other controls, so it is what identifies them as
    // interactive and has to clear 3:1 against the background it sits on.
    lineStrong: '#6E6657',

    // Sunrise amber, unchanged: it was already Daylight's hue, and the surfaces moved to
    // meet it rather than the other way round. Light enough that it needs dark ink on
    // top, which is why accentContrast is near-black rather than white.
    accent: '#F2A94B',
    accentContrast: '#1A1206',

    // An inverted card on a dark theme is *light*. The previous design hardcoded white
    // text on these surfaces, which would now be white on near-white, so the inverse set
    // carries its own secondary and line colours rather than leaving screens to guess.
    inverseSurface: '#F4EFE4',
    inverseText: '#19150F',
    inverseTextSecondary: '#4E4739',
    inverseLine: '#D8CFBE',

    success: '#86CE94',
    successSurface: '#152318',
    warning: '#E8B866',
    warningSurface: '#2C2314',
    error: '#F0908A',
    errorSurface: '#2E1C18',

    // `warm` is the quiet companion to the accent for eyebrows and kickers, not a second
    // action color. AGENTS.md permits exactly one accent hue.
    warm: '#E0B07C',
    warmSurface: '#241B12',

    focus: '#F2A94B',
    scrim: 'rgba(8, 6, 3, 0.74)',
  },

  light: {
    // Warm paper, not white.
    //
    // Daylight's whole premise is a screen you can read in sunlight because it behaves
    // like paper. #F5F0E4 is that paper. The previous #FAF8F5 was a cooled-down white,
    // which is the one thing a sunlight-first reference is arguing against.
    background: '#F5F0E4',
    surface: '#FCF8EE',
    surfaceStrong: '#EBE3D2',
    backgroundElement: '#FCF8EE',
    backgroundSelected: '#F7E7C8',

    text: '#1C1710',
    textSecondary: '#5C5343',
    muted: '#5C5343',
    subtle: '#6A6050',

    line: '#E0D7C4',
    // See the dark-mode note: this outlines controls, so it clears 3:1 rather than being
    // the near-invisible hairline it was.
    lineStrong: '#8C8372',

    // Deepened amber: the dark-mode value does not reach 4.5:1 against a light
    // background, so light mode uses a darker tone of the same hue.
    accent: '#8A4E08',
    accentContrast: '#FFFBF2',

    inverseSurface: '#1C1710',
    inverseText: '#F7F2E7',
    inverseTextSecondary: '#B5AC9B',
    inverseLine: '#39322A',

    success: '#1B6440',
    successSurface: '#E3EEE2',
    warning: '#744D0F',
    warningSurface: '#F8EAD0',
    error: '#9E2E26',
    errorSurface: '#F8E4DE',

    warm: '#82521C',
    warmSurface: '#F3E8D6',

    focus: '#8A4E08',
    scrim: 'rgba(28, 23, 16, 0.46)',
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
  title: { fontFamily: Fonts.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
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
  /** Cards: a discrete object with its own actions. */
  card: 20,
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
