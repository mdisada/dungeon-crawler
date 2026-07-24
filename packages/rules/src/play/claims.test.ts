import { describe, expect, it } from 'vitest'

import {
  claimViolations, namesEntity, parseEntityClaims, suspectEntities,
} from './claims'
import type { ClaimEntity } from './claims'

const roster: ClaimEntity[] = [
  { id: 'n1', name: 'Sereth Vane', state: 'alive' },
  { id: 'n2', name: 'Elias Thorne', state: 'dead' },
  { id: 'n3', name: 'Keeper Elphin', state: 'absent' },
]

describe('the structural gate', () => {
  it('charges nothing when the draft names nobody who is gone', () => {
    expect(suspectEntities('Sereth Vane draws her blade and steps forward.', roster)).toEqual([])
  })

  it('picks up a dead name and an absent one', () => {
    const found = suspectEntities('You think of Elias Thorne, and of Keeper Elphin far away.', roster)
    expect(found.map((e) => e.id).sort()).toEqual(['n2', 'n3'])
  })

  it('matches whole names only', () => {
    expect(namesEntity('The elias thornewood grows here.', 'Elias Thorne')).toBe(false)
    expect(namesEntity('You turn to Elias Thorne.', 'Elias Thorne')).toBe(true)
    expect(namesEntity('"Elias Thorne!" she cries.', 'Elias Thorne')).toBe(true)
  })

  it('survives punctuation in a name', () => {
    expect(() => namesEntity('anything at all', "Silas 'The Shadow' (d)")).not.toThrow()
    expect(namesEntity("Silas 'The Shadow' nods.", "Silas 'The Shadow'")).toBe(true)
  })
})

describe('the verdict, in code', () => {
  it('THE speaking corpse: a dead man given a line is a violation', () => {
    const violations = claimViolations([{ name: 'Elias Thorne', role: 'speaks' }], roster)
    expect(violations).toHaveLength(1)
    expect(violations[0].id).toBe('n2')
    expect(violations[0].constraint).toContain('DEAD')
  })

  it('a dead man acting is a violation too', () => {
    expect(claimViolations([{ name: 'Elias Thorne', role: 'acts' }], roster)).toHaveLength(1)
  })

  it('THE murder mystery: naming the victim is never a violation', () => {
    // The original bug this whole checker family exists to avoid - a story that says its
    // victim's name in every scene had its narrator silenced six times in one session.
    expect(claimViolations([{ name: 'Elias Thorne', role: 'mentioned' }], roster)).toEqual([])
  })

  it('an absent person may be discussed, but not act here', () => {
    expect(claimViolations([{ name: 'Keeper Elphin', role: 'mentioned' }], roster)).toEqual([])
    const acting = claimViolations([{ name: 'Keeper Elphin', role: 'acts' }], roster)
    expect(acting[0].constraint).toContain('NOT in this scene')
  })

  it('the living may do anything', () => {
    expect(claimViolations([
      { name: 'Sereth Vane', role: 'speaks' }, { name: 'Sereth Vane', role: 'acts' },
    ], roster)).toEqual([])
  })

  it('a name the extractor invented is ignored, never guessed at', () => {
    expect(claimViolations([{ name: 'Some Passing Stranger', role: 'speaks' }], roster)).toEqual([])
  })

  it('reports each person once, however many claims name them', () => {
    expect(claimViolations([
      { name: 'Elias Thorne', role: 'speaks' }, { name: 'Elias Thorne', role: 'acts' },
    ], roster)).toHaveLength(1)
  })
})

describe('parsing the extractor', () => {
  it('reads a well-formed reply', () => {
    expect(parseEntityClaims({ claims: [{ name: 'Elias Thorne', role: 'speaks' }] }))
      .toEqual([{ name: 'Elias Thorne', role: 'speaks' }])
  })

  it('degrades an unknown role to the harmless one', () => {
    expect(parseEntityClaims({ claims: [{ name: 'Elias Thorne', role: 'lurks' }] }))
      .toEqual([{ name: 'Elias Thorne', role: 'mentioned' }])
  })

  it('garbage in, empty out - never a violation from a malformed reply', () => {
    expect(parseEntityClaims(null)).toEqual([])
    expect(parseEntityClaims('prose')).toEqual([])
    expect(parseEntityClaims({ claims: 'nope' })).toEqual([])
    expect(parseEntityClaims({ claims: [{ role: 'speaks' }, null, 42] })).toEqual([])
  })
})
