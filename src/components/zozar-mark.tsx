import Svg, { Circle, Line, Path } from 'react-native-svg';

// Imported from the provider, not zo-zar-ui: BrandBar in zo-zar-ui renders this mark,
// and a hook from that module would make the two import each other.
import { useAppearance } from '@/components/appearance-provider';

/**
 * The ZO-ZAR mark: a Z interlocked with an O drawn as a clock face.
 *
 * Designed by the project's owner; rebuilt here as vectors from their artwork so it is
 * sharp at every size. Geometry is kept in the original artwork's pixel space (the
 * numbers below are measurements from it) and the viewBox crops to the mark.
 *
 * It reads its colours from the theme rather than shipping two images, so it follows
 * the app's appearance automatically: cream Z and gold O on the night surface, dark Z and
 * deep amber O on limestone. Gold is the accent on dark and amber the accent on light —
 * the same rule as every amber element in the app — which also keeps the O legible at
 * header size in light mode, where gold on limestone nearly disappears.
 *
 * Where the Z crosses the O, a band of the background shows between them, as in the
 * original artwork. It is drawn as a halo in `surface`'s colour, so pass the colour of
 * whatever the mark sits on.
 */

const Z_PATH = 'M330 353 L542 353 L310 647 L563 647';
const Z_WIDTH = 60;
const GAP = 22;
const O = { cx: 583, cy: 529, ro: 149, ri: 88 };
const HAND = { x: 626, y: 486, width: 18, pivot: 20 };

// Bounds of the mark in artwork space, with room for round caps.
const VIEW = { x: 280, y: 321, width: 454, height: 359 };
export const ZOZAR_MARK_ASPECT = VIEW.width / VIEW.height;

export function ZozarMark({
  height = 28,
  surface,
  accessibilityLabel = 'ZO-ZAR',
  decorative = false,
}: {
  /** Rendered height in dp; width follows the mark's proportions. */
  height?: number;
  /** The colour behind the mark. Defaults to the app background. */
  surface?: string;
  accessibilityLabel?: string;
  /** Hide from TalkBack when the words "ZO-ZAR" are already next to it. */
  decorative?: boolean;
}) {
  const { theme } = useAppearance();
  const ground = surface ?? theme.background;
  const ringMid = (O.ro + O.ri) / 2;

  return (
    <Svg
      width={height * ZOZAR_MARK_ASPECT}
      height={height}
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : accessibilityLabel}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
    >
      <Circle cx={O.cx} cy={O.cy} r={ringMid} fill="none" stroke={theme.accent} strokeWidth={O.ro - O.ri} />
      <Line
        x1={O.cx}
        y1={O.cy}
        x2={HAND.x}
        y2={HAND.y}
        stroke={theme.text}
        strokeWidth={HAND.width}
        strokeLinecap="round"
      />
      <Circle cx={O.cx} cy={O.cy} r={HAND.pivot} fill={theme.text} />
      <Path
        d={Z_PATH}
        fill="none"
        stroke={ground}
        strokeWidth={Z_WIDTH + GAP * 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d={Z_PATH}
        fill="none"
        stroke={theme.text}
        strokeWidth={Z_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
