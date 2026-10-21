import { useMemo, useState, type ComponentType, type PropsWithChildren, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  AlarmClock,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ListChecks,
  Lock,
  MoreHorizontal,
  Pencil,
  Play,
  Square,
  Trash2,
  X,
  Mic,
  Plus,
  Send,
  ShieldCheck,
  Sunrise,
  UserPlus,
  Users,
  Moon,
  MailOpen,
  Clock3,
  RotateCw,
  type LucideIcon,
} from 'lucide-react-native';

import { useAppearance, type AppearancePreference } from './appearance-provider';
import { Touchable, minTargetStyle } from './motion';
import { Fonts, IconSize, IconStroke, Radius, Spacing, Type, type Theme } from '@/constants/theme';
import { useZOZARStore } from './zo-zar-store';

export function useZOZARTheme() {
  const { theme } = useAppearance();
  return { theme, styles: useMemo(() => makeUIStyles(theme), [theme]) };
}

/**
 * The project's icon.
 *
 * Icons were emoji text. Emoji are font-dependent, render differently on every Android
 * version, cannot be coloured from a token, and have no accessible semantics — they are
 * the single most reliable sign of an unfinished interface. Lucide draws on a 24px grid
 * at a constant stroke, and the stroke is held constant across the whole app so the icon
 * set reads as one family.
 *
 * Decorative by default: an icon sitting beside its own label is noise to a screen
 * reader, so it is hidden unless given a label of its own.
 */
export function Icon({
  as: Glyph,
  size = IconSize.md,
  color,
  label,
}: {
  as: LucideIcon | ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  size?: number;
  color: string;
  /** Supply only when the icon stands alone and carries the meaning. */
  label?: string;
}) {
  return (
    <View
      accessible={Boolean(label)}
      accessibilityRole={label ? 'image' : undefined}
      accessibilityLabel={label}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}
    >
      <Glyph size={size} color={color} strokeWidth={IconStroke} />
    </View>
  );
}

/**
 * A person's mark: the first letter of their name.
 *
 * This used to pick from ['🌙', '🦉', '🦊', '🐼', …] by hashing the id. Three problems,
 * and the third is the one that matters. Emoji render differently on every Android
 * version and font; they cannot take a colour, so the warm ink the People screen sets
 * them in is simply ignored; and a fox assigned by a hash tells you nothing about who
 * the person is, where their own initial tells you immediately.
 *
 * Falls back to a bullet rather than an empty box when a name is missing or begins with
 * something that has no uppercase form.
 */
export function deterministicAvatar(seed: string) {
  const letter = seed.trim()[0];
  return letter ? letter.toUpperCase() : '•';
}

export function Screen({
  children,
  scroll = true,
  bottomInset = false,
}: PropsWithChildren<{ scroll?: boolean; bottomInset?: boolean }>) {
  const { theme, styles } = useZOZARTheme();
  const content = scroll ? (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    children
  );
  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.background }]}
      edges={bottomInset ? ['top', 'left', 'right', 'bottom'] : ['top', 'left', 'right']}
    >
      {content}
    </SafeAreaView>
  );
}

/** A quiet section label. Sentence case, normal weight: a tracked-out uppercase label
 * above every heading is the commonest tell of generated design, and uppercase is harder
 * to scan in the dark. */
