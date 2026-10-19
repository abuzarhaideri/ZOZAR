# ZO-ZAR Supabase layer

This directory contains the local Supabase project configuration, the Monday internal-beta database migration, and the two Edge Functions required by the app. It is intentionally deployment-free: a human must create and configure the Supabase project before these files can be used against a hosted environment.

## Local development

Install the Supabase CLI, then run:

```bash
supabase start
supabase db reset
supabase functions serve invite-by-email --env-file supabase/.env.local
supabase functions serve process-due-wakes --env-file supabase/.env.local
```

The migration creates the following protected data model:

`profiles`, `commitments`, `wake_plans`, `wake_occurrences`, `circles`, `circle_members`, `device_tokens`, `chat_threads`, `messages`, `voice_notes`, and `notification_deliveries`.

It also enables RLS, configures private `voice-notes` Storage policies, adds Realtime for chat/wake/circle/delivery tables, and enforces a maximum of three active trusted-circle members at the database layer.

## Human-required hosted setup

Before using the app with a hosted backend, the human owner must:

1. Create a Supabase project at [supabase.com](https://supabase.com). Do not put the project URL, anon key, service-role key, or any token in source control.
2. Link this local directory to that project and apply the migration with `supabase link --project-ref <project-ref>` followed by `supabase db push`.
3. Set hosted Edge Function secrets:

   ```bash
   supabase secrets set \
     SUPABASE_URL="https://<project-ref>.supabase.co" \
     SUPABASE_ANON_KEY="<anon-key>" \
     SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
     CRON_SECRET="<long-random-secret>" \
     EXPO_ACCESS_TOKEN="<optional-expo-access-token>"
   ```

   The service-role key is server-only and must never be shipped in the mobile app.
4. Deploy functions manually when ready:

   ```bash
   supabase functions deploy invite-by-email
   supabase functions deploy process-due-wakes
   ```

5. Configure a Supabase Cron job to call `process-due-wakes` every minute with `Authorization: Bearer <CRON_SECRET>`. The function is idempotent at the `notification_deliveries` unique key and occurrence claim update.
6. Configure Auth email/redirect settings for the final mobile scheme and create at least two test accounts before testing invitations.

## Mobile environment

The app-side client reads these public values at runtime/build time:

```text
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

Use `src/lib/supabase-client.ts` for the typed REST/Auth/Function/Storage client. It deliberately uses the platform `fetch` API so the cloud layer does not require a package manifest change. The mobile repository uses the same authenticated client for session persistence, trusted-circle invitations, voice upload, signed voice playback URLs, and device-token persistence.

`src/lib/zo-zar-repository.ts` is the integration contract for the app layer. It exposes authentication, commitments, wake plans/occurrences, circle invitations and responses, realtime text-message subscriptions, voice-note metadata, and device-token persistence. It does not fake success: missing public configuration throws `SupabaseConfigMissingError`, and data mutations without an authenticated session throw `RepositoryAuthError`.

## Function contracts

### `invite-by-email`

Authenticated `POST` body:

```json
{ "circleId": "circle-uuid", "email": "trusted@example.com" }
```

The recipient must already have a ZO-ZAR account. The function creates or refreshes a pending invitation, rejects self-invites, validates circle ownership, and rejects a fourth active member.

### `process-due-wakes`

Called by Cron with the configured secret. It claims overdue, unconfirmed occurrences after their grace period, creates one delivery record per active circle member, sends Expo push notifications to active device tokens, and records provider ticket status. It does not create SMS or phone calls.

## Verification without a remote account

The migration can be inspected or tested locally with `supabase db reset` once the Supabase CLI/Docker are installed. No hosted project, account, secret, or Edge Function deployment is performed by this repository change.
