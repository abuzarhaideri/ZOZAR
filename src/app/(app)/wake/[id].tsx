import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { Card, Glyph, PrimaryButton, Screen, useZOZARTheme } from '@/components/zo-zar-ui';
import { useZOZARStore, type WakePlan } from '@/components/zo-zar-store';
import type { RepositoryWakeOccurrence } from '@/components/zo-zar-repository';

type ChallengeState = { plan: WakePlan; occurrence: RepositoryWakeOccurrence } | null;

function challengeFor(difficulty: WakePlan['difficulty'], seedValue: string) {
  const seed = [...seedValue].reduce((total, character) => total + character.charCodeAt(0), 0);
  if (difficulty === 'Easy') {
    const a = 3 + seed % 6; const b = 1 + seed % 3; const c = 5 + seed % 4; const d = 1 + seed % 4;
    return [{ prompt: `What is ${a} + ${b}?`, answer: `${a + b}` }, { prompt: `What is ${c} − ${d}?`, answer: `${c - d}` }];
  }
  if (difficulty === 'Medium') {
    const a = 24 + seed % 31; const b = 12 + seed % 17; const c = 61 + seed % 25; const d = 20 + seed % 20; const e = 33 + seed % 30; const f = 11 + seed % 19;
    return [{ prompt: `What is ${a} + ${b}?`, answer: `${a + b}` }, { prompt: `What is ${c} − ${d}?`, answer: `${c - d}` }, { prompt: `What is ${e} + ${f}?`, answer: `${e + f}` }];
  }
  const passage = 'Morning arrives quietly, and I meet it with patience. I breathe, sit up, place my feet on the floor, drink some water, and begin this new day with calm focus.';
  return [{ prompt: `Type this passage exactly:\n\n${passage}`, answer: passage }];
}

