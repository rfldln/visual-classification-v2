# Migration 0002 — Vault Items Table

**Created:** 2026-05-27  
**Status:** pending

## Summary

Creates the `public.vault_items` table for per-user file storage. Each row
records a file that has been uploaded to Supabase Storage under the `vault`
bucket. The table stores metadata only — actual files live in Supabase Storage
at path `{userId}/{uuid}.{ext}`.

Also requires a Supabase Storage bucket named `vault` (private). Create it
manually in the Supabase Dashboard → Storage before uploading files.

## How to apply

1. Run `npm run db:generate` to produce the raw SQL into `lib/db/migrations/sql/`.
2. Review the generated file, then run the SQL below in **Supabase Dashboard → SQL Editor** (or via `psql`).

```sql
-- vault_items: metadata for files stored in Supabase Storage bucket "vault"
CREATE TABLE IF NOT EXISTS public.vault_items (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL,
  storage_key TEXT        NOT NULL UNIQUE,
  file_name   TEXT        NOT NULL,
  file_type   TEXT        NOT NULL,
  file_size   INTEGER     NOT NULL,
  media_kind  TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FK to Supabase Auth users (cross-schema — cannot be expressed in Drizzle)
ALTER TABLE public.vault_items
  ADD CONSTRAINT vault_items_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users (id)
  ON DELETE CASCADE;

-- Indexes
CREATE INDEX IF NOT EXISTS vault_items_user_id_idx    ON public.vault_items (user_id);
CREATE INDEX IF NOT EXISTS vault_items_created_at_idx ON public.vault_items (created_at DESC);

-- Row Level Security
ALTER TABLE public.vault_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vault_items_select_own"
  ON public.vault_items FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "vault_items_insert_own"
  ON public.vault_items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "vault_items_delete_own"
  ON public.vault_items FOR DELETE
  USING (auth.uid() = user_id);
```

## Rollback

```sql
DROP TABLE IF EXISTS public.vault_items;
```

## Notes

- The `auth.users` FK is absent from `lib/db/schema/vault.ts` for the same
  reason as `users.ts` — Drizzle cannot cross the `auth` schema boundary.
- `media_kind` is constrained at the application layer (see `lib/vault/constants.ts`);
  not a Postgres enum so it can be extended without a migration.
- Uploads go through `supabaseAdmin.storage.from("vault").createSignedUploadUrl()`
  so the bucket can stay private with no storage RLS policies required.
