import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { Icon, Icons, PrimaryButton, SecondaryButton, TextField, useZOZARTheme } from './zo-zar-ui';
import { Touchable, announce } from './motion';
import { IconSize, MinTarget, Radius, Spacing, Type, type Theme } from '@/constants/theme';
import { challengeFor, isCorrectAnswer, type ChallengeDifficulty } from '@/lib/wake-challenge';

/**
 * A practice run of a wake challenge, opened from the alarm editor.
 *
 * It uses the same generator as the real wake check, with a fresh seed every time it
 * opens so the answers cannot be memorised. It never confirms a wake, never touches the
 * store, and never changes the alarm being edited: closing it returns to the editor
 * exactly as it was.
 *
 * `difficulty` doubles as visibility: null means closed.
 */
export function ChallengePractice({
  difficulty,
  onClose,
}: {
  difficulty: ChallengeDifficulty | null;
  onClose: () => void;
}) {
  const { theme } = useZOZARTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [seed, setSeed] = useState(() => String(Date.now()));
  const [step, setStep] = useState(0);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  // Kept while the modal fades out, so the content does not blank mid-animation.
  const [shown, setShown] = useState<ChallengeDifficulty>(difficulty ?? 'Easy');

  const visible = difficulty !== null;

  const restart = () => {
    setSeed(String(Date.now()));
    setStep(0);
    setAnswer('');
    setError(null);
    setComplete(false);
  };

  // Every opening is a new run with new numbers. This resets during render rather than in
  // an effect, so the first frame of the fade-in never shows the previous run (its last
  // step or its finished screen) before the new one replaces it.
  const [openedFor, setOpenedFor] = useState<ChallengeDifficulty | null>(difficulty);
  if (difficulty !== openedFor) {
    setOpenedFor(difficulty);
    if (difficulty) {
      setShown(difficulty);
      restart();
    }
  }

  useEffect(() => {
    if (error) announce(error);
  }, [error]);

  const steps = useMemo(() => challengeFor(shown, seed), [shown, seed]);
  const isHard = shown === 'Hard';
  const isLastStep = step === steps.length - 1;

  const submit = () => {
    if (!answer.trim()) return;
    if (!isCorrectAnswer(steps[step], answer)) {
      setError(isHard ? 'That does not match the passage exactly yet. Check the punctuation and try again.' : 'That answer is not quite right. Try again.');
      return;
    }
    setError(null);
    if (!isLastStep) {
      setStep((current) => current + 1);
      setAnswer('');
      return;
    }
    setComplete(true);
    announce('Practice finished');
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      {/* A Modal is its own native window on Android, so it needs its own inset provider. */}
      <SafeAreaProvider>
        <SafeAreaView style={styles.sheet} edges={['top', 'bottom', 'left', 'right']}>
          <View style={styles.header}>
            <Touchable
              accessibilityRole="button"
              accessibilityLabel={complete ? 'Close practice' : 'Cancel practice'}
              accessibilityHint="Returns to the alarm. Nothing is changed."
              onPress={onClose}
              rippleColor={theme.surfaceStrong}
              style={styles.close}
            >
              <Icon as={Icons.close} size={IconSize.md} color={theme.textSecondary} />
              <Text style={styles.closeText}>{complete ? 'Close' : 'Cancel'}</Text>
            </Touchable>
          </View>

          <KeyboardAvoidingView behavior="padding" style={styles.flex}>
            <ScrollView
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text accessibilityRole="header" style={styles.title}>
                Practice: {shown} challenge
              </Text>

              {complete ? (
                <View style={styles.done}>
                  <View style={styles.doneMark}>
                    <Icon as={Icons.check} size={IconSize.xl} color={theme.success} label="Finished" />
                  </View>
                  <Text accessibilityRole="header" style={styles.doneTitle}>
                    That is how it will feel
                  </Text>
                  <Text style={styles.doneDetail}>
                    {isHard
                      ? 'When this alarm rings, you will type a passage like this one to stop it.'
                      : 'When this alarm rings, you will answer questions like these to stop it.'}{' '}
                    Nothing was saved and nobody was told.
                  </Text>
                  <View style={styles.actions}>
                    <PrimaryButton label="Done" onPress={onClose} />
                    <SecondaryButton
                      label="Practise again"
                      accessibilityHint="Starts a new run with different questions"
                      onPress={restart}
                    />
                  </View>
                </View>
              ) : (
                <View style={styles.task}>
                  <Text style={styles.step}>
                    Step {step + 1} of {steps.length}
                  </Text>

                  {/* The question is the hero, as on the real wake check. */}
                  <Text style={[styles.prompt, isHard && styles.promptLong]}>{steps[step]?.prompt}</Text>

                  <View style={styles.answerBlock}>
                    <TextField
                      key={`${seed}-${step}`}
                      label="Your answer"
                      autoFocus
                      value={answer}
                      onChangeText={(value) => {
                        setAnswer(value);
                        if (error) setError(null);
                      }}
                      onSubmitEditing={isHard ? undefined : submit}
                      returnKeyType={isHard ? 'default' : 'done'}
                      keyboardType={isHard ? 'default' : 'numeric'}
                      multiline={isHard}
                      autoCorrect={false}
                      autoCapitalize={isHard ? 'sentences' : 'none'}
                      placeholder={isHard ? 'Type it exactly' : 'Answer'}
                      style={[isHard ? styles.answerLong : styles.answer, error ? styles.answerError : null]}
                    />
                    {error ? (
                      <Text accessibilityRole="alert" style={styles.error}>
                        {error}
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.actions}>
                    <Text style={styles.note}>Practice does not change your alarm or message anyone.</Text>
                    <PrimaryButton
                      label={isLastStep ? 'Finish practice' : 'Continue'}
                      onPress={submit}
                      disabled={!answer.trim()}
                    />
                  </View>
                </View>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    sheet: { flex: 1, backgroundColor: theme.background },
    flex: { flex: 1 },
    header: { minHeight: 64, paddingHorizontal: Spacing.lg, flexDirection: 'row', alignItems: 'center' },
    close: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, minHeight: MinTarget, minWidth: 72, paddingRight: Spacing.sm },
    closeText: { ...Type.action, color: theme.textSecondary },

    body: {
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.xxxl,
    },
    title: { ...Type.heading, color: theme.textSecondary, textAlign: 'center' },

    task: { alignItems: 'stretch', gap: Spacing.lg, paddingTop: Spacing.sm },
    step: { ...Type.caption, color: theme.textSecondary, textAlign: 'center' },
    prompt: { ...Type.display, color: theme.text, textAlign: 'center', marginTop: Spacing.lg },
    promptLong: { ...Type.heading, color: theme.text, textAlign: 'left', lineHeight: 30 },

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

    actions: { alignSelf: 'stretch', gap: Spacing.md, marginTop: Spacing.md },
    note: { ...Type.callout, color: theme.textSecondary, textAlign: 'center' },

    done: { alignItems: 'center', gap: Spacing.lg, paddingTop: Spacing.huge },
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
  });