export function SectionLabel({ children }: { children: string }) {
  const { styles } = useZOZARTheme();
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function SectionHeader({
  kicker,
  title,
  action,
  onAction,
}: {
  kicker?: string;
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  const { theme, styles } = useZOZARTheme();
  return (
    <View style={styles.sectionHeading}>
      <View style={styles.flexOne}>
        {kicker ? <Text style={styles.sectionKicker}>{kicker}</Text> : null}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {action ? (
        onAction ? (
          <Touchable
            accessibilityRole="button"
            accessibilityLabel={action}
            onPress={onAction}
            rippleColor={theme.surfaceStrong}
            style={styles.sectionActionTarget}
          >
            <Text style={styles.sectionAction}>{action}</Text>
          </Touchable>
        ) : (
          <Text style={styles.sectionAction}>{action}</Text>
        )
      ) : null}
    </View>
  );
}

/** A discrete object with its own actions. Not a generic container: if the content is one
 * of several similar things, it belongs in a Row. */
export function Card({
  children,
  emphasis = false,
  style,
}: PropsWithChildren<{ emphasis?: boolean; style?: StyleProp<ViewStyle> }>) {
  const { theme, styles } = useZOZARTheme();
  return (
    <View
      style={[
        styles.card,
        emphasis && { backgroundColor: theme.inverseSurface, borderColor: theme.inverseSurface },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  icon,
  disabled = false,
  busy = false,
}: {
  label: string;
  onPress?: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  busy?: boolean;
}) {
  const { theme, styles } = useZOZARTheme();
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      rippleColor={theme.onFill}
      style={[styles.primaryButton, (disabled || busy) && styles.disabled]}
    >
      {busy ? (
        <ActivityIndicator color={theme.onFill} />
      ) : (
        <>
          {icon ? <Icon as={icon} size={IconSize.md} color={theme.onFill} /> : null}
          <Text style={styles.primaryText}>{label}</Text>
        </>
      )}
    </Touchable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  icon,
  disabled = false,
  accessibilityHint,
}: {
  label: string;
  onPress?: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  accessibilityHint?: string;
}) {
  const { theme, styles } = useZOZARTheme();
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      rippleColor={theme.surfaceStrong}
      style={[styles.secondaryButton, disabled && styles.disabled]}
    >
      {icon ? <Icon as={icon} size={IconSize.md} color={theme.text} /> : null}
      <Text style={styles.secondaryText}>{label}</Text>
    </Touchable>
  );
}

/**
 * Hearth's list row: a leading mark, a title with one line of detail, and a chevron when
 * it opens something.
 *
 * Rows rather than cards, separated by a hairline. A chevron appears only when the row
 * navigates; a row that toggles in place gets none, because a chevron promises a new
 * screen and breaking that promise is how people stop trusting what they tap.
 */
export function HearthRow({
  title,
  detail,
  leading,
  trailing,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = 'button',
  accessibilityState,
  navigates = true,
  last = false,
  dimmed = false,
  actions,
}: {
  title: string;
  detail?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: 'button' | 'checkbox' | 'link';
  accessibilityState?: { checked?: boolean; disabled?: boolean; busy?: boolean };
  /** Shows the chevron. False for rows that act in place. */
  navigates?: boolean;
  last?: boolean;
  /** For a completed item: the text recedes but stays, so it can be undone. */
  dimmed?: boolean;
  /**
   * Named actions for TalkBack's actions menu.
   *
   * Anything reachable by long press must be reachable another way: a double-tap-and-hold
   * is the least discoverable gesture TalkBack has. Every long-press handler on a row
   * should also appear here by name ("Edit", "Remove Priya").
   */
  actions?: { name: string; label: string; run: () => void }[];
}) {
  const { theme, styles } = useZOZARTheme();
  const body = (
    <View style={[styles.hearthRow, last && styles.hearthRowLast]}>
      {leading ? <View style={styles.hearthLeading}>{leading}</View> : null}
      <View style={styles.hearthCopy}>
        <Text style={[styles.hearthTitle, dimmed && styles.hearthDimmed]} numberOfLines={2}>
          {title}
        </Text>
        {detail ? (
          <Text style={styles.hearthDetail} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing ?? (navigates && onPress ? <Icon as={ChevronRight} size={IconSize.md} color={theme.subtle} /> : null)}
    </View>
  );
  if (!onPress && !onLongPress) return body;
  return (
    <Touchable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? (detail ? `${title}, ${detail}` : title)}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState}
      accessibilityActions={actions?.map(({ name, label }) => ({ name, label }))}
      onAccessibilityAction={(event) => actions?.find((action) => action.name === event.nativeEvent.actionName)?.run()}
      onPress={onPress}
      onLongPress={onLongPress}
      rippleColor={theme.surfaceStrong}
    >
      {body}
    </Touchable>
  );
}

/** A leading mark for a HearthRow: an icon in a soft circle, or a person's initial. */
export function RowMark({ icon, letter, active = false }: { icon?: LucideIcon; letter?: string; active?: boolean }) {
  const { theme, styles } = useZOZARTheme();
  return (
    <View style={[styles.rowMark, active && { backgroundColor: theme.backgroundSelected }]}>
      {icon ? (
        <Icon as={icon} size={IconSize.md} color={active ? theme.accent : theme.textSecondary} />
      ) : (
        <Text style={[styles.rowMarkLetter, active && { color: theme.accent }]}>{letter}</Text>
      )}
    </View>
  );
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  error,
  ...inputProps
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  error?: string | null;
} & Omit<TextInputProps, 'value' | 'onChangeText' | 'placeholder' | 'secureTextEntry'>) {
  const { theme, styles } = useZOZARTheme();
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.subtle}
        secureTextEntry={secureTextEntry}
        style={[styles.input, Boolean(error) && { borderColor: theme.error }, inputProps.style]}
      />
      {/* Errors sit against the field they describe, not collected at the top of the form
          where the reader has to work out which input is wrong. */}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'warning' }) {
  const { theme, styles } = useZOZARTheme();
  const color = tone === 'success' ? theme.success : tone === 'warning' ? theme.warning : theme.muted;
  const background =
    tone === 'success' ? theme.successSurface : tone === 'warning' ? theme.warningSurface : theme.surfaceStrong;
  return (
    <View style={[styles.pill, { backgroundColor: background }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

/** An empty screen is an invitation to act, so it names the action rather than describing
 * the absence. */
export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  const { theme, styles } = useZOZARTheme();
  return (
    <View style={styles.emptyState}>
      {icon ? <Icon as={icon} size={IconSize.xl} color={theme.subtle} /> : null}
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDetail}>{detail}</Text>
      {action}
    </View>
  );
}

export function BackButton({ label = 'Back' }: { label?: string }) {
  const { theme, styles } = useZOZARTheme();
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.back()}
      rippleColor={theme.surfaceStrong}
      borderless
      style={styles.backButton}
    >
      <Icon as={ArrowLeft} size={IconSize.lg} color={theme.text} />
      <Text style={styles.backText}>{label}</Text>
    </Touchable>
  );
}

