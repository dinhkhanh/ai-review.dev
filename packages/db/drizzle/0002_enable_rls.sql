-- Defense in depth for Supabase: its Data API (PostgREST) exposes the public schema to the
-- anon/authenticated roles. The app connects as the table owner, which bypasses RLS, so enabling
-- RLS with no policies blocks Data API access without affecting the app.
-- New tables must enable RLS too; packages/db/src/schema.test.ts fails if one does not.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
