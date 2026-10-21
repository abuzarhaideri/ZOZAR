import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Touchable, announce } from '@/components/motion';
import { useZOZARStore, type ChatMessage, type CircleMember } from '@/components/zo-zar-store';
import {
  BrandBar,
  HearthRow,
  Icon,
  Icons,
  PrimaryButton,
  RowMark,
  Screen,
  SecondaryButton,
  TextField,
  deterministicAvatar,
  useZOZARTheme,
} from '@/components/zo-zar-ui';
import { IconSize, Radius, Spacing, Type, type Theme } from '@/constants/theme';

/**
 * People, in Hearth.
 *
 * The relationship comes before the management. The screen opens with a note from the
 * first person who has agreed to look out for you: their latest message if there is one,
 * or a plain prompt to write to them if there is not. It never invents a message.
 *
 * Below it, the circle as rows. Each state reads differently, because a letter alone must
 * never suggest that protection is on:
 *
 * - Accepted: their initial in the selected mark, and exactly what they receive. Tap to
 *   talk, long press to remove (TalkBack exposes the long press as an action).
 * - Asked you: two literal text actions, "I'll do it" and "Not me".
 * - Invited by you: an envelope, not their initial, and says it is waiting.
 *
 * Inviting is one quiet button that opens the email field in place, with a literal
 * "Send invitation" as the single primary action.
 */

const MAX_CIRCLE = 3;

type Note =
  | { state: 'loading'; memberId: string | null }
  | { state: 'empty'; memberId: string }
  | { state: 'message'; memberId: string; message: ChatMessage };

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

