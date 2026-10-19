import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { Card, Icon, Icons, PrimaryButton, Screen, useZOZARTheme } from '@/components/zo-zar-ui';
import { Touchable } from '@/components/motion';
import { IconSize, Spacing, Type, type Theme } from '@/constants/theme';
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
  const wake = useMemo(() => makeWakeStyles(theme), [theme]);
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

  return (
    <Screen>
      {/*
        Chrome is kept to a single exit. This screen is read in the dark by someone who
        has just been woken, so everything that is not the question, the answer field, or
        the button is a distraction with a real cost.
      */}
      <Touchable
        accessibilityRole="button"
        accessibilityLabel="Leave without confirming"
        onPress={() => router.back()}
        rippleColor={theme.surfaceStrong}
        borderless
        style={styles.backButton}
      >
        <Icon as={Icons.back} size={IconSize.lg} color={theme.subtle} />
        <Text style={wake.exitLabel}>Leave</Text>
      </Touchable>

      {loading ? (
        <Card>
          <Text style={styles.cardTitle}>Loading your challenge</Text>
        </Card>
      ) : !challenge ? (
        <Card>
          <Text style={styles.cardTitle}>This alarm is not available</Text>
          <Text style={styles.cardDetail}>{error ?? 'Open Wake and turn on an alarm first.'}</Text>
          <PrimaryButton label="Back to alarms" onPress={() => router.replace('/wake' as never)} />
        </Card>
      ) : complete ? (
        <View style={wake.done}>
          <View style={wake.doneMark}>
            <Icon as={Icons.check} size={IconSize.xl} color={theme.success} label="Confirmed" />
          </View>
          <Text style={wake.doneTitle}>
            {isPractice ? 'That was practice' : confirmedAt ? `Awake at ${confirmedAt}` : 'Awake'}
          </Text>
          <Text style={wake.doneDetail}>
            {isPractice
              ? 'Nothing changed. Your real alarm is still set.'
              : 'Your alarm has stopped and nobody needs to check on you.'}
          </Text>
          <PrimaryButton
            label={isPractice ? 'Back to alarms' : 'Start the day'}
            onPress={() => router.replace((isPractice ? '/wake' : '/tonight') as never)}
          />
        </View>
      ) : (
        <View style={wake.task}>
          <Text style={wake.greeting}>
            {isPractice ? 'Practice' : `Good morning, ${userName}`}
          </Text>

          {/* The question is the hero. Everything else on screen is smaller than it. */}
          <Text
            accessibilityRole="header"
            style={[wake.prompt, difficulty === 'Hard' && wake.promptLong]}
          >
            {challengeSteps[step]?.prompt}
          </Text>

          <TextInput
            accessibilityLabel="Your answer"
            autoFocus
            value={answer}
            onChangeText={setAnswer}
            onSubmitEditing={() => void finish()}
            keyboardType={difficulty === 'Hard' ? 'default' : 'numeric'}
            multiline={difficulty === 'Hard'}
            placeholder={difficulty === 'Hard' ? 'Type it exactly' : 'Answer'}
            placeholderTextColor={theme.subtle}
            style={[wake.answer, difficulty === 'Hard' && wake.answerLong]}
          />

          <PrimaryButton
            label={step === steps - 1 ? (isPractice ? 'Finish' : 'I am awake') : 'Next'}
            onPress={() => void finish()}
            disabled={!answer.trim()}
            busy={confirming}
          />

          {steps > 1 ? (
            <Text style={wake.step}>
              {step + 1} of {steps}
            </Text>
          ) : null}

          {error ? (
            <Text accessibilityRole="alert" style={wake.error}>
              {error}
            </Text>
          ) : null}

          {/*
            The consequence, stated plainly and placed with the action rather than at the
            foot of the screen. Someone deciding whether to put the phone down needs to
            know who is about to be woken on their behalf.
          */}
          <View style={wake.stakes}>
            <Icon as={Icons.shield} size={IconSize.sm} color={theme.textSecondary} />
            <Text style={wake.stakesText}>
              {isPractice
                ? 'Practice does not stop a real alarm or message anyone.'
                : challenge.plan.protectedBy === 'No trusted person yet'
                  ? `${challenge.plan.graceMinutes} minutes to answer. Nobody else will be told.`
                  : `${challenge.plan.graceMinutes} minutes to answer, or ${challenge.plan.protectedBy} hears about it.`}
            </Text>
          </View>
        </View>
      )}
    </Screen>
  );
}

const makeWakeStyles = (theme: Theme) =>
  StyleSheet.create({
    exitLabel: { ...Type.callout, color: theme.subtle },

    task: { paddingTop: Spacing.xl, gap: Spacing.lg },
    greeting: { ...Type.body, color: theme.textSecondary },
    // Large, because it is being read by someone who cannot yet focus properly.
    prompt: { ...Type.display, color: theme.text },
    promptLong: { ...Type.heading, color: theme.text, lineHeight: 30 },

    answer: {
      minHeight: 64,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.lineStrong,
      borderRadius: 16,
      paddingHorizontal: Spacing.lg,
      color: theme.text,
      backgroundColor: theme.surface,
      ...Type.title,
      fontVariant: ['tabular-nums'],
    },
    answerLong: { minHeight: 140, textAlignVertical: 'top', paddingTop: Spacing.lg, ...Type.body, color: theme.text },

    step: { ...Type.caption, color: theme.subtle, textAlign: 'center' },
    error: { ...Type.body, color: theme.error },

    stakes: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginTop: Spacing.lg },
    stakesText: { ...Type.caption, color: theme.textSecondary, flex: 1 },

    done: { paddingTop: Spacing.huge, alignItems: 'center', gap: Spacing.lg },
    doneMark: {
      width: 72,
      height: 72,
      borderRadius: 36,
      borderWidth: 1.5,
      borderColor: theme.success,
      alignItems: 'center',
      justifyContent: 'center',
    },
    doneTitle: { ...Type.title, color: theme.text, textAlign: 'center' },
    doneDetail: { ...Type.body, color: theme.textSecondary, textAlign: 'center', maxWidth: 320, marginBottom: Spacing.md },
  });
