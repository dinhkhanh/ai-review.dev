-- Extensions required by the schema. Supabase installs these in the `extensions` schema;
-- IF NOT EXISTS keeps this a no-op there and on the local docker image.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;
