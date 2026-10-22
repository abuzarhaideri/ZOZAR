# ZO-ZAR architecture

Decision record for the migration off Appwrite onto AWS serverless + Aiven PostgreSQL.
Written 2026-10-19. Supersedes the Appwrite notes in `appwrite/README.md`.

## Shape

| Layer | Choice |
| --- | --- |
| Client | Expo SDK 57 Android app (the only frontend; no web app, no Vercel) |
| Precise alarms | `modules/zo-zar-exact-alarm`, project-local native Android module — unchanged |
| API | Single Node 22 Lambda running a Hono router behind an API Gateway HTTP API |
| Realtime | API Gateway WebSocket API, connection registry in Postgres |
| Scheduled work | EventBridge Scheduler to a worker Lambda |
| Database | Aiven for PostgreSQL (free plan), Drizzle ORM, SQL migrations |
| Object storage | S3, private, presigned PUT/GET |
| Auth | Self-built: scrypt password hashing, JWT access tokens, rotating refresh tokens |
| Push | FCM via `firebase-admin` in the worker Lambda |
| IaC | AWS CDK (TypeScript) |
| Region | `ap-south-1` (Mumbai) |
| CI/CD | GitHub Actions: tests gate deploy |

Firebase remains FCM-only. No Appwrite, no Supabase, no Firebase Auth/Firestore/Storage.

## The binding constraint: 20 database connections

Aiven's free PostgreSQL plan caps `max_connections` at 20 and does **not** include
PgBouncer. Lambda holds one connection per warm container, so an unbounded serverless
API would exhaust the database under trivial concurrency. RDS Proxy cannot help — it
only fronts RDS and Aurora.

The fix is an explicit, enforced connection budget: every Lambda uses a `pg` pool of
`max: 1`, and each function carries a reserved concurrency ceiling. The ceilings are the
real guarantee; the pool size just stops a single container from multiplying.

| Consumer | Reserved concurrency | Pool max | Connections |
| --- | --- | --- | --- |
| API Lambda | 8 | 1 | 8 |
| WebSocket Lambda | 4 | 1 | 4 |
| Worker Lambda (schedule, push, sweeps) | 1 | 2 | 2 |
| Headroom: migrations, `psql`, admin | — | — | 3 |
| Aiven service management | — | — | ~3 |
| **Total** | | | **20** |

Consequences accepted:

- Requests beyond the API ceiling are throttled (HTTP 429), not queued. Fine at
  portfolio traffic; the ceiling is one CDK constant to raise.
- Lambdas run **outside a VPC** and reach Aiven over its public TLS endpoint. A VPC
  would require a NAT gateway at roughly $32/month, which would dwarf every other cost
  here. Security therefore rests on TLS plus credentials, not network isolation.
- Aiven's free plan has no static IPs, so the database cannot be IP-allowlisted.
- Aiven's free plan picks a **continent**, not a region: the console offers Asia Pacific,
  Australia, Europe and North America, and notes that a specific provider and region
  require the Professional tier. Latency is therefore tunable only to continental
  accuracy. Pick the continent the compute runs in — the Learner Lab deployment is in
  `us-east-1`, so the database belongs in North America, while a Mumbai deployment would
  want Asia Pacific. Getting this wrong costs roughly 200ms on every query.
- The upgrade path, if traffic ever justifies it, is Aiven's paid tier for PgBouncer.

## Cost

Lambda's 1M requests and 400,000 GB-seconds per month are permanently free. API Gateway
HTTP API (1M calls) and WebSocket (1M messages, 750,000 connection-minutes) are free only
for the first 12 months of the AWS account, then roughly $1 per million. Aiven's free plan
is 5 GB and does not expire. EventBridge Scheduler and SSM Parameter Store SecureStrings
are free at this volume.

Expected steady state: $0/month for the first year, then cents per month. Secrets live in
SSM Parameter Store rather than Secrets Manager specifically to avoid $0.40 per secret
per month.

## Authentication

Appwrite owned sessions; now the API does.

- Passwords hashed with `scrypt` from `node:crypto`. Chosen over argon2 and bcrypt
  because both are native modules that complicate Lambda bundling, while `node:crypto`
  ships with the runtime. Parameters N=2^15, r=8, p=1, 32-byte random salt per password,
  verified with `timingSafeEqual`.
- Access token: JWT, HS256 via `jose`, 15-minute expiry, held in memory on the client.
- Refresh token: opaque 32-byte random value, only its SHA-256 hash stored. Rotated on
  every use. Tokens carry a `family_id`; presenting an already-rotated token revokes the
  whole family, which detects theft and replay.
- Client stores only the refresh token, in `expo-secure-store`.

### Migrated accounts cannot keep their passwords

Appwrite does not expose password hashes, so they cannot be exported. Migrated users
therefore get `password_hash = NULL` and `password_reset_required = true`. Sign-in for
such an account returns a distinct response that sends the client into a set-password
flow instead of failing as bad credentials. Their data carries over fully; only the
password has to be re-established once.

## Authorization

Appwrite enforced per-row permissions server-side. That logic now lives in
`server/src/domain/authz.ts` as pure functions over `(session, row, action)`, unit tested
as the security boundary of the system. Every route resolves a rule there before touching
data; no route builds its own ownership check.

- `commitments`, `wake_plans`, `wake_occurrences`, `device_tokens`: owner only.
- `connections`: readable by requester or recipient; only the recipient may accept or
  decline; either side may revoke.
- `chat_threads`, `messages`: participants only; a sender must be a thread participant.
- `profiles`: full access to your own; for anyone else, display name and photo only, and
  only when an accepted connection exists between you.

## Layout

```
src/            Expo app (unchanged until the UI phase)
server/         API, WebSocket, and worker Lambdas; own package.json
infra/          AWS CDK app; own package.json
scripts/        includes the one-time Appwrite to Aiven migration
.github/        CI and deploy workflows
```

`server/` and `infra/` are deliberately **not** npm workspaces. Expo's Metro bundler
watches the project root, and hoisted workspace dependencies would land in its module
graph. They stay independent projects, and `metro.config.js` blocks both directories.
