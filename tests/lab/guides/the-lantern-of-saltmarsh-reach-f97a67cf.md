# The Lantern of Saltmarsh Reach

*one_shot | mode full_ai | status active*

> A fishing town on a tidal estuary has lost three boats in a month. The harbour lantern that guides them home has been burning the wrong colour since the old keeper died, and the woman who took over the light insists nothing has changed. Someone in town is signalling the wrecks deliberately.

## Premise

Three fishing boats have wrecked on the treacherous bar at Mirren's Mouth in a single month. The harbour lantern — the only guide through the estuary's shifting channels — has been burning the wrong colour since old keeper Tollen Vey died. His successor, his granddaughter Fen Tollen, insists nothing has changed. She is wrong, but she is not lying: someone has been tampering with the light each night, and that someone is getting more desperate.

**Antagonist:** Cris Hakey, the harbour pilot who guides ships through the bar, has been deliberately misaligning the lantern's mirrors to draw boats onto the rocks. He is a revenant — dead three years, drowned when Tollen Vey misread a signal and guided him onto the shelf — and he has clawed his way back from the Murk to take his revenge on the keeper's light and the families it fails. He cannot enter the lighthouse itself; the lantern's true flame burns him. So he works from outside, visiting each night to shift the mirrors before the boats come home, and visiting Fen in her dreams to make her forget what she's seen.

## The job offered

- **ENTRY: Find what's wrong with the light** - giver Bren Solas, 75-150 gp, due in 3 days
  - stakes: The Night Solace is due in three days and Bren cannot bring her through the Bar without a true light — if the lantern stays wrong, the ship and thirty souls will founder on the Shelf.
  - covers 1/3 objectives: Find what's wrong with the light
- **side: Clear Cris Hakey's name** - giver Mara Hakey, 40-80 gp
  - stakes: Mara has spent three years watching the town blame her husband for his own death; if the truth of Tollen Vey's misread signal is not spoken before Cris rises again, she fears his revenant will take more lives in his rage.
  - covers 2/3 objectives: Uncover the truth of Cris's death; Stop Cris before the boat lands

## The spine

### Chapter 1: The Wrong Light

The party arrives in Mirren's Mouth at dawn on the day the Night Solace is due. Cris Hakey's revenant spent the previous night tampering with the lantern's mirrors and visiting Fen Tollen in her dreams to make her forget, and he is now in the estuary's Murk, too weak to act until dusk — when he will make his final attempt on the light before the boat comes home. The party discovers the tampered mirrors if they inspect the lighthouse, learns of Cris's death from Roth Kel or the harbour stone, and hears from Mara Hakey that the official story of his drowning was wrong: Tollen Vey misread his signal and guided him onto the shelf. At dusk, Cris rises from the Murk and moves on the lighthouse. If the party has uncovered the truth, they can meet him with it — confronting his rage, freeing his bones, or taking the lantern's flame to the shelf. If they have not, the light fails, the Night Solace wrecks, and Cris's revenge is complete.

#### 1. Find what's wrong with the light

*DM intent:* The party arrives at Mirren's Mouth at dawn and is briefed by Bren Solas on the quay. Their first task is to investigate the lighthouse itself, where they will discover the misaligned mirrors and Murk residue on the housing, indicating sabotage. They also meet Fen Tollen, exhausted and confused, her memory tampered by Cris's nightly dream-visitations. The mirrors are physically shifted but the Lantern's Flame burns clean — the corruption is external. This objective grounds Scenes 4, 5, and 6 and establishes the central problem: the light is being sabotaged.

- **Route - Climb the winding stairs to the lantern room.** *(skill_challenge)*
  - Dawn breaks over Mirren's Mouth, painting the sky in bruised shades of purple and orange. Bren Solas, grim-faced, directs you towards the lighthouse, the scene of this morning's unexpected darkness.
  - at stake: A critical failure in assessing the light's malfunction could lead to a ship running aground.
  - ways in: Attempt: Climb the winding stairs to the lantern room. / Attempt: Inspect the lighthouse's foundation and exterior.
  - on success: `lantern_sabotage_discovered`
  - on failure: `mirrors_unmoved`
  - on *full* -> **objective resolves**
  - on *failed* -> Offer Fen a warm drink and a listening ear. — "Despite your efforts, the cause of the light's failure remains elusive, the mirrors seeming to have reset themselves."
