# The Lantern of Saltmarsh Reach

*one_shot | mode full_ai | status active*

> A fishing town on a tidal estuary has lost three boats in a month. The harbour lantern that guides them home has been burning the wrong colour since the old keeper died, and the woman who took over the light insists nothing has changed. Someone in town is signalling the wrecks deliberately.

## Premise

A grieving widow has repurposed the harbour lantern of Tidemouth to lure fishing boats onto the Black Sow reef, sinking them to join her drowned husband. She believes she is sending crews to him, building a submerged community in death. Every night she continues her work, and every storm brings another ship within reach of her false light.

**Antagonist:** Maren Ostholm, the new harbour lantern keeper, who uses coloured glass and timed signals to mimic safe-channel lights, deliberately wrecking vessels to 'reunite' them with her drowned husband Colm Ostholm.

## The job offered

- **ENTRY: Investigate the Grey Harrier wreck** - giver Harriet Vane, 30-75 gp, due in 3 days
  - stakes: Harriet's brother drowned on the Grey Harrier and the Council refuses to act; she wants proof of what really lured the ship onto the reef so the families of Tidemouth can have answers before more boats are lost.
  - covers 2/3 objectives: Investigate the wrecked Grey Harrier; Uncover the truth at Saltspire

## The spine

### Chapter 1: The Wrong Light

The party arrives in Tidemouth to investigate three missing boats. The truth is that Maren Ostholm, who took over the Saltspire Lantern after her husband Colm drowned on the Sweet Marie, has been using coloured glass and timed signal intervals to mimic the old safe-channel light while actually misdirecting boats onto Black Sow Reef. She believes she is sending the drowned to join Colm, building a community of the dead beneath the water. Investigation of the wrecked Grey Harrier at low tide, questioning of Harriet Vane and Dermot Quinn, and close examination of the light itself all point toward Maren. When the party confronts or exposes her, an incoming storm is already driving the Lindworm toward the estuary, and Maren lights the false signal one final time. The climax is the party's choice at the tower: stop Maren and save the Lindworm, reach her emotionally and end the signal, fail to prevent the wreck, or confront her violently on the storm-lashed platform. Every outcome leaves Tidemouth changed; none is clean.

#### 1. Investigate the wrecked Grey Harrier

