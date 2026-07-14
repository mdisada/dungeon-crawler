import type { PuzzleDefinition } from './types'

// A small starter library of complete, ready-made definitions — one per archetype is the
// Phase 6 goal; these three exercise both presentation classes end-to-end for now. Picking one
// drops it straight into the review card, editable or "Adapt to my campaign"-able from there.
export const PUZZLE_TEMPLATES: { id: string; archetype: string; definition: PuzzleDefinition }[] = [
  {
    id: 'template-riddle-sphinx',
    archetype: 'riddle',
    definition: {
      title: 'The Sphinx of the Sealed Vault',
      presentation: 'text',
      archetype: 'riddle',
      description:
        'A stone sphinx blocks the vault door. Its voice grinds like shifting rock: "Speak my answer, or speak no more."',
      dmNotes: 'Play the sphinx as bored rather than menacing — it has asked this riddle for centuries.',
      grid: null,
      elements: [],
      stateTriggers: [],
      winCondition: {
        requiredStates: [],
        sequence: null,
        solutionText: 'A candle (or a candle flame) — it grows shorter as it lives longer.',
      },
      hints: [
        'It has a life, but is not alive.',
        'The more it gives, the less remains of it.',
      ],
      maxAttempts: 4,
      successText: 'The sphinx dips its great stone head, and the vault door grinds open.',
      failText: 'The sphinx grows still. Its eyes dim to cold stone, and the vault seals forever.',
    },
  },
  {
    id: 'template-pressure-plates-twin-doors',
    archetype: 'pressure-plates',
    definition: {
      title: 'The Twin Weight Doors',
      presentation: 'map',
      archetype: 'pressure-plates',
      description:
        'Two stone plates sit before a barred door — clearly meant to be pressed at once.',
      dmNotes: 'A cooperative puzzle: it should nudge the party toward splitting up.',
      grid: {
        width: 5,
        height: 3,
        imageUrl: null,
        blockedTiles: [],
        tileTriggers: [],
      },
      elements: [
        {
          id: 'plate-left', name: 'Left Plate', kind: 'plate',
          description: 'A worn stone plate set into the floor.',
          position: { x: 1, y: 1 }, hidden: false,
          states: ['pressed', 'released'], initialState: 'released',
          interactions: [], revealText: null,
        },
        {
          id: 'plate-right', name: 'Right Plate', kind: 'plate',
          description: 'A worn stone plate set into the floor.',
          position: { x: 3, y: 1 }, hidden: false,
          states: ['pressed', 'released'], initialState: 'released',
          interactions: [], revealText: null,
        },
        {
          id: 'door', name: 'Barred Door', kind: 'door',
          description: 'A heavy door barred with iron.',
          position: { x: 4, y: 1 }, hidden: false,
          states: ['closed', 'open'], initialState: 'closed',
          interactions: [], revealText: null,
        },
      ],
      stateTriggers: [
        {
          id: 'trigger-both-plates',
          when: { elementId: 'plate-left', state: 'pressed' },
          effects: [
            { type: 'set-state', text: null, elementId: 'door', state: 'open', instruction: null },
          ],
          once: false,
        },
      ],
      winCondition: {
        requiredStates: [
          { elementId: 'plate-left', state: 'pressed' },
          { elementId: 'plate-right', state: 'pressed' },
        ],
        sequence: null,
        solutionText: null,
      },
      hints: ['Both plates need weight on them at the same time.'],
      maxAttempts: null,
      successText: 'The iron bars grind upward, and the door swings wide.',
      failText: null,
    },
  },
  {
    id: 'template-lever-combination-three-switches',
    archetype: 'lever-combination',
    definition: {
      title: 'The Three Switches',
      presentation: 'map',
      archetype: 'lever-combination',
      description: 'Three levers jut from the wall, each scored with a faded rune.',
      dmNotes: 'The correct combination is up, down, up — a nearby inscription hints at it if the party investigates.',
      grid: {
        width: 4,
        height: 2,
        imageUrl: null,
        blockedTiles: [],
        tileTriggers: [],
      },
      elements: [
        {
          id: 'lever-1', name: 'First Lever', kind: 'lever',
          description: 'A lever marked with a sun rune.',
          position: { x: 0, y: 0 }, hidden: false,
          states: ['up', 'down'], initialState: 'down',
          interactions: [
            { id: 'pull-lever-1', label: 'Pull the lever', requires: null,
              effects: [{ type: 'set-state', text: null, elementId: 'lever-1', state: 'up', instruction: null }],
              onFail: [] },
          ],
          revealText: null,
        },
        {
          id: 'lever-2', name: 'Second Lever', kind: 'lever',
          description: 'A lever marked with a moon rune.',
          position: { x: 1, y: 0 }, hidden: false,
          states: ['up', 'down'], initialState: 'up',
          interactions: [
            { id: 'pull-lever-2', label: 'Pull the lever', requires: null,
              effects: [{ type: 'set-state', text: null, elementId: 'lever-2', state: 'down', instruction: null }],
              onFail: [] },
          ],
          revealText: null,
        },
        {
          id: 'lever-3', name: 'Third Lever', kind: 'lever',
          description: 'A lever marked with a star rune.',
          position: { x: 2, y: 0 }, hidden: false,
          states: ['up', 'down'], initialState: 'down',
          interactions: [
            { id: 'pull-lever-3', label: 'Pull the lever', requires: null,
              effects: [{ type: 'set-state', text: null, elementId: 'lever-3', state: 'up', instruction: null }],
              onFail: [] },
          ],
          revealText: null,
        },
        {
          id: 'inscription', name: 'Faded Inscription', kind: 'inscription',
          description: 'Worn letters carved beside the levers.',
          position: { x: 3, y: 0 }, hidden: false,
          states: [], initialState: null,
          interactions: [
            { id: 'read-inscription', label: 'Read the inscription', requires: null,
              effects: [{ type: 'narrate', text: 'It reads: "Sun rises, moon falls, star rises."', elementId: null, state: null, instruction: null }],
              onFail: [] },
          ],
          revealText: 'It reads: "Sun rises, moon falls, star rises."',
        },
      ],
      stateTriggers: [],
      winCondition: {
        requiredStates: [
          { elementId: 'lever-1', state: 'up' },
          { elementId: 'lever-2', state: 'down' },
          { elementId: 'lever-3', state: 'up' },
        ],
        sequence: null,
        solutionText: null,
      },
      hints: ['Something in the room might describe the correct order.'],
      maxAttempts: null,
      successText: 'The levers click into place and a hidden door rumbles open nearby.',
      failText: null,
    },
  },
]
