#!/usr/bin/env node
// Fetches D&D SRD 5.2.1 reference data (CC-BY-4.0, Wizards of the Coast) from the Open5e API
// (api.open5e.com/v2, document key "srd-2024") and writes ../seed.sql, which the Supabase CLI
// runs automatically after migrations on `supabase db reset`.
//
// Attribution required by the source license: see NOTICE.md at the repo root.
// Re-run this script (`node supabase/seed/ingest-srd.mjs`) to refresh the seed from upstream.

const API_BASE = 'https://api.open5e.com/v2'
const DOCUMENT_KEY = 'srd-2024'
const OUTPUT_PATH = new URL('../seed.sql', import.meta.url)
const NULL_BYTE = String.fromCharCode(0)

async function fetchAllPages(endpoint) {
  const results = []
  let url = `${API_BASE}/${endpoint}/?document__key=${DOCUMENT_KEY}&limit=100`
  while (url) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`)
    const json = await res.json()
    results.push(...json.results)
    url = json.next
  }
  return results
}

function sqlString(value) {
  if (value === null || value === undefined) return 'null'
  return `'${String(value).replaceAll("'", "''")}'`
}

function sqlNumber(value) {
  return value === null || value === undefined || Number.isNaN(value) ? 'null' : String(value)
}

function sqlBool(value) {
  return value ? 'true' : 'false'
}

function sqlJsonb(value) {
  if (value === null || value === undefined) return 'null'
  // Postgres text/jsonb cannot contain the null byte; strip it defensively.
  const json = JSON.stringify(value).split(NULL_BYTE).join('')
  return `'${json.replaceAll("'", "''")}'::jsonb`
}

function insertStatement(table, columns, rows) {
  if (rows.length === 0) return ''
  const values = rows.map((row) => `  (${row.join(', ')})`).join(',\n')
  return (
    `insert into ${table} (${columns.join(', ')})\nvalues\n${values}\n` +
    `on conflict (key) do nothing;\n\n`
  )
}

async function buildMonsters() {
  const creatures = await fetchAllPages('creatures')
  const rows = creatures.map((c) => [
    sqlString(c.key),
    sqlString(c.name),
    sqlString(c.type?.name ?? null),
    sqlString(c.size?.name ?? null),
    sqlNumber(c.challenge_rating),
    sqlNumber(c.experience_points),
    sqlNumber(c.armor_class),
    sqlNumber(c.hit_points),
    sqlJsonb(c),
  ])
  return insertStatement(
    'srd_monsters',
    ['key', 'name', 'creature_type', 'size', 'challenge_rating', 'experience_points', 'armor_class', 'hit_points', 'data'],
    rows,
  )
}

async function buildSpells() {
  const spells = await fetchAllPages('spells')
  const rows = spells.map((s) => [
    sqlString(s.key),
    sqlString(s.name),
    sqlString(s.school?.name ?? null),
    sqlNumber(s.level),
    sqlBool(s.concentration),
    sqlBool(s.ritual),
    sqlJsonb(s),
  ])
  return insertStatement(
    'srd_spells',
    ['key', 'name', 'school', 'level', 'concentration', 'ritual', 'data'],
    rows,
  )
}

async function buildClassesAndFeatures() {
  const classes = await fetchAllPages('classes')
  // Base classes must be inserted before subclasses (subclass_of is a self-FK).
  const ordered = [...classes].sort((a, b) => (a.subclass_of ? 1 : 0) - (b.subclass_of ? 1 : 0))

  const classRows = ordered.map((cls) => [
    sqlString(cls.key),
    sqlString(cls.name),
    sqlString(cls.hit_dice),
    sqlString(cls.caster_type),
    sqlString(cls.subclass_of?.key ?? null),
    sqlJsonb(cls),
  ])
  let sql = insertStatement(
    'srd_classes',
    ['key', 'name', 'hit_dice', 'caster_type', 'subclass_of', 'data'],
    classRows,
  )

  const featureRows = []
  for (const cls of classes) {
    for (const feature of cls.features ?? []) {
      featureRows.push([
        sqlString(feature.key),
        sqlString(cls.key),
        sqlString(feature.name),
        sqlString(feature.feature_type),
        sqlJsonb(feature.gained_at ?? null),
        sqlJsonb(feature.data_for_class_table ?? null),
        sqlJsonb(feature),
      ])
    }
  }
  sql += insertStatement(
    'srd_class_features',
    ['key', 'class_key', 'name', 'feature_type', 'gained_at', 'data_for_class_table', 'data'],
    featureRows,
  )
  return sql
}

async function buildItems() {
  // Open5e's /items/ endpoint already covers weapons and armor - each has a `category` field
  // (e.g. "Weapon", "Armor", "Adventuring Gear") and, when applicable, nested `weapon`/`armor`
  // stat objects. The separate /weapons/ and /armor/ endpoints return the same keys with the
  // same data, so fetching them too just produces duplicate keys.
  const items = await fetchAllPages('items')
  const rows = items.map((i) => [
    sqlString(i.key),
    sqlString(i.name),
    sqlString(i.category?.name ?? null),
    sqlJsonb(i),
  ])
  let sql = insertStatement('srd_items', ['key', 'name', 'category', 'data'], rows)

  const weaponRows = items
    .filter((i) => i.weapon)
    .map((i) => [
      sqlString(i.key),
      sqlString(i.weapon.damage_type?.name ?? null),
      sqlString(i.weapon.damage_dice ?? null),
      sqlBool(i.weapon.is_simple),
      sqlBool(i.weapon.is_martial),
      sqlBool(i.weapon.is_improvised),
      sqlJsonb(i.weapon),
    ])
  sql += insertStatement(
    'srd_weapons',
    ['key', 'damage_type', 'damage_dice', 'is_simple', 'is_martial', 'is_improvised', 'data'],
    weaponRows,
  )

  const armorRows = items
    .filter((i) => i.armor)
    .map((i) => [
      sqlString(i.key),
      sqlString(i.armor.category ?? null),
      sqlNumber(i.armor.ac_base),
      sqlBool(i.armor.ac_add_dexmod),
      sqlNumber(i.armor.ac_cap_dexmod),
      sqlBool(i.armor.grants_stealth_disadvantage),
      sqlNumber(i.armor.strength_score_required),
      sqlJsonb(i.armor),
    ])
  sql += insertStatement(
    'srd_armor',
    [
      'key',
      'armor_category',
      'ac_base',
      'ac_add_dexmod',
      'ac_cap_dexmod',
      'grants_stealth_disadvantage',
      'strength_score_required',
      'data',
    ],
    armorRows,
  )

  return sql
}

async function main() {
  const sections = await Promise.all([
    buildMonsters(),
    buildSpells(),
    buildClassesAndFeatures(),
    buildItems(),
  ])

  const header =
    '-- Generated by supabase/seed/ingest-srd.mjs from api.open5e.com (SRD 5.2.1, document ' +
    "key 'srd-2024'). Do not hand-edit; re-run the script instead.\n" +
    '-- SRD content is CC-BY-4.0 Wizards of the Coast; see NOTICE.md for required attribution.\n\n' +
    'truncate table srd_class_features, srd_classes, srd_spells, srd_monsters, srd_weapons, srd_armor, srd_items restart identity cascade;\n\n'

  const { writeFile } = await import('node:fs/promises')
  await writeFile(OUTPUT_PATH, header + sections.join(''))

  console.log('Wrote', OUTPUT_PATH.pathname)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
