import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Touchable } from '@/components/motion';
import { useZOZARStore, type CircleMember } from '@/components/zo-zar-store';
import {
  BrandBar,
  Icon,
  Icons,
  Screen,
  TextField,
  deterministicAvatar,
  useZOZARTheme,
} from '@/components/zo-zar-ui';
import { IconSize, Radius, Spacing, Type, type Theme } from '@/constants/theme';

/**
 * People.
 *
 * The old screen listed contacts and hung four buttons off each one: invite, accept,
 * decline, remove. That is an address book, and an address book is the wrong object. The
 * thing being modelled is that somebody has agreed to be woken up on your behalf — a
 * real favour between two people, and the only reason this app is not just a clock.
 *
 * Slowly's idea is that a connection should carry weight and take time: letters that
 * travel, stamps you keep. So:
 *
 * - An accepted person is a **standing mark**, not a row: their initial set large in
 *   warm ink, with plain language about exactly what they receive. No buttons on it —
 *   you touch the person to talk to them, and remove sits behind a long press because it
 *   ends something.
 * - An invitation you sent is **in transit**, and says so. It has left, it has not
 *   arrived, and there is nothing to do but wait. More honest than a row with a greyed
 *   out button.
 * - An invitation you received is the one place two real choices exist, so it gets two
 *   plain text actions rather than a filled button fighting a ghost button.
 */

const MAX_CIRCLE = 3;

