# supabase/

Schema migrations + SRD reference-data seed for the project's Supabase backend.

## No local Docker

The dev machine can't run Docker, so this project does **not** use `supabase start` / `supabase
db reset` (the CLI's local emulation stack). Instead, migrations and the seed apply directly to
the real, already-configured Supabase project:

```sh
# Load the connection string (kept in backend/.env for now - see docs/DECISIONS.md):
set -a && source backend/.env && set +a

# Migrations - preview, then apply:
supabase db push --dry-run --db-url "$POSTGRES_URL_NON_POOLING"
supabase db push --db-url "$POSTGRES_URL_NON_POOLING"

# Seed data - apply/refresh supabase/seed.sql:
node supabase/seed/apply-seed.mjs "$POSTGRES_URL_NON_POOLING"
```

**Don't use `supabase db push --include-seed`** for the seed step even though the flag exists -
verified live that once a seed.sql has been applied once, a *changed* seed.sql only updates the
CLI's tracked hash and does **not** re-run the file, silently leaving stale data in place. Use
`supabase/seed/apply-seed.mjs` instead, which executes each statement in `seed.sql` directly via
`supabase db query --file` (deterministic, no hash-tracking involved) - see the script's header
comment for the full story.

`POSTGRES_URL_NON_POOLING` currently lives in `backend/.env` (the non-pooling connection string is
required for migrations — the pooled `POSTGRES_URL` goes through pgbouncer, which doesn't reliably
support DDL).

No `supabase login` or `supabase link` needed — `--db-url` connects directly.

Verify results in the **hosted** Supabase Studio (supabase.com/dashboard/project/&lt;ref&gt;), not
a local one.

CI (`.github/workflows/ci.yml`) is unaffected by this — its `supabase-migrations` job runs
`supabase db start` / `db reset` on GitHub's hosted runners, which have Docker regardless of the
developer's machine. That job is the "do migrations apply cleanly from an empty database" check;
the commands above are the day-to-day way to actually get schema + seed changes into the real
project.

See `docs/DECISIONS.md` (2026-07-17) for why.

## Layout

- `migrations/` — hand-written SQL migrations, applied in filename (timestamp) order. srd_items
  holds the full item catalog; srd_weapons / srd_armor normalize the weapon- and armor-specific
  stats out of it (`20260717120000_split_srd_weapons_armor.sql`), keyed 1:1 to `srd_items.key`.
- `seed/ingest-srd.mjs` — fetches SRD 5.2.1 content from the Open5e API and generates `seed.sql`.
  Re-run it (`node supabase/seed/ingest-srd.mjs`) to refresh from upstream, then run
  `seed/apply-seed.mjs` (see above) to push the refreshed data.
- `seed/apply-seed.mjs` — applies `seed.sql` to a given `--db-url` one statement at a time.
- `seed.sql` — generated output of `ingest-srd.mjs`; do not hand-edit.
