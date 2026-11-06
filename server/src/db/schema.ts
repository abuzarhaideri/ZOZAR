import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Appwrite enforced these value sets through column enums and row permissions. Postgres
 * enums keep the same guarantees at the storage layer, so an invalid status cannot be
 * written even by a buggy route.
 */
export const commitmentStatus = pgEnum('commitment_status', ['planned', 'completed', 'archived']);
export const wakeScheduleType = pgEnum('wake_schedule_type', ['once', 'daily', 'weekly']);
export const difficulty = pgEnum('difficulty', ['easy', 'medium', 'hard']);
export const wakeSoundKey = pgEnum('wake_sound_key', [
  'bright-rise',
  'steady-pulse',
  'summit-siren',
  'default',
  'zo-zar',
]);
export const wakeOccurrenceStatus = pgEnum('wake_occurrence_status', [
  'scheduled',
  'ringing',
  'confirmed',
  'missed',
  'escalated',
  'cancelled',
]);
export const connectionStatus = pgEnum('connection_status', ['pending', 'accepted', 'declined', 'revoked']);
export const chatRetention = pgEnum('chat_retention', ['7d', '30d']);
export const messageType = pgEnum('message_type', ['text', 'voice', 'system']);
export const devicePlatform = pgEnum('device_platform', ['android', 'ios']);
export const notificationJobStatus = pgEnum('notification_job_status', ['pending', 'sent', 'retry', 'failed']);

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Credentials and profile in one table. Appwrite split these across its account service
 * and a `profiles` row; merging them removes a join from the hot auth path, which matters
 * when the connection budget is 20.
 *
 * `password_hash` is nullable on purpose: accounts migrated from Appwrite arrive without
 * one, because Appwrite does not expose password hashes. Those rows carry
 * `password_reset_required` and are routed into a set-password flow at sign-in.
 *
 * A null hash must not be claimable by anyone who merely knows the email address, or the
 * migration would hand out account takeovers. The migration script therefore issues a
 * single-use claim token per migrated account, stores only its hash here, and prints the
 * tokens for out-of-band delivery. Setting a password requires presenting one. The token
 * expires so an unclaimed account does not stay claimable forever.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 320 }).notNull(),
    passwordHash: text('password_hash'),
    passwordResetRequired: boolean('password_reset_required').notNull().default(false),
    claimTokenHash: varchar('claim_token_hash', { length: 64 }),
    claimTokenExpiresAt: timestamp('claim_token_expires_at', { withTimezone: true }),
    displayName: varchar('display_name', { length: 128 }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    photoKey: text('photo_key'),
    createdAt,
    updatedAt,
  },
  (table) => [
    // Case-insensitive uniqueness: sign-up must not allow Abc@x.com beside abc@x.com.
    uniqueIndex('users_email_lower_key').on(sql`lower(${table.email})`),
  ],
);

/**
 * Refresh token rotation with theft detection. Only the SHA-256 hash is stored, so a
 * database leak does not yield usable tokens. Every token belongs to a `family_id`;
 * replaying an already-rotated token revokes the entire family.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    familyId: uuid('family_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedBy: uuid('replaced_by'),
    createdAt,
  },
  (table) => [
    uniqueIndex('refresh_tokens_hash_key').on(table.tokenHash),
    index('refresh_tokens_user_idx').on(table.userId),
    index('refresh_tokens_family_idx').on(table.familyId),
    index('refresh_tokens_expires_idx').on(table.expiresAt),
  ],
);

export const commitments = pgTable(
  'commitments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 160 }).notNull(),
    description: varchar('description', { length: 500 }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    status: commitmentStatus('status').notNull().default('planned'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index('commitments_user_idx').on(table.userId),
    index('commitments_user_starts_idx').on(table.userId, table.startsAt),
  ],
);

/**
 * `local_time` stays a 'HH:MM' string and `timezone` an IANA name, rather than storing a
 * UTC instant. A recurring 7:00am alarm must stay 7:00am local across a DST shift, which
 * a fixed UTC offset cannot express.
 */
