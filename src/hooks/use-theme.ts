/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { useAppearance } from '@/components/appearance-provider';

export function useTheme() {
  return useAppearance().theme;
}