export function OptionRow({
  label,
  detail,
  selected,
  onPress,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { theme, styles } = useZOZARTheme();
  return (
    <Touchable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      rippleColor={theme.surfaceStrong}
      style={[styles.optionRow, selected && { borderColor: theme.accent, backgroundColor: theme.backgroundSelected }]}
    >
      <View style={[styles.radio, selected && { borderColor: theme.accent }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: theme.accent }]} /> : null}
      </View>
      <View style={styles.optionCopy}>
        <Text style={styles.optionLabel}>{label}</Text>
        {detail ? <Text style={styles.optionDetail}>{detail}</Text> : null}
      </View>
    </Touchable>
  );
}

export function BrandBar({ showProfile = true }: { showProfile?: boolean }) {
  const { theme, styles } = useZOZARTheme();
  const { preference, setPreference } = useAppearance();
  const { signOut, updateProfilePhoto, userName, profilePhotoUri } = useZOZARStore();
  const [accountOpen, setAccountOpen] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const profileName = userName || 'Your profile';
  const avatarCharacter = deterministicAvatar(profileName);

  return (
    <View style={styles.brandBar}>
      <Touchable
        accessibilityRole="button"
        accessibilityLabel="Go to tonight"
        onPress={() => router.replace('/tonight' as never)}
        rippleColor={theme.surfaceStrong}
        borderless
        style={styles.brandRow}
      >
        <Image source={require('../../assets/images/zo-zar-mark-flat.png')} style={styles.brandLogo} resizeMode="contain" />
        <Text style={styles.brand}>ZO-ZAR</Text>
      </Touchable>

      {showProfile ? (
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Open account settings"
          onPress={() => setAccountOpen(true)}
          rippleColor={theme.surfaceStrong}
          style={styles.profileRow}
        >
          <View style={[styles.avatar, { backgroundColor: theme.warmSurface }]}>
            {profilePhotoUri ? (
              <Image source={{ uri: profilePhotoUri }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarCharacter}>{avatarCharacter}</Text>
            )}
          </View>
          <Text numberOfLines={1} style={styles.profileName}>
            {profileName}
          </Text>
          <Icon as={ChevronDown} size={IconSize.sm} color={theme.subtle} />
        </Touchable>
      ) : null}

      <Modal visible={accountOpen} transparent animationType="fade" onRequestClose={() => setAccountOpen(false)}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close account settings"
          onPress={() => setAccountOpen(false)}
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]}
        />
        <SafeAreaView pointerEvents="box-none" style={styles.accountOverlay}>
          <View accessibilityViewIsModal style={styles.accountSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.accountTitle}>{profileName}</Text>
            <Text style={styles.cardDetail}>Choose how ZO-ZAR looks on this device.</Text>

            <Touchable
              accessibilityRole="button"
              accessibilityLabel="Choose profile photo"
              disabled={photoBusy}
              rippleColor={theme.surfaceStrong}
              onPress={async () => {
                const result = await ImagePicker.launchImageLibraryAsync({
                  mediaTypes: ['images'],
                  allowsEditing: true,
                  aspect: [1, 1],
                  quality: 0.82,
                });
                if (!result.canceled && result.assets[0]?.uri) {
                  setPhotoBusy(true);
                  try {
                    await updateProfilePhoto(result.assets[0].uri);
                  } finally {
                    setPhotoBusy(false);
                  }
                }
              }}
              style={[styles.appearanceOption, { marginTop: Spacing.lg }]}
            >
              <Text style={styles.optionLabel}>
                {photoBusy ? 'Uploading photo' : profilePhotoUri ? 'Change profile photo' : 'Add profile photo'}
              </Text>
              <Icon as={Plus} size={IconSize.md} color={theme.accent} />
            </Touchable>

            <View accessibilityRole="radiogroup" style={styles.appearanceGroup}>
              {(['system', 'light', 'dark'] as AppearancePreference[]).map((option) => (
                <Touchable
                  key={option}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: preference === option }}
                  accessibilityLabel={option}
                  onPress={() => void setPreference(option)}
                  rippleColor={theme.surfaceStrong}
                  style={[
                    styles.appearanceOption,
                    preference === option && { borderColor: theme.accent, backgroundColor: theme.backgroundSelected },
                  ]}
                >
                  <Text style={styles.optionLabel}>{option[0]!.toUpperCase() + option.slice(1)}</Text>
                  {preference === option ? <Icon as={Check} size={IconSize.md} color={theme.accent} /> : null}
                </Touchable>
              ))}
            </View>

            <Touchable
              accessibilityRole="button"
              accessibilityLabel="Close account settings"
              rippleColor={theme.surfaceStrong}
              onPress={() => setAccountOpen(false)}
              style={styles.signOutButton}
            >
              <Text style={styles.secondaryText}>Close</Text>
            </Touchable>
            <Touchable
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              rippleColor={theme.errorSurface}
              onPress={async () => {
                setAccountOpen(false);
                await signOut();
                router.replace('/sign-in' as never);
              }}
              style={styles.signOutButton}
            >
              <Text style={[styles.secondaryText, { color: theme.error }]}>Sign out</Text>
            </Touchable>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

