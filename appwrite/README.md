# ZO-ZAR Appwrite Cloud

Production uses one Appwrite Cloud project in Singapore (`https://sgp.cloud.appwrite.io/v1`). The mobile app receives only public resource IDs. API keys, Firebase credentials, and other server secrets belong in Appwrite Function variables.

## Resources

- Database: `zozar`
- Private bucket: `zozar-private`
- Functions: `zozar-actions`, `zozar-maintenance`
- Maintenance schedule: `* * * * *`

Create the tables and columns in [`schema.md`](./schema.md), with row security enabled for every table. Client-created owner records receive user-specific read/update/delete permissions. Connections, threads, messages, participant-visible files, and all sensitive mutations are created by `zozar-actions` with explicit permissions for both participants.

## Function variables

Set these in both functions unless marked otherwise:

```text
APPWRITE_ENDPOINT=https://sgp.cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=<project-id>
APPWRITE_DATABASE_ID=zozar
APPWRITE_STORAGE_BUCKET_ID=zozar-private
APPWRITE_API_KEY=<server-key-with-required-database/storage/users-scopes>
```

Set these only for functions that send push notifications:

```text
FIREBASE_SERVICE_ACCOUNT_JSON=<complete-service-account-json>
FIREBASE_PROJECT_ID=<firebase-project-id>
```

Never prefix a secret with `EXPO_PUBLIC_` and never place one in an EAS build profile.

## Deploy order

1. Create the Singapore project, Android platform (`com.abuzarhaideri.zozar`), database, tables, indexes, and private bucket.
2. Deploy `zozar-actions`, then set execute access to authenticated users.
3. Deploy `zozar-maintenance`, set its schedule to every minute, and deny client execution.
4. Put the public IDs in the app's EAS environment from `.env.example`.
5. Register fresh test accounts; Supabase accounts and rows are intentionally not copied.

Supabase remains untouched as a temporary rollback reference, but the app runtime no longer imports or selects it.
