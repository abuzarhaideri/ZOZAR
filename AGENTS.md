# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## ZO-ZAR project guidance

- This project uses Expo SDK 57 and Expo Router under `src/app/`.
- Use the authenticated Expo MCP server for current Expo documentation, compatible package guidance, and local verification when the MCP-enabled dev server is running.
- For UI creation, review, or redesign, follow `.agents/skills/apple-design/SKILL.md` and load the relevant HIG reference files before making design recommendations.
- Apply the Apple Design Skill cross-platform: use its principles for accessibility, hierarchy, craft, writing, interaction, and navigation, but keep Android-native behavior authoritative for alarms, notifications, permissions, system settings, back handling, and touch interaction.
- The production product surface includes Home, Wake, Plan, and People, backed by Appwrite Cloud Singapore with authentication, row permissions, Realtime, storage, trusted-person protection, chat, and voice messages. Firebase is used only for FCM push delivery. Precise alarms are owned by the project-local native Android module. Do not add Supabase runtime calls or Firebase Auth/Firestore/Storage/Functions.
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
