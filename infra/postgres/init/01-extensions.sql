-- Runs once when the local volume is first created. Migrations also create these idempotently.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
-- Separate database for the test suite so tests never touch dev data.
CREATE DATABASE aireview_test OWNER aireview;
\connect aireview_test
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
