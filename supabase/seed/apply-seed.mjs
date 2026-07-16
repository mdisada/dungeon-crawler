#!/usr/bin/env node
// Applies supabase/seed.sql directly against a Postgres connection, one statement at a time.
//
// Why this exists: `supabase db push --include-seed` only re-runs the seed when it detects the
// seed hasn't been applied before; once a hash is recorded, a changed seed.sql silently updates
// the tracked hash without re-executing (verified: re-running after a fix left stale data in
// place). `supabase db query --file` executes reliably but rejects multi-statement files
// ("cannot insert multiple commands into a prepared statement"), so this script splits seed.sql
// into its individual statements and runs each one through `supabase db query --file` in order.
//
// Usage: node supabase/seed/apply-seed.mjs "$POSTGRES_URL_NON_POOLING"

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const dbUrl = process.argv[2]
if (!dbUrl) {
  console.error('Usage: node supabase/seed/apply-seed.mjs <postgres-connection-string>')
  process.exit(1)
}

const seedPath = new URL('../seed.sql', import.meta.url)

async function main() {
  const { readFile } = await import('node:fs/promises')
  const content = await readFile(seedPath, 'utf8')

  // Statements are separated by ";\n\n" (how ingest-srd.mjs joins them). Drop empty chunks
  // (e.g. trailing newline) and skip chunks that are comment-only.
  const statements = content
    .split(';\n\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.split('\n').every((line) => line.trim().startsWith('--')))

  const tmpDir = await mkdtemp(join(tmpdir(), 'srd-seed-'))
  try {
    for (const [i, statement] of statements.entries()) {
      const file = join(tmpDir, `statement-${i}.sql`)
      await writeFile(file, statement.endsWith(';') ? statement : `${statement};`)
      const label = statement.slice(0, 60).replace(/\s+/g, ' ')
      console.log(`[${i + 1}/${statements.length}] ${label}...`)
      await execFileAsync(
        'npx',
        ['--yes', 'supabase', 'db', 'query', '--file', file, '--db-url', dbUrl],
        { shell: true },
      )
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }

  console.log('Done.')
}

main().catch((err) => {
  console.error(err.stderr ?? err.message ?? err)
  process.exitCode = 1
})