export default function PeopleRoute() {
  const { theme } = useZOZARTheme();
  const local = useMemo(() => makeStyles(theme), [theme]);
  const { members, addMember, respondToInvitation, removeMember } = useZOZARStore();

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [memberBusy, setMemberBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accepted = members.filter((member) => member.status === 'Accepted');
  const incoming = members.filter((member) => member.status === 'Pending' && member.relationship === 'incoming');
  const outgoing = members.filter((member) => member.status === 'Pending' && member.relationship === 'outgoing');
  const full = accepted.length + outgoing.length >= MAX_CIRCLE;

  async function invite() {
    const value = email.trim();
    if (!value.includes('@') || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addMember(value);
      setEmail('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The invitation could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  async function act(member: CircleMember, action: 'accept' | 'decline' | 'remove') {
    if (memberBusy) return;
    setMemberBusy(member.id);
    setError(null);
    try {
      if (action === 'accept') await respondToInvitation(member.id, true);
      else if (action === 'decline') await respondToInvitation(member.id, false);
      else await removeMember(member.id);
      setConfirming(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That change could not be saved.');
    } finally {
      setMemberBusy(null);
    }
  }

  const headline =
    accepted.length === 0
      ? 'Nobody has your back yet'
      : accepted.length === 1
        ? `${accepted[0].name.split(/\s+/)[0]} has your back`
        : `${accepted.length} people have your back`;

  return (
    <Screen>
      <BrandBar />

      <View style={local.intro}>
        <Text accessibilityRole="header" style={local.title}>
          {headline}
        </Text>
        <Text style={local.lede}>
          {accepted.length === 0
            ? 'Pick someone who would actually get out of bed and check on you. They only see the alarms you link them to — nothing else.'
            : 'They are told when you sleep through a linked alarm, and never anything else about your day.'}
        </Text>
      </View>

      {error ? (
        <Text accessibilityRole="alert" style={local.error}>
          {error}
        </Text>
      ) : null}

      {accepted.map((member) => (
        <View key={member.id}>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel={`Message ${member.name}`}
            accessibilityHint="Long press to remove them from your circle"
            onPress={() => router.push(`/chat/${member.id}` as never)}
            onLongPress={() => setConfirming(member.id)}
            rippleColor={theme.surfaceStrong}
            style={local.person}
          >
            <View style={local.mark}>
              <Text style={local.markCharacter}>{deterministicAvatar(member.name)}</Text>
            </View>
            <View style={local.personBody}>
              <Text style={local.personName}>{member.name}</Text>
              <Text style={local.personDetail}>{member.detail}</Text>
              <View style={local.promise}>
                <Icon as={Icons.shield} size={IconSize.sm} color={theme.warm} />
                <Text style={local.promiseText}>Woken if you are not</Text>
              </View>
            </View>
          </Touchable>

          {confirming === member.id ? (
            <View style={local.confirm}>
              <Text style={local.confirmText}>
                Remove {member.name}? They stop hearing about your wakes.
              </Text>
              <View style={local.confirmRow}>
                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel="Keep things as they are"
                  onPress={() => setConfirming(null)}
                  rippleColor={theme.surfaceStrong}
                  style={local.textAction}
                >
                  <Text style={local.keepText}>Keep</Text>
                </Touchable>
                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${member.name}`}
                  accessibilityState={{ busy: memberBusy === member.id }}
                  disabled={memberBusy === member.id}
                  onPress={() => void act(member, 'remove')}
                  rippleColor={theme.errorSurface}
                  style={local.textAction}
                >
                  <Text style={local.removeText}>
                    {memberBusy === member.id ? 'Removing…' : 'Remove'}
                  </Text>
                </Touchable>
              </View>
            </View>
          ) : null}
        </View>
      ))}

      {incoming.map((member) => (
        <View key={member.id} style={local.letter}>
          <View style={local.letterHead}>
            <Icon as={Icons.letter} size={IconSize.md} color={theme.accent} />
            <Text style={local.letterTitle}>{member.name} asked you</Text>
          </View>
          <Text style={local.letterBody}>
            They want you to be the one who hears about it when they sleep through. You can say no.
          </Text>
          <View style={local.confirmRow}>
            <Touchable
              accessibilityRole="button"
              accessibilityLabel={`Decline ${member.name}`}
              disabled={memberBusy === member.id}
              onPress={() => void act(member, 'decline')}
              rippleColor={theme.surfaceStrong}
              style={local.textAction}
            >
              <Text style={local.keepText}>Not me</Text>
            </Touchable>
            <Touchable
              accessibilityRole="button"
              accessibilityLabel={`Accept ${member.name}`}
              accessibilityState={{ busy: memberBusy === member.id }}
              disabled={memberBusy === member.id}
              onPress={() => void act(member, 'accept')}
              rippleColor={theme.surfaceStrong}
              style={local.textAction}
            >
              <Text style={local.acceptText}>
                {memberBusy === member.id ? 'Saving…' : "I'll do it"}
              </Text>
            </Touchable>
          </View>
        </View>
      ))}

      {outgoing.map((member) => (
        <View key={member.id}>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel={`Invitation to ${member.name}, waiting`}
            accessibilityHint="Long press to cancel this invitation"
            onLongPress={() => setConfirming(member.id)}
            rippleColor={theme.surfaceStrong}
            style={local.transit}
          >
            <View style={local.transitMark}>
              <Icon as={Icons.letter} size={IconSize.md} color={theme.subtle} />
            </View>
            <View style={local.personBody}>
              <Text style={local.transitName}>{member.name}</Text>
              <Text style={local.personDetail}>Sent. Waiting for them to say yes.</Text>
            </View>
          </Touchable>

          {confirming === member.id ? (
            <View style={local.confirm}>
              <Text style={local.confirmText}>Cancel the invitation to {member.name}?</Text>
              <View style={local.confirmRow}>
                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel="Leave the invitation open"
                  onPress={() => setConfirming(null)}
                  rippleColor={theme.surfaceStrong}
                  style={local.textAction}
                >
                  <Text style={local.keepText}>Leave it</Text>
                </Touchable>
                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel={`Cancel the invitation to ${member.name}`}
                  disabled={memberBusy === member.id}
                  onPress={() => void act(member, 'remove')}
                  rippleColor={theme.errorSurface}
                  style={local.textAction}
                >
                  <Text style={local.removeText}>
                    {memberBusy === member.id ? 'Cancelling…' : 'Cancel it'}
                  </Text>
                </Touchable>
              </View>
            </View>
          ) : null}
        </View>
      ))}

      {/*
        One field, no button. The keyboard already has a send key, and a filled "Invite"
        beside a single input is a button that exists only to look like a form.
      */}
      {full ? (
        <Text style={local.limit}>
          That is everyone. {MAX_CIRCLE} is the limit, so the people who get woken for you stay
          people you would actually ask.
        </Text>
      ) : (
        <View style={local.inviteBlock}>
          <TextField
            label="Ask someone"
            value={email}
            onChangeText={setEmail}
            placeholder="their@email.com"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            returnKeyType="send"
            onSubmitEditing={() => void invite()}
          />
          <Text style={local.inviteHint}>
            {busy
              ? 'Sending…'
              : 'They need a ZO-ZAR account to accept, and get one message asking if they are willing. Nothing is shared until they say yes.'}
          </Text>
        </View>
      )}
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    intro: { paddingTop: Spacing.xl, paddingBottom: Spacing.xl },
    title: { ...Type.title, color: theme.text },
    lede: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.sm, maxWidth: 440 },
    error: { ...Type.callout, color: theme.error, marginBottom: Spacing.lg },

    person: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: Spacing.lg, gap: Spacing.lg },
    /** The person's initial, set large in warm ink — a mark, not an avatar chip. */
    mark: {
      width: 56,
      height: 56,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: theme.warm,
      backgroundColor: theme.warmSurface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markCharacter: { ...Type.heading, color: theme.warm },
    personBody: { flex: 1, paddingTop: Spacing.xs },
    personName: { ...Type.heading, color: theme.text },
    personDetail: { ...Type.caption, color: theme.subtle, marginTop: 2 },
    promise: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.sm },
    promiseText: { ...Type.caption, color: theme.warm },

    /** An invitation that has arrived. Treated as a letter, because that is what it is. */
    letter: {
      borderWidth: 1,
      borderColor: theme.lineStrong,
      borderRadius: Radius.card,
      padding: Spacing.lg,
      marginBottom: Spacing.lg,
      backgroundColor: theme.surface,
    },
    letterHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    letterTitle: { ...Type.heading, color: theme.text },
    letterBody: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.sm },

    /** An invitation still travelling. Deliberately quieter than an accepted person. */
    transit: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.lg, gap: Spacing.lg },
    transitMark: {
      width: 56,
      height: 56,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: theme.lineStrong,
      borderStyle: 'dashed',
      alignItems: 'center',
      justifyContent: 'center',
    },
    transitName: { ...Type.callout, color: theme.textSecondary },

    confirm: {
      borderTopWidth: 1,
      borderTopColor: theme.line,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.lg,
      gap: Spacing.sm,
    },
    confirmText: { ...Type.callout, color: theme.text },
    confirmRow: { flexDirection: 'row', gap: Spacing.xl, marginTop: Spacing.sm },
    textAction: { minHeight: 48, justifyContent: 'center' },
    keepText: { ...Type.action, color: theme.textSecondary },
    acceptText: { ...Type.action, color: theme.accent },
    removeText: { ...Type.action, color: theme.error },

    inviteBlock: { paddingTop: Spacing.xl, gap: Spacing.sm },
    inviteHint: { ...Type.caption, color: theme.subtle, maxWidth: 440 },
    limit: { ...Type.caption, color: theme.subtle, paddingTop: Spacing.xl, maxWidth: 440 },
  });
