import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, useFonts } from '@expo-google-fonts/manrope';
import { View } from 'react-native';

import { AppearanceProvider, useAppearance } from '@/components/appearance-provider';
import { ZOZARStoreProvider } from '@/components/zo-zar-store';

function AppProviders() {
  const { resolvedAppearance, theme } = useAppearance();
  const [fontsLoaded, fontError] = useFonts({ Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold });
  const navigationTheme = resolvedAppearance === 'dark' ? DarkTheme : DefaultTheme;
  const themedNavigation = {
    ...navigationTheme,
    colors: { ...navigationTheme.colors, primary: theme.accent, background: theme.background, card: theme.surface, text: theme.text, border: theme.line },
  };

  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: theme.background }} />;

  return <ThemeProvider value={themedNavigation}>
    <StatusBar style={resolvedAppearance === 'dark' ? 'light' : 'dark'} />
    <ZOZARStoreProvider>
      <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: theme.background } }} />
    </ZOZARStoreProvider>
  </ThemeProvider>;
}

export default function RootLayout() {
  return <AppearanceProvider><AppProviders /></AppearanceProvider>;
}
