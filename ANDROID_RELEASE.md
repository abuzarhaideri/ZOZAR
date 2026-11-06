# ZO-ZAR Android native/release slice

The production backend is Appwrite Cloud Singapore. App screens use its repository abstraction; no server credentials are stored in the app.

Included:

- Android package ID `com.zozar.app`.
- A native `AlarmManager.setAlarmClock()` engine, foreground ringing service, lock-screen activity, reboot restore, three one-minute custom tones, and Android default sound.
- Notification, microphone, exact-alarm, and notification-policy Android permissions.
- Permission status plus Android Settings handoffs for exact alarms and Do Not Disturb.
- One-shot, daily, and weekly native wake scheduling plus cancellation, one snooze, and completion sync helpers.
- Native Firebase token registration persisted in Appwrite; Expo push tokens are not used.
- A 30-second `expo-audio` recorder, playback factory, and injected upload adapter.
- EAS `preview` internal-distribution APK profile.

Required before a real build:

1. Expo account with EAS access and a linked EAS project ID.
2. Approval to link the project and create Android signing credentials.
3. Firebase/FCM configuration supplied through the approved Expo/EAS flow for remote push.
4. Public Appwrite resource IDs supplied through an ignored local/EAS environment. Appwrite API keys and Firebase service-account JSON exist only as Appwrite Function variables.
5. Physical Android test devices. Remote push requires an Expo development/internal build, not Expo Go.

Never commit EAS tokens, Android keystores, Firebase service-account JSON, the Aiven database URL or CA certificate, Catalyst CLI tokens, or `.env*.local` files.

Android still controls special access. The app can open the exact-alarm and Do Not Disturb Settings screens, but it cannot grant access itself. ZO-ZAR's local Expo module reads `AlarmManager.canScheduleExactAlarms()` on Android 12+, so onboarding only confirms wake protection when Android reports exact-alarm access. The wake channel requests DND bypass; the user and OEM system settings remain authoritative.

Wake onboarding requests notifications and then hands off exact-alarm/DND access to Android Settings. Microphone permission is intentionally separate and is requested when voice recording is first used.

The Appwrite session is restored before auth routes render. A cached identity keeps temporary network failures from forcing sign-in; only an Appwrite 401/403 clears it.

Run `npm run typecheck`, `npx expo-doctor`, and `npx expo config --type public` before linking EAS or producing a build. This slice did not create credentials, build, or distribute an APK.
