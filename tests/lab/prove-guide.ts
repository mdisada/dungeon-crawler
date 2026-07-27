// Runs the stage-8 playability prover against a stored guide. $0, no LLM, no network beyond reads.
// Usage: npx tsx tests/lab/prove-guide.ts <adventure_id>   (omit the id to prove every guide)
import { proveGraph } from '../../packages/rules/src/guide/prove.ts'
import type { ProvableNode } from '../../packages/rules/src/guide/prove.ts'
// @ts-expect-error - plain JS helper
import { serviceRest } from './shared.mjs'

type Row = Record<string, any>

const toNodes = (rows: Row[]): ProvableNode[] => rows.map((r) => ({
  id: r.id, key: r.key, objectiveId: r.objective_id, index: r.index, role: r.role,
  onSuccess: r.encounter_spec?.on_success ?? [],
  onFailure: r.encounter_spec?.on_failure ?? [],
  transitions: (r.transitions ?? []).map((t: Row) => ({
    on: t.on, toNodeKey: t.to_node_key ?? null, arrivalContext: t.arrival_context ?? '',
  })),
}))

async function proveOne(advId: string, title: string) {
  const rows = await serviceRest('GET', `story_nodes?adventure_id=eq.${advId}&select=id,key,objective_id,index,role,transitions,encounter_spec`)
  if (rows.length === 0) return null
  const objs = await serviceRest('GET', `objectives?adventure_id=eq.${advId}&select=id,title,completion_predicates`)
  const findings = proveGraph({
    objectives: objs.map((o: Row) => ({ id: o.id, title: o.title, completionPredicates: o.completion_predicates })),
    nodes: toNodes(rows),
  })
  console.log(`\n${title}  (${rows.length} nodes / ${objs.length} objectives)  -> ${findings.length} finding(s)`)
  for (const f of findings) {
    console.log(`  [${f.code}] ${f.message}${f.path?.length ? `\n      path: ${f.path.join(' -> ')}` : ''}`)
  }
  return findings.length
}

async function main() {
  const only = process.argv[2]
  const advs: Row[] = only
    ? await serviceRest('GET', `adventures?id=eq.${only}&select=id,title`)
    : await serviceRest('GET', 'adventures?select=id,title&order=created_at')

  let total = 0, proved = 0
  for (const a of advs) {
    const n = await proveOne(a.id, a.title || '(untitled)')
    if (n !== null) { total += n; proved++ }
  }
  console.log(`\n=== proved ${proved} guide(s), ${total} finding(s) total ===`)
}

void main()
