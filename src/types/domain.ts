export type Difficulty = 'easy' | 'medium' | 'hard';

export type WakeSoundKey = 'bright-rise' | 'steady-pulse' | 'summit-siren' | 'default' | 'zo-zar';

export type CommitmentStatus = 'planned' | 'completed' | 'archived';

export type WakeScheduleType = 'once' | 'daily' | 'weekly';

export type WakeOccurrenceStatus =
  | 'scheduled'
  | 'ringing'
  | 'confirmed'
  | 'missed'
  | 'escalated'
  | 'cancelled';

export type CircleMemberStatus = 'pending' | 'active' | 'declined' | 'revoked';

export interface Profile {
  id: string;
  email: string;
  display_name: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface Commitment {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  status: CommitmentStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WakePlan {
  id: string;
  user_id: string;
  commitment_id: string | null;
  circle_id: string | null;
  schedule_type: WakeScheduleType;
  scheduled_date: string | null;
  local_time: string;
  timezone: string;
  weekdays: number[];
  difficulty: Difficulty;
  sound_key: WakeSoundKey;
  grace_period_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WakeOccurrence {
  id: string;
  wake_plan_id: string;
  user_id: string;
  commitment_id: string | null;
  scheduled_for: string;
  difficulty: Difficulty;
  grace_period_minutes: number;
  challenge_payload: Record<string, unknown>;
  status: WakeOccurrenceStatus;
  triggered_at: string | null;
  confirmed_at: string | null;
  escalated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Circle {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface CircleMember {
  id: string;
  circle_id: string;
  user_id: string;
  invited_email: string;
  invited_by: string;
  role: 'member';
  status: CircleMemberStatus;
  invited_at: string;
  responded_at: string | null;
}

export interface DeviceToken {
  id: string;
  user_id: string;
  expo_push_token: string;
  platform: 'android' | 'ios' | 'web';
  device_name: string | null;
  is_active: boolean;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface ChatThread {
  id: string;
  participant_a: string;
  participant_b: string;
  created_at: string;
}

export interface Message {
  id: string;
  thread_id: string;
  sender_id: string;
  message_type: 'text' | 'voice';
  body: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoiceNote {
  id: string;
  message_id: string;
  storage_path: string;
  duration_seconds: number;
  expires_at: string;
  created_at: string;
}

export interface NotificationDelivery {
  id: string;
  occurrence_id: string;
  recipient_user_id: string;
  channel: 'push';
  notification_type: 'missed_wake';
  status: 'pending' | 'sent' | 'failed';
  provider_ticket_id: string | null;
  error_message: string | null;
  attempt_count: number;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}
