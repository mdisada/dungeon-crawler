#!/usr/bin/env node
// Pre-deploy gate for the edge functions. `supabase functions deploy --use-api` does NOT
// typecheck or even module-load the bundle, so a duplicate import survived deploy and every
// request came back 503 BOOT_ERROR until it was found by hand (2026-07-23).
//
// This LOADS each function under Deno, which catches exactly that class of failure (duplicate
// identifiers, bad named imports, top-level throws) in a couple of seconds. Type errors are
// deliberately NOT fatal: the repo carries known-strictness noise that the runtime strips.
//
//   node scripts/check-functions.mjs            # load-check every function
//   node scripts/check-functions.mjs session    # just one
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DENO = [
  join(homedir(), '.deno', 'bin', 'deno.exe'),
  join(homedir(), '.deno', 'bin', 'deno'),
  'deno',
].find((p) => p === 'deno' || existsSync(p))

const only = process.argv[2]
const functions = readdirSync('supabase/functions', { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(`supabase/functions/${d.name}/index.ts`))
  .map((d) => d.name)
  .filter((n) => !only || n === only)

/** Boot the function and kill it once it starts serving - a clean start is the pass condition. */
function loadCheck(name) {
  return new Promise((resolve) => {
    const child = spawn(DENO, ['run', '--no-check', '--allow-all', `supabase/functions/${name}/index.ts`], {
      env: { ...process.env, SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'x', OPENROUTER_API_KEY: 'x' },
    })
    let out = ''
    const done = (ok) => { try { child.kill() } catch { /* already gone */ } resolve({ ok, out }) }
    const settle = setTimeout(() => done(false), 90_000)
    const onData = (buf) => {
      out += buf.toString()
      if (out.includes('Listening on')) { clearTimeout(settle); done(true) }
      if (/error:/i.test(out)) { clearTimeout(settle); done(false) }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (err) => { clearTimeout(settle); out += String(err); done(false) })
    child.on('exit', () => { clearTimeout(settle); done(out.includes('Listening on')) })
  })
}

/**
 * A curated set of type errors that are always real bugs and never the repo's known
 * strictness noise. A full `deno check` is too loud to gate on (pre-existing TS18047
 * possibly-null and TS2304 NegotiateStash), but these are unambiguous:
 *
 *   TS1117 - duplicate key in an object literal. Legal JS, silently keeps the LAST value.
 *            Cost a silent bug: a `completionPredicates: null` placeholder shadowed the real
 *            value, so every encounter shipped with null award atoms (2026-07-23).
 *   TS2552 / TS2304 on a name we introduced - a typo'd identifier.
 */
const FATAL_TYPE_CODES = [/TS1117\b/, /TS2304\b/, /TS2552\b/]

function typeCheck(name) {
  return new Promise((resolve) => {
    const child = spawn(DENO, ['check', `supabase/functions/${name}/index.ts`], { env: process.env })
    let out = ''
    const onData = (b) => { out += b.toString() }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', () => resolve([]))
    child.on('exit', () => {
      const hits = out.split('\n').filter((line) => FATAL_TYPE_CODES.some((re) => re.test(line)))
      resolve(hits)
    })
  })
}

let failed = 0
for (const name of functions) {
  const { ok, out } = await loadCheck(name)
  if (!ok) {
    failed++
    console.log(`  FAIL: ${name} failed to boot\n${out.split('\n').slice(0, 12).map((l) => `    ${l}`).join('\n')}`)
    continue
  }
  const typeHits = await typeCheck(name)
  if (typeHits.length > 0) {
    failed++
    console.log(`  FAIL: ${name} boots but has fatal type errors:\n${typeHits.map((l) => `    ${l}`).join('\n')}`)
  } else {
    console.log(`  ok: ${name} boots`)
  }
}
console.log(failed === 0 ? `\nAll ${functions.length} function(s) boot.` : `\n${failed} function(s) FAILED - do not deploy.`)
process.exitCode = failed > 0 ? 1 : 0
