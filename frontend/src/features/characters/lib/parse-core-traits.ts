import { SKILL_ABILITY } from '@rules/character'

import type { EquipmentOption } from '../types'

export const ALL_SKILLS = Object.keys(SKILL_ABILITY)

// Open5e's SRD 5.2.1 class data doesn't expose skill-choice-count or starting-equipment as
// structured fields - they're embedded in a markdown table inside the class's "Core <Class>
// Traits" feature description (one exception: Cleric has no such feature in the seeded data -
// see fallback-core-traits.ts).
function parseMarkdownTableRows(desc: string): Record<string, string> {
  const rows: Record<string, string> = {}
  for (const line of desc.split('\n')) {
    const cells = line.split('|')
    if (cells.length !== 4) continue // |Key|Value| splits into ['', 'Key', 'Value', '']
    const key = cells[1].trim()
    const value = cells[2].trim()
    if (!key || key === '---') continue
    rows[key] = value
  }
  return rows
}

export function parseEquipmentOptions(text: string): EquipmentOption[] {
  const markers = [...text.matchAll(/\(([A-Z])\)/g)]
  const options: EquipmentOption[] = []
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i]
    const start = (marker.index ?? 0) + marker[0].length
    const end = i + 1 < markers.length ? (markers[i + 1].index ?? text.length) : text.length
    const chunk = text
      .slice(start, end)
      .replace(/^;?\s*(or\s+)?/i, '')
      .replace(/;\s*(or\s*)?$/i, '')
      .trim()
    options.push({ letter: marker[1], desc: chunk })
  }
  return options
}

export interface CoreTraitsResult {
  skillChoiceCount: number
  skillChoices: string[]
  equipmentOptions: EquipmentOption[]
  table: Record<string, string>
}

// Skill rows come in two shapes: "Choose 2: Acrobatics, Animal Handling, ..." (explicit list)
// and "Choose any 3 skills" (Bard - any of the 18).
function parseSkillRow(skillRow: string): { count: number; choices: string[] } {
  const anyMatch = /Choose any (\d+)/i.exec(skillRow)
  if (anyMatch) return { count: Number(anyMatch[1]), choices: [...ALL_SKILLS] }

  const listMatch = /Choose (\d+):/i.exec(skillRow)
  if (!listMatch) return { count: 0, choices: [] }
  const choices = skillRow
    .replace(/Choose \d+:\s*/i, '')
    .replace(/,?\s+or\s+/gi, ',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return { count: Number(listMatch[1]), choices }
}

export function parseCoreTraitsTable(desc: string | undefined): CoreTraitsResult {
  if (!desc) return { skillChoiceCount: 0, skillChoices: [], equipmentOptions: [], table: {} }

  const rows = parseMarkdownTableRows(desc)
  const { count, choices } = parseSkillRow(rows['Skill Proficiencies'] ?? '')

  const equipmentRow = rows['Starting Equipment'] ?? ''
  const afterColon = equipmentRow.includes(':') ? equipmentRow.split(':').slice(1).join(':') : equipmentRow
  const equipmentOptions = parseEquipmentOptions(afterColon)

  return { skillChoiceCount: count, skillChoices: choices, equipmentOptions, table: rows }
}

// Background equipment text is a standalone "*Choose A or B:* (A) ...; or (B) ..." blob (not
// embedded in a markdown table like class Starting Equipment), so it needs its own entry point.
export function parseChoiceEquipmentText(desc: string): EquipmentOption[] {
  const cleaned = desc.replace(/^\*?Choose[^:]*:\*?\s*/i, '')
  return parseEquipmentOptions(cleaned)
}
