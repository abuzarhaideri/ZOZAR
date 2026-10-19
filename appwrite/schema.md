# Appwrite schema

All tables have row security enabled. ISO timestamps use Appwrite `datetime` columns. IDs are Appwrite row IDs and are not duplicated as columns.

## `profiles`

`email` varchar(320, required), `displayName` varchar(128, required), `timezone` varchar(64, required), `photoFileId` varchar(36, optional). Index: unique `email`.

## `commitments`

`userId` varchar(36, required), `title` varchar(160, required), `description` varchar(500, optional), `startsAt` datetime required, `status` enum(`planned`,`completed`,`archived`) required, `completedAt` datetime optional. Indexes: `userId`, `userId+startsAt`.

## `wake_plans`

`userId`, `commitmentId`, `connectionId` varchar(36); `scheduleType` enum(`once`,`daily`,`weekly`); `scheduledDate` varchar(10, optional); `localTime` varchar(5); `timezone` varchar(64); `weekdays` integer array; `difficulty` enum(`easy`,`medium`,`hard`); `soundKey` enum(`bright-rise`,`steady-pulse`,`summit-siren`,`default`,`zo-zar`); `graceMinutes` integer; `isActive` boolean. Indexes: `userId`, `userId+isActive`.

## `wake_occurrences`

`wakePlanId`, `userId`, `commitmentId` varchar(36); `scheduledFor` datetime; `difficulty` enum; `graceMinutes` integer; `challengePayload` varchar(4096); `status` enum(`scheduled`,`ringing`,`confirmed`,`missed`,`escalated`,`cancelled`); `triggeredAt`, `confirmedAt`, `escalatedAt` datetime optional; `snoozeCount` integer default 0. Indexes: `userId`, `wakePlanId`, `status+scheduledFor`.

## `connections`

`requesterId`, `recipientId` varchar(36); `requesterEmail`, `recipientEmail` varchar(320); `requesterDisplayName`, `recipientDisplayName` varchar(128); `status` enum(`pending`,`accepted`,`declined`,`revoked`). Indexes: `requesterId`, `recipientId`, `recipientEmail`, unique `requesterId+recipientEmail`.

## `chat_threads`

`participantA`, `participantB` varchar(36); `retention` enum(`7d`,`30d`) default `30d`; `retentionChangedBy` varchar(36); `retentionChangedAt` datetime. Indexes: `participantA`, `participantB`, unique `participantA+participantB` after canonical ordering.

## `messages`

`threadId`, `senderId` varchar(36); `type` enum(`text`,`voice`,`system`); `body` varchar(4096, optional); `voicePath` varchar(36, optional); `createdAt` datetime; `expiresAt` datetime. Indexes: `threadId+createdAt`, `expiresAt`.

## `device_tokens`

`userId` varchar(36); `token` varchar(4096); `tokenHash` varchar(64); `platform` enum(`android`,`ios`); `isActive` boolean; `lastSeenAt` datetime. Indexes: `userId`, unique `tokenHash`. The hash keeps the uniqueness index within Appwrite's index-length limit without weakening delivery.

## `notification_jobs`

`userId` varchar(36); `token` varchar(4096, optional); `kind` varchar(64); `payload` varchar(8192); `status` enum(`pending`,`sent`,`retry`,`failed`); `attempts` integer; `nextAttemptAt` datetime; `dedupeKey` varchar(128); `lastError` varchar(1000, optional). Indexes: unique `dedupeKey`, `status+nextAttemptAt`.