*DM intent:* The party must reach the wreck of the Grey Harrier at low tide and examine the hull damage and the dead lantern wedged in the foredeck gratings. The amber-green glass shards (ing#1) and the logbook page (ing#2) prove that the wreck was caused by deliberate misdirection, not weather. This gives them their first hard evidence and connects the false light to the Saltspire Lantern.

- **Route - Scrutinize the hull for signs of deliberate impact.** *(skill_challenge)*
  - The tide has receded, exposing the skeletal remains of the Grey Harrier, its splintered hull a grim testament to the sea's fury. Wedged precariously in the foredeck is a shattered lantern, its glass a mosaic of amber and green.
  - at stake: Failure to find evidence on the Grey Harrier means the party drifts without leads, the true cause of the wreck remaining a mystery.
  - ways in: Attempt: Scrutinize the hull for signs of deliberate impact. / Attempt: Carefully extract the damaged lantern. / Attempt: Rummage through the debris for any loose documents.
  - on success: `grey_harrier_evidence_recovered`
  - on failure: `wreckage_scoured`
  - on *full* -> **objective resolves**
  - on *failed* -> Offer coin for information on recent wrecks. — "The sea, having claimed the ship, has also swallowed any remaining clues. With nothing to show for their efforts, the party must find another way to learn about the false light."
- **Route - Offer coin for information on recent wrecks.** *(social)*
  - The harbormaster's office is a cramped, salt-dusted room, the air thick with the smell of pipeweed and old parchment. Harriet Vane, her face a roadmap of weathered lines, eyes the party with a practiced wariness.
  - at stake: Without information from Harriet, the party risks searching the wrong locations and wasting precious time.
  - ways in: Talk: Offer coin for information on recent wrecks. / Talk: Convince her of the urgency of their investigation. / Talk: Demand she reveal what she knows about the Grey Harrier.
  - on success: `grey_harrier_evidence_recovered`
  - on failure: `harriet_uncooperative`
  - on *full* -> **objective resolves**
  - on *failed* -> Investigate the wrecked Grey Harrier — "Harriet Vane remains tight-lipped, her silence a stone wall. The party is forced to seek answers elsewhere, the mystery of the Grey Harrier still unsolved."
- **RESCUE - Investigate the wrecked Grey Harrier** *(skill_challenge)*
  - The way forward narrows to one thing: Investigate the wrecked Grey Harrier. The party must reach the wreck of the Grey Harrier at low tide and examine the hull damage and the dead lantern wedged in the foredeck. The amber-green glass shards and the logbook page prove that the
  - at stake: The party must reach the wreck of the Grey Harrier at low tide and examine the hull damage and the dead lantern wedged in the foredeck. The amber-green glass shards and the logbook page prove that the
  - ways in: Attempt: Investigate the wrecked Grey Harrier
  - on success: `grey_harrier_evidence_recovered`
  - on *full* -> **objective resolves**

#### 2. Uncover the truth at Saltspire

*DM intent:* Guided by the colour-change detail and Maren's name, the party ascends to the Saltspire Lantern's lamp room and finds the coloured glass panels (ing#6), the timed shutter mechanism (ing#6), and Colm's sea chest (ing#5) with Maren's letters (ing#5) describing the crews she has sent to join her drowned husband. This is the proof that turns suspicion into certainty and reveals her motive before the storm arrives.

- **Route - Analyze the timed shutter mechanism.** *(puzzle)*
  - The lamp room of Saltspire pulses with an otherworldly glow as coloured glass panels shift and turn. A complex shutter mechanism dominates one wall, its purpose unclear, while a sea chest sits in the corner, a silent repository of secrets.
  - at stake: Failing to decipher the lantern's secrets means Maren's plan remains hidden, and the party cannot prove her guilt.
  - ways in: Work out: Analyze the timed shutter mechanism. / Work out: Inspect the coloured glass panels. / Work out: Attempt to open Colm's sea chest.
  - on success: `lantern_sabotage_proven`
  - on failure: `mechanism_jammed`
  - on *full* -> **objective resolves**
  - on *failed* -> Ask Dermot about Maren and the lantern. — "The intricate mechanism proves too complex to immediately decipher, and the sea chest remains stubbornly locked. The party must find a way to bypass the puzzle or seek external help."
- **Route - Ask Dermot about Maren and the lantern.** *(social)*
  - You find Dermot Quinn polishing a spyglass in the harbormaster's office, his brow furrowed in concentration. He seems preoccupied, but perhaps he can shed light on the Saltspire Lantern's recent activities.
  - at stake: Without Dermot's testimony, the party lacks a crucial witness to Maren's disturbing actions.
  - ways in: Talk: Ask Dermot about Maren and the lantern. / Talk: Help Dermot with his task to earn his trust. / Talk: Present any findings from the Grey Harrier to Dermot.
  - on success: `lantern_sabotage_proven`
  - on failure: `dermot_fearful`
  - on *full* -> **objective resolves**
  - on *failed* -> Investigate the Saltspire Lantern's secrets. — "Dermot Quinn, clearly intimidated, refuses to speak further, his fear an palpable barrier. The party must find another way to uncover the truth about the Saltspire Lantern."
- **RESCUE - Investigate the Saltspire Lantern's secrets.** *(skill_challenge)*
  - The way forward narrows to one thing: Uncover the truth at Saltspire. Guided by the colour-change detail and Maren's name, the party ascends to the Saltspire Lantern's lamp room and finds the coloured glass panels, the timed shutter mechanism, and Colm's sea chest with
  - at stake: Guided by the colour-change detail and Maren's name, the party ascends to the Saltspire Lantern's lamp room and finds the coloured glass panels, the timed shutter mechanism, and Colm's sea chest with
  - ways in: Attempt: Uncover the truth at Saltspire
  - on success: `lantern_sabotage_proven`
  - on *full* -> **objective resolves**

#### 3. Stop Maren atop the tower

*DM intent:* The storm strikes and the Lindworm runs for harbour beyond Black Sow Reef. Maren lights the false signal from the lantern room one final time. The party must reach her on the wind-blasted tower platform and choose how to end it: physically shut down the lantern, reach her emotionally so she extinguishes it herself, take her by force, or fail to reach the mechanism before the Lindworm turns toward Black Sow Reef. Their choice and its consequences close the chapter. The conditions for this event are established as ing#7.

- **Route - Confront Maren atop the tower during the storm.** *(combat)*
  - The storm rages, a maelstrom of wind and rain. Atop the tower, silhouetted against the furious sky, Maren Ostholm stands by the lantern, its false light a beacon of doom. The Lindworm battles the waves, its sails straining. The party must confront her here.
  - at stake: If Maren is not stopped, the Lindworm will be led to its destruction on Black Sow Reef.
  - ways in: Fight: Engage Maren directly in combat. / Fight: Attempt to physically shut down the false light. / Fight: Brace against the gale and make your way to the mechanism.
  - on success: `false_light_extinguished`
  - on failure: `lindworm_lost`
  - on *full* -> **objective resolves**
  - on *failed* -> Witness Maren's grief and observe the letter hinting at her motives. — "The storm's fury proves too great, or Maren too resolute. The Lindworm, a doomed vessel, turns towards the treacherous Black Sow Reef, its fate sealed."
- **Route - Witness Maren's grief and observe the letter hinting at her motives.** *(social)*
  - The wind howls like a banshee, all but drowning out Maren Ostholm's anguished cries. She clutches a letter to her chest, her face etched with grief and a terrible resolve, as the false light continues to burn. This letter (ing#9) is evidence of her motives, detailing how she has sent crews to join her drowned husband.
  - at stake: Maren's emotional state is volatile; a wrong word could doom the Lindworm.
  - ways in: Talk: Speak to Maren's pain and sense of loss. / Talk: Acknowledge her husband's fate and her own suffering. / Talk: Try to logically explain the consequences of her actions.
  - on success: `false_light_extinguished`
  - on failure: `maren_unreachable`
  - on *full* -> **objective resolves**
  - on *failed* -> Stop Maren atop the tower — "Maren's grief is a wall, her obsession a blinding light. Your words fail to penetrate her despair, and the false signal continues to burn, leading the Lindworm to ruin."
- **RESCUE - Stop Maren atop the tower** *(skill_challenge)*
  - The way forward narrows to one thing: Stop Maren atop the tower. The storm strikes and the Lindworm runs for harbour. Maren lights the false signal from the lantern room one final time. The party must reach her on the wind-blasted tower platform and choose how to e
  - at stake: The storm strikes and the Lindworm runs for harbour. Maren lights the false signal from the lantern room one final time. The party must reach her on the wind-blasted tower platform and choose how to e
  - ways in: Attempt: Stop Maren atop the tower
  - on success: `false_light_extinguished`
  - on *full* -> **objective resolves**

## Cast

- **Colm Ostholm** (npc) *[dead]* - Maren's drowned husband, the former lantern keeper lost on the Sweet Marie three months ago; his sea chest and marriage ring remain in the lantern room, testaments to their shared life, though his correspondence continue
- **Harriet Vane** (npc) - A fisher who lost her brother on the Grey Harrier; she has watched the Saltspire Lantern since Maren took over and noticed the light shifting white to amber-green on some nights, as Maren continues her dangerous work.
- **Dermot Quinn** (npc) - The Wreck and Tackle owner who knows Maren took over the lantern within weeks of Colm's drowning and admits the Council has not acted because accusing her would split the town, as the evidence primarily relies on her mot
- **Maren Ostholm** (boss) - The harbour lantern keeper who installs coloured glass and timed shutters to mimic the safe-channel light, deliberately wrecking ships. She has already destroyed three boats and is refining her technique before her final

## Places

- **Tidemouth** - A crisis-struck fishing town with half its fleet lost; families load carts to leave and the harbour sits half-empty of boats. The pervasive sense of loss and impending departure underscores the urgenc
- **Black Sow Reef** - A jagged reef where three boats have been wrecked; the shattered hull of the Grey Harrier is visible at low tide among the rocks.
- **Saltspire Lantern** - The harbour light tower where Maren has installed coloured glass panels and timed shutters that shift the beam from white to amber-green.
- **Grey Harrier** - 

## Endings

### The Light Restored *(bittersweet)*

Maren is stopped by force and the true signal restored, but the drowned crews remain lost and Tidemouth must rebuild from grief. The town survives but carries the weight of what was done to it.

*Authored climax:* The party overpowers Maren on the storm-lashed platform and shuts down the false lantern, guiding the Lindworm safely past Black Sow Reef into harbour. Maren is hauled away in chains or left broken on the stones as the true light burns once more.

Scores when:

- +5 if **Stop Maren atop the tower** is *completed* — The party stopped Maren and saved the Lindworm at the climax.
- +2 if **Investigate the wrecked Grey Harrier** is *completed* — Hard evidence from the Grey Harrier gave them the foundation to act decisively.
- +2 if **Uncover the truth at Saltspire** is *completed* — Proof from Saltspire confirmed the threat and justified force.
- +3 if dial *force_at_the_tower* >= 2 — The party chose physical confrontation over persuasion.
- +2 if dial *empathy_for_maren* <= -2 — The party treated Maren as a criminal, not a grieving woman.
- -4 if dial *empathy_for_maren* >= 3 — High empathy pushes toward surrender, not force.
- -2 if **Maren Ostholm** is *dead* — If Maren is killed rather than captured, this shifts toward the buried-truth ending.

### The False Light Extinguished *(bittersweet)*

The party reaches Maren through her grief and she surrenders, extinguishing the false light herself and ending the wrecks without further bloodshed. She descends to face whatever justice Tidemouth chooses, and the town begins to mourn properly.

*Authored climax:* Standing on the tower platform with the storm roaring below, the party speaks Maren's name and Colm's until her hands leave the shutter mechanism and the false light goes dark. The Lindworm finds the true channel, and Maren walks down the stairs under her own power.

Scores when:

- +5 if **Stop Maren atop the tower** is *completed* — The party reached Maren and stopped the false signal at the climax.
- +3 if **Uncover the truth at Saltspire** is *completed* — Reading Maren's letters gave the party the language of her grief.
- +5 if dial *empathy_for_maren* >= 3 — The party consistently engaged with Maren's humanity and grief.
- +3 if dial *force_at_the_tower* <= -2 — The party chose nonviolent confrontation at the tower.
- -4 if dial *force_at_the_tower* >= 3 — Heavy use of force prevents a voluntary surrender.
- -5 if **Maren Ostholm** is *dead* — Maren must be alive to choose to extinguish the light.
- +3 if **Maren Ostholm** is *allied* — If Maren came to trust the party, surrender is natural.
- +1 if dial *timber_for_tidemouth* >= 2 — Community support gives Maren somewhere to come home to, easing surrender.

### The Next Wreck Claimed *(tragic)*

The party fails to stop the next wreck in time, and must choose whether to expose Maren publicly or let her escape with the blood she has already taken. Tidemouth's last boats scatter and the town's future hangs on what the party does with the truth they carry.

*Authored climax:* The Lindworm grinds onto Black Sow Reef as the party struggles up the tower steps too late. From the lamp room they see the white hull buckle and hear the screams carry over the water. Maren watches beside them, serene, and the party must decide what to do with her now.

Scores when:

- +5 if **Stop Maren atop the tower** is *failed* — The party failed to stop Maren and the Lindworm was lost.
- +1 if **Investigate the wrecked Grey Harrier** is *completed* — The party gathered evidence but evidence alone could not save the ship.
- +1 if **Uncover the truth at Saltspire** is *completed* — They knew the truth but could not reach Maren in time.
- -2 if dial *force_at_the_tower* >= 2 — If the party used significant force, they more likely stopped her physically; high force argues against failure.
- -2 if dial *empathy_for_maren* >= 3 — High empathy would have produced a surrender path, making total failure less likely.
- -3 if **Maren Ostholm** is *dead* — If Maren is dead, the 'expose or let escape' choice collapses; this ending requires her alive or fled.

### The Keeper Consumed *(pyrrhic)*

The party confronts Maren on the tower during the storm and she dies at the light she corrupted, leaving Tidemouth without a keeper and the truth buried in the rocks. The false light goes dark with her, but no one remains to light the true one.

*Authored climax:* Maren lunges for the shutter mechanism as the party moves to shut it down, and in the struggle on the rain-slick platform she goes over the rail or takes the lantern's full heat. The false light flares once and dies, and the Lindworm founders on the reef as the party stands alone on a dark tower.

Scores when:

- +2 if **Stop Maren atop the tower** is *completed* — The party reached the climax confrontation.
- +2 if **Stop Maren atop the tower** is *failed* — Even in failure, if Maren dies violently the tower is left dark.
- +5 if **Maren Ostholm** is *dead* — Maren's death at the tower is the core condition.
- +4 if dial *force_at_the_tower* >= 3 — Escalated violence at the tower makes a fatal outcome likely.
- -4 if dial *empathy_for_maren* >= 3 — High empathy makes violent death deeply counter to the established trajectory.
- -5 if **Maren Ostholm** is *allied* — If Maren allied with the party, her death is deeply contradictory.
- -3 if dial *force_at_the_tower* <= -3 — Strong restraint makes a lethal confrontation unlikely.

## Audit

- **Entry contract covers 2/3 objectives.** When it completes, its loop closes while later objectives are still to come.
- 1 objective(s) belong to no contract at all: Stop Maren atop the tower
- Ending **The Light Restored**: side signals total +9 vs a climax claim of +5 - it can land while its own premise is false.
- Ending **The False Light Extinguished**: side signals total +15 vs a climax claim of +5 - it can land while its own premise is false.
- Ending **The Keeper Consumed**: side signals total +9 vs a climax claim of +2 - it can land while its own premise is false.

### What the pipeline itself flagged

- *stage 4* **[info]** Chapter 1 coop: coop set "coop:reef-evidence" was demoted to plain ingredients: all members must be clues; every member needs a reveals_to affinity
- *stage 4* **[info]** Chapter 1 coop: coop set "coop:lantern-proof" was demoted to plain ingredients: all members must be clues; every member needs a reveals_to affinity
- *stage 7* **[info]** The objective description mentions amber-green glass shards but the related ingredient ing#1 is only described as 'amber-green glass shards wedged in the foredeck gratings', without specifying they are of a particular colour.
- *stage 7* **[info]** The meta loop suggests Maren has destroyed three boats, but npc#1's description only mentions his drowning three months ago, with no link to Maren's actions.
- *stage 7* **[info]** The meta loop states Maren has already destroyed three boats by the time of the party's investigation, but npc#4's description implies this is the first chapter's focus and doesn't explicitly state prior destruction.
- *stage 7* **[info]** The objective title 'Stop Maren atop the tower' is a direct spoiler for the climax it describes.
- *stage 7* **[info]** The scene description mentions Maren Ostholm by the lantern, but doesn't specify the coloured light being displayed as is central to the plot.
- *stage 7* **[info]** This scene describes Maren Ostholm clutching a letter, but the content or significance of this letter is not established in any prior nodes or objectives.
- *stage 7* **[info]** The scene's objective is 'Stop Maren atop the tower', but the description states 'Maren lights the false signal from the lan[tern]...', which gives away the conclusion of the objective.
- *stage 7* **[info]** The scene describes coloured glass panels and a shutter mechanism as 'complex', but objective obj#2 suggests these are central to uncovering the truth, implying they should be more readily understandable or investigable.
- *stage 7* **[info]** The scene's objective is 'Uncover the truth at Saltspire', but the description states 'the party ascends to the Saltspire La[tern]', which gives away the location discovery of the objective.
- *stage 7* **[info]** The scene description mentions the 'Grey Harrier, its splintered hull a grim testament to the sea's fury', but doesn't explicitly link this damage to Maren's actions as described in the meta loop.
