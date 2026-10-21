import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { Touchable } from '@/components/motion';
import { PrimaryButton, Screen, TextField, useZOZARTheme } from '@/components/zo-zar-ui';
import { useZOZARStore } from '@/components/zo-zar-store';
import { Fonts, Radius, Spacing, Type, type Theme } from '@/constants/theme';
import { ZozarMark } from '@/components/zozar-mark';

export default function SignInScreen() {
  const { theme } = useZOZARTheme();
  const local = useMemo(() => makeStyles(theme), [theme]);
  const { signIn, hydrationError } = useZOZARStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSignIn() {
    try {
      setError(null);
      setBusy(true);
      await signIn(email, password);
      router.replace('/' as never);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign in. Check your email and password.');
    } finally {
      setBusy(false);
    }
  }

  const message = error || hydrationError;

  return (
    <Screen bottomInset>
      <View style={local.brandRow}>
        <ZozarMark height={22} decorative />
        <Text style={local.brand}>ZO-ZAR</Text>
      </View>

      <View style={local.intro}>
        <Text accessibilityRole="header" style={local.title}>
          Welcome back.
        </Text>
        <Text style={local.lede}>Sign in to see tonight's alarm and the people behind it.</Text>
      </View>

      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
        secureTextEntry={!showPassword}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => void handleSignIn()}
      />
      <Touchable
        accessibilityRole="button"
        accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
        onPress={() => setShowPassword((value) => !value)}
        rippleColor={theme.surfaceStrong}
        style={local.reveal}
      >
        <Text style={local.revealText}>{showPassword ? 'Hide password' : 'Show password'}</Text>
      </Touchable>

      {message ? (
        <View style={local.errorBox}>
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={local.errorText}>
            {message}
          </Text>
        </View>
      ) : null}

      <View style={local.action}>
        <PrimaryButton
          label="Sign in"
          onPress={() => void handleSignIn()}
          disabled={!email.trim() || !password}
          busy={busy}
        />
      </View>

      <Touchable
        accessibilityRole="link"
        accessibilityLabel="New to ZO-ZAR? Create an account"
        onPress={() => router.push('/sign-up' as never)}
        rippleColor={theme.surfaceStrong}
        style={local.switchLink}
      >
        <Text style={local.switchText}>
          New to ZO-ZAR? <Text style={local.switchStrong}>Create an account</Text>
        </Text>
      </Touchable>

      <Text style={local.footnote}>Once you sign in, ZO-ZAR keeps your session securely on this device.</Text>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    brandRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md },
    brand: { ...Type.label, color: theme.textSecondary, letterSpacing: 1.6 },

    intro: { paddingTop: Spacing.huge, paddingBottom: Spacing.xxl },
    title: { ...Type.title, color: theme.text },
    lede: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.md },

    reveal: {
      alignSelf: 'flex-end',
      minHeight: 48,
      justifyContent: 'center',
      paddingHorizontal: Spacing.sm,
      marginTop: -Spacing.sm,
      borderRadius: Radius.row,
    },
    revealText: { ...Type.action, color: theme.textSecondary },

    errorBox: {
      backgroundColor: theme.errorSurface,
      borderRadius: Radius.row,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      marginTop: Spacing.md,
    },
    errorText: { ...Type.body, color: theme.error },

    action: { marginTop: Spacing.xl },

    switchLink: {
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: Spacing.lg,
      borderRadius: Radius.row,
      paddingHorizontal: Spacing.sm,
    },
    switchText: { ...Type.body, color: theme.textSecondary, textAlign: 'center' },
    switchStrong: { fontFamily: Fonts.semibold, color: theme.text, textDecorationLine: 'underline' },

    footnote: { ...Type.caption, color: theme.textSecondary, textAlign: 'center', marginTop: Spacing.xl },
  });
