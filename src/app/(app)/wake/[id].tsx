import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { Icon, Icons, PrimaryButton, Screen, SecondaryButton, TextField, useZOZARTheme } from '@/components/zo-zar-ui';
import { Touchable, announce } from '@/components/motion';
import { IconSize, Radius, Spacing, Type, type Theme } from '@/constants/theme';
import { clockParts, dayPart, minutesOf } from '@/lib/time';
import { useZOZARStore, type WakePlan } from '@/components/zo-zar-store';
import { isProtected, type RepositoryWakeOccurrence } from '@/components/zo-zar-repository';

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

  // TalkBack does not reliably read an error that appears as plain text, so a wrong answer
  // or a failed confirmation is spoken as well as shown.
  useEffect(() => {
    if (error) announce(error);
  }, [error]);

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
  const isLastStep = step === steps - 1;
  const firstName = userName.trim().split(/\s+/)[0] ?? '';
  const greeting = greetingFor(new Date().getHours(), firstName);
  // minutesOf() falls back to 0 on a malformed time; showing "00:00" would be a false claim.
  const alarmClock = challenge && /^\d{1,2}:\d{2}$/.test(challenge.plan.time) ? clockParts(minutesOf(challenge.plan.time)) : null;
  const consequence = !challenge
    ? ''
    : isPractice
      ? 'Practice does not stop a real alarm or message anyone.'
      : !isProtected(challenge.plan)
        ? `You have ${challenge.plan.graceMinutes} minutes to answer. Nobody else will be told.`
        : `${challenge.plan.protectedBy} hears about it if you don't confirm within ${challenge.plan.graceMinutes} minutes.`;

  return (
    <Screen>
      {/*
        Chrome is kept to a single exit. This screen is read in the dark by someone who
        has just been woken, so everything that is not the question, the answer field, or
        the one action is a distraction with a real cost.
      */}
      <Touchable
        accessibilityRole="button"
        accessibilityLabel="Leave without confirming"
        onPress={() => router.back()}
        rippleColor={theme.surfaceStrong}
        borderless
        style={styles.backButton}
      >
        <Icon as={Icons.back} size={IconSize.lg} color={theme.textSecondary} />
        <Text style={wake.exitLabel}>Leave</Text>
      </Touchable>

      {loading ? (
        <View style={wake.centered} accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.textSecondary} />
          <Text style={wake.quiet}>Getting your wake check ready</Text>
        </View>
      ) : !challenge ? (
        <View style={wake.centered}>
          <Text accessibilityRole="header" style={wake.doneTitle}>
            This alarm is not available
          </Text>
          <Text style={wake.doneDetail}>{error ?? 'Open Wake and turn on an alarm first.'}</Text>
          <View style={wake.action}>
            <PrimaryButton label="Back to alarms" onPress={() => router.replace('/wake' as never)} />
          </View>
        </View>
      ) : complete ? (
        <View style={wake.centered}>
          <View style={wake.doneMark}>
            <Icon as={Icons.check} size={IconSize.xl} color={theme.success} label="Confirmed" />
          </View>
          <Text accessibilityRole="header" style={wake.doneTitle}>
            {isPractice ? 'That was practice' : confirmedAt ? `Awake at ${confirmedAt}` : 'You are awake'}
          </Text>
          <Text style={wake.doneDetail}>
            {isPractice
              ? 'Nothing changed. Your real alarm is still set.'
              : 'Your alarm has stopped and nobody needs to check on you.'}
          </Text>
          {error ? (
            <Text accessibilityRole="alert" style={wake.doneNote}>
              {error}
            </Text>
          ) : null}
          <View style={wake.action}>
            {isPractice ? (
              <SecondaryButton label="Back to alarms" onPress={() => router.replace('/wake' as never)} />
            ) : (
              <SecondaryButton label="Back to Tonight" onPress={() => router.replace('/tonight' as never)} />
            )}
          </View>
        </View>
      ) : (
        <View style={wake.task}>
          {/* The alarm this answers, set steady and still smaller than the question. Nothing here moves. */}
          {alarmClock ? (
            <View
              accessible
              accessibilityLabel={`${challenge.plan.title || 'Alarm'}, ${alarmClock.spoken}`}
              style={wake.clockBlock}
            >
              <Text style={wake.clockLine}>
                <Text style={wake.clock}>{alarmClock.digits}</Text>
                {alarmClock.period ? <Text style={wake.period}> {alarmClock.period}</Text> : null}
              </Text>
              {challenge.plan.title ? <Text style={wake.quiet}>{challenge.plan.title}</Text> : null}
            </View>
          ) : null}

          <Text style={wake.greeting}>{isPractice ? 'This is a practice run.' : greeting}</Text>

          {/* The question is the hero. Everything else on screen is smaller than it. */}
          <Text
            accessibilityRole="header"
            style={[wake.prompt, difficulty === 'Hard' && wake.promptLong]}
          >
            {challengeSteps[step]?.prompt}
          </Text>

          {steps > 1 ? (
            <Text style={wake.step}>
              Question {step + 1} of {steps}
            </Text>
          ) : null}

          <View style={wake.answerBlock}>
            <TextField
              label="Your answer"
              autoFocus
              value={answer}
              onChangeText={(value) => {
                setAnswer(value);
                if (error) setError(null);
              }}
              onSubmitEditing={() => void finish()}
              keyboardType={difficulty === 'Hard' ? 'default' : 'numeric'}
              multiline={difficulty === 'Hard'}
              placeholder={difficulty === 'Hard' ? 'Type it exactly' : 'Answer'}
              style={[difficulty === 'Hard' ? wake.answerLong : wake.answer, error ? wake.answerError : null]}
            />
            {/* Rendered here rather than through TextField's caption-sized error: this is the
                one message a just-woken reader must not miss, so it is set at body size. */}
            {error ? (
              <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={wake.error}>
                {error}
              </Text>
            ) : null}
          </View>

          {/* The consequence sits with the action: whoever is deciding whether to put the
              phone down should know who is about to be told on their behalf. */}
          <View style={wake.action}>
            <Text style={wake.stakes}>{consequence}</Text>
            <PrimaryButton
              label={isLastStep ? (isPractice ? 'Finish practice' : 'I’m awake') : 'Continue'}
              onPress={() => void finish()}
              disabled={!answer.trim()}
              busy={confirming}
            />
          </View>
        </View>
      )}
    </Screen>
  );
}

