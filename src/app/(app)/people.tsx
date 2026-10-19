import { router } from 'expo-router';
import { useState, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useZOZARStore, type CircleMember } from '@/components/zo-zar-store';
import {
  BrandBar,
  Card,
  deterministicAvatar,
  EmptyState,
  Icon,
  Icons,
  PrimaryButton,
  Screen,
  SectionLabel,
  TextField,
  useZOZARTheme,
} from '@/components/zo-zar-ui';
import { Touchable } from '@/components/motion';
import { IconSize, Radius, Spacing, Type, type Theme } from '@/constants/theme';

const MAX_CIRCLE = 3;

export default function PeopleRoute() {
  const { styles, theme } = useZOZARTheme();
  const local = useMemo(() => makeLocal(theme), [theme]);
  const { members, addMember, respondToInvitation, removeMember } = useZOZARStore();
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [memberBusy, setMemberBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accepted = members.filter((member) => member.status === 'Accepted');
  const pending = members.filter((member) => member.status === 'Pending');

  async function invite() {
    if (!email.includes('@') || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addMember(email.trim());
      setEmail('');
      setInviting(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The invitation could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  async function runMemberAction(member: CircleMember, action: 'accept' | 'decline' | 'remove') {
    if (memberBusy) return;
    setMemberBusy(member.id);
    setError(null);
    try {
      if (action === 'accept') await respondToInvitation(member.id, true);
      else if (action === 'decline') await respondToInvitation(member.id, false);
      else await removeMember(member.id);
      setConfirming(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The trusted-circle change could not be saved.');
    } finally {
      setMemberBusy(null);
    }
  }

  /**
   * The confirm step for a destructive change.
   *
   * It names what is about to happen in the question and repeats the verb on the button,
   * so the person reading it in a hurry cannot mistake which control does what. "Keep" is
   * the safe default and sits first.
   */
  function MemberConfirmation({ member, action }: { member: CircleMember; action: 'decline' | 'remove' }) {
    if (confirming !== member.id) return null;
    const question =
      action === 'decline'
        ? `Decline ${member.name}?`
        : member.status === 'Pending'
          ? `Cancel the invitation to ${member.name}?`
          : `Remove ${member.name}? They stop hearing about your wakes.`;

    return (
      <View style={local.confirmPanel}>
        <Text style={local.confirmText}>{question}</Text>
        <View style={local.confirmActions}>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Keep things as they are"
            onPress={() => setConfirming(null)}
            rippleColor={theme.surfaceStrong}
            style={local.declineButton}
          >
            <Text style={local.declineText}>Keep</Text>
          </Touchable>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel={action === 'decline' ? `Decline ${member.name}` : `Remove ${member.name}`}
            accessibilityState={{ busy: memberBusy === member.id }}
            disabled={memberBusy === member.id}
            onPress={() => void runMemberAction(member, action)}
            rippleColor={theme.background}
            style={local.destructiveButton}
          >
            <Text style={local.destructiveText}>
              {memberBusy === member.id ? 'Saving' : action === 'decline' ? 'Decline' : 'Remove'}
            </Text>
          </Touchable>
        </View>
      </View>
    );
  }

  return (
    <Screen>
      <BrandBar />

      <View style={styles.intro}>
        <Text accessibilityRole="header" style={styles.pageTitle}>
          Who has your back
        </Text>
        {/*
          Slowly's lens: a connection is a relationship, not a contact entry. The copy
          says what the other person actually experiences, because that is what makes
          someone hesitate before inviting — and what makes the feature trustworthy.
        */}
        <Text style={styles.lede}>
          {accepted.length === 0
            ? 'Pick someone who would actually get up and check on you. They see only the alarms you link them to.'
            : `${accepted.length === 1 ? 'One person' : `${accepted.length} people`} will hear about it if you sleep through a linked alarm. Nothing else of yours is shared.`}
        </Text>
      </View>

      <View style={local.action}>
        <PrimaryButton
          label={inviting ? 'Not now' : 'Invite someone'}
          icon={inviting ? Icons.close : Icons.userPlus}
          disabled={!inviting && members.length >= MAX_CIRCLE}
          onPress={() => {
            setInviting((value) => !value);
            setError(null);
          }}
        />
      </View>

      {inviting ? (
        <Card>
          <Text style={styles.cardTitle}>Who would you want on a bad morning?</Text>
          <Text style={styles.cardDetail}>
            They will need a ZO-ZAR account to accept. Nothing is shared until they do.
          </Text>
          <View style={local.inviteField}>
            <TextField
              label="Their email"
              value={email}
              onChangeText={setEmail}
              placeholder="rahul@example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="send"
              onSubmitEditing={() => void invite()}
              error={error}
            />
          </View>
          <PrimaryButton label="Send the invitation" onPress={() => void invite()} disabled={!email.includes('@')} busy={busy} />
        </Card>
      ) : null}

      {error && !inviting ? (
        <Card style={{ backgroundColor: theme.errorSurface, borderColor: theme.error }}>
          <Text accessibilityRole="alert" style={local.error}>
            {error}
          </Text>
        </Card>
      ) : null}

      <View style={local.section}>
        <SectionLabel>{accepted.length === 0 ? 'Connected' : `Connected, ${accepted.length} of ${MAX_CIRCLE}`}</SectionLabel>

        {accepted.length === 0 ? (
          <EmptyState
            icon={Icons.users}
            title="No one yet"
            detail="Once someone accepts, you can message them here and link them to an alarm."
          />
        ) : (
          accepted.map((member) => (
            <Card key={member.id} style={local.personCard}>
              <Touchable
                accessibilityRole="button"
                accessibilityLabel={`Open your conversation with ${member.name}`}
                onPress={() => router.push(`/chat/${member.id}` as never)}
                rippleColor={theme.surfaceStrong}
                style={local.personRow}
              >
                <View style={[local.avatar, { backgroundColor: theme.warmSurface }]}>
                  <Text style={local.avatarCharacter}>{deterministicAvatar(member.id || member.name)}</Text>
                </View>
                <View style={local.copy}>
                  <Text style={styles.cardTitle}>{member.name}</Text>
                  <Text style={styles.cardDetail}>{member.detail}</Text>
                </View>
                <Icon as={Icons.chevronRight} size={IconSize.md} color={theme.subtle} />
              </Touchable>

              <View style={local.permission}>
                <Icon as={Icons.shield} size={IconSize.sm} color={theme.success} />
                <Text style={local.permissionText}>Sees your linked wakes and whether you confirmed</Text>
              </View>

              {member.relationship === 'outgoing' ? (
                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${member.name}`}
                  onPress={() => setConfirming(member.id)}
                  rippleColor={theme.errorSurface}
                  style={local.memberLink}
                >
                  <Text style={local.memberLinkText}>Remove</Text>
                </Touchable>
              ) : null}
              <MemberConfirmation member={member} action="remove" />
            </Card>
          ))
        )}
      </View>

      {pending.length > 0 ? (
        <View style={local.section}>
          <SectionLabel>Waiting</SectionLabel>
          {pending.map((member) => (
            <Card key={member.id} style={local.personCard}>
              <View style={local.personRow}>
                <View style={[local.avatar, { backgroundColor: theme.surfaceStrong }]}>
                  <Text style={local.avatarCharacter}>{deterministicAvatar(member.id || member.name)}</Text>
                </View>
                <View style={local.copy}>
                  <Text style={styles.cardTitle}>{member.name}</Text>
                  <Text style={styles.cardDetail}>
                    {member.relationship === 'incoming' ? 'Asked you to watch out for them' : 'Has not answered yet'}
                  </Text>
                </View>
              </View>

              {member.relationship === 'incoming' ? (
                <View style={local.pendingActions}>
                  <Touchable
                    accessibilityRole="button"
                    accessibilityLabel={`Accept ${member.name}`}
                    disabled={memberBusy === member.id}
                    onPress={() => void runMemberAction(member, 'accept')}
                    rippleColor={theme.accentContrast}
                    style={local.acceptButton}
                  >
                    <Text style={local.acceptText}>{memberBusy === member.id ? 'Saving' : 'Accept'}</Text>
                  </Touchable>
                  <Touchable
                    accessibilityRole="button"
                    accessibilityLabel={`Decline ${member.name}`}
                    onPress={() => setConfirming(member.id)}
                    rippleColor={theme.surfaceStrong}
                    style={local.declineButton}
                  >
                    <Text style={local.declineText}>Decline</Text>
                  </Touchable>
                </View>
              ) : (
                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel={`Cancel the invitation to ${member.name}`}
                  onPress={() => setConfirming(member.id)}
                  rippleColor={theme.errorSurface}
                  style={local.memberLink}
                >
                  <Text style={local.memberLinkText}>Cancel the invitation</Text>
                </Touchable>
              )}
              <MemberConfirmation member={member} action={member.relationship === 'incoming' ? 'decline' : 'remove'} />
            </Card>
          ))}
        </View>
      ) : null}

      <View style={local.section}>
        <SectionLabel>What they can see</SectionLabel>
        <Card>
          <Text style={styles.cardDetail}>
            A trusted person sees a wake time you linked them to, what it is for, and whether you confirmed. They do
            not see your other alarms, your plan, or anything you have not linked.
          </Text>
        </Card>
      </View>
    </Screen>
  );
}

const makeLocal = (theme: Theme) =>
  StyleSheet.create({
    action: { alignSelf: 'flex-start', marginTop: Spacing.sm },
    inviteField: { marginTop: Spacing.lg },
    section: { marginTop: Spacing.xxl },
    error: { ...Type.body, color: theme.error },

    personCard: { paddingVertical: Spacing.md },
    personRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    avatarCharacter: { fontSize: 20, lineHeight: 24 },
    copy: { flex: 1, gap: 2 },

    permission: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.line,
      paddingTop: Spacing.md,
      marginTop: Spacing.md,
    },
    permissionText: { ...Type.caption, color: theme.textSecondary, flex: 1 },

    memberLink: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', marginTop: Spacing.xs },
    memberLinkText: { ...Type.action, color: theme.error },

    pendingActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
    acceptButton: {
      flex: 1,
      minHeight: 48,
      borderRadius: Radius.row,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.accent,
      overflow: 'hidden',
    },
    acceptText: { ...Type.action, color: theme.accentContrast },
    declineButton: {
      flex: 1,
      minHeight: 48,
      borderRadius: Radius.row,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.lineStrong,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    declineText: { ...Type.action, color: theme.text },

    confirmPanel: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.line,
      paddingTop: Spacing.md,
      marginTop: Spacing.md,
      gap: Spacing.md,
    },
    confirmText: { ...Type.body, color: theme.textSecondary },
    confirmActions: { flexDirection: 'row', gap: Spacing.sm },
    destructiveButton: {
      flex: 1,
      minHeight: 48,
      borderRadius: Radius.row,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.error,
      overflow: 'hidden',
    },
    destructiveText: { ...Type.action, color: theme.accentContrast },
  });
