# Where this work is

Written 2026-10-20, immediately before a Claude Code restart to load two newly
installed design plugins. Read this first; it is the fastest way back to context.

## The project

ZO-ZAR: an Android alarm app. You commit to waking at a time, and a trusted person is
notified if you do not confirm within your grace period. Alarms fire through a
project-local native Android module.

Work is on the branch `aws-aiven-migration`, not `main`.

## What is done

The backend was rebuilt from scratch, replacing Appwrite entirely.

- PostgreSQL schema on Aiven, via Drizzle, migrations committed and verified against a
  real Postgres 17
- Self-built auth: scrypt passwords, 15-minute JWTs, rotating refresh tokens with family
  revocation on replay
- Authorization as pure functions in `server/src/domain/authz.ts`, replacing Appwrite's
  row permissions
- Every route: commitments, wake plans and occurrences, connections, chat, device tokens,
  profile, presigned S3 uploads
- Worker Lambda: materialises alarms, escalates missed wakes, delivers FCM pushes, sweeps
  expired messages
- WebSocket realtime via API Gateway
- AWS CDK infrastructure, synth verified, and a GitHub Actions pipeline that gates deploys
  on the test suite
- The app talks to this API through `src/components/rest-repository.ts`
- Appwrite is fully removed

291 server tests pass. `docs/ARCHITECTURE.md` holds the decision record;
`docs/DEPLOYMENT.md` is the runbook.

## What is NOT done

**The UI redesign, which is the user's top priority.**

Only the palette has changed. The night-first colours are in `src/constants/theme.ts` and
apply everywhere, but:

- Icons are still emoji text (`🌙`, `←`, `⌄`) in the `Glyph` component
- `src/components/motion.tsx` exists and is used in ZERO files
- The `Type` scale in theme.ts is not adopted by `src/components/zo-zar-ui.tsx`
- Spacing, layouts and component shapes are untouched

So the app currently reads as recoloured, not redesigned. The user has seen this and knows.

## Decisions already made — do not relitigate

- Android only. No web app, nothing on Vercel.
- AWS region `ap-south-1`. Aiven free plan picks its own region.
- Night-first palette: dark is the reference design, light derives from it. One accent,
  a warm amber. All 46 contrast pairs verified by `npm run verify:contrast`, which runs
  in CI.
- Lucide icons, via `lucide-react-native` + `react-native-svg`, both installed. Chosen
  because the reference scrape showed Structured uses Lucide, and it is ISC licensed.
- Appwrite data migration was **cancelled**: the audit found 2 rows and 1 account of test
  data. Not worth migrating. `/auth/claim-account` is now dead surface and should probably
  be removed.

## The design brief, in the user's own words

Five reference folders live in `design/` (gitignored — 18MB of third-party marketing
assets, scraped with CSS Peeper, which must never ship):

- **Daylight's warmth** for the palette
- **mymind's personal feel** for cards and copy
- **Structured's clarity** for alarms and routines
- **Slowly's approach to connection** for friends
- **Endel's ambient approach** for bedtime

Those folders contain marketing-site assets, not app screenshots, so the written brief
above carries more weight than the files do.

## Pick up here

A design workflow was running when the session restarted and did not survive it. Re-run
it, this time with the newly installed `frontend-design` and `ui-ux-pro-max` skills
loaded, plus the project's own `apple-design` skill which AGENTS.md mandates.

Then implement, in this order, because the component library is shared by every screen:

1. `src/components/zo-zar-ui.tsx` — adopt the Type scale, the motion primitives and
   Lucide icons
2. Home, Wake, Plan, People, Chat, and the wake-confirm screen
3. Fresh `expo export` and serve it, so the user can actually see the result

## Outstanding, needing the user

- Deployment: Aiven service and CA cert, AWS account, OIDC role, four SSM parameters
- Nothing is deployed yet. The backend has never run against real AWS or real Aiven.