export default function PeopleRoute() {
  const { theme } = useZOZARTheme();
  const local = useMemo(() => makeStyles(theme), [theme]);
  const { members, repository, addMember, respondToInvitation, removeMember } = useZOZARStore();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [memberBusy, setMemberBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [note, setNote] = useState<Note>({ state: 'loading', memberId: null });

  const accepted = members.filter((member) => member.status === 'Accepted');
  const incoming = members.filter((member) => member.status === 'Pending' && member.relationship === 'incoming');
  const outgoing = members.filter((member) => member.status === 'Pending' && member.relationship === 'outgoing');
  const full = accepted.length + outgoing.length >= MAX_CIRCLE;
  const noteMember = accepted[0] ?? null;
  const noteMemberId = noteMember?.id ?? null;

  // Read the first accepted person's thread for the note card. This reads the repository
  // directly rather than through loadMessages, because the store keeps one shared message
  // list for whichever chat is open and the note must not overwrite it. One request per
  // focus; failure falls back to the prompt rather than an error, since the card is a
  // greeting, not a status.
  useFocusEffect(
    useCallback(() => {
      if (!noteMemberId) return undefined;
      let active = true;
      // Keep a message already shown for this same person while it refreshes; anything
      // read for a different person is dropped, so their words never sit under this name.
      setNote((current) =>
        current.state === 'message' && current.memberId === noteMemberId
          ? current
          : { state: 'loading', memberId: noteMemberId },
      );
      repository
        .listMessages(noteMemberId)
        .then((items) => {
          if (!active) return;
          const latest = [...items].reverse().find((item) => item.author === 'them' && item.kind !== 'system');
          setNote(
            latest
              ? { state: 'message', memberId: noteMemberId, message: latest }
              : { state: 'empty', memberId: noteMemberId },
          );
        })
        .catch(() => {
          if (active) setNote({ state: 'empty', memberId: noteMemberId });
        });
      return () => {
        active = false;
      };
    }, [noteMemberId, repository]),
  );

  function openInvite() {
    setInviteError(null);
    setInviteOpen(true);
  }

  function closeInvite() {
    setInviteOpen(false);
    setEmail('');
    setInviteError(null);
  }

  async function invite() {
    if (busy) return;
    const value = email.trim();
    if (!value.includes('@')) {
      setInviteError('Enter the email address they use for ZO-ZAR.');
      return;
    }
    setBusy(true);
    setInviteError(null);
    try {
      await addMember(value);
      setEmail('');
      setInviteOpen(false);
      announce(`Invitation sent to ${value}`);
    } catch (caught) {
      setInviteError(caught instanceof Error ? caught.message : 'The invitation could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  async function act(member: CircleMember, action: 'accept' | 'decline' | 'remove') {
    if (memberBusy) return;
    setMemberBusy(member.id);
    setMemberError(null);
    try {
      if (action === 'accept') await respondToInvitation(member.id, true);
      else if (action === 'decline') await respondToInvitation(member.id, false);
      else await removeMember(member.id);
      setConfirming(null);
    } catch (caught) {
      setMemberError(caught instanceof Error ? caught.message : 'That change could not be saved.');
    } finally {
      setMemberBusy(null);
    }
  }

  const hasAnyone = members.length > 0;
  // The note only ever shows what was read for the person it names.
  const shownNote: Note = note.memberId === noteMemberId ? note : { state: 'loading', memberId: noteMemberId };

  return (
    <Screen>
      <BrandBar />

      <View style={local.intro}>
        <Text accessibilityRole="header" style={local.title}>
          {accepted.length > 0 ? 'Your kind of company.' : "Someone who'd check on you."}
        </Text>
        <Text style={local.lede}>
          {accepted.length > 0
            ? 'They hear about it only if you sleep through an alarm you link them to, and nothing else about your day.'
            : 'Pick someone who would actually get up and check on you. Nothing is shared until they say yes.'}
        </Text>
      </View>

      {noteMember ? (
        <View style={local.note}>
          <View style={local.noteHead}>
            <RowMark letter={deterministicAvatar(noteMember.name)} active />
            <View style={local.noteWho}>
              <Text style={local.noteName} numberOfLines={1}>
                {noteMember.name}
              </Text>
              {shownNote.state === 'message' && shownNote.message.timestamp ? (
                <Text style={local.noteTime}>{shownNote.message.timestamp}</Text>
              ) : null}
            </View>
          </View>

          {shownNote.state === 'message' ? (
            shownNote.message.kind === 'voice' ? (
              <Text style={local.notePrompt}>Sent you a voice message.</Text>
            ) : (
              <Text style={local.quote} numberOfLines={6}>
                {`“${shownNote.message.body}”`}
              </Text>
            )
          ) : shownNote.state === 'empty' ? (
            <Text style={local.notePrompt}>Say goodnight to {firstName(noteMember.name)}.</Text>
          ) : null}

          <Touchable
            accessibilityRole="button"
            accessibilityLabel={`Open conversation with ${noteMember.name}`}
            onPress={() => router.push(`/chat/${noteMember.id}` as never)}
            rippleColor={theme.surfaceStrong}
            style={local.textAction}
          >
            <Text style={local.accentText}>Open conversation</Text>
          </Touchable>
        </View>
      ) : null}

      {memberError ? (
        <Text accessibilityRole="alert" style={local.error}>
          {memberError}
        </Text>
      ) : null}

      {hasAnyone ? (
        <View style={local.circle}>
          {accepted.map((member) => (
            <View key={member.id}>
              <HearthRow
                title={member.name}
                detail="Told if you sleep through an alarm linked to them"
                leading={<RowMark letter={deterministicAvatar(member.name)} active />}
                onPress={() => router.push(`/chat/${member.id}` as never)}
                onLongPress={() => setConfirming(member.id)}
                accessibilityLabel={`${member.name}, told if you sleep through an alarm linked to them. Opens your conversation.`}
                accessibilityHint="Actions menu has the option to remove them"
                actions={[{ name: 'remove', label: `Remove ${member.name}`, run: () => setConfirming(member.id) }]}
              />
              {confirming === member.id ? (
                <View style={local.confirm}>
                  <Text style={local.confirmText}>
                    Remove {member.name}? They stop hearing about it when you sleep through.
                  </Text>
                  <View style={local.actionRow}>
                    <Touchable
                      accessibilityRole="button"
                      accessibilityLabel={`Keep ${member.name}`}
                      onPress={() => setConfirming(null)}
                      rippleColor={theme.surfaceStrong}
                      style={local.textAction}
                    >
                      <Text style={local.quietText}>Keep</Text>
                    </Touchable>
                    <Touchable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${member.name}`}
                      accessibilityState={{ busy: memberBusy === member.id, disabled: memberBusy === member.id }}
                      disabled={memberBusy === member.id}
                      onPress={() => void act(member, 'remove')}
                      rippleColor={theme.errorSurface}
                      style={local.textAction}
                    >
                      <Text style={local.removeText}>{memberBusy === member.id ? 'Removing…' : 'Remove'}</Text>
                    </Touchable>
                  </View>
                </View>
              ) : null}
            </View>
          ))}

          {incoming.map((member) => (
            <View key={member.id}>
              <HearthRow
                title={`${member.name} asked you`}
                detail="Not agreed yet"
                leading={<RowMark icon={Icons.letter} />}
                navigates={false}
              />
              {/* Outside the row so it is never cut off at large text sizes. */}
              <Text style={local.askBody}>
                They want you to hear about it if they sleep through. You can say no.
              </Text>
              <View style={local.actionRow}>
                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel={`Accept ${member.name}'s invitation`}
                  accessibilityState={{ busy: memberBusy === member.id, disabled: memberBusy === member.id }}
                  disabled={memberBusy === member.id}
                  onPress={() => void act(member, 'accept')}
                  rippleColor={theme.surfaceStrong}
                  style={local.textAction}
                >
                  <Text style={local.accentText}>{memberBusy === member.id ? 'Saving…' : "I'll do it"}</Text>
                </Touchable>
                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel={`Decline ${member.name}'s invitation`}
                  accessibilityState={{ disabled: memberBusy === member.id }}
                  disabled={memberBusy === member.id}
                  onPress={() => void act(member, 'decline')}
                  rippleColor={theme.surfaceStrong}
                  style={local.textAction}
                >
                  <Text style={local.quietText}>Not me</Text>
                </Touchable>
              </View>
            </View>
          ))}

          {outgoing.map((member) => (
            <View key={member.id}>
              {/* Tapping opens the cancel choice too, so it is not reachable only by long press. */}
              <HearthRow
                title={member.name}
                detail="Invited, waiting for them to accept"
                leading={<RowMark icon={Icons.letter} />}
                navigates={false}
                onPress={() => setConfirming(confirming === member.id ? null : member.id)}
                onLongPress={() => setConfirming(member.id)}
                accessibilityLabel={`${member.name}, invited, waiting for them to accept. Not looking out for you yet.`}
                accessibilityHint="Opens the option to cancel this invitation"
              />
              {confirming === member.id ? (
                <View style={local.confirm}>
                  <Text style={local.confirmText}>Cancel the invitation to {member.name}?</Text>
                  <View style={local.actionRow}>
                    <Touchable
                      accessibilityRole="button"
                      accessibilityLabel="Leave the invitation open"
                      onPress={() => setConfirming(null)}
                      rippleColor={theme.surfaceStrong}
                      style={local.textAction}
                    >
                      <Text style={local.quietText}>Leave it</Text>
                    </Touchable>
                    <Touchable
                      accessibilityRole="button"
                      accessibilityLabel={`Cancel the invitation to ${member.name}`}
                      accessibilityState={{ busy: memberBusy === member.id, disabled: memberBusy === member.id }}
                      disabled={memberBusy === member.id}
                      onPress={() => void act(member, 'remove')}
                      rippleColor={theme.errorSurface}
                      style={local.textAction}
                    >
                      <Text style={local.removeText}>{memberBusy === member.id ? 'Cancelling…' : 'Cancel it'}</Text>
                    </Touchable>
                  </View>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <View style={local.inviteBlock}>
        {full ? (
          <Text style={local.hint}>
            That is everyone. {MAX_CIRCLE} is the limit, so the people who hear about your mornings stay
            people you would actually ask.
          </Text>
        ) : inviteOpen ? (
          <View style={local.inviteForm}>
            <TextField
              label="Their email"
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                if (inviteError) setInviteError(null);
              }}
              placeholder="their@email.com"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              returnKeyType="send"
              autoFocus
              onSubmitEditing={() => void invite()}
              error={inviteError}
            />
            <Text style={local.hint}>
              They need a ZO-ZAR account to accept. Nothing is shared until they say yes.
            </Text>
            <PrimaryButton
              label="Send invitation"
              icon={Icons.send}
              busy={busy}
              disabled={!email.trim()}
              onPress={() => void invite()}
            />
            <Touchable
              accessibilityRole="button"
              accessibilityLabel="Not now, close the invitation"
              onPress={closeInvite}
              rippleColor={theme.surfaceStrong}
              style={[local.textAction, local.centered]}
            >
              <Text style={local.quietText}>Not now</Text>
            </Touchable>
          </View>
        ) : (
          <SecondaryButton
            label="Invite someone"
            icon={Icons.userPlus}
            onPress={openInvite}
            accessibilityHint="Opens a field for their email address"
          />
        )}
      </View>

      {!hasAnyone ? (
        <View style={local.emptyNote}>
          <Icon as={Icons.shield} size={IconSize.sm} color={theme.subtle} />
          <Text style={local.emptyText}>
            Until someone accepts, nobody is told if you sleep through.
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    intro: { paddingTop: Spacing.xl, paddingBottom: Spacing.xl },
    title: { ...Type.title, color: theme.text },
    lede: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.sm, maxWidth: 440 },

    /** Hearth's note card: the relationship, before any management. */
    note: {
      backgroundColor: theme.surface,
      borderRadius: Radius.card,
      padding: Spacing.xl,
      marginBottom: Spacing.xl,
      gap: Spacing.md,
    },
    noteHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    noteWho: { flex: 1 },
    noteName: { ...Type.callout, color: theme.text },
    noteTime: { ...Type.caption, color: theme.subtle },
    quote: { ...Type.title, fontSize: 23, lineHeight: 30, letterSpacing: -0.7, color: theme.text },
    notePrompt: { ...Type.body, color: theme.textSecondary },

    error: { ...Type.callout, color: theme.error, marginBottom: Spacing.md },

    circle: { marginBottom: Spacing.sm },
    confirm: { paddingTop: Spacing.sm, paddingBottom: Spacing.md, gap: Spacing.xs },
    confirmText: { ...Type.callout, color: theme.text },
    askBody: { ...Type.body, color: theme.textSecondary },
    actionRow: { flexDirection: 'row', gap: Spacing.xl, paddingLeft: Spacing.xs },
    textAction: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
    centered: { alignSelf: 'center' },
    accentText: { ...Type.action, color: theme.accent },
    quietText: { ...Type.action, color: theme.textSecondary },
    removeText: { ...Type.action, color: theme.error },

    inviteBlock: { paddingTop: Spacing.xl },
    inviteForm: { gap: Spacing.md },
    hint: { ...Type.caption, color: theme.subtle, maxWidth: 440 },

    emptyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingTop: Spacing.xl },
    emptyText: { ...Type.caption, color: theme.subtle, flex: 1 },
  });
