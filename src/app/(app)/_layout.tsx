import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';

import { Fonts, IconSize } from '@/constants/theme';
import { Icon, Icons, useZOZARTheme } from '@/components/zo-zar-ui';

/**
 * Two tabs: Wake and People.
 *
 * Home, Wake and Plan were three views of one night, and most of the app's buttons
 * existed to carry you between them. They are now a single spine on Wake, and Wake,
 * Plan and the editors live behind it as detail screens reached by touching the thing
 * you want — which is why they are declared here with `href: null`: still routable, no
 * longer advertised.
 *
 * People stays a tab rather than folding in. The person who gets told is not a step in
 * tonight's sequence; they are a standing relationship you maintain on their own time.
 */

function TabIcon({
  as,
  color,
  focused,
}: {
  as: (typeof Icons)[keyof typeof Icons];
  color: ColorValue;
  focused: boolean;
}) {
  return (
    <View style={{ width: 34, height: 28, alignItems: 'center', justifyContent: 'center' }}>
      <Icon as={as} size={focused ? IconSize.lg : IconSize.md} color={String(color)} />
    </View>
  );
}

export default function AppLayout() {
  const { theme } = useZOZARTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.subtle,
        tabBarStyle: {
          minHeight: 72,
          paddingTop: 6,
          backgroundColor: theme.background,
          borderTopWidth: 1,
          borderTopColor: theme.line,
          elevation: 0,
        },
        tabBarItemStyle: { minHeight: 58 },
        tabBarLabelStyle: { fontFamily: Fonts.medium, fontSize: 12, marginTop: -2 },
        tabBarHideOnKeyboard: true,
        // Hearth opens details with a short cross-fade rather than a slide: calm, and
        // nothing for Reduce Motion to remove because nothing travels.
        animation: 'fade',
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Wake',
          tabBarAccessibilityLabel: 'Wake: your next alarm',
          tabBarIcon: ({ color, focused }) => <TabIcon as={Icons.sun} color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="people"
        options={{
          title: 'People',
          tabBarAccessibilityLabel: 'Trusted people',
          tabBarIcon: ({ color, focused }) => <TabIcon as={Icons.users} color={color} focused={focused} />,
        }}
      />

      {/* Reached by touching something on Wake, never from a tab. */}
      <Tabs.Screen name="wake" options={{ href: null }} />
      <Tabs.Screen name="plan" options={{ href: null }} />
      {/* Bedtime is a low-information view: no tab bar, nothing to do but put the phone down. */}
      <Tabs.Screen name="bedtime" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="wake/[id]" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="chat/[id]" options={{ href: null, tabBarStyle: { display: 'none' } }} />
    </Tabs>
  );
}
