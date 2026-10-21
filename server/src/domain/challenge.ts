/**
 * Wake challenges: the task you must complete to dismiss an alarm.
 *
 * The payload is stored on the occurrence row and read by the client, answer included.
 * That is deliberate. The native alarm has to ring and be dismissible with no network —
 * a phone in airplane mode at 06:00 must still work — so validation happens on device.
 * The threat model here is a half-asleep person tapping "dismiss" by reflex, not an
 * attacker, and someone determined to defeat their own alarm can simply uninstall the app.
 *
 * The server still owns the `confirmed` status, because that is what the trusted-person
 * escalation depends on, and that cannot be decided on the device that overslept.
 *
 * Generation is pure apart from the injected random source, so tests can pin it.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';

export type WakeChallenge = {
  kind: 'arithmetic';
  difficulty: Difficulty;
  prompt: string;
  choices: string[];
  answerIndex: number;
};

/** Injectable so tests are deterministic. Defaults to `Math.random`. */
export type RandomSource = () => number;

function integerBetween(random: RandomSource, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

type Problem = { prompt: string; answer: number };

function easyProblem(random: RandomSource): Problem {
  const a = integerBetween(random, 2, 9);
  const b = integerBetween(random, 2, 9);
  return { prompt: `${a} + ${b}`, answer: a + b };
}

function mediumProblem(random: RandomSource): Problem {
  const a = integerBetween(random, 11, 29);
  const b = integerBetween(random, 3, 9);
  return { prompt: `${a} × ${b}`, answer: a * b };
}

function hardProblem(random: RandomSource): Problem {
  const a = integerBetween(random, 12, 24);
  const b = integerBetween(random, 3, 9);
  const c = integerBetween(random, 2, 9);
  // Two operations, so it cannot be answered by pattern recognition alone.
  return { prompt: `${a} × ${b} − ${c}`, answer: a * b - c };
}

const GENERATORS: Record<Difficulty, (random: RandomSource) => Problem> = {
  easy: easyProblem,
  medium: mediumProblem,
  hard: hardProblem,
};

const CHOICE_COUNT: Record<Difficulty, number> = { easy: 3, medium: 4, hard: 4 };

/**
 * Builds distractors near the answer so they cannot be dismissed at a glance, while
 * keeping every option distinct and non-negative. The offsets widen with difficulty.
 */
function distractors(answer: number, count: number, spread: number, random: RandomSource): number[] {
  const values = new Set<number>([answer]);
  let guard = 0;
  while (values.size < count && guard < 200) {
    guard += 1;
    const delta = integerBetween(random, 1, spread) * (random() < 0.5 ? -1 : 1);
    const candidate = answer + delta;
    if (candidate >= 0) values.add(candidate);
  }
  // A pathological random source could stall the loop above; fill deterministically so a
  // challenge is always produced rather than an alarm shipping with too few choices.
  let fallback = answer + 1;
  while (values.size < count) {
    values.add(fallback);
    fallback += 1;
  }
  return [...values];
}

export function generateChallenge(difficulty: Difficulty, random: RandomSource = Math.random): WakeChallenge {
  const { prompt, answer } = GENERATORS[difficulty](random);
  const count = CHOICE_COUNT[difficulty];
  const spread = difficulty === 'easy' ? 3 : difficulty === 'medium' ? 12 : 25;

  const values = distractors(answer, count, spread, random);

  // Fisher-Yates, so the answer is not biased toward a position a tired user could learn.
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [values[index], values[swap]] = [values[swap]!, values[index]!];
  }

  return {
    kind: 'arithmetic',
    difficulty,
    prompt: `${prompt} = ?`,
    choices: values.map(String),
    answerIndex: values.indexOf(answer),
  };
}

/** Narrows an unknown jsonb payload back to a challenge, for rows written by an older
 * version or by the migration. */
export function isWakeChallenge(value: unknown): value is WakeChallenge {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<WakeChallenge>;
  return (
    candidate.kind === 'arithmetic' &&
    typeof candidate.prompt === 'string' &&
    Array.isArray(candidate.choices) &&
    candidate.choices.length > 1 &&
    typeof candidate.answerIndex === 'number' &&
    candidate.answerIndex >= 0 &&
    candidate.answerIndex < candidate.choices.length
  );
}
