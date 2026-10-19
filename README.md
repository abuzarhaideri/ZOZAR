# ZO-ZAR

An Android alarm app for people who sleep through alarms. You commit to waking at a time,
and a trusted person is notified if you don't confirm within your grace period. Alarms fire
through a project-local native Android module so they ring exactly on time, with a
full-screen intent, through Doze and after a reboot.

## Status

The backend is being migrated from Appwrite onto infrastructure this project owns. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the decision record.

| Area | State |
| --- | --- |
| Database schema, migrations | Done, verified against PostgreSQL 17 |
| Authentication, token rotation | Done, tested |
| Authorization rules | Done, tested |
| Wake recurrence and escalation logic | Done, tested, daylight-saving aware |
| CI | Done |
| API routes: commitments, wake, connections, chat, devices, profile | Done, tested |
| S3 presigned uploads (voice notes, photos) | Not started |
| WebSocket realtime, scheduled worker | Not started |
| AWS CDK infrastructure | Not started |
| Appwrite data migration | Not started |
| App switched onto the new API | Not started |
| UI redesign | Not started |

## Stack

**App** — Expo SDK 57, Expo Router, React Native 0.86, TypeScript. Android only; there is
no web build. Precise alarms live in `modules/zo-zar-exact-alarm`.

**API** — Node 22 on AWS Lambda, Hono router behind an API Gateway HTTP API. Aiven for
PostgreSQL via Drizzle. S3 for voice notes and profile photos. API Gateway WebSockets for
chat realtime. EventBridge Scheduler for materialising alarms, escalating missed wakes, and
expiring messages. Firebase is used for FCM delivery and nothing else.

**Infrastructure** — AWS CDK in TypeScript. GitHub Actions runs typecheck, unit tests, and
the migrations against a throwaway Postgres; deploys are gated on all of it passing.

### The interesting constraint

Aiven's free PostgreSQL plan permits 20 connections and has no PgBouncer, and RDS Proxy
cannot front a non-AWS database. Lambda holds a connection per warm container, so the
deployment runs on an explicit connection budget: every function uses a `pg` pool of
`max: 1` and carries a reserved-concurrency ceiling that sums to the limit. Lambdas also
run outside a VPC, because a VPC would need a NAT gateway costing more per month than the
rest of the stack combined. The full budget is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Layout

```
src/              Expo app. Routes under src/app/, Expo Router file-based.
modules/          Native Android exact-alarm module.
server/           API, WebSocket, and worker Lambdas. Independent npm project.
infra/            AWS CDK app. Independent npm project.
docs/             Architecture decision record.
appwrite/         Legacy backend, retained until the migration completes.
```

`server/` and `infra/` are deliberately not npm workspaces: Metro watches the repository
root, and hoisted dependencies would end up in the app's module graph. `metro.config.js`
blocks both.

## Running it

### App

```bash
npm install
npm run android        # a development build; Expo Go cannot load the native alarm module
```

### API

```bash
cd server
npm install
cp .env.example .env   # then fill in DATABASE_URL and JWT_SECRET
npm test               # unit tests; integration tests skip without DATABASE_URL
npm run typecheck
```

To run the integration tests, point `DATABASE_URL` at a throwaway database. Containers
serve no TLS certificate, so disable it explicitly:

```bash
docker run -d --name zozar-pg -e POSTGRES_USER=zozar -e POSTGRES_PASSWORD=zozar \
  -e POSTGRES_DB=zozar_test -p 55432:5432 postgres:17-alpine

export DATABASE_URL='postgres://zozar:zozar@localhost:55432/zozar_test?sslmode=disable'
npm run db:migrate
npm test
```

Never point these at the Aiven database. The tests truncate tables.

### Database changes

Migrations are generated from the Drizzle schema and committed, never pushed from the
schema directly, so the SQL that CI validates is the SQL that runs in production:

```bash
cd server
npm run db:generate -- --name=what_changed
npm run db:migrate
```

## Licence

See [LICENSE](LICENSE).
