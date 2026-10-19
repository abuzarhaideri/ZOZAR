import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';

import { Icon, Icons, PrimaryButton, Screen, TextField, useZOZARTheme } from '@/components/zo-zar-ui';
import { useZOZARStore } from '@/components/zo-zar-store';

export default function SignUpScreen() {
  const { styles, theme } = useZOZARTheme();
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
    } finally { setBusy(false); }
  }

  if (confirmationSent) return <Screen>
    <View style={styles.authIntro}><Text style={styles.sectionKicker}>Check your inbox</Text><Text style={styles.authTitle}>Confirm your email to continue.</Text><Text style={styles.authDetail}>Your account was created. Open the confirmation link sent to {email.trim()}, then come back and sign in.</Text></View>
    <PrimaryButton label="Back to sign in" onPress={() => router.replace('/sign-in' as never)} />
  </Screen>;

  return <Screen>
    <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}><Icon as={Icons.back} size={20} color={theme.text} /><Text style={styles.backText}>Sign in</Text></Pressable>
    <View style={styles.authIntro}><Text style={styles.sectionKicker}>Start simply</Text><Text style={styles.authTitle}>Build a day you can trust.</Text><Text style={styles.authDetail}>Create your account, then we’ll set up the wake permissions together.</Text></View>
    <TextField label="Your name" value={name} onChangeText={setName} placeholder="Abuzar" autoCapitalize="words" autoComplete="name" textContentType="name" />
    <TextField label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
    <TextField label="Password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" returnKeyType="go" onSubmitEditing={() => void handleSignUp()} />
    <Pressable accessibilityRole="button" onPress={() => setShowPassword((value) => !value)} style={[styles.authLink, { alignItems: 'flex-end', paddingVertical: 6 }]}><Text style={styles.authLinkStrong}>{showPassword ? 'Hide password' : 'Show password'}</Text></Pressable>
    {error && <Text accessibilityRole="alert" style={[styles.authNoteText, { color: theme.error, marginBottom: 12 }]}>{error}</Text>}
    <PrimaryButton label="Create account" onPress={() => void handleSignUp()} disabled={!name.trim() || !email.includes('@') || password.length < 8} busy={busy} />
  </Screen>;
}