/** Icons used by screens, re-exported so a screen imports one module rather than reaching
 * into the icon library directly and drifting from the set. */
export const Icons = {
  alarm: AlarmClock,
  close: X,
  edit: Pencil,
  lock: Lock,
  more: MoreHorizontal,
  play: Play,
  stop: Square,
  trash: Trash2,
  listChecks: ListChecks,
  sun: Sunrise,
  userPlus: UserPlus,
  users: Users,
  back: ArrowLeft,
  check: Check,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  mic: Mic,
  plus: Plus,
  send: Send,
  shield: ShieldCheck,
  moon: Moon,
  letter: MailOpen,
  clock: Clock3,
  refresh: RotateCw,
} as const;

function makeUIStyles(theme: Theme) {
  const hairline = StyleSheet.hairlineWidth;

  return StyleSheet.create({
    safeArea: { flex: 1 },
    flex: { flex: 1 },
    flexOne: { flex: 1 },
    scrollContent: {
      paddingHorizontal: Spacing.xl,
      paddingBottom: Spacing.xxxl,
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
    },

    // Chrome stays quiet: it is navigation, not content.
    brandBar: { minHeight: 64, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    brandRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingRight: Spacing.sm },
    brandLogo: { width: 26, height: 26, borderRadius: Radius.tight },
    brand: { ...Type.label, color: theme.textSecondary, letterSpacing: 1.6 },
    profileRow: {
      minHeight: 48,
      maxWidth: '55%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingLeft: Spacing.sm,
    },
    avatar: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
    avatarImage: { width: '100%', height: '100%' },
    avatarCharacter: { fontSize: 16, lineHeight: 20 },
    profileName: { ...Type.caption, flexShrink: 1, color: theme.textSecondary },
    chevron: { color: theme.subtle, fontSize: 16 },

    // The hero. No container, maximum scale contrast.
    hero: { paddingTop: Spacing.xxl, paddingBottom: Spacing.xl },
    heroLabel: { ...Type.label, color: theme.textSecondary, marginBottom: Spacing.sm },
    heroTime: { ...Type.clock, color: theme.text },
    heroDetail: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.sm },

    intro: { paddingTop: Spacing.xl, paddingBottom: Spacing.lg },
    eyebrow: { ...Type.label, color: theme.textSecondary, marginBottom: Spacing.sm },
    pageTitle: { ...Type.title, color: theme.text },
    lede: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.sm },

    sectionLabel: { ...Type.label, color: theme.textSecondary, marginBottom: Spacing.md },
    sectionHeading: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: Spacing.md,
      marginBottom: Spacing.md,
      marginTop: Spacing.xl,
    },
    sectionKicker: { ...Type.label, color: theme.textSecondary, marginBottom: Spacing.xs },
    sectionTitle: { ...Type.heading, color: theme.text },
    sectionAction: { ...Type.callout, color: theme.accent },
    sectionActionTarget: { minHeight: 48, justifyContent: 'center', paddingHorizontal: Spacing.sm },

    // Hearth cards are a raised surface and nothing else: no border, no shadow. The
    // limestone/olive step between background and surface is the whole edge.
    card: {
      borderRadius: Radius.card,
      backgroundColor: theme.surface,
      padding: Spacing.xl,
      marginBottom: Spacing.md,
    },
    cardTitle: { ...Type.heading, color: theme.text },
    cardDetail: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.sm },

    // Gold with dark ink in both appearances, per the brief. One per decision.
    primaryButton: {
      minHeight: 52,
      borderRadius: Radius.button,
      paddingHorizontal: Spacing.xl,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      backgroundColor: theme.fill,
      overflow: 'hidden',
    },
    primaryText: { ...Type.action, color: theme.onFill },
    primaryGlyph: { color: theme.onFill, fontSize: 18 },
    // Hearth's secondary: the raised surface, no outline. Clearly a button, clearly not
    // the one you are meant to press first.
    secondaryButton: {
      minHeight: 52,
      borderRadius: Radius.button,
      backgroundColor: theme.surface,
      paddingHorizontal: Spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      overflow: 'hidden',
    },
    secondaryText: { ...Type.action, color: theme.text },
    secondaryGlyph: { color: theme.text, fontSize: 18 },
    pressed: { opacity: 0.72 },
    disabled: { opacity: 0.4 },

    hearthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      minHeight: 64,
      paddingVertical: Spacing.md,
      borderBottomWidth: hairline,
      borderBottomColor: theme.line,
    },
    hearthRowLast: { borderBottomWidth: 0 },
    hearthLeading: { alignItems: 'center', justifyContent: 'center' },
    hearthCopy: { flex: 1, minWidth: 0 },
    hearthTitle: { ...Type.callout, fontSize: 16, color: theme.text },
    hearthDimmed: { color: theme.subtle, textDecorationLine: 'line-through' },
    hearthDetail: { ...Type.caption, color: theme.textSecondary, marginTop: 3 },
    rowMark: {
      width: 40,
      height: 40,
      borderRadius: 999,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowMarkLetter: { ...Type.callout, fontFamily: Fonts.semibold, color: theme.text },

    field: { gap: Spacing.sm, marginBottom: Spacing.lg },
    fieldLabel: { ...Type.label, color: theme.textSecondary },
    fieldError: { ...Type.caption, color: theme.error },
    input: {
      minHeight: 52,
      borderWidth: hairline,
      borderColor: theme.lineStrong,
      borderRadius: Radius.row,
      paddingHorizontal: Spacing.lg,
      color: theme.text,
      backgroundColor: theme.surface,
      ...Type.body,
    },

    pill: { alignSelf: 'flex-start', borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
    pillText: { ...Type.caption, fontFamily: Fonts.medium },

    emptyState: { alignItems: 'center', paddingVertical: Spacing.xxl, gap: Spacing.md },
    emptyIcon: { color: theme.subtle, fontSize: 28 },
    emptyTitle: { ...Type.heading, color: theme.text, textAlign: 'center' },
    emptyDetail: { ...Type.body, color: theme.textSecondary, textAlign: 'center', maxWidth: 300 },

    accountOverlay: { flex: 1, justifyContent: 'flex-end' },
    accountSheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: Radius.sheet,
      borderTopRightRadius: Radius.sheet,
      borderWidth: hairline,
      borderColor: theme.line,
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.xl,
    },
    sheetHandle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.lineStrong,
      alignSelf: 'center',
      marginBottom: Spacing.xl,
    },
    accountTitle: { ...Type.title, color: theme.text },
    appearanceGroup: { gap: Spacing.sm, marginVertical: Spacing.xl },
    appearanceOption: {
      minHeight: 52,
      borderRadius: Radius.row,
      borderWidth: hairline,
      borderColor: theme.line,
      paddingHorizontal: Spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      overflow: 'hidden',
    },
    signOutButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm },

    bottomTabs: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      minHeight: 72,
      borderTopWidth: hairline,
      borderTopColor: theme.line,
      backgroundColor: theme.background,
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.md,
    },
    tab: { minWidth: 60, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
    tabIcon: { color: theme.subtle, fontSize: 20 },
    tabIconActive: { color: theme.accent },
    tabLabel: { ...Type.caption, fontSize: 11, color: theme.subtle },
    tabLabelActive: { color: theme.text },

    backButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 48, alignSelf: 'flex-start' },
    backGlyph: { color: theme.text, fontSize: 20 },
    backText: { ...Type.action, color: theme.text },

    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      borderWidth: hairline,
      borderColor: theme.line,
      borderRadius: Radius.row,
      padding: Spacing.lg,
      marginBottom: Spacing.sm,
      overflow: 'hidden',
    },
    radio: {
      width: 20,
      height: 20,
      borderWidth: 1.5,
      borderColor: theme.lineStrong,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
    },
    radioDot: { width: 10, height: 10, borderRadius: 5 },
    optionCopy: { flex: 1, gap: Spacing.xs },
    optionLabel: { ...Type.callout, color: theme.text },
    optionDetail: { ...Type.caption, color: theme.textSecondary },

    buttonRow: { flexDirection: 'row', justifyContent: 'flex-start', marginBottom: Spacing.lg },
    composer: { marginBottom: Spacing.xl },
    composerFields: { marginTop: Spacing.lg },
    spacerSection: { marginTop: Spacing.xxl },
    inlineRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },

    list: { borderTopWidth: hairline, borderTopColor: theme.line },
    listRow: {
      minHeight: 64,
      borderBottomWidth: hairline,
      borderBottomColor: theme.line,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.md,
    },
    listCopy: { flex: 1, gap: 2 },
    listTitle: { ...Type.callout, color: theme.text },
    listDone: { color: theme.subtle, textDecorationLine: 'line-through' },
    listDetail: { ...Type.caption, color: theme.textSecondary },
    listTime: { ...Type.clockRow, color: theme.textSecondary },
    rowChevron: { color: theme.subtle, fontSize: 20 },

    check: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: theme.lineStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkDone: { backgroundColor: theme.success, borderColor: theme.success },
    checkText: { color: theme.accentContrast, fontSize: 12 },

    heroCard: { padding: 0, overflow: 'hidden', marginBottom: Spacing.xl },
    heroCopy: { flex: 1, padding: Spacing.xl, gap: Spacing.lg },
    kickerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.success },
    inverseKicker: { ...Type.label, color: theme.inverseTextSecondary },
    heroTitle: { ...Type.heading, color: theme.inverseText },
    heroTimeLabel: { ...Type.caption, color: theme.textSecondary },
    heroTimeValue: { ...Type.clockSmall, color: theme.text },
    inverseLink: { ...Type.action, color: theme.inverseText },
    protectedText: { ...Type.caption, color: theme.inverseTextSecondary },
    heroActions: { gap: Spacing.sm },

    iconBox: {
      width: 40,
      height: 40,
      borderWidth: hairline,
      borderColor: theme.lineStrong,
      borderRadius: Radius.tight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconText: { color: theme.text, fontSize: 20 },
    divider: { height: hairline, backgroundColor: theme.line, marginVertical: Spacing.lg },
    actionRow: { minHeight: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    actionText: { ...Type.action, color: theme.text },
    actionArrow: { color: theme.subtle, fontSize: 18 },

    personAvatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.surfaceStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    personAvatarText: { ...Type.callout, color: theme.text },

    helperGlyph: { color: theme.success, fontSize: 18 },
    helperText: { ...Type.caption, color: theme.textSecondary, marginTop: Spacing.md },
    linkedWake: { ...Type.caption, color: theme.textSecondary, marginTop: Spacing.md },
    commitmentCard: { paddingVertical: Spacing.lg },
    permissionCaption: {
      ...Type.caption,
      color: theme.textSecondary,
      marginTop: Spacing.md,
      paddingTop: Spacing.md,
      borderTopWidth: hairline,
      borderTopColor: theme.line,
    },
    actionPair: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.xl },

    wakeHero: { padding: Spacing.xl, marginBottom: Spacing.lg },
    wakeHeroTime: { ...Type.clock, color: theme.text, marginTop: Spacing.md },
    wakeHeroDetail: { ...Type.body, color: theme.textSecondary },
    heroDivider: { height: hairline, backgroundColor: theme.line, marginVertical: Spacing.lg },
    inverseIcon: { color: theme.inverseText, fontSize: 20 },
    inverseCardTitle: { ...Type.callout, color: theme.inverseText },
    inverseCardDetail: { ...Type.caption, color: theme.inverseTextSecondary, marginTop: Spacing.xs },
    permissionStatus: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
    successDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.success },

    authTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.xl, marginBottom: Spacing.huge },
    authMark: {
      width: 28,
      height: 28,
      borderWidth: 2,
      borderColor: theme.text,
      borderRadius: Radius.tight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    authHand: { width: 8, height: 2, backgroundColor: theme.text, transform: [{ rotate: '35deg' }], marginLeft: 4 },
    authBrand: { ...Type.heading, color: theme.text },
    authIntro: { marginBottom: Spacing.xl },
    authTitle: { ...Type.title, color: theme.text },
    authDetail: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.sm },
    authLink: { paddingVertical: Spacing.lg, alignItems: 'center', minHeight: 48 },
    authLinkText: { ...Type.callout, color: theme.textSecondary },
    authLinkStrong: { color: theme.accent, fontFamily: Fonts.semibold },
    authNote: { marginTop: Spacing.xxl, borderTopWidth: hairline, borderTopColor: theme.line, paddingTop: Spacing.lg },
    authNoteTitle: { ...Type.callout, color: theme.text },
    authNoteText: { ...Type.caption, color: theme.textSecondary, marginTop: Spacing.xs },

    onboardingHeader: { paddingTop: Spacing.xxl, marginBottom: Spacing.lg },
    permissionNotice: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start', backgroundColor: theme.surfaceStrong },
    permissionNoticeIcon: { color: theme.success, fontSize: 22 },
    permissionNoticeCopy: { flex: 1 },
    permissionList: { marginBottom: Spacing.md },
    permissionCard: { flexDirection: 'row', gap: Spacing.md, padding: Spacing.lg },
    permissionNumber: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: theme.surfaceStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    permissionNumberText: { ...Type.caption, color: theme.text },
    permissionCopy: { flex: 1 },
    permissionAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.md, minHeight: 48 },
    permissionActionText: { ...Type.action, color: theme.accent },
    permissionArrow: { color: theme.accent, fontSize: 18 },
    skipButton: { paddingVertical: Spacing.lg, alignItems: 'center', minHeight: 48 },
    skipText: { ...Type.callout, color: theme.textSecondary },

    circleHero: { padding: Spacing.xl, marginBottom: Spacing.xl },
    circleHeroTitle: { ...Type.heading, color: theme.inverseText, marginTop: Spacing.md, marginBottom: Spacing.sm },

    chatHeader: {
      minHeight: 64,
      paddingHorizontal: Spacing.lg,
      borderBottomWidth: hairline,
      borderBottomColor: theme.line,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
    },
    chatHeaderIcon: { color: theme.subtle, fontSize: 20, marginLeft: 'auto' },
    chatName: { ...Type.callout, color: theme.text },
    chatStatus: { ...Type.caption, color: theme.textSecondary, marginTop: 2 },
    chatPrivacy: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.md,
    },
    chatPrivacyText: { ...Type.caption, color: theme.subtle },
    chatMessages: { flex: 1, padding: Spacing.lg, justifyContent: 'flex-end' },
    messageRow: { alignItems: 'flex-start', marginBottom: Spacing.sm },
    messageRowMe: { alignItems: 'flex-end' },
    messageBubble: { maxWidth: '82%', borderRadius: Radius.card, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
    messageText: { ...Type.body },
    messageTime: { ...Type.caption, fontSize: 11, marginTop: Spacing.xs },
    voiceBubble: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    voiceIcon: { fontSize: 14 },
    voiceText: { ...Type.caption },
    voiceShell: {
      borderTopWidth: hairline,
      borderTopColor: theme.line,
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.xs,
    },
    voiceShellText: { ...Type.caption, fontSize: 11, color: theme.textSecondary },
    composerBar: {
      minHeight: 64,
      borderTopWidth: hairline,
      borderTopColor: theme.line,
      paddingHorizontal: Spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    recordButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: theme.surfaceStrong,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    recordIcon: { color: theme.text, fontSize: 16 },
    chatInput: {
      flex: 1,
      minHeight: 48,
      borderWidth: hairline,
      borderColor: theme.lineStrong,
      borderRadius: Radius.pill,
      paddingHorizontal: Spacing.lg,
      color: theme.text,
      ...Type.body,
    },
    sendButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: theme.accent,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    sendGlyph: { color: theme.accentContrast, fontSize: 18 },

    wakeConfirmTop: { alignItems: 'center', paddingTop: Spacing.xxl, paddingBottom: Spacing.xl },
    alarmRing: {
      width: 72,
      height: 72,
      borderWidth: 1.5,
      borderColor: theme.accent,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: Spacing.xl,
    },
    alarmIcon: { color: theme.accent, fontSize: 30 },
    wakeConfirmTitle: { ...Type.title, color: theme.text, textAlign: 'center', marginTop: Spacing.sm },
    wakeConfirmDetail: { ...Type.body, color: theme.textSecondary, textAlign: 'center', marginTop: Spacing.sm, maxWidth: 320 },
    wakeConfirmNote: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xl, paddingHorizontal: Spacing.sm },

    taskCard: { padding: Spacing.xl },
    taskHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    taskDifficulty: { ...Type.label, color: theme.textSecondary },
    taskPrompt: { ...Type.title, color: theme.text, marginTop: Spacing.xl, marginBottom: Spacing.lg },
    taskChoice: {
      minHeight: 56,
      borderWidth: hairline,
      borderColor: theme.lineStrong,
      borderRadius: Radius.row,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: Spacing.md,
      overflow: 'hidden',
    },
    taskChoiceText: { ...Type.heading, color: theme.text, fontVariant: ['tabular-nums'] },

    successCard: { alignItems: 'center', padding: Spacing.xl, gap: Spacing.md },
    successIcon: { color: theme.success, fontSize: 36 },
  });
}
