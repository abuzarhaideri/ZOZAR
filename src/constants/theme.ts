import { Platform } from 'react-native';

/** ZO-ZAR's fixed semantic palette. Components consume roles, never raw mode colors. */
export const Colors = {
  light: {
    text: '#172132', background: '#F5F7FA', surface: '#FFFFFF', surfaceStrong: '#EDF1F7',
    backgroundElement: '#FFFFFF', backgroundSelected: '#E8EDFA', textSecondary: '#526078',
    muted: '#526078', subtle: '#728097', line: '#DCE2EB', lineStrong: '#C7D0DE',
    accent: '#2856D9', accentContrast: '#FFFFFF', inverseSurface: '#172132', inverseText: '#F4F6FA',
    success: '#1D704E', successSurface: '#E5F4EC', warning: '#8B5813', warningSurface: '#FFF2DC',
    error: '#B42332', errorSurface: '#FCE8EA', warm: '#95551C', warmSurface: '#F8E9DA',
    focus: '#728097', scrim: 'rgba(11, 16, 24, 0.48)',
  },
  dark: {
    text: '#F4F6FA', background: '#0B1018', surface: '#141C28', surfaceStrong: '#1D2838',
    backgroundElement: '#141C28', backgroundSelected: '#202F4E', textSecondary: '#A8B2C2',
    muted: '#A8B2C2', subtle: '#8995A8', line: '#2C394B', lineStrong: '#40506A',
    accent: '#2856D9', accentContrast: '#FFFFFF', inverseSurface: '#172132', inverseText: '#F4F6FA',
    success: '#75D3A4', successSurface: '#173629', warning: '#F0BE68', warningSurface: '#3B2B13',
    error: '#FF929D', errorSurface: '#421F27', warm: '#F3B58A', warmSurface: '#3A281F',
    focus: '#9AA8BE', scrim: 'rgba(0, 0, 0, 0.66)',
  },
} as const;

export type Theme = { readonly [key in keyof typeof Colors.light]: string };
export type ThemeColor = keyof Theme;

export const Fonts = {
  regular: 'Manrope_400Regular', medium: 'Manrope_500Medium', semibold: 'Manrope_600SemiBold', bold: 'Manrope_700Bold',
  mono: Platform.select({ ios: 'ui-monospace', android: 'monospace', default: 'ui-monospace' }),
  sans: 'Manrope_400Regular',
} as const;

export const Spacing = { half: 2, one: 4, two: 8, three: 16, four: 24, five: 32, six: 48, seven: 64 } as const;
export const Radius = { small: 12, medium: 18, large: 24, pill: 999 } as const;
export const BottomTabInset = 0;
export const MaxContentWidth = 720;