/** A greeting that is true about the hour, or a plain hello when it cannot be. */
function greetingFor(hour: number, firstName: string): string {
  const part = dayPart(hour);
  const salutation =
    part === 'morning' ? 'Good morning' : part === 'afternoon' ? 'Good afternoon' : part === 'evening' ? 'Good evening' : 'Hello';
  return firstName ? `${salutation}, ${firstName}.` : `${salutation}.`;
}

const makeWakeStyles = (theme: Theme) =>
  StyleSheet.create({
    exitLabel: { ...Type.callout, color: theme.textSecondary },

    centered: { paddingTop: Spacing.huge, alignItems: 'center', gap: Spacing.lg },
    quiet: { ...Type.body, color: theme.textSecondary, textAlign: 'center' },

    task: { paddingTop: Spacing.xl, alignItems: 'stretch', gap: Spacing.lg },
    clockBlock: { alignItems: 'center', gap: Spacing.xs },
    clockLine: { textAlign: 'center' },
    clock: { ...Type.clockSmall, color: theme.text },
    period: { ...Type.callout, color: theme.textSecondary },
    greeting: { ...Type.heading, color: theme.text, textAlign: 'center', marginTop: Spacing.sm },
    // Large, because it is being read by someone who cannot yet focus properly.
    prompt: { ...Type.display, color: theme.text, textAlign: 'center', marginTop: Spacing.lg },
    promptLong: { ...Type.heading, color: theme.text, textAlign: 'left', lineHeight: 30 },
    step: { ...Type.caption, color: theme.textSecondary, textAlign: 'center' },

    answerBlock: { marginTop: Spacing.sm, gap: Spacing.sm },
    answerError: { borderColor: theme.error },
    error: { ...Type.body, color: theme.error, textAlign: 'center' },
    answer: {
      minHeight: 64,
      borderRadius: Radius.button,
      paddingHorizontal: Spacing.lg,
      backgroundColor: theme.surface,
      color: theme.text,
      textAlign: 'center',
      ...Type.title,
      fontVariant: ['tabular-nums'],
    },
    answerLong: {
      minHeight: 140,
      borderRadius: Radius.button,
      textAlignVertical: 'top',
      paddingTop: Spacing.lg,
      backgroundColor: theme.surface,
      color: theme.text,
      ...Type.body,
    },

    action: { alignSelf: 'stretch', gap: Spacing.md, marginTop: Spacing.md },
    stakes: { ...Type.body, color: theme.textSecondary, textAlign: 'center' },

    doneMark: {
      width: 72,
      height: 72,
      borderRadius: Radius.pill,
      borderWidth: 1.5,
      borderColor: theme.success,
      alignItems: 'center',
      justifyContent: 'center',
    },
    doneTitle: { ...Type.title, color: theme.text, textAlign: 'center' },
    doneDetail: { ...Type.body, color: theme.textSecondary, textAlign: 'center', maxWidth: 340 },
    doneNote: { ...Type.callout, color: theme.warning, textAlign: 'center', maxWidth: 340 },
  });
