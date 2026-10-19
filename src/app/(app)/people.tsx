import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useZOZARStore, type CircleMember } from '@/components/zo-zar-store';
import { BrandBar, Card, deterministicAvatar, EmptyState, PrimaryButton, Screen, SectionHeader, TextField, useZOZARTheme } from '@/components/zo-zar-ui';
import { Fonts } from '@/constants/theme';

const MAX_CIRCLE = 3;

export default function PeopleRoute() {
  const { styles, theme } = useZOZARTheme();
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

  function MemberConfirmation({ member, action }: { member: CircleMember; action: 'decline' | 'remove' }) {
    if (confirming !== member.id) return null;
    const label = action === 'decline' ? 'Decline invitation?' : member.status === 'Pending' ? 'Cancel this invitation?' : 'Remove this trusted person?';
    return <View style={[local.confirmPanel, { borderTopColor: theme.line }]}>
      <Text style={[local.confirmText, { color: theme.muted }]}>{label}</Text>
      <View style={local.confirmActions}>
        <Pressable accessibilityRole="button" onPress={() => setConfirming(null)} style={[local.smallButton, { borderColor: theme.lineStrong }]}><Text style={[local.smallButtonText, { color: theme.text }]}>Keep</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ busy: memberBusy === member.id }} disabled={memberBusy === member.id} onPress={() => void runMemberAction(member, action)} style={[local.smallButton, { backgroundColor: theme.error, borderColor: theme.error }]}><Text style={local.destructiveText}>{memberBusy === member.id ? 'Saving…' : action === 'decline' ? 'Decline' : 'Remove'}</Text></Pressable>
      </View>
    </View>;
  }

  return <Screen>
    <BrandBar />
    <View style={styles.intro}>
      <Text style={styles.eyebrow}>People · Your circle</Text>
      <Text style={styles.pageTitle}>Support that feels human.</Text>
      <Text style={styles.lede}>You decide who is close, what they can see, and when they can step in.</Text>
    </View>

    <Card style={local.circleCard}>
      <View style={local.orbits} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[local.orbit, { borderColor: theme.lineStrong }]} />
        <View style={[local.core, { backgroundColor: theme.warm }]}><Text style={local.coreText}>{accepted.length}</Text></View>
      </View>
      <View style={local.circleCopy}>
        <Text style={[styles.sectionKicker, { marginBottom: 6 }]}>TRUSTED CIRCLE</Text>
        <Text style={styles.cardTitle}>{accepted.length ? `${accepted.length} ${accepted.length === 1 ? 'person' : 'people'} connected` : 'Your circle is private by default'}</Text>
        <Text style={styles.cardDetail}>{accepted.length ? 'Accepted members can support only the protected wakes you link.' : 'Invite someone only when you are ready. Your other plans remain yours.'}</Text>
      </View>
    </Card>

    <View style={local.action}><PrimaryButton label={inviting ? 'Close invitation' : 'Invite someone'} icon={inviting ? '×' : '+'} disabled={!inviting && members.length >= MAX_CIRCLE} onPress={() => { setInviting((value) => !value); setError(null); }} /></View>
    {inviting && <Card>
      <Text style={styles.sectionKicker}>Private invitation</Text>
      <Text style={styles.cardTitle}>Who would you trust on a difficult morning?</Text>
      <Text style={styles.cardDetail}>They need a ZO-ZAR account before accepting.</Text>
      <View style={local.inviteField}><TextField label="Email address" value={email} onChangeText={setEmail} placeholder="rahul@example.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" returnKeyType="send" onSubmitEditing={() => void invite()} /></View>
      <PrimaryButton label="Send invitation" onPress={() => void invite()} disabled={!email.includes('@')} busy={busy} />
    </Card>}

    {error && <Card style={{ backgroundColor: theme.errorSurface, borderColor: theme.error }}><Text accessibilityRole="alert" style={[local.error, { color: theme.error }]}>{error}</Text></Card>}

    <View style={local.section}><SectionHeader kicker="Connected" title="People you trust" action={`${accepted.length}/${MAX_CIRCLE}`} /></View>
    {accepted.length === 0 ? <EmptyState icon="◎" title="No one connected yet" detail="Once an invitation is accepted, chat and protected wake support appear here." /> : accepted.map((member) => <Card key={member.id} style={local.personCard}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open chat with ${member.name}`} onPress={() => router.push(`/chat/${member.id}` as never)} style={local.personRow}>
        <View style={[local.avatar, { backgroundColor: theme.warmSurface }]}><Text style={local.avatarCharacter}>{deterministicAvatar(member.id || member.name)}</Text></View>
        <View style={local.copy}><Text style={styles.cardTitle}>{member.name}</Text><Text style={styles.cardDetail}>{member.detail}</Text></View>
        <Text style={[local.chevron, { color: theme.subtle }]}>›</Text>
      </Pressable>
      <View style={[local.permission, { borderTopColor: theme.line }]}><Text style={[local.permissionText, { color: theme.success }]}>✓ Protected wake status</Text><Text style={[local.permissionText, { color: theme.muted }]}>Other plans stay private</Text></View>
      {member.relationship === 'outgoing' && <Pressable accessibilityRole="button" onPress={() => setConfirming(member.id)} style={local.memberLink}><Text style={[local.memberLinkText, { color: theme.error }]}>Remove trusted person</Text></Pressable>}
      <MemberConfirmation member={member} action="remove" />
    </Card>)}

    {pending.length > 0 && <View style={local.section}>
      <SectionHeader kicker="Waiting" title="Pending invitations" />
      {pending.map((member) => <Card key={member.id} style={local.personCard}>
        <View style={local.personRow}>
          <View style={[local.avatar, { backgroundColor: theme.surfaceStrong }]}><Text style={local.avatarCharacter}>{deterministicAvatar(member.id || member.name)}</Text></View>
          <View style={local.copy}><Text style={styles.cardTitle}>{member.name}</Text><Text style={styles.cardDetail}>{member.detail}</Text></View>
          <View style={[local.pendingPill, { backgroundColor: theme.warningSurface }]}><Text style={[local.pendingText, { color: theme.warning }]}>Pending</Text></View>
        </View>
        {member.relationship === 'incoming' ? <View style={local.pendingActions}>
          <Pressable accessibilityRole="button" disabled={memberBusy === member.id} onPress={() => void runMemberAction(member, 'accept')} style={[local.smallButton, { backgroundColor: theme.accent, borderColor: theme.accent }]}><Text style={local.destructiveText}>{memberBusy === member.id ? 'Saving…' : 'Accept'}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setConfirming(member.id)} style={[local.smallButton, { borderColor: theme.lineStrong }]}><Text style={[local.smallButtonText, { color: theme.text }]}>Decline</Text></Pressable>
        </View> : <Pressable accessibilityRole="button" onPress={() => setConfirming(member.id)} style={local.memberLink}><Text style={[local.memberLinkText, { color: theme.error }]}>Cancel invitation</Text></Pressable>}
        <MemberConfirmation member={member} action={member.relationship === 'incoming' ? 'decline' : 'remove'} />
      </Card>)}
    </View>}

    <View style={local.section}><SectionHeader kicker="Privacy" title="You stay in control" /><Card><Text style={styles.cardTitle}>Permission is specific.</Text><Text style={styles.cardDetail}>A trusted person can see a linked wake time, its commitment, and whether you confirmed. They do not receive access to your full plan.</Text></Card></View>
  </Screen>;
}

const local = StyleSheet.create({
  circleCard: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 22 },
  orbits: { width: 92, height: 92, alignItems: 'center', justifyContent: 'center' },
  orbit: { position: 'absolute', width: 88, height: 88, borderRadius: 44, borderWidth: 1 },
  core: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  coreText: { color: '#FFFFFF', fontFamily: Fonts.bold, fontSize: 21, fontWeight: '700' },
  circleCopy: { flex: 1 },
  action: { alignSelf: 'flex-start', marginTop: 8 },
  inviteField: { marginTop: 18 },
  section: { marginTop: 30 },
  personCard: { paddingVertical: 8 },
  personRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  avatarCharacter: { fontSize: 24, lineHeight: 29 },
  initials: { fontFamily: Fonts.bold, fontSize: 13, fontWeight: '700' },
  copy: { flex: 1 },
  chevron: { fontSize: 28 },
  permission: { borderTopWidth: 1, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  permissionText: { fontFamily: Fonts.medium, fontSize: 12, fontWeight: '600' },
  pendingPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  pendingText: { fontFamily: Fonts.semibold, fontSize: 11, fontWeight: '700' },
  pendingActions: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  memberLink: { minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' },
  memberLinkText: { fontFamily: Fonts.semibold, fontSize: 13, fontWeight: '700' },
  confirmPanel: { borderTopWidth: 1, paddingTop: 14, paddingBottom: 6 },
  confirmText: { fontFamily: Fonts.medium, fontSize: 13, lineHeight: 19, marginBottom: 10 },
  confirmActions: { flexDirection: 'row', gap: 10 },
  smallButton: { minHeight: 44, minWidth: 96, paddingHorizontal: 16, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  smallButtonText: { fontFamily: Fonts.semibold, fontSize: 13, fontWeight: '700' },
  destructiveText: { color: '#FFFFFF', fontFamily: Fonts.semibold, fontSize: 13, fontWeight: '700' },
  error: { fontFamily: Fonts.medium, fontSize: 13, lineHeight: 19 },
});
