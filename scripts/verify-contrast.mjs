#!/usr/bin/env node
/**
 * Verifies the palette against the contrast table in the Apple HIG accessibility
 * reference: 4.5:1 for text up to 17pt at any weight, 3:1 at 18pt or when bold.
 *
 * This runs in CI because a palette is the easiest thing in a design system to break
 * quietly. Nudging one hex value to taste can drop a label below the legibility floor,
 * and nobody notices by looking — least of all on a bright monitor, when the people most
 * affected are reading at 6am with the screen dimmed.
 *
 * Ratios use the WCAG relative-luminance formula, which is what the HIG table refers to.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src/constants/theme.ts'), 'utf8');

/** Pulls the two palettes out of the theme without importing React Native. */
function parsePalette(mode) {
  const block = source.match(new RegExp(`${mode}:\\s*\\{([\\s\\S]*?)\\n  \\},`));
  if (!block) throw new Error(`Could not find the ${mode} palette in theme.ts`);
  const entries = [...block[1].matchAll(/^\s*([a-zA-Z]+):\s*'([^']+)'/gm)];
  return Object.fromEntries(entries.map(([, key, value]) => [key, value]));
}

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  if (a === null || b === null) return null;
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Each pair names the smallest text size it is used at, which sets its threshold.
 * `large` means 18pt or bold, where the HIG allows 3:1.
 *
 * Deliberately not checked: `line` and `inverseLine`. Both are decorative rules between
 * blocks of content. WCAG 1.4.11 sets a 3:1 floor for "visual information required to
 * identify user interface components and states", which a divider is not — the content
 * either side identifies itself. Holding a hairline to 3:1 would mean drawing heavy grey
 * lines through a calm layout to satisfy a rule aimed at something else.
 *
 * `lineStrong` *is* checked, because that is what outlines inputs and controls, and there
 * the boundary genuinely is the thing identifying the component.
 */
const PAIRS = [
  ['text', 'background', 'small', 'body copy on the base background'],
  ['text', 'surface', 'small', 'body copy on a card'],
  ['text', 'surfaceStrong', 'small', 'body copy on a raised row'],
  ['textSecondary', 'background', 'small', 'supporting copy on the base background'],
  ['textSecondary', 'surface', 'small', 'supporting copy on a card'],
  ['muted', 'background', 'small', 'muted copy on the base background'],
  ['muted', 'surface', 'small', 'muted copy on a card'],
  ['subtle', 'background', 'small', 'tab labels and timestamps'],
  ['subtle', 'surface', 'small', 'subtle copy on a card'],
  ['accentContrast', 'accent', 'small', 'label on a filled primary button'],
  ['accent', 'background', 'large', 'accent link on the base background'],
  ['accent', 'surface', 'large', 'accent link on a card'],
  ['inverseText', 'inverseSurface', 'small', 'label on an inverted surface'],
  ['inverseTextSecondary', 'inverseSurface', 'small', 'supporting copy on an inverted surface'],
  ['success', 'background', 'large', 'success state on the base background'],
  ['success', 'successSurface', 'small', 'success pill text'],
  ['warning', 'warningSurface', 'small', 'warning pill text'],
  ['error', 'background', 'large', 'error text on the base background'],
  ['error', 'errorSurface', 'small', 'error pill text'],
  ['warm', 'background', 'large', 'eyebrow on the base background'],
  ['warm', 'surface', 'large', 'eyebrow on a card'],
  ['text', 'backgroundSelected', 'small', 'label on a selected row'],
  ['lineStrong', 'background', 'large', 'input border against the background'],
  ['onFill', 'fill', 'small', 'label on the gold primary button'],
  ['textSecondary', 'surfaceStrong', 'small', 'supporting copy on a pressed row'],
  ['accent', 'backgroundSelected', 'small', 'selected label on a selected row'],
  ['subtle', 'surfaceStrong', 'small', 'timestamps on a raised row'],
  ['lineStrong', 'surface', 'large', 'control border on a card'],
];

const THRESHOLD = { small: 4.5, large: 3 };

let failures = 0;
let checked = 0;

for (const mode of ['dark', 'light']) {
  const palette = parsePalette(mode);
  console.log(`\n${mode.toUpperCase()}`);

  for (const [fg, bg, size, description] of PAIRS) {
    const foreground = palette[fg];
    const background = palette[bg];
    if (!foreground || !background) {
      console.log(`  SKIP  ${fg} on ${bg} — not defined`);
      continue;
    }

    const value = ratio(foreground, background);
    if (value === null) continue;

    checked += 1;
    const needed = THRESHOLD[size];
    const ok = value >= needed;
    if (!ok) failures += 1;

    const verdict = ok ? 'ok  ' : 'FAIL';
    console.log(
      `  ${verdict}  ${value.toFixed(2).padStart(5)}:1  (needs ${needed})  ${fg} on ${bg}  — ${description}`,
    );
  }
}

console.log(`\n${checked} pairs checked, ${failures} below the floor.`);
if (failures > 0) {
  console.error('\nPalette does not meet the HIG contrast table. Adjust the values in src/constants/theme.ts.');
  process.exit(1);
}
console.log('Palette meets the HIG contrast table.');