- **Route - Offer Fen a warm drink and a listening ear.** *(social)*
  - Fen Tollen, eyes shadowed with exhaustion, fumbles with a broom near the lighthouse base. She seems distant, her words occasionally trailing off before she can complete them.
  - at stake: Misunderstanding Fen's state could lead to crucial information about the light being missed.
  - ways in: Talk: Offer Fen a warm drink and a listening ear. / Talk: Gently probe Fen about any disturbances she might have noticed.
  - on success: `lantern_sabotage_discovered`
  - on failure: `fen_too_distracted`
  - on *full* -> **objective resolves**
  - on *failed* -> Investigate the lighthouse for signs of sabotage. — "Fen's scattered thoughts offer little clarity, so you turn your attention back to the lighthouse itself."
- **RESCUE - Investigate the lighthouse for signs of sabotage.** *(skill_challenge)*
  - The way forward narrows to one thing: Find what's wrong with the light. Upon arriving at Mirren's Mouth at dawn, the party is briefed by Bren Solas on the quay. Their immediate task is to investigate the lighthouse itself, where they will discover the misaligned mirrors and signs of the Murk's influence before Cris's final attempt.
  - at stake: The party arrives at Mirren's Mouth at dawn and is briefed by Bren Solas on the quay. Their first task is to investigate the lighthouse itself, where they will discover the misaligned mirrors and Murk
  - ways in: Attempt: Find what's wrong with the light
  - on success: `lantern_sabotage_discovered`
  - on *full* -> **objective resolves**

#### 2. Uncover the truth of Cris's death

