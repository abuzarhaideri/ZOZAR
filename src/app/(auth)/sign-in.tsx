import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';

import { PrimaryButton, Screen, TextField, useZOZARTheme } from '@/components/zo-zar-ui';
import { useZOZARStore } from '@/components/zo-zar-store';

export default function SignInScreen() {
  const { styles, theme } = useZOZARTheme();
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
    } finally { setBusy(false); }
  }

  return <Screen>
    <View style={styles.authTop}><Image source={require('../../../assets/images/zo-zar-mark-flat.png')} style={styles.brandLogo} resizeMode="contain" /><Text style={styles.authBrand}>ZO-ZAR</Text></View>
    <View style={styles.authIntro}><Text style={styles.sectionKicker}>Welcome back</Text><Text style={styles.authTitle}>Keep the next right thing close.</Text><Text style={styles.authDetail}>Your plans, wake support, and trusted people in one calm place.</Text></View>
    <TextField label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="next" />
    <TextField label="Password" value={password} onChangeText={setPassword} placeholder="Your password" secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={() => void handleSignIn()} />
    <Pressable accessibilityRole="button" onPress={() => setShowPassword((value) => !value)} style={[styles.authLink, { alignItems: 'flex-end', paddingVertical: 6 }]}><Text style={styles.authLinkStrong}>{showPassword ? 'Hide password' : 'Show password'}</Text></Pressable>
    {(error || hydrationError) && <Text accessibilityRole="alert" style={[styles.authNoteText, { color: theme.error, marginBottom: 12 }]}>{error || hydrationError}</Text>}
    <PrimaryButton label="Sign in" onPress={() => void handleSignIn()} disabled={!email.trim() || !password} busy={busy} />
    <Pressable accessibilityRole="button" onPress={() => router.push('/sign-up' as never)} style={styles.authLink}><Text style={styles.authLinkText}>New to ZO-ZAR? <Text style={styles.authLinkStrong}>Create an account</Text></Text></Pressable>
    <View style={styles.authNote}><Text style={styles.authNoteTitle}>Your quiet start</Text><Text style={styles.authNoteText}>Sign in once and ZO-ZAR keeps your session securely on this device.</Text></View>
  </Screen>;
}