export default function WakeConfirmationRoute() {
  const { styles, theme } = useZOZARTheme();
  const { confirmWake, getWakeChallenge, userName } = useZOZARStore();
  const { id: rawId, practice: rawPractice, nativeCompleted: rawNativeCompleted } = useLocalSearchParams<{ id: string; practice?: string; nativeCompleted?: string }>();
  const occurrenceId = Array.isArray(rawId) ? rawId[0] : rawId;
  const isPractice = (Array.isArray(rawPractice) ? rawPractice[0] : rawPractice) === '1';
  const nativeCompleted = (Array.isArray(rawNativeCompleted) ? rawNativeCompleted[0] : rawNativeCompleted) === '1';
  const [challenge, setChallenge] = useState<ChallengeState>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [answer, setAnswer] = useState('');
  const [complete, setComplete] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const difficulty = challenge?.plan.difficulty ?? 'Easy';
  const challengeSteps = useMemo(() => challengeFor(difficulty, occurrenceId || 'practice'), [difficulty, occurrenceId]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    if (!occurrenceId) {
      setLoading(false);
      setError('This wake check has no occurrence id. Open Wake and choose a saved alarm.');
      return () => { mounted = false; };
    }
    void getWakeChallenge(occurrenceId).then((value) => {
      if (!mounted) return;
      setChallenge(value);
      if (!value) setError('This wake occurrence is no longer available. Open Wake and activate an alarm first.');
      else if (nativeCompleted) {
        setComplete(true);
        setConfirmedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
        void confirmWake(occurrenceId).catch(() => setError('Your alarm stopped. ZO-ZAR will sync completion when connectivity returns.'));
      }
    }).catch((cause) => {
      if (mounted) setError(cause instanceof Error ? cause.message : 'The wake challenge could not be loaded.');
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
    // Store actions are recreated with store state; this load is keyed by the route occurrence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeCompleted, occurrenceId]);

  async function finish() {
    if (!challenge || !occurrenceId) return;
    const expected = challengeSteps[step]?.answer ?? '';
    if (answer.trim() !== expected) {
      setError('That answer is not quite right. Try again.');
      return;
    }
    setError(null);
    const steps = challengeSteps.length;
    if (step < steps - 1) {
      setStep((current) => current + 1);
      setAnswer('');
      return;
    }
    try {
      setConfirming(true);
      if (!isPractice) await confirmWake(occurrenceId);
      setConfirmedAt(isPractice ? null : new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      setComplete(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The wake could not be confirmed.');
    } finally {
      setConfirming(false);
    }
  }

  const steps = challengeSteps.length;

  return <Screen>
    <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}><Glyph style={styles.backGlyph}>←</Glyph><Text style={styles.backText}>Exit wake</Text></Pressable>
    {loading ? <Card><Text style={styles.cardTitle}>Loading your wake challenge…</Text></Card> : !challenge ? <Card><Text style={styles.cardTitle}>Wake challenge unavailable</Text><Text style={styles.cardDetail}>{error ?? 'Open Wake to choose an active occurrence.'}</Text><PrimaryButton label="Back to Wake" onPress={() => router.replace('/wake' as never)} /></Card> : <>
      <View style={styles.wakeConfirmTop}><View style={styles.alarmRing}><Glyph style={styles.alarmIcon}>◷</Glyph></View><Text style={styles.sectionKicker}>{isPractice ? 'Challenge practice' : 'ZO-ZAR wake check'}</Text><Text style={styles.wakeConfirmTitle}>{complete ? (isPractice ? 'Practice complete.' : 'You’re ready for the day.') : `Good morning, ${userName}.`}</Text><Text style={styles.wakeConfirmDetail}>{complete ? (isPractice ? 'Your real wake occurrence was not changed.' : 'Your wake is confirmed and the alarm is stopped.') : `Complete the ${difficulty.toLowerCase()} check${isPractice ? ' without changing your live alarm' : ' to confirm you are awake'}.`}</Text></View>
      {!complete ? <Card style={styles.taskCard}><View style={styles.taskHeader}><Text style={styles.sectionKicker}>Step {step + 1} of {steps}</Text><Text style={styles.taskDifficulty}>{difficulty}</Text></View><Text style={styles.taskPrompt}>{challengeSteps[step]?.prompt}</Text><TextInput accessibilityLabel="Wake challenge answer" autoFocus value={answer} onChangeText={setAnswer} onSubmitEditing={() => void finish()} keyboardType={difficulty === 'Hard' ? 'default' : 'numeric'} multiline={difficulty === 'Hard'} placeholder={difficulty === 'Hard' ? 'Type the passage exactly' : 'Type the answer'} placeholderTextColor={theme.subtle} style={[styles.input, difficulty === 'Hard' && { minHeight: 130, textAlignVertical: 'top' }]} /><PrimaryButton label={step === steps - 1 ? (isPractice ? 'Finish practice' : 'Confirm I’m awake') : 'Continue'} onPress={() => void finish()} disabled={!answer.trim()} busy={confirming} /></Card> : <Card style={styles.successCard}><Text style={styles.successIcon}>✓</Text><Text style={styles.cardTitle}>{isPractice ? 'Challenge completed safely' : confirmedAt ? `Wake confirmed at ${confirmedAt}` : 'Wake confirmed'}</Text><Text style={styles.cardDetail}>{isPractice ? 'Practice never confirms or changes a real wake occurrence.' : 'Your commitment is still ahead. Go gently.'}</Text><PrimaryButton label={isPractice ? 'Back to Wake' : 'Back to home'} onPress={() => router.replace((isPractice ? '/wake' : '/home') as never)} /></Card>}
    </>}
    {error && challenge && !complete && <Card><Text style={styles.cardDetail}>{error}</Text></Card>}
    {!complete && challenge && <View style={styles.wakeConfirmNote}><Glyph style={styles.helperGlyph}>⌁</Glyph><Text style={styles.helperText}>{isPractice ? 'Practice mode does not stop alarms, confirm occurrences, or contact anyone.' : challenge.plan.protectedBy === 'No trusted person yet' ? `You have ${challenge.plan.graceMinutes} minutes to complete this check. No trusted person is linked.` : `If you do not complete this check in ${challenge.plan.graceMinutes} minutes, ${challenge.plan.protectedBy} can receive a wake-support notification.`}</Text></View>}
  </Screen>;
}
