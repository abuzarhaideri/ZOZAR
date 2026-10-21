# ZO-ZAR

[![CI](https://github.com/abuzarhaideri/ZOZAR/actions/workflows/ci.yml/badge.svg)](https://github.com/abuzarhaideri/ZOZAR/actions/workflows/ci.yml)
![Expo SDK 57](https://img.shields.io/badge/Expo-SDK%2057-1C1C19)
![Android](https://img.shields.io/badge/platform-Android-E7BB72)
![Tests](https://img.shields.io/badge/server%20tests-291%20passing-2D5E2A)

**An alarm app for people who sleep through alarms.** You set the time you need to be up
and choose someone you trust. If you don't confirm you're awake within your grace period,
they're told — so oversleeping stops being something only you find out about.

| Wake (dark) | Wake (light) | Bedtime | Wake streak | Practise a challenge | People |
| --- | --- | --- | --- | --- | --- |
| ![Wake tab in dark mode](docs/screenshots/wake-dark.png) | ![Wake tab in light mode](docs/screenshots/wake-light.png) | ![Bedtime screen](docs/screenshots/bedtime-dark.png) | ![Profile with a five-day wake streak](docs/screenshots/profile-streak-dark.png) | ![Practising a medium challenge](docs/screenshots/practice-light.png) | ![People tab](docs/screenshots/people-light.png) |

## What it does

- **Rings exactly on time.** Alarms go through a project-local native Android module
  (`modules/zo-zar-exact-alarm`): exact alarms, a full-screen activity over the lock
  screen, through Doze and across reboots.
- **Makes you prove you're awake.** Stopping an alarm means solving a challenge — Easy,
  Medium or Hard — and any level can be practised from the alarm editor first.
- **Tells someone if you don't.** Pick a trusted person; if the grace period lapses
  without a confirmation, they get a push notification. Invitations are explicit, and a
  pending invitation is never shown as protection.
- **Keeps you company.** Chat and voice notes with your circle, a wind-down screen at
  bedtime, commitments you need to be up for, and a streak of days you woke up on time.

## Design

The visual direction is **Hearth**: an alarm should feel like a familiar object beside the
bed. Night is a dark olive-charcoal, day a warm limestone, and a single gold accent is
reserved for primary actions and selection.

- **The dial is a real clock face.** Its gold arc runs from where the hour hand is now to
  where the alarm sits, so "how long until I wake" is a shape you read at a glance. Tap
  to edit; turn it like a knob to nudge the time in five-minute steps.
- **Accessible by construction.** The palette's foreground/background pairings — 28 per
  theme, 56 in all — are checked against WCAG contrast in CI (`npm run verify:contrast`).
  Every gesture has a TalkBack equivalent; Reduce Motion stills the two ambient surfaces;
  times follow the phone's locale, 12- or 24-hour.
- **One-tap appearance.** A sun/moon toggle in the header switches dark and light; a long
  press returns to following the device.

## Architecture

```mermaid
flowchart TB
  App["Your phone<br/>Expo app + native alarm module"]
  subgraph AWS["AWS, provisioned with CDK"]
    HTTP["API Gateway<br/>HTTP API"]
    WSG["API Gateway<br/>WebSocket"]
    S3[("S3<br/>voice notes, photos")]
    EB["EventBridge<br/>every 5 min"]
    API["API Lambda<br/>Hono, Node 22"]
    WS["WebSocket<br/>Lambda"]
    Worker["Worker Lambda<br/>escalate missed wakes"]
  end
  DB[("Aiven PostgreSQL")]
  FCM["Firebase Cloud Messaging"]
  Friend["Trusted person's phone"]

  App --> HTTP --> API --> DB
  App --> WSG --> WS --> DB
  App -- presigned upload --> S3
  EB --> Worker --> DB
  Worker --> FCM --> Friend
```

Every five minutes the worker turns upcoming alarms into scheduled occurrences, marks
unconfirmed ones as missed once their grace period lapses, and queues a push to the
trusted person. Secrets — the database URL and CA certificate, the JWT signing key and the
Firebase service account — live in SSM Parameter Store and are read by each Lambda at cold
start, never placed in environment variables or the CloudFormation template.

**The interesting constraint.** Aiven's free PostgreSQL plan allows 20 connections and has
no PgBouncer, and RDS Proxy can't front a database outside AWS. Lambda holds a connection
per warm container, so the stack runs on an explicit connection budget: every function
uses a `pg` pool of `max: 1` with a reserved-concurrency ceiling — API 8, WebSocket 4,
worker 1 — leaving headroom for migrations and Aiven's own management. The Lambdas also
run outside a VPC, because the NAT gateway a VPC needs would cost more per month than the
rest of the stack combined. The full reasoning is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Engineering notes

- **291 server tests** run against a real PostgreSQL 17 in CI, not mocks. Migrations are
  applied to an empty database and re-applied to prove they are idempotent before the
  tests run.
- **Auth is self-built and conservative:** scrypt password hashing, 15-minute JWT access
  tokens, and opaque refresh tokens stored hashed and rotated on every use. Replaying a
  rotated token revokes the whole token family. Sessions last until 60 days pass without
  activity.
- **Authorization is pure functions** (`server/src/domain/authz.ts`). Callers who aren't
  a party to a resource get 404 rather than 403, so its existence never leaks; 403 is
  reserved for parties who already know it exists.
- **Recurrence is timezone-correct.** Wake times are computed in the plan's own timezone,
  so a 07:00 alarm in Asia/Kolkata doesn't fire 5.5 hours late on a UTC server, and a
  07:00 alarm stays at 07:00 local across daylight-saving changes instead of drifting by
  an hour.
- **Deploys are set up for GitHub OIDC**, not stored AWS keys, with the role's trust
  policy pinned to the repository's `production` environment by exact match.
- **`main` is protected:** changes land by pull request, and all three checks — server
  tests, infrastructure synth, app typecheck — must pass.

## Status

| Area | State |
| --- | --- |
| Android app, Hearth design, both themes | Done |
| Native exact-alarm module | Done; compiles in EAS builds |
| API, auth, authorization, wake scheduling, chat, uploads | Done, 291 tests passing |
| WebSocket realtime and scheduled worker | Done, tested |
| AWS CDK infrastructure | Done; synthesises 34 AWS resources |
| CI on every pull request | Done |
| Deployment to AWS | Paused — the deploy job is switched off until AWS is provisioned |

While deployment is paused, the app runs on an on-device store: accounts, alarms and the
streak persist on the phone, but a trusted person can't actually be notified and chat
can't reach other phones. Both need the live backend. Turning deploys on is one repository
variable once [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) is done.

## Running it

### App

```bash
npm install
npx expo start --go        # opens in Expo Go; real alarms need a build
```

Expo Go doesn't include the native alarm module, so the app opens but can't schedule
alarms there. For the real thing, build an installable APK:

```bash
npx eas-cli build --platform android --profile preview
```

### Server

```bash
cd server
npm install
docker run -d --name zozar-pg -e POSTGRES_USER=zozar -e POSTGRES_PASSWORD=zozar \
  -e POSTGRES_DB=zozar_test -p 5432:5432 postgres:17-alpine

export DATABASE_URL='postgres://zozar:zozar@localhost:5432/zozar_test?sslmode=disable'
export JWT_SECRET="$(openssl rand -base64 48)"
npm test          # applies migrations itself, then runs all 291 tests
```

Never point `DATABASE_URL` at a real database: the tests truncate tables.

### Infrastructure

```bash
cd infra
npm install
npx cdk synth
```

Schema changes are generated from the Drizzle schema and committed, so the SQL that CI
validates is the SQL that runs in production:

```bash
cd server
npm run db:generate -- --name=what_changed
npm run db:migrate
```

## Layout

```
src/        Expo app. Routes under src/app/ (Expo Router); theme in src/constants/theme.ts.
modules/    Native Android exact-alarm module (Kotlin).
assets/     App icon, splash images and alarm sounds.
server/     API, WebSocket and worker Lambdas, with tests. Independent npm project.
infra/      AWS CDK app. Independent npm project.
scripts/    Contrast verification, one-time AWS bootstrap, and legacy Appwrite tools.
docs/       Architecture, deployment runbook, screenshots.
supabase/   Legacy schema from before the move to AWS; not used.
```

`server/` and `infra/` are deliberately not npm workspaces: Metro watches the repository
root, and hoisted server dependencies would leak into the app's bundle.
`metro.config.js` blocks both.

## Licence

Copyright © 2026 Abuzar Haideri. All rights reserved. The source is public to read;
reusing it requires permission. See [LICENSE](LICENSE).