export const wakePlans = pgTable(
  'wake_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    commitmentId: uuid('commitment_id').references(() => commitments.id, { onDelete: 'set null' }),
    connectionId: uuid('connection_id').references(() => connections.id, { onDelete: 'set null' }),
    scheduleType: wakeScheduleType('schedule_type').notNull(),
    scheduledDate: varchar('scheduled_date', { length: 10 }),
    localTime: varchar('local_time', { length: 5 }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    weekdays: smallint('weekdays').array().notNull().default(sql`'{}'::smallint[]`),
    difficulty: difficulty('difficulty').notNull().default('medium'),
    soundKey: wakeSoundKey('sound_key').notNull().default('zo-zar'),
    graceMinutes: integer('grace_minutes').notNull().default(10),
    isActive: boolean('is_active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (table) => [
    index('wake_plans_user_idx').on(table.userId),
    index('wake_plans_user_active_idx').on(table.userId, table.isActive),
  ],
);

/**
 * `challenge_payload` is jsonb rather than Appwrite's varchar(4096), so challenge shapes
 * can be queried and validated instead of parsed by every reader.
 */
export const wakeOccurrences = pgTable(
  'wake_occurrences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    wakePlanId: uuid('wake_plan_id')
      .notNull()
      .references(() => wakePlans.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    commitmentId: uuid('commitment_id').references(() => commitments.id, { onDelete: 'set null' }),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    difficulty: difficulty('difficulty').notNull(),
    graceMinutes: integer('grace_minutes').notNull(),
    challengePayload: jsonb('challenge_payload').notNull().default({}),
    status: wakeOccurrenceStatus('status').notNull().default('scheduled'),
    triggeredAt: timestamp('triggered_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    snoozeCount: integer('snooze_count').notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [
    index('wake_occurrences_user_idx').on(table.userId),
    index('wake_occurrences_plan_idx').on(table.wakePlanId),
    // Drives the worker sweep: find everything overdue in one index scan.
    index('wake_occurrences_status_scheduled_idx').on(table.status, table.scheduledFor),
    // One occurrence per plan per instant, so a retried materialisation cannot double-book.
    uniqueIndex('wake_occurrences_plan_instant_key').on(table.wakePlanId, table.scheduledFor),
  ],
);

/** The trusted-person relationship. Denormalised email and display name let the People
 * screen render a pending invite before the invitee has an account. */
export const connections = pgTable(
  'connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id').references(() => users.id, { onDelete: 'cascade' }),
    requesterEmail: varchar('requester_email', { length: 320 }).notNull(),
    recipientEmail: varchar('recipient_email', { length: 320 }).notNull(),
    requesterDisplayName: varchar('requester_display_name', { length: 128 }).notNull(),
    recipientDisplayName: varchar('recipient_display_name', { length: 128 }),
    status: connectionStatus('status').notNull().default('pending'),
    createdAt,
    updatedAt,
  },
  (table) => [
    index('connections_requester_idx').on(table.requesterId),
    index('connections_recipient_idx').on(table.recipientId),
    index('connections_recipient_email_idx').on(sql`lower(${table.recipientEmail})`),
    uniqueIndex('connections_requester_recipient_key').on(table.requesterId, sql`lower(${table.recipientEmail})`),
  ],
);

/**
 * `participant_a` and `participant_b` are stored in canonical order (a < b) and the
 * unique index enforces one thread per pair. A check constraint would be redundant since
 * every write goes through `canonicalPair()`.
 */
export const chatThreads = pgTable(
  'chat_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    participantA: uuid('participant_a')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    participantB: uuid('participant_b')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    retention: chatRetention('retention').notNull().default('30d'),
    retentionChangedBy: uuid('retention_changed_by').references(() => users.id, { onDelete: 'set null' }),
    retentionChangedAt: timestamp('retention_changed_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    index('chat_threads_participant_a_idx').on(table.participantA),
    index('chat_threads_participant_b_idx').on(table.participantB),
    uniqueIndex('chat_threads_pair_key').on(table.participantA, table.participantB),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => chatThreads.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: messageType('type').notNull().default('text'),
    body: varchar('body', { length: 4096 }),
    voiceKey: text('voice_key'),
    voiceDurationSeconds: integer('voice_duration_seconds'),
    createdAt,
    // Set from the thread's retention at insert time. The worker sweep deletes on it and
    // an S3 lifecycle rule expires the matching voice objects.
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('messages_thread_created_idx').on(table.threadId, table.createdAt),
    index('messages_expires_idx').on(table.expiresAt),
  ],
);

export const deviceTokens = pgTable(
  'device_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    // FCM tokens exceed Postgres's btree index key limit, so uniqueness is enforced on a
    // hash. Appwrite needed the same trick for the same reason.
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    platform: devicePlatform('platform').notNull().default('android'),
    deviceName: varchar('device_name', { length: 128 }),
    isActive: boolean('is_active').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt,
    updatedAt,
  },
  (table) => [
    index('device_tokens_user_idx').on(table.userId),
    uniqueIndex('device_tokens_hash_key').on(table.tokenHash),
  ],
);

/** Outbox for FCM. Writing the job in the same transaction as the state change it reports
 * means a push is never lost to a worker timeout, and `dedupe_key` makes retries safe. */
export const notificationJobs = pgTable(
  'notification_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 64 }).notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: notificationJobStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    dedupeKey: varchar('dedupe_key', { length: 128 }).notNull(),
    lastError: varchar('last_error', { length: 1000 }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('notification_jobs_dedupe_key').on(table.dedupeKey),
    index('notification_jobs_due_idx').on(table.status, table.nextAttemptAt),
  ],
);

/**
 * Registry for API Gateway WebSocket connections, replacing Appwrite Realtime. Rows are
 * written on $connect and deleted on $disconnect; a stale row is harmless because posting
 * to a dead connection returns 410 Gone, which the publisher treats as a delete signal.
 */
export const wsConnections = pgTable(
  'ws_connections',
  {
    connectionId: varchar('connection_id', { length: 128 }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id').references(() => chatThreads.id, { onDelete: 'cascade' }),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ws_connections_user_idx').on(table.userId),
    index('ws_connections_thread_idx').on(table.threadId),
  ],
);
