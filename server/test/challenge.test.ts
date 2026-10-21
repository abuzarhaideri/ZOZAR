import { describe, expect, it } from 'vitest';

import { generateChallenge, isWakeChallenge, type Difficulty } from '@/domain/challenge';

/** A deterministic stand-in for Math.random that cycles a fixed sequence. */
function sequence(values: number[]) {
  let index = 0;
  return () => values[index++ % values.length]!;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

describe('challenge generation', () => {
  it('always marks the correct answer', () => {
    for (const difficulty of DIFFICULTIES) {
      for (let run = 0; run < 200; run += 1) {
        const challenge = generateChallenge(difficulty);
        const chosen = Number(challenge.choices[challenge.answerIndex]);
        const [, left, operator, right, , tail] =
          challenge.prompt.match(/^(\d+) (.) (\d+)( − (\d+))? = \?$/) ?? [];
        expect(left, challenge.prompt).toBeDefined();

        const a = Number(left);
        const b = Number(right);
        const expected = operator === '+' ? a + b : tail ? a * b - Number(tail) : a * b;
        expect(chosen, `${difficulty}: ${challenge.prompt}`).toBe(expected);
      }
    }
  });

  it('offers distinct choices', () => {
    for (const difficulty of DIFFICULTIES) {
      for (let run = 0; run < 100; run += 1) {
        const { choices } = generateChallenge(difficulty);
        expect(new Set(choices).size).toBe(choices.length);
      }
    }
  });

  it('never offers a negative choice, which would give the answer away', () => {
    for (const difficulty of DIFFICULTIES) {
      for (let run = 0; run < 200; run += 1) {
        for (const choice of generateChallenge(difficulty).choices) {
          expect(Number(choice)).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('scales the number of choices with difficulty', () => {
    expect(generateChallenge('easy').choices).toHaveLength(3);
    expect(generateChallenge('medium').choices).toHaveLength(4);
    expect(generateChallenge('hard').choices).toHaveLength(4);
  });

  it('makes harder problems genuinely harder', () => {
    const easy = generateChallenge('easy');
    const hard = generateChallenge('hard');
    expect(easy.prompt).toMatch(/^\d+ \+ \d+ = \?$/);
    // Two operations, so it cannot be answered by recognising a times-table entry.
    expect(hard.prompt).toMatch(/^\d+ × \d+ − \d+ = \?$/);
  });

  it('does not park the answer in a fixed position', () => {
    const positions = new Set<number>();
    for (let run = 0; run < 200; run += 1) {
      positions.add(generateChallenge('medium').answerIndex);
    }
    // All four slots should be reachable, or a half-asleep user learns to tap one spot.
    expect(positions.size).toBe(4);
  });

  it('still produces a complete challenge when the random source is degenerate', () => {
    // A source that always returns the same value cannot generate varied distractors, so
    // the deterministic fill has to cover it rather than looping forever.
    for (const constant of [0, 0.5, 0.999999]) {
      const challenge = generateChallenge('hard', () => constant);
      expect(challenge.choices).toHaveLength(4);
      expect(new Set(challenge.choices).size).toBe(4);
      expect(challenge.answerIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it('is reproducible for a given random sequence', () => {
    const values = [0.1, 0.4, 0.7, 0.2, 0.9, 0.3, 0.6, 0.5];
    const first = generateChallenge('medium', sequence(values));
    const second = generateChallenge('medium', sequence(values));
    expect(first).toEqual(second);
  });
});

describe('challenge narrowing', () => {
  it('accepts a generated challenge', () => {
    expect(isWakeChallenge(generateChallenge('easy'))).toBe(true);
  });

  it('rejects anything that could not drive the UI', () => {
    const cases: unknown[] = [
      null,
      undefined,
      {},
      'arithmetic',
      { kind: 'riddle', prompt: 'x', choices: ['1', '2'], answerIndex: 0 },
      { kind: 'arithmetic', prompt: 'x', choices: ['1'], answerIndex: 0 },
      { kind: 'arithmetic', prompt: 'x', choices: ['1', '2'], answerIndex: 5 },
      { kind: 'arithmetic', prompt: 'x', choices: ['1', '2'], answerIndex: -1 },
      { kind: 'arithmetic', prompt: 42, choices: ['1', '2'], answerIndex: 0 },
    ];
    for (const value of cases) {
      expect(isWakeChallenge(value), JSON.stringify(value)).toBe(false);
    }
  });
});
