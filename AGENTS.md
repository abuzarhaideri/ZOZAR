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
- The signature is a calm cobalt action color, slate matte surfaces, and a restrained warm horizon accent.
- Use bold, clean headings and tabular time typography. Do not reintroduce the old editorial-serif/photo composition.
- Warm, contextual greetings should support the user’s next action without inventing product status.
- Respect the device appearance by default and preserve the user’s System, Light, or Dark choice.
- Use clear hierarchy, generous spacing, readable contrast, reduced-motion support, and touch targets of at least 48dp where practical.
- Keep a fixed bottom navigation bar for Home, Wake, Plan, and People; editors and chats use conventional Back/Cancel navigation.
- Avoid gradients, glass effects, decorative photography, and misleading protection or scheduling claims.
