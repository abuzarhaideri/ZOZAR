CREATE TYPE "public"."chat_retention" AS ENUM('7d', '30d');--> statement-breakpoint
CREATE TYPE "public"."commitment_status" AS ENUM('planned', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('pending', 'accepted', 'declined', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."device_platform" AS ENUM('android', 'ios');--> statement-breakpoint
CREATE TYPE "public"."difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'voice', 'system');--> statement-breakpoint
CREATE TYPE "public"."notification_job_status" AS ENUM('pending', 'sent', 'retry', 'failed');--> statement-breakpoint
CREATE TYPE "public"."wake_occurrence_status" AS ENUM('scheduled', 'ringing', 'confirmed', 'missed', 'escalated', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."wake_schedule_type" AS ENUM('once', 'daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."wake_sound_key" AS ENUM('bright-rise', 'steady-pulse', 'summit-siren', 'default', 'zo-zar');--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_a" uuid NOT NULL,
	"participant_b" uuid NOT NULL,
	"retention" "chat_retention" DEFAULT '30d' NOT NULL,
	"retention_changed_by" uuid,
	"retention_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"description" varchar(500),
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"status" "commitment_status" DEFAULT 'planned' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"recipient_id" uuid,
	"requester_email" varchar(320) NOT NULL,
	"recipient_email" varchar(320) NOT NULL,
	"requester_display_name" varchar(128) NOT NULL,
	"recipient_display_name" varchar(128),
	"status" "connection_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"platform" "device_platform" DEFAULT 'android' NOT NULL,
	"device_name" varchar(128),
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"type" "message_type" DEFAULT 'text' NOT NULL,
	"body" varchar(4096),
	"voice_key" text,
	"voice_duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(64) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "notification_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" varchar(128) NOT NULL,
	"last_error" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"family_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" text,
	"password_reset_required" boolean DEFAULT false NOT NULL,
	"claim_token_hash" varchar(64),
	"claim_token_expires_at" timestamp with time zone,
	"display_name" varchar(128) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"photo_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wake_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wake_plan_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"commitment_id" uuid,
	"scheduled_for" timestamp with time zone NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"grace_minutes" integer NOT NULL,
	"challenge_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "wake_occurrence_status" DEFAULT 'scheduled' NOT NULL,
	"triggered_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"snooze_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wake_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"commitment_id" uuid,
	"connection_id" uuid,
	"schedule_type" "wake_schedule_type" NOT NULL,
	"scheduled_date" varchar(10),
	"local_time" varchar(5) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"weekdays" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"difficulty" "difficulty" DEFAULT 'medium' NOT NULL,
	"sound_key" "wake_sound_key" DEFAULT 'zo-zar' NOT NULL,
	"grace_minutes" integer DEFAULT 10 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ws_connections" (
	"connection_id" varchar(128) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"thread_id" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_participant_a_users_id_fk" FOREIGN KEY ("participant_a") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_participant_b_users_id_fk" FOREIGN KEY ("participant_b") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_retention_changed_by_users_id_fk" FOREIGN KEY ("retention_changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_jobs" ADD CONSTRAINT "notification_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wake_occurrences" ADD CONSTRAINT "wake_occurrences_wake_plan_id_wake_plans_id_fk" FOREIGN KEY ("wake_plan_id") REFERENCES "public"."wake_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wake_occurrences" ADD CONSTRAINT "wake_occurrences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wake_occurrences" ADD CONSTRAINT "wake_occurrences_commitment_id_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."commitments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wake_plans" ADD CONSTRAINT "wake_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wake_plans" ADD CONSTRAINT "wake_plans_commitment_id_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."commitments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wake_plans" ADD CONSTRAINT "wake_plans_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ws_connections" ADD CONSTRAINT "ws_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ws_connections" ADD CONSTRAINT "ws_connections_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_threads_participant_a_idx" ON "chat_threads" USING btree ("participant_a");--> statement-breakpoint
CREATE INDEX "chat_threads_participant_b_idx" ON "chat_threads" USING btree ("participant_b");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_threads_pair_key" ON "chat_threads" USING btree ("participant_a","participant_b");--> statement-breakpoint
CREATE INDEX "commitments_user_idx" ON "commitments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "commitments_user_starts_idx" ON "commitments" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX "connections_requester_idx" ON "connections" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "connections_recipient_idx" ON "connections" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "connections_recipient_email_idx" ON "connections" USING btree (lower("recipient_email"));--> statement-breakpoint
CREATE UNIQUE INDEX "connections_requester_recipient_key" ON "connections" USING btree ("requester_id",lower("recipient_email"));--> statement-breakpoint
CREATE INDEX "device_tokens_user_idx" ON "device_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_tokens_hash_key" ON "device_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "messages_thread_created_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_expires_idx" ON "messages" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_jobs_dedupe_key" ON "notification_jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_jobs_due_idx" ON "notification_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_key" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_expires_idx" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "wake_occurrences_user_idx" ON "wake_occurrences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wake_occurrences_plan_idx" ON "wake_occurrences" USING btree ("wake_plan_id");--> statement-breakpoint
CREATE INDEX "wake_occurrences_status_scheduled_idx" ON "wake_occurrences" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "wake_occurrences_plan_instant_key" ON "wake_occurrences" USING btree ("wake_plan_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "wake_plans_user_idx" ON "wake_plans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wake_plans_user_active_idx" ON "wake_plans" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "ws_connections_user_idx" ON "ws_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ws_connections_thread_idx" ON "ws_connections" USING btree ("thread_id");