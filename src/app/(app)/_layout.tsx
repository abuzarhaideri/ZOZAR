import { Tabs } from 'expo-router';
import { Text, View, type ColorValue } from 'react-native';

import { Fonts } from '@/constants/theme';
import { useZOZARTheme } from '@/components/zo-zar-ui';

function TabIcon({ symbol, color, focused }: { symbol: string; color: ColorValue; focused: boolean }) {
  return <View style={{ width: 34, height: 28, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}><Text accessible={false} style={{ color, fontSize: focused ? 23 : 21, lineHeight: 25, fontWeight: focused ? '700' : '400' }}>{symbol}</Text></View>;
}

export default function AppLayout() {
  const { theme } = useZOZARTheme();

  return <Tabs
    screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: theme.accent,
      tabBarInactiveTintColor: theme.subtle,
      tabBarStyle: {
        minHeight: 76,
        paddingTop: 7,
        backgroundColor: theme.surface,
        borderTopWidth: 1,
        borderTopColor: theme.line,
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        elevation: 0,
      },
      tabBarItemStyle: { minHeight: 58 },
      tabBarLabelStyle: { fontFamily: Fonts.medium, fontSize: 12, fontWeight: '600', marginTop: -2 },
      tabBarHideOnKeyboard: true,
    }}
  >
    <Tabs.Screen name="home" options={{ title: 'Home', tabBarAccessibilityLabel: 'Home', tabBarIcon: ({ color, focused }) => <TabIcon symbol="⌂" color={color} focused={focused} /> }} />
    <Tabs.Screen name="wake" options={{ title: 'Wake', tabBarAccessibilityLabel: 'Wake alarms', tabBarIcon: ({ color, focused }) => <TabIcon symbol="◷" color={color} focused={focused} /> }} />
    <Tabs.Screen name="plan" options={{ title: 'Plan', tabBarAccessibilityLabel: 'Plan commitments', tabBarIcon: ({ color, focused }) => <TabIcon symbol="▣" color={color} focused={focused} /> }} />
    <Tabs.Screen name="people" options={{ title: 'People', tabBarAccessibilityLabel: 'Trusted people', tabBarIcon: ({ color, focused }) => <TabIcon symbol="◎" color={color} focused={focused} /> }} />
    <Tabs.Screen name="wake/[id]" options={{ href: null, tabBarStyle: { display: 'none' } }} />
    <Tabs.Screen name="chat/[id]" options={{ href: null, tabBarStyle: { display: 'none' } }} />
  </Tabs>;
}
