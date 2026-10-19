# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## ZO-ZAR project guidance

- This project uses Expo SDK 57 and Expo Router under `src/app/`.
- Use the authenticated Expo MCP server for current Expo documentation, compatible package guidance, and local verification when the MCP-enabled dev server is running.
- For UI creation, review, or redesign, follow `.agents/skills/apple-design/SKILL.md` and load the relevant HIG reference files before making design recommendations.
- Apply the Apple Design Skill cross-platform: use its principles for accessibility, hierarchy, craft, writing, interaction, and navigation, but keep Android-native behavior authoritative for alarms, notifications, permissions, system settings, back handling, and touch interaction.
- The production product surface includes Home, Wake, Plan, and People, with trusted-person protection, chat, and voice messages. The Android app is the only frontend; there is no web app and nothing deploys to Vercel.
- The backend is a self-owned AWS serverless API: Lambda running a Hono router behind API Gateway, Aiven for PostgreSQL via Drizzle, S3 for media, API Gateway WebSockets for realtime, and EventBridge for scheduled work. Infrastructure is AWS CDK in `infra/`; the API lives in `server/`. Read `docs/ARCHITECTURE.md` before changing either.
- Appwrite has been replaced and is being removed. Do not add Appwrite, Supabase, or Firebase Auth/Firestore/Storage/Functions calls. Firebase remains FCM-only. Precise alarms are owned by the project-local native Android module.
- Aiven's free PostgreSQL plan allows only 20 connections and has no PgBouncer, so every Lambda uses a `pg` pool of `max: 1` and carries a reserved-concurrency ceiling. Do not raise concurrency, add a Lambda, or open a second pool without re-checking the connection budget in `docs/ARCHITECTURE.md`.
- Authorization rules live in `server/src/domain/authz.ts` as pure functions and are the replacement for Appwrite's row permissions. Route handlers must resolve a decision there rather than writing their own ownership checks.
- `server/` and `infra/` are independent npm projects, not workspaces, and are blocked from Metro in `metro.config.js`. Never import server code from `src/`.
- Prefer React Native primitives and shared theme tokens from `src/constants/theme.ts`.

## ZO-ZAR visual direction

- Use the semantic light and dark palettes in `src/constants/theme.ts`; do not add one-off screen colors.
- The palette is night-first: dark is the reference design and light is derived from it, because an alarm app is used in bed in the dark and a full-brightness white screen at 06:00 is the wrong default. Night-first describes which mode is designed first, not which mode is forced.
- The signature is deep ink surfaces, a warm off-white text color, and a single warm amber action color that reads as sunrise rather than as an alert. Amber is the only accent; do not introduce a second competing accent hue.
- Use bold, clean headings and tabular time typography. Do not reintroduce the old editorial-serif/photo composition.
- Warm, contextual greetings should support the user’s next action without inventing product status.
- Respect the device appearance by default and preserve the user’s System, Light, or Dark choice. Light mode is a first-class variant and must meet the same contrast bar as dark; being night-first never means shipping a neglected light theme.
- Use clear hierarchy, generous spacing, readable contrast, reduced-motion support, and touch targets of at least 48dp where practical.
- The bottom navigation bar has two tabs, Tonight and People. Home, Wake and Plan were three views of one night and most of the app's buttons existed to move between them; they are now a single vertical spine on Tonight. Wake, Plan, the alarm editors and chats are detail screens reached by touching the thing they belong to, declared `href: null`, and each carries its own Back.
- The spine in `src/components/night-spine.tsx` is the primary layout for anything that happens in time: times in a fixed left gutter, a continuous rail, and blocks whose height is their duration. The sleep gap is deliberately compressed and states its real length in words. Do not reintroduce a dashboard of cards for alarms, commitments or the night.
- Prefer direct manipulation over adding a control. The wake time is dragged, a commitment is tapped to complete and long-pressed to edit, and destructive actions live inside the editor beside the fields they destroy — never as a third icon on a list row. Every gesture must ship with an accessible equivalent: the wake block is an `adjustable` with increment/decrement actions, and anything reachable only by long press is also reachable by opening the object.
- Avoid gradients, glass effects, decorative photography, and misleading protection or scheduling claims.
- Avatars and status markers are drawn or lettered, never emoji. Emoji cannot take a theme colour, render differently on every Android version, and carry no accessible semantics.
- Motion is calm and purposeful: it should explain where something came from or confirm an action landed, never decorate. Use Reanimated on the UI thread, keep durations short, prefer opacity and transform over layout animation, and honor reduced-motion by reducing to a cross-fade rather than disabling feedback entirely.
- There is exactly one exception to that rule, and it is fenced: `src/components/night-sky.tsx` is ambient, and it appears only at the bedtime end of the spine and on the threshold screen. It carries no information, so Reduce Motion stops it entirely with nothing lost. Do not add a second ambient surface, and do not extend this one to a screen where a decision is made.
