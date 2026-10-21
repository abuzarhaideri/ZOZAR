# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## ZO-ZAR project guidance

- This project uses Expo SDK 57 and Expo Router under `src/app/`.
- Use the authenticated Expo MCP server for current Expo documentation, compatible package guidance, and local verification when the MCP-enabled dev server is running.
- The visual and interaction reference is the **Hearth** direction in `design-exports/ZO-ZAR-design-review/` (gitignored; the brief is `Design-brief-and-Claude-prompt.md`). Follow it for layout, hierarchy, spacing, palette and motion. Do not combine it with the Thread or Still directions, and do not use the Apple Design skill for this product. Android-native behavior stays authoritative for alarms, notifications, permissions, system settings, back handling and touch interaction.
- The production product surface includes Home, Wake, Plan, and People, with trusted-person protection, chat, and voice messages. The Android app is the only frontend; there is no web app and nothing deploys to Vercel.
- The backend is a self-owned AWS serverless API: Lambda running a Hono router behind API Gateway, Aiven for PostgreSQL via Drizzle, S3 for media, API Gateway WebSockets for realtime, and EventBridge for scheduled work. Infrastructure is AWS CDK in `infra/`; the API lives in `server/`. Read `docs/ARCHITECTURE.md` before changing either.
- Appwrite has been replaced and is being removed. Do not add Appwrite, Supabase, or Firebase Auth/Firestore/Storage/Functions calls. Firebase remains FCM-only. Precise alarms are owned by the project-local native Android module.
- Aiven's free PostgreSQL plan allows only 20 connections and has no PgBouncer, so every Lambda uses a `pg` pool of `max: 1` and carries a reserved-concurrency ceiling. Do not raise concurrency, add a Lambda, or open a second pool without re-checking the connection budget in `docs/ARCHITECTURE.md`.
- Authorization rules live in `server/src/domain/authz.ts` as pure functions and are the replacement for Appwrite's row permissions. Route handlers must resolve a decision there rather than writing their own ownership checks.
- `server/` and `infra/` are independent npm projects, not workspaces, and are blocked from Metro in `metro.config.js`. Never import server code from `src/`.
- Prefer React Native primitives and shared theme tokens from `src/constants/theme.ts`.

## ZO-ZAR visual direction

- Use the semantic light and dark palettes in `src/constants/theme.ts`; do not add one-off screen colors.
- Hearth's thesis: an alarm should feel like a familiar object beside the bed. Night is a dark olive-charcoal (#1C1C19), day a warm limestone (#F6F0E4); both are first-class.
- Gold/amber is reserved for selected state and primary actions — never decoration, never status. The primary button is gold with dark ink (`fill`/`onFill`) in both appearances; `accent` is amber used as text and deepens in light mode. Do not introduce a second accent hue.
- Use bold, clean headings and tabular time typography. Do not reintroduce the old editorial-serif/photo composition.
- Warm, contextual greetings should support the user’s next action without inventing product status.
- Respect the device appearance by default and preserve the user’s System, Light, or Dark choice. The choice is a single toggle in the header, not a settings list: tap switches to the opposite of what is on screen, and a long press (also a named TalkBack action) returns to following the device. Light mode is a first-class variant and must meet the same contrast bar as dark; being night-first never means shipping a neglected light theme.
- Use clear hierarchy, generous spacing, readable contrast, reduced-motion support, and touch targets of at least 48dp where practical. Run `npm run verify:contrast` after any palette change.
- The bottom navigation bar has two tabs, Wake (route `/home`) and People. Wake is named for what it is always about — the next wake-up — not a time of day. The alarm list (`/wake`), Plan, Bedtime, the alarm editors and chats are detail screens declared `href: null`, each with its own Back.
- Wake's anchor is `src/components/hearth-dial.tsx`: a real twelve-hour clock face whose amber arc runs from now to the alarm. Tap opens the alarm; turning it moves the time in five-minute steps. The enable switch stays outside the dial's tap target. Below it, Hearth rows (`HearthRow`, `RowMark`) and one primary action.
- One primary action per decision, with literal labels at consequential moments: "Save alarm", "I'm awake", "Snooze 5 minutes".
- Never nest a touch target inside another (a Switch in a pressable row, a Pressable inside a GestureDetector): it fires both. Compose taps and drags as gestures with `Gesture.Exclusive`.
- Anything reachable by long press must also be reachable another way — pass named `actions` to `HearthRow` so TalkBack lists them.
- People opens with a personal message from the trusted person when one exists, then the small circle. Never invent a message, and never let an avatar imply protection: pending, accepted and unlinked are shown distinctly.
- Protection is tested only with `isProtected()` from `zo-zar-repository.ts`, never by comparing label strings.
- The real ringing screen is native (`modules/zo-zar-exact-alarm/.../ZoZarAlarmActivity.kt`) and hard-codes the Hearth dark palette; keep it in step with `theme.ts`.
- Avoid gradients, glass effects, decorative photography, and misleading protection or scheduling claims.
- Avatars and status markers are drawn or lettered, never emoji. Emoji cannot take a theme colour, render differently on every Android version, and carry no accessible semantics.
- Motion is calm and purposeful: it should explain where something came from or confirm an action landed, never decorate. Use Reanimated on the UI thread, keep durations short, prefer opacity and transform over layout animation, and honor reduced-motion by reducing to a cross-fade rather than disabling feedback entirely.
- Ambient motion is fenced to two places, both carrying no information and both held still by Reduce Motion: the ember breathing behind the Wake dial, and `src/components/night-sky.tsx` on Bedtime and the welcome threshold. Never animate the ringing or challenge screens, and never animate every row.
