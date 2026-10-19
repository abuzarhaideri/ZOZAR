import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  // Migrations are generated and committed, never pushed straight from the schema. The
  // committed SQL is what CI applies to a throwaway database and what runs against Aiven,
  // so the two can never drift.
  strict: true,
  verbose: true,
});
