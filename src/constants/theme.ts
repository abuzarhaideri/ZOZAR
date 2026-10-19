import { Platform } from 'react-native';

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
    // Base and elevated. Deep blue-black ink rather than neutral grey, so the warm amber
    // accent reads as warm against it.
    background: '#0D1117',
    surface: '#161B22',
    surfaceStrong: '#1F262F',
    backgroundElement: '#161B22',
    backgroundSelected: '#2A2218',

    // Warm off-white; secondary and subtle both clear 4.5:1 on base and elevated.
    text: '#F0EDE8',
    textSecondary: '#AFB6BF',
    muted: '#AFB6BF',
    subtle: '#8B939E',

    line: '#262D36',
    // `line` is decorative — dividers and hairlines, carrying no information on its own.
    // `lineStrong` outlines inputs and other controls, so it is what identifies them as
    // interactive and has to clear 3:1 against the background it sits on.
    lineStrong: '#5E646D',

    // Sunrise amber. Light enough that it needs dark ink on top, which is why
    // accentContrast is near-black rather than white.
    accent: '#F2A94B',
    accentContrast: '#1A1206',

    // An inverted card on a dark theme is *light*. The previous design hardcoded white
    // text on these surfaces, which would now be white on near-white, so the inverse set
    // carries its own secondary and line colours rather than leaving screens to guess.
    inverseSurface: '#F0EDE8',
    inverseText: '#14181E',
    inverseTextSecondary: '#4A5056',
    inverseLine: '#D4CEC5',

    success: '#74D39B',
    successSurface: '#15291F',
    warning: '#E8B866',
    warningSurface: '#2B2214',
    error: '#F08A8A',
    errorSurface: '#2E1A1A',

    // `warm` is the quiet companion to the accent for eyebrows and kickers, not a second
    // action color. AGENTS.md permits exactly one accent hue.
    warm: '#E0B07C',
    warmSurface: '#241B12',

    focus: '#F2A94B',
    scrim: 'rgba(3, 6, 10, 0.72)',
  },

  light: {
    // Warm, softened white rather than #FFFFFF, so the light mode is a sibling of the
    // dark one rather than a different product.
    background: '#FAF8F5',
    surface: '#FFFFFF',
    surfaceStrong: '#F1EDE7',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#FBEFDC',

    text: '#17181B',
    textSecondary: '#5A5F67',
    muted: '#5A5F67',
    // Darkened from #73787F, which measured 4.20:1 and failed the small-text floor.
    subtle: '#6A6F75',

    line: '#E4DFD8',
    // See the dark-mode note: this outlines controls, so it clears 3:1 rather than being
    // the near-invisible hairline it was.
    lineStrong: '#8F8B85',

    // Deepened amber: the dark-mode value does not reach 4.5:1 against a light
    // background, so light mode uses a darker tone of the same hue.
    accent: '#92540A',
    accentContrast: '#FFFFFF',

    inverseSurface: '#17181B',
    inverseText: '#F7F5F2',
    inverseTextSecondary: '#B4B8BE',
    inverseLine: '#34363B',

    success: '#1C6B46',
    successSurface: '#E4F2EA',
    warning: '#7A5212',
    warningSurface: '#FBEEDA',
    error: '#A5302E',
    errorSurface: '#FBE7E6',

    warm: '#8A5A22',
    warmSurface: '#F7ECDF',

    focus: '#92540A',
    scrim: 'rgba(12, 10, 8, 0.44)',
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
  label: { fontFamily: Fonts.semibold, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18 },
  // Uppercase eyebrows: tracked out, because uppercase at small sizes needs the air.
  eyebrow: { fontFamily: Fonts.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 1.3 },
  clock: { fontFamily: Fonts.bold, fontSize: 56, lineHeight: 62, letterSpacing: -2.5 },
  clockSmall: { fontFamily: Fonts.semibold, fontSize: 32, lineHeight: 38, letterSpacing: -1 },
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

export const Radius = { small: 10, medium: 16, large: 22, xlarge: 28, pill: 999 } as const;

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
