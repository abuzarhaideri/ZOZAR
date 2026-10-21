/**
 * The wake challenge generator, shared by the in-app wake check (`/wake/[id]`) and the
 * practice modal in the alarm editor.
 *
 * The questions deliberately mirror the native generator in
 * modules/zo-zar-exact-alarm/android/src/main/java/expo/modules/zozarexactalarm/ZoZarAlarmActivity.kt:
 * the same arithmetic ranges, the same prompts, the same passage and the same trimmed,
 * exact comparison. Change one and the other must change with it, or practice stops
 * feeling like the real alarm.
 *
 * Known divergence, kept as it was: the seed. Native uses `abs(alarmId.hashCode())`
 * (Java String hash of the alarm id); this module sums the character codes of whatever
 * seed string it is given (the occurrence id on the wake check, a fresh timestamp in
 * practice). The question shapes match, the specific numbers for a given alarm do not.
 */

export type ChallengeDifficulty = 'Easy' | 'Medium' | 'Hard';

export type ChallengeStep = { prompt: string; answer: string };

export const HARD_PASSAGE =
  'Morning arrives quietly, and I meet it with patience. I breathe, sit up, place my feet on the floor, drink some water, and begin this new day with calm focus.';

export function challengeFor(difficulty: ChallengeDifficulty, seedValue: string): ChallengeStep[] {
  const seed = [...seedValue].reduce((total, character) => total + character.charCodeAt(0), 0);
  if (difficulty === 'Easy') {
    const a = 3 + seed % 6; const b = 1 + seed % 3; const c = 5 + seed % 4; const d = 1 + seed % 4;
    return [{ prompt: `What is ${a} + ${b}?`, answer: `${a + b}` }, { prompt: `What is ${c} − ${d}?`, answer: `${c - d}` }];
  }
  if (difficulty === 'Medium') {
    const a = 24 + seed % 31; const b = 12 + seed % 17; const c = 61 + seed % 25; const d = 20 + seed % 20; const e = 33 + seed % 30; const f = 11 + seed % 19;
    return [{ prompt: `What is ${a} + ${b}?`, answer: `${a + b}` }, { prompt: `What is ${c} − ${d}?`, answer: `${c - d}` }, { prompt: `What is ${e} + ${f}?`, answer: `${e + f}` }];
  }
  return [{ prompt: `Type this passage exactly:\n\n${HARD_PASSAGE}`, answer: HARD_PASSAGE }];
}

/**
 * Whether an answer is accepted. Surrounding whitespace is ignored, as on the native
 * alarm; everything else, including the Hard passage's punctuation and case, must match
 * exactly because the real alarm requires it.
 */
export function isCorrectAnswer(step: ChallengeStep | undefined, answer: string): boolean {
  return Boolean(step) && answer.trim() === step!.answer;
}
