import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useZOZARStore } from '@/components/zo-zar-store';
import { Fonts } from '@/constants/theme';
import { useZOZARTheme } from '@/components/zo-zar-ui';

function welcomeCopy() {
  const hour = new Date().getHours();
  if (hour < 12) return { greeting: 'Good morning', message: 'Begin gently. Your day is already held.', action: 'Start my day' };
  if (hour < 17) return { greeting: 'Good afternoon', message: 'Take a breath. The next thing is close.', action: 'Continue my day' };
  if (hour < 21) return { greeting: 'Good evening', message: 'Settle in. Tomorrow can feel a little lighter.', action: 'Ease into ZO-ZAR' };
  return { greeting: 'Good night', message: 'One last calm check, then the day can rest.', action: 'Prepare tomorrow' };
}

export default function WelcomeRoute() {
  const { theme } = useZOZARTheme();
  const { userName } = useZOZARStore();
  const [reducedMotion, setReducedMotion] = useState(false);
  const brand = useRef(new Animated.Value(0)).current;
  const horizon = useRef(new Animated.Value(0)).current;
  const copy = useRef(new Animated.Value(0)).current;
  const action = useRef(new Animated.Value(0)).current;
  const words = useMemo(welcomeCopy, []);
  const firstName = (userName || 'there').split(/\s+/)[0];
  const useNativeDriver = Platform.OS !== 'web';

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!active) return;
      setReducedMotion(reduce);
      if (reduce) {
        brand.setValue(1); horizon.setValue(1); copy.setValue(1); action.setValue(1);
        return;
      }
      Animated.sequence([
        Animated.timing(brand, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver }),
        Animated.parallel([
          Animated.timing(horizon, { toValue: 1, duration: 560, easing: Easing.out(Easing.cubic), useNativeDriver }),
          Animated.timing(copy, { toValue: 1, duration: 460, delay: 90, easing: Easing.out(Easing.cubic), useNativeDriver }),
        ]),
        Animated.timing(action, { toValue: 1, duration: 300, useNativeDriver }),
      ]).start();
    });
    return () => { active = false; };
  }, [action, brand, copy, horizon, useNativeDriver]);

  const lift = (value: Animated.Value, distance: number) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  });

  return <SafeAreaView style={[local.safe, { backgroundColor: theme.background }]} edges={['top', 'bottom', 'left', 'right']}>
    <ScrollView contentContainerStyle={local.content} showsVerticalScrollIndicator={false}>
      <Animated.View style={[local.brandRow, lift(brand, 8)]}>
        <Image source={require('../../assets/images/zo-zar-mark-flat.png')} style={local.brandLogo} resizeMode="contain" />
        <Text style={[local.brand, { color: theme.text }]}>ZO-ZAR</Text>
      </Animated.View>

      <Animated.View accessible={false} style={[local.horizonFrame, lift(horizon, 26)]}>
        <View style={[local.horizonRingOuter, { borderColor: theme.line }]} />
        <View style={[local.horizonRingInner, { borderColor: theme.lineStrong }]} />
        <View style={[local.sun, { backgroundColor: theme.warm }]} />
        <View style={[local.horizonLine, { backgroundColor: theme.warm }]} />
      </Animated.View>

      <Animated.View style={[local.copy, lift(copy, 18)]}>
        <Text style={[local.eyebrow, { color: theme.warm }]}>{words.greeting}, {firstName}</Text>
        <Text accessibilityRole="header" style={[local.title, { color: theme.text }]}>A calmer rhythm,{`\n`}made for you.</Text>
        <Text style={[local.message, { color: theme.muted }]}>{words.message}</Text>
      </Animated.View>

      <Animated.View style={[local.footer, lift(action, 10)]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${words.action}. Open Home.`} onPress={() => router.replace('/home' as never)} style={({ pressed }) => [local.continueButton, { backgroundColor: theme.accent }, pressed && { opacity: 0.78 }]}>
          <Text style={local.continueText}>{words.action}</Text><Text style={local.arrow}>→</Text>
        </Pressable>
        <Text style={[local.caption, { color: theme.subtle }]}>{reducedMotion ? 'Motion reduced to match your device setting.' : 'Wake · Plan · People'}</Text>
      </Animated.View>
    </ScrollView>
  </SafeAreaView>;
}

const local = StyleSheet.create({
  safe: { flex: 1 }, content: { flexGrow: 1, width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16 },
  brandRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }, brandLogo: { width: 32, height: 32, borderRadius: 10 }, brand: { fontFamily: Fonts.bold, fontSize: 15, fontWeight: '700', letterSpacing: 3 },
  horizonFrame: { flex: 1, minHeight: 250, maxHeight: 390, marginTop: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end' }, horizonRingOuter: { position: 'absolute', bottom: -165, width: 420, height: 420, borderRadius: 210, borderWidth: 1 }, horizonRingInner: { position: 'absolute', bottom: -116, width: 320, height: 320, borderRadius: 160, borderWidth: 1 }, sun: { position: 'absolute', bottom: 18, width: 104, height: 104, borderRadius: 52 }, horizonLine: { position: 'absolute', bottom: 17, width: '100%', maxWidth: 430, height: 2, borderRadius: 1 },
  copy: { paddingTop: 28 }, eyebrow: { fontFamily: Fonts.semibold, fontSize: 14, fontWeight: '700', marginBottom: 12 }, title: { fontFamily: Fonts.bold, fontSize: 40, lineHeight: 45, fontWeight: '700', letterSpacing: -1.4 }, message: { fontFamily: Fonts.regular, fontSize: 17, lineHeight: 25, marginTop: 15, maxWidth: 410 },
  footer: { marginTop: 30 }, continueButton: { minHeight: 56, borderRadius: 18, paddingHorizontal: 19, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, continueText: { color: '#FFFFFF', fontFamily: Fonts.semibold, fontSize: 16, fontWeight: '700' }, arrow: { color: '#FFFFFF', fontSize: 23 }, caption: { fontFamily: Fonts.medium, textAlign: 'center', fontSize: 12, marginTop: 13 },
});
