import { useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { Touchable } from '@/components/motion';
import { Icon, Icons, PrimaryButton, Screen, TextField, useZOZARTheme } from '@/components/zo-zar-ui';
import { useZOZARStore } from '@/components/zo-zar-store';
import { Fonts, IconSize, Radius, Spacing, Type, type Theme } from '@/constants/theme';

/** Sign-in pushes this screen, so going back is the natural way there; a cold start onto
 * sign-up has nothing to go back to and replaces instead. */
function toSignIn() {
  if (router.canGoBack()) router.back();
  else router.replace('/sign-in' as never);
}

export default function SignUpScreen() {
  const { theme } = useZOZARTheme();
  const local = useMemo(() => makeStyles(theme), [theme]);
  const { signUp } = useZOZARStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSignUp() {
    try {
      setError(null);
      setBusy(true);
      const result = await signUp(name, email, password);
      if (result.requiresEmailConfirmation) {
        setConfirmationSent(true);
        return;
      }
      router.replace('/' as never);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create your account.');
    } finally {
      setBusy(false);
    }
  }

  if (confirmationSent) {
    return (
      <Screen bottomInset>
        <View style={local.intro}>
          <View style={local.mark}>
            <Icon as={Icons.letter} size={IconSize.lg} color={theme.textSecondary} />
          </View>
          <Text accessibilityRole="header" style={local.title}>
            Check your inbox.
          </Text>
          <Text style={local.lede}>
            Your account was created. Open the confirmation link sent to {email.trim()}, then come back and sign in.
          </Text>
        </View>
        <PrimaryButton label="Back to sign in" onPress={() => router.replace('/sign-in' as never)} />
      </Screen>
    );
  }

  const passwordShort = password.length > 0 && password.length < 8;

  return (
    <Screen bottomInset>
      <View style={local.brandRow}>
        <Image
          source={require('../../../assets/images/zo-zar-mark-flat.png')}
          style={local.brandLogo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <Text style={local.brand}>ZO-ZAR</Text>
      </View>

      <View style={local.intro}>
        <Text accessibilityRole="header" style={local.title}>
          Let's set up your mornings.
        </Text>
        <Text style={local.lede}>Create your account, then we'll set up the alarm permissions together.</Text>
      </View>

      <TextField
        label="Your name"
        value={name}
        onChangeText={setName}
        placeholder="First name is fine"
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
      />
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
        placeholder="At least 8 characters"
        secureTextEntry={!showPassword}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={() => void handleSignUp()}
      />
      {/* A neutral hint, not an error: a password being typed is not yet wrong. */}
      {passwordShort ? (
        <Text style={local.hint}>
          {`${8 - password.length} more ${8 - password.length === 1 ? 'character' : 'characters'} needed.`}
        </Text>
      ) : null}
      <Touchable
        accessibilityRole="button"
        accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
        onPress={() => setShowPassword((value) => !value)}
        rippleColor={theme.surfaceStrong}
        style={local.reveal}
      >
        <Text style={local.revealText}>{showPassword ? 'Hide password' : 'Show password'}</Text>
      </Touchable>

      {error ? (
        <View style={local.errorBox}>
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={local.errorText}>
            {error}
          </Text>
        </View>
      ) : null}

      <View style={local.action}>
        <PrimaryButton
          label="Create account"
          onPress={() => void handleSignUp()}
          disabled={!name.trim() || !email.includes('@') || password.length < 8}
          busy={busy}
        />
      </View>

      <Touchable
        accessibilityRole="link"
        accessibilityLabel="Already have an account? Sign in"
        onPress={toSignIn}
        rippleColor={theme.surfaceStrong}
        style={local.switchLink}
      >
        <Text style={local.switchText}>
          Already have an account? <Text style={local.switchStrong}>Sign in</Text>
        </Text>
      </Touchable>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    brandRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md },
    brandLogo: { width: 26, height: 26, borderRadius: Radius.tight },
    brand: { ...Type.label, color: theme.textSecondary, letterSpacing: 1.6 },

    intro: { paddingTop: Spacing.huge, paddingBottom: Spacing.xxl },
    mark: {
      width: 56,
      height: 56,
      borderRadius: Radius.pill,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: Spacing.xl,
    },
    title: { ...Type.title, color: theme.text },
    lede: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.md },

    hint: { ...Type.caption, color: theme.textSecondary, marginTop: -Spacing.sm, marginBottom: Spacing.sm },

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
  });