*DM intent:* The party must uncover that Cris Hakey did not die by his own error but was guided onto the Shelf by Tollen Vey's misread signal. This can be learned from Mara Hakey at her cottage (loc#5), from Roth Kel's ravings (ing#3), and the Harbour Stone (ing#5) omitting Cris's name. At the Shelf (loc#4) at low tide they find his bones tangled in pilot's rope (ing#6), and the Murk whispers of being guided wrong. This grounds Scenes 1, 2, and 3 and unlocks the climax.

- **Route - Inquire about Cris's final days and the official story.** *(social)*
  - Mara Hakey's cottage is small and neat, filled with the scent of dried herbs and unspoken grief. She looks up from mending a fishing net as you enter, her eyes red-rimmed but sharp. She can speak of Cris's final days and the accident, hinting that the official story doesn't sit right with her.
  - at stake: Learning the true circumstances of Cris's death is vital to preventing his return.
  - ways in: Talk: Inquire about Cris's final days and the accident. / Talk: Express your sympathy and offer help to Mara.
  - on success: `cris_death_truth_uncovered`
  - on failure: `mara_uncooperative`
  - on *full* -> **objective resolves**
  - on *failed* -> Carefully inspect the skeletal remains for clues. — "Mara's grief makes her guarded, so you decide to seek out other witnesses to Cris's final moments."
- **Route - Carefully inspect the skeletal remains for clues.** *(puzzle)*
  - The tide has receded, revealing the jagged rocks of the Shelf. Amongst the kelp and barnacles, you spot what looks like Cris Hakey's bones, tangled in pilot's rope, a grim testament to his final moments. This dire discovery is key to Objective 2.
  - at stake: Failure to find evidence at the Shelf could leave Cris's death unexplained, fueling his vengeful spirit.
  - ways in: Work out: Carefully inspect the skeletal remains for clues. / Work out: Investigate the rope entangled with the bones.
  - on success: `cris_death_truth_uncovered`
  - on failure: `bones_too_eroded`
  - on *full* -> **objective resolves**
  - on *failed* -> Uncover the truth of Cris's death — "The sea has taken its toll on the remains, obscuring any definitive clues, so you must look elsewhere for answers."
- **RESCUE - Uncover the truth of Cris's death** *(skill_challenge)*
  - The way forward narrows to one thing: Uncover the truth of Cris's death. The party must uncover that Cris Hakey did not die by his own error but was guided onto the Shelf by Tollen Vey's misread signal. This comes from talking to Mara Hakey at her cottage, or discovering Cris's charts and recognizing Tollen Vey's signal mark.
  - at stake: The party must uncover that Cris Hakey did not die by his own error but was guided onto the Shelf by Tollen Vey's misread signal. This comes from talking to Mara Hakey at her cottage, from Roth Kel's
  - ways in: Attempt: Uncover the truth of Cris's death
  - on success: `cris_death_truth_uncovered`
  - on *full* -> **objective resolves**

#### 3. Stop Cris before the boat lands

*DM intent:* At dusk the Night Solace appears on the horizon and Cris Hakey rises from the Murk to make his final attempt on the lantern's mirrors. The party, armed with the truth of Tollen Vey's error (learned from Mara, Roth Kel, or the Harbour Stone), must intercept him at the lighthouse base (node#8). They may burn his bones with the Lantern's Flame, speak his death aloud to sever the Murk's hold, offer him the truth of Tollen Vey's error to cool his rage, or fight him back until the Night Solace clears the Bar. If they lack the truth or fail, Cris shifts the mirrors and the Night Solace wrecks. This is the chapter's climax, grounding Scene 7 and 8 and resolving the story toward one of the promised endings.

- **Route - Engage Cris directly at the lighthouse base.** *(combat)*
  - As dusk bleeds across the horizon, a spectral silhouette appears – the Night Solace. From the churning Murk, a twisted figure rises, a harbinger of Cris's unfinished rage. He makes for the lighthouse, his purpose clear.
  - at stake: If Cris reaches the lantern, the Night Solace will wreck and lives will be lost.
  - ways in: Fight: Engage Cris directly at the lighthouse base. / Fight: Attempt to burn Cris's spectral form with the lighthouse beam.
  - on success: `cris_laid_to_rest`
  - on failure: `cris_reaches_lantern`
  - on *full* -> **objective resolves**
  - on *failed* -> Confront Cris, armed with the truth of Tollen Vey's mistake. — "Despite your best efforts, Cris surges past you, his spectral fingers scrabbling at the lantern housing."
- **Route - Confront Cris, armed with the truth of Tollen Vey's mistake.** *(social)*
  - Cris Hakey, a phantom consumed by rage, blocks your path to the lighthouse. His form flickers, caught between worlds, his eyes burning with accusation. To proceed, you must explain Tollen Vey's mistake and its consequences.
  - at stake: Appeasing Cris's spectral rage is key to preventing the Night Solace's destruction.
  - ways in: Talk: Explain Tollen Vey's mistake and its consequences. / Talk: Recite the truth of his demise aloud, offering him peace.
  - on success: `cris_laid_to_rest`
  - on failure: `cris_unappeased`
  - on *full* -> **objective resolves**
  - on *failed* -> Stop Cris before the boat lands — "Your words fail to quell Cris's spectral fury, and he lunges towards the lighthouse, his form solidifying with malevolent intent."
- **RESCUE - Stop Cris before the boat lands** *(skill_challenge)*
  - The way forward narrows to one thing: Stop Cris before the boat lands. At dusk the Night Solace appears on the horizon and Cris Hakey rises from the Murk to make his final attempt on the lantern's mirrors. The party, armed with the truth, must intercept him at the lighth
  - at stake: At dusk the Night Solace appears on the horizon and Cris Hakey rises from the Murk to make his final attempt on the lantern's mirrors. The party, armed with the truth, must intercept him at the lighth
  - ways in: Attempt: Stop Cris before the boat lands
  - on success: `cris_laid_to_rest`
  - on *full* -> **objective resolves**

## Cast

- **Fen Tollen** (npc) - Pale lighthouse keeper in denial; her memory is scrubbed each night by Cris's dream-visitations. This phenomenon is mentioned by Bren Solas as a potential cause for her confusion regarding the mirror misalignment.
- **Tollen Vey** (npc) *[dead]* - Previous lighthouse keeper whose misread signal sent Cris Hakey onto the Shelf three years ago. His error is the core of Objective 2.
- **Mara Hakey** (npc) - Cris's widow, keeper of his pilot's gear and charts; knows the official drowning story is false.
- **Bren Solas** (npc) - Harbourmaster desperate to bring the Night Solace home; knows the lantern's colour is wrong but can't make Fen listen.
- **Roth Kel** (npc) - Half-mad survivor of the second wreck; saw a figure standing on the water near the Bar before his boat struck.
- **Cris Hakey** (boss) *[absent]* - Revenant harbour pilot, drowned three years ago, tethered to his bones on the Shelf (loc#4). Rises at dusk to shift the mirrors, and may also be found guarding the lighthouse path (node#8).

## Places

- **Mirren's Mouth** - A grieving fishing town built around its harbour, its quay stone scarred by wrecks and loss.
- **the Lighthouse** - A stone tower on the harbour mole holding the lantern; the mirrors in its housing have been subtly tampered with.
- **the Bar** - Shifting sand and rock shelf at the estuary's mouth where boats wreck without true light to guide them.
- **the Shelf** - A rocky spur exposed at low tide where Cris Hakey’s bones remain tangled in pilot's rope; the Murk pools thick around it, suggesting a connection to the broader body of water and serving as the locati
- **Mara Hakey's Cottage** - Cris's widow's home on the harbour edge, holding his pilot's gear, rope, and old charts.
- **the Murk** - Malevolent tidal damp clinging to Cris's revenant and pooling at the Shelf, whispering when disturbed.

## Endings

### Laid to Rest *(bittersweet)*

The party recovers Cris's bones from the Shelf and returns them to his widow Mara with the truth of his death, breaking the Murk's hold and freeing the light. Fen keeps the lantern burning and Mirren's Mouth rebuilds.

*Authored climax:* At dusk the party intercepts Cris at the lighthouse base, holding his bones and Mara's words. He falters, the rage in him guttering like a spent flame, and the Murk releases its drowned pilot as Mara names him at the harbour stone.

Scores when:

- +3 if **Stop Cris before the boat lands** is *completed* — The climax is resolved — Cris is stopped and the Night Solace survives.
- +3 if **Uncover the truth of Cris's death** is *completed* — The party learned the truth of Cris's death, enabling a peaceful resolution.
- +2 if **Mara Hakey** is *allied* — Mara trusts the party and can receive her husband's bones.
- +1 if **Fen Tollen** is *alive* — Fen survives to keep the lantern burning.
- +2 if dial *mercy_vs_force* >= 2 — The party chose restraint over destruction.
- +2 if dial *truth_vs_destruction* >= 1 — The party valued understanding over mere elimination.
- +1 if dial *community_bonds* >= 0 — The party did not alienate the town they mean to save.

### The Light Fails *(tragic)*

The party cannot break Cris's hold before the tide turns. The Night Solace wrecks on the Shelf, the town blames Fen, and she vanishes into the Murk herself. The lantern goes dark for good.

*Authored climax:* Cris reaches the mirrors unopposed or unbroken, and the light burns wrong one final time. Out on the bar the Night Solace founders, and on the quay the fishers watch their livelihood drown.

Scores when:

- +5 if **Stop Cris before the boat lands** is *failed* — Cris succeeds; the Night Solace is lost.
- +3 if **Uncover the truth of Cris's death** is *failed* — Without the truth, the party had no lever against Cris's rage.
- +2 if dial *community_bonds* <= -2 — An alienated town turns on Fen in the aftermath.
- +1 if dial *truth_vs_destruction* <= -2 — The party never sought the truth that could have saved the town.
- +2 if **Fen Tollen** is *hostile* — Fen is driven away or turned against — the lantern loses its keeper.

### The Truth Carved *(bittersweet)*

The party confronts Cris with the truth of Tollen Vey's fatal mistake, and his name is carved on the harbour stone alongside the lost crews. His rage cools, the light steadies, and Mirren's Mouth learns its dead were failed by the living.

*Authored climax:* The party speaks Cris's death aloud at the lighthouse base — not the官方 story, but the truth — and the revenant's fury cracks open into grief. The harbour stone receives a new name and the Murk loosens its grip.

Scores when:

- +3 if **Stop Cris before the boat lands** is *completed* — Cris is stopped and the Night Solace is saved.
- +3 if **Uncover the truth of Cris's death** is *completed* — The party knows the truth and can speak it aloud.
- +4 if dial *truth_vs_destruction* >= 3 — The party committed to truth-telling as the resolution itself.
- +2 if dial *mercy_vs_force* >= 1 — The party offered understanding rather than destruction.
- +1 if **Cris Hakey** is *alive* — Cris survives the encounter — not destroyed, but freed.
- +2 if dial *community_bonds* >= 1 — The town is ready to hear and accept the uncomfortable truth.
- +1 if **Mara Hakey** is *allied* — Mara's testimony gives the truth its weight.

### The Burning of the Murk *(pyrrhic)*

The party takes the lantern's flame to the Shelf and burns the Murk away. Cris is destroyed, but the estuary is scarred — fish flee the coast, and the town survives only to face a slow starvation.

*Authored climax:* The party carries the lantern's flame down to the Shelf at low tide and sets the Murk alight. The drowned ground burns clean, but when the smoke clears the water is dead and silent, and the fish are gone.

Scores when:

- +3 if **Stop Cris before the boat lands** is *completed* — Cris is stopped and the Night Solace survives.
- +4 if dial *mercy_vs_force* <= -2 — The party chose overwhelming force over restraint.
- +3 if dial *truth_vs_destruction* <= -3 — The party bypassed truth in favor of a scorched solution.
- +2 if **Cris Hakey** is *dead* — Cris is destroyed rather than freed.
- +1 if dial *community_bonds* <= 0 — The party acted without deep community investment, leaving the town to face the consequences alone.
- -2 if **Uncover the truth of Cris's death** is *completed* — Knowing the truth argues against a purely destructive resolution.

## Audit

- **Entry contract covers 1/3 objectives.** When it completes, its loop closes while later objectives are still to come.
- Ending **Laid to Rest**: side signals total +11 vs a climax claim of +3 - it can land while its own premise is false.
- Ending **The Light Fails**: side signals total +8 vs a climax claim of +5 - it can land while its own premise is false.
- Ending **The Truth Carved**: side signals total +13 vs a climax claim of +3 - it can land while its own premise is false.
- Ending **The Burning of the Murk**: side signals total +10 vs a climax claim of +3 - it can land while its own premise is false.
- Corrupted characters in authored prose (`官方`): "The party speaks Cris's death aloud at the lighthouse base — not the官方..."

### What the pipeline itself flagged

- *stage 4* **[info]** Chapter 1 coop: coop set "coop:shelf-truth" was demoted to plain ingredients: needs 2-3 member ingredients, has 1; all members must be clues; every member needs a reveals_to affinity
- *stage 5* **[info]** $.encounters[3]: rebalanced from 1200 to 600 adjusted XP (target 300 for 2 level-3) - dropped duplicate bodies - now within the survivable ceiling.
- *stage 5* **[info]** $.encounters[4]: rebalanced from 1800 to 700 adjusted XP (target 300 for 2 level-3) - downgraded Cris Hakey (Revenant) CR 5 -> 4, Cris Hakey (Revenant) CR 4 -> 3 - now within the survivable ceiling.
- *stage 5* **[info]** Battle encounter is over budget: 600 adjusted XP vs a 300 XP standard target for 2 level-3 characters.
- *stage 5* **[info]** Battle encounter is over budget: 700 adjusted XP vs a 300 XP standard target for 2 level-3 characters.
- *stage 7* **[warning]** The initial briefing by Bren Solas on the quay is mentioned in the objective description but not represented as a distinct scene or interaction.
- *stage 7* **[warning]** The objective states the truth of Cris's death can be learned from Mara Hakey, but objective #3 implies the party is already armed with this truth before confronting Cris, creating a potential sequencing issue.
- *stage 7* **[warning]** Fen Tollen's memory being scrubbed by Cris's dream-visitations is stated as a potential phenomenon that Bren Solas mentions, but there's no scene or objective directly addressing this or how the players might discover or interact with it.
- *stage 7* **[warning]** The objective states the party is 'armed with the truth of Tollen Vey' when Cris rises, but the actual learning and acquisition of this truth (via obj#2) is not explicitly linked as a prerequisite to starting this final confrontation scene.
- *stage 7* **[info]** The description of node#1 serving 'Uncover the truth of Cris's death' implies Mara's knowledge is the direct path, but obj#2 also mentions learning from her, which seems redundant if the primary interaction is this scene.
- *stage 7* **[info]** This puzzle scene is listed as serving 'Uncover the truth of Cris's death', but the discovery of Cris's bones on the Shelf is already revealed as part of the investigation of the Shelf in obj#6 and the meta loop.
- *stage 7* **[info]** This scene is a skill challenge for 'Uncover the truth of Cris's death', but the truth itself is presented as being discovered earlier via node#1 and node#2, making the narrative purpose of this specific skill challenge unclear.
- *stage 7* **[info]** This skill challenge scene for 'Find what's wrong with the light' begins by stating the party is briefed by Bren Solas on the quay, which is also an initial step for obj#1 but not presented as a separate scene or part of this challenge's actions.
- *stage 7* **[warning]** This combat scene states Cris Hakey blocks the path to the lighthouse, but the meta loop and obj#3 place the confrontation occurring as the Night Solace appears on the horizon, implying it happens outside or near the harbour, not necessarily blocking the lighthouse itself.
