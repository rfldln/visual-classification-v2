# Migration 0001 — Initial Users Table

**Created:** 2026-05-26  
**Status:** pending

## Summary

Creates the `public.users` table that stores application-level user profiles,
linked to Supabase's internal `auth.users` table via a foreign key with
`ON DELETE CASCADE`.

Also sets up:
- Row Level Security (RLS) with SELECT and UPDATE policies
- An `updated_at` trigger to keep the timestamp current
- A `handle_new_auth_user` trigger that automatically inserts a profile row
  whenever a new user signs up through Supabase Auth

## How to apply

Run the SQL below in **Supabase Dashboard → SQL Editor**, or via `psql`
connected directly to your database.

```sql
-- Enable UUID generation (already available in Supabase by default)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create the users table
CREATE TABLE IF NOT EXISTS public.users (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT        NOT NULL UNIQUE,
  full_name   TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Foreign key to Supabase Auth's internal users table (cross-schema reference).
-- CASCADE DELETE ensures profile rows are removed when the auth user is deleted.
-- NOTE: Drizzle cannot express cross-schema FKs in its schema builder, so this
--       constraint lives only here in raw SQL.
ALTER TABLE public.users
  ADD CONSTRAINT users_id_fkey
  FOREIGN KEY (id)
  REFERENCES auth.users (id)
  ON DELETE CASCADE;

-- Index: fast lookups by email
CREATE INDEX IF NOT EXISTS users_email_idx ON public.users (email);

-- Index: ordering by signup date (DESC for newest-first queries)
CREATE INDEX IF NOT EXISTS users_created_at_idx ON public.users (created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Policy: users can read their own profile row only
CREATE POLICY "users_select_own"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

-- Policy: users can update their own profile row only
CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Trigger function: keep updated_at current on every row update
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Trigger function: auto-create a profile row when a user signs up via Auth.
-- SECURITY DEFINER lets this function INSERT on behalf of the new user before
-- their session exists. search_path = public prevents search_path injection.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
```

## Rollback

```sql
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_auth_user();
DROP TRIGGER IF EXISTS users_updated_at ON public.users;
DROP FUNCTION IF EXISTS public.handle_updated_at();
DROP TABLE IF EXISTS public.users;
```

## Notes

- The `auth.users` FK is intentionally absent from `lib/db/schema/users.ts`
  because Drizzle's schema builder cannot cross the `auth` schema boundary.
  The constraint is enforced exclusively via this migration SQL.
- The `handle_new_auth_user` trigger runs as `SECURITY DEFINER` so it can
  INSERT into `public.users` on behalf of the newly-created auth user, even
  before the user's session is established.
- After applying this migration, generate Supabase TypeScript types to get
  full type-safety on database queries:
  ```
  npx supabase gen types typescript --project-id YOUR_PROJECT_ID > types/supabase.ts
  ```
