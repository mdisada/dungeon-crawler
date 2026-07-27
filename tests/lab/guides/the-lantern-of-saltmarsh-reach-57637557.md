# The Lantern of Saltmarsh Reach

*one_shot | mode full_ai | status active*

> A fishing town on a tidal estuary has lost three boats in a month. The harbour lantern that guides them home has been burning the wrong colour since the old keeper died, and the woman who took over the light insists nothing has changed. Someone in town is signalling the wrecks deliberately.

## Premise

Fishing boats vanish from the estuary town of Saltmarsh Reach, lured off course by a harbour lantern burning blood-red instead of safe amber. The new keeper swears the light is fine, someone ashore is signalling false guidance to the rocks, and every night the tide brings fewer answers and more grief.

**Antagonist:** Aldric Venn, the dead keeper's estranged son, has returned to Saltmarsh Reach under a false name. He spent years building a smuggling operation but lost his crew to a deal gone wrong. Now he uses his father's old signal codes—codes only he and his father knew—to deliberately misguide boats onto the Wrackstone Shelf, then scavenges the wrecks with his men before dawn. He needs three more wrecks to clear his debts to the Kellwater Syndicate, who are coming to collect in eleven days.

## The job offered

- **ENTRY: Investigate the Stillwater Lantern** - giver Constable Bryce, 40-80 gp, due in 3 days
  - stakes: Bryce has three grieving families demanding answers and a harbour keeper who stonewalls every question. He cannot investigate the lantern himself — he has no boat, no budget, and no authority beyond the town limits — and another boat is due home before the week is out.
  - covers 2/4 objectives: Investigate the harbour light; Prove the light is sabotage

## The spine

### Chapter 1: The Wrong Light

Aldric Venn, under the name 'Wren,' has been deliberately misguiding fishing boats onto the Wrackstone Shelf using his dead father's old wrecking codes, transmitted through the Stillwater Lantern's coloured-light apparatus. Maren Thistledown, the new keeper, knows the light is malfunctioning but has been lying about it to protect her position—she believes it is a technical flaw she can quietly fix, not sabotage. In reality, Aldric has been accessing the tower at night, overriding her work, and using the Wrecking Codes to send false guidance. His Wrecking Crew waits at the mudflats to strip the wrecks. The chapter escalates over three in-game days: the party investigates, Old Petric identifies the codes as deliberate sabotage, Maren finally admits she has been lying, and the Fourth Boat is due home on the final night—the next target. Aldric, aware someone is asking questions, begins covering his tracks, pressuring Maren to stay silent, and preparing to wreck the Fourth Boat ahead of schedule if the party gets too close. The climax occurs at the Stillwater Lantern on the night of the Fourth Boat's return, during a high spring tide that floods the causeway—trapping everyone at the tower with the signalling equipment and the incoming boat. The party's choices—how much proof they gathered, who they told, whether they warned the boat or ambushed the keeper—determine whether the Fourth Boat survives, whether Aldric is caught or escapes, and what the town becomes.

#### 1. Investigate the harbour light

*DM intent:* The party must confirm that the Stillwater Lantern is broadcasting the wrong signal and uncover that the malfunction is deliberate sabotage rather than a technical fault. Scenes 1 and 2 ground this: Tomalen Quinn's testimony at The Drowned Oar, direct observation of the blood-red light from the harbour wall at nightfall, and the sighting of lantern movement on the mudflats establish that something is deeply wrong. The party does not yet know who is responsible or why; they only know the light is wrong and someone is moving on the flats after dark.

- **Route - gently persuade Tomalen to recount his sighting** *(social)*
  - The Drowned Oar is thick with salt spray and suspicion. Tomalen Quinn nurses his ale, his eyes darting nervously around the room. He claims to have seen something unusual near the tower last night, but his words are hesitant, jumbled by fear.
  - at stake: Discovering the initial signs of the lantern's malfunction from a witness.
  - ways in: Talk: gently persuade Tomalen to recount his sighting / Talk: offer Tomalen coin for his story
  - on success: `wrong_light_witnessed`, `mudflat_movement_spotted`
  - on failure: `tomalen_uncooperative`
  - on *full* -> **objective resolves**
  - on *failed* -> study the pattern and color of the light — "Tomalen clams up, unwilling to speak further. The party must find another way to confirm their suspicions about the light."
- **Route - study the pattern and color of the light** *(skill_challenge)*
  - As dusk bleeds across the sky, the harbour wall offers a stark vantage point. The Stillwater Lantern, usually a beacon of steady reassurance, pulses with an unnatural, blood-red light that cuts through the gathering gloom. It feels less like a guide and more like a warning.
  - at stake: Observing the incorrect signal from the tower and noting any unusual activity.
  - ways in: Attempt: study the pattern and color of the light / Attempt: search the mudflats for movement
  - on success: `wrong_light_witnessed`, `mudflat_movement_spotted`
  - on failure: `unclear_observation`
  - on *full* -> **objective resolves**
  - on *failed* -> Investigate the harbour light — "The light's erratic nature is difficult to interpret, and the fading light makes spotting movement on the flats impossible. The party must find a way to gain clearer evidence."
- **RESCUE - Investigate the harbour light** *(skill_challenge)*
  - The way forward narrows to one thing: Investigate the harbour light. The party must confirm that the Stillwater Lantern is broadcasting the wrong signal and uncover that the malfunction is deliberate sabotage rather than a technical fault. Scenes 1 and 2 ground this.
  - at stake: The party must confirm that the Stillwater Lantern is broadcasting the wrong signal and uncover that the malfunction is deliberate sabotage rather than a technical fault. Scenes 1 and 2 ground this: T
  - ways in: Attempt: Investigate the harbour light
  - on success: `wrong_light_witnessed`, `mudflat_movement_spotted`
  - on *full* -> **objective resolves**

#### 2. Prove the light is sabotage

*DM intent:* Old Petric's water-stained chart of the Wrecking Codes is the proof that turns suspicion into certainty: the pattern the party describes matches deliberate wrecking signals abolished two generations ago. Scene 4 provides the second pillar: Maren Thistledown breaks and admits the light has been tampered with every morning, that she has been lying to protect her position, and that a man named Wren has been helping with repairs. The party now knows the saboteur's false name, that he has insider knowledge of the old codes, and that the apparatus is being physically overridden at night. They do not yet know Wren is Aldric Venn, the dead keeper's son.

- **Route - examine Old Petric's water-stained chart** *(puzzle)*
  - Old Petric's shack is a chaotic archive of nautical lore, smelling of brine and forgotten voyages. Among the water-stained charts and thick fog of pipe smoke, you find a tattered nautical codex, its pages brittle with age. It speaks of Wrecking Codes, signals long abolished but once used to lure ships to their doom.
  - at stake: Deciphering the wrecking codes to prove the light's signal is deliberate sabotage.
  - ways in: Work out: examine Old Petric's water-stained chart / Work out: study the ancient wrecking code book
  - on success: `wrecking_codes_identified`, `maren_confessed`
  - on failure: `codes_incomprehensible`
  - on *full* -> **objective resolves**
  - on *failed* -> confront Maren with evidence of tampering — "The chart and the codex are difficult to reconcile, the ancient symbols eluding clear interpretation. The party needs a more direct confession."
- **Route - confront Maren with evidence of tampering** *(social)*
  - Maren Thistledown nervously polishes tankards behind the bar of The Drowned Oar, her eyes betraying a deep unease. When pressed about the lantern, her carefully constructed composure begins to fray, revealing a desperate woman tangled in a web of lies.
  - at stake: Extracting a confession from Maren Thistledown about the sabotage.
  - ways in: Talk: confront Maren with evidence of tampering / Talk: promise Maren leniency for her cooperation
  - on success: `wrecking_codes_identified`, `maren_confessed`
  - on failure: `maren_defiant`
  - on *full* -> **objective resolves**
  - on *failed* -> Prove the light is sabotage — "Maren stonewalls, her fear of reprisal outweighing her desire to confess. The party must find another way to expose the sabotage."
- **RESCUE - Prove the light is sabotage** *(skill_challenge)*
  - The way forward narrows to one thing: Prove the light is sabotage. Old Petric's water-stained chart of the Wrecking Codes is the proof that turns suspicion into certainty: the pattern the party describes matches deliberate wrecking signals abolished two generations a
  - at stake: Old Petric's water-stained chart of the Wrecking Codes is the proof that turns suspicion into certainty: the pattern the party describes matches deliberate wrecking signals abolished two generations a
  - ways in: Attempt: Prove the light is sabotage
  - on success: `wrecking_codes_identified`, `maren_confessed`
  - on *full* -> **objective resolves**

#### 3. Reach the tower before the tide

*DM intent:* With the Fourth Boat due home on the night's high spring tide and the causeway to the Stillwater Lantern flooding, the party must act before nightfall. Scene 5 forces a choice between warning the boat, fetching Constable Bryce, or heading straight to the tower to secure the apparatus. What they do not yet know is that Aldric, aware they are closing in, has already moved to the tower and begun signalling early. His Wrecking Crew is launching toward the Wrackstone Shelf ahead of schedule. Whatever the party decides here locks in who is present at the climax and whether the Fourth Boat has any warning.

- **Route - dash across the exposed causeway** *(combat)*
  - The causeway to Stillwater Lantern is already succumbing to the hungry tide, waves lapping at its edges. The Fourth Boat is a distant silhouette against the darkening horizon, and the race against time has begun. You must reach the tower before the water claims the path entirely.
  - at stake: Reaching the tower before the tide cuts off access.
  - ways in: Fight: dash across the exposed causeway / Fight: carefully pick your way across as the tide rises
  - on success: `boat_warned`
  - on failure: `causeway_flooded`
  - on *full* -> **objective resolves**
  - on *failed* -> try to signal the Fourth Boat — "The tide surges, breaching the causeway and forcing a hasty retreat. The party is stranded, the tower now unreachable by foot."
- **Route - try to signal the Fourth Boat** *(skill_challenge)*
  - The path to the Stillwater Lantern is rapidly disappearing beneath the churning sea. In the distance, the Fourth Boat ploughs onward, oblivious to the danger. You have a critical choice: try to warn the vessel, seek aid from Constable Bryce, or make a desperate push for the tower yourself.
  - at stake: Making a crucial decision to either warn the boat, fetch help, or head directly to the tower.
  - ways in: Attempt: try to signal the Fourth Boat / Attempt: find Constable Bryce for assistance / Attempt: make a direct attempt for the tower
  - on success: `boat_warned`
  - on failure: `delayed_action`
  - on *full* -> **objective resolves**
  - on *failed* -> Reach the tower before the tide — "The chosen course of action consumes precious time. The party finds themselves further from the tower and the approaching boat than they hoped."
- **RESCUE - Reach the tower before the tide** *(skill_challenge)*
  - The way forward narrows to one thing: Reach the tower before the tide. With the Fourth Boat due home on the night's high spring tide and the causeway to the Stillwater Lantern flooding, the party must act before nightfall. Scene 5 forces a choice between warning the boat
  - at stake: With the Fourth Boat due home on the night's high spring tide and the causeway to the Stillwater Lantern flooding, the party must act before nightfall. Scene 5 forces a choice between warning the boat
  - ways in: Attempt: Reach the tower before the tide
  - on success: `boat_warned`
  - on *full* -> **objective resolves**

#### 4. Confront the saboteur at the lantern

*DM intent:* The climax. Night, high spring tide, the causeway flooded or flooding. Aldric Venn is at the top of the Stillwater Lantern, actively transmitting the wrecking code. The Fourth Boat is visible, approaching the estuary mouth. The Wrecking Crew is on the water. The party is trapped on the tower with Aldric or racing to reach him before the causeway becomes impassable. This single confrontation resolves the boat's fate, Aldric's capture or escape, and what the town becomes. The party's choices across all prior objectives—how much proof they gathered, who they told, whether they warned the boat—determine whether the Fourth Boat survives, whether Aldric is caught or escapes, and whether the Kellwater Syndicate finds him or absorbs the town.

- **Route - engage Aldric Venn directly** *(combat)*
  - The apex of Stillwater Lantern is your battleground. The blood-red light pulses with malevolent intent, a stark contrast to the roaring sea below and the approaching silhouette of the Fourth Boat. Aldric Venn stands before you, a phantom in the tempest, actively transmitting the wrecking code, his Wrecking Crew closing in on the Wrackstone Shelf.
  - at stake: Confronting the saboteur and preventing a shipwreck.
  - ways in: Fight: engage Aldric Venn directly / Fight: attempt to stop the signal / Fight: exploit the tower's structure to your advantage
  - on success: `aldric_captured`
  - on failure: `aldric_escapes`
  - on *full* -> **objective resolves**
  - on *failed* -> try to make Aldric see the error of his ways — "Despite your efforts, Aldric vanishes into the storm-tossed night, leaving the signal to continue its deadly broadcast. The Fourth Boat is still in peril."
- **Route - try to make Aldric see the error of his ways** *(skill_challenge)*
  - Trapped at the top of the storm-lashed tower, the air crackles with tension. Aldric Venn, illuminated by the malevolent glow of the Stillwater Lantern, turns to face you. The sounds of the rising tide and the distant cries of the Fourth Boat's crew fill the air as he relays his intentions. The fate of the town hangs in the balance as you attempt to sway him or stop him.
  - at stake: Reasoning with or confronting Aldric Venn to prevent the wreck.
  - ways in: Attempt: try to make Aldric see the error of his ways / Attempt: use threats to make Aldric desist / Attempt: seek a compromise with the saboteur
  - on success: `aldric_captured`
  - on failure: `negotiation_fails`
  - on *full* -> **objective resolves**
  - on *failed* -> Confront the saboteur at the lantern — "Your attempts at reason or negotiation fall on deaf ears. Aldric remains resolute in his destructive purpose, forcing a more direct confrontation."
- **RESCUE - Confront the saboteur at the lantern** *(skill_challenge)*
  - The way forward narrows to one thing: Confront the saboteur at the lantern. The climax. Night, high spring tide, the causeway flooded or flooding. Aldric Venn is at the top of the Stillwater Lantern, actively transmitting the wrecking code. The Fourth Boat is visible, approac
  - at stake: The climax. Night, high spring tide, the causeway flooded or flooding. Aldric Venn is at the top of the Stillwater Lantern, actively transmitting the wrecking code. The Fourth Boat is visible, approac
  - ways in: Attempt: Confront the saboteur at the lantern
  - on success: `aldric_captured`
  - on *full* -> **objective resolves**

## Cast

- **Maren Thistledown** (npc) - The new harbour keeper, red-eyed and protective, insists the Stillwater Lantern functions perfectly. She has been lying to protect her position; the apparatus is tampered with every morning.
- **Constable Bryce** (npc) - The underfunded lawkeeper trying to keep peace between grieving fishermen and a defensive keeper. Suspects smuggling but has no proof and no authority over the lantern.
- **Tomalen Quinn** (npc) - The grieving owner of the lost Gull's Promise, drinking himself numb at The Drowned Oar. Swears the harbour light burned the wrong colour the night his boat vanished.
- **Old Petric** (npc) - A retired fisherman who recognizes the Wrecking Codes from two generations ago. Keeps a water-stained chart proving the patterns are deliberate sabotage.
- **Aldric Venn** (boss) *[absent]* - Operates under the name 'Wren' and claims to be a travelling lampsmen helping Maren with repairs. Only someone personally taught the old codes could reproduce them.

## Places

- **Saltmarsh Reach** - A declining fishing town built around a silting harbour, where grief and suspicion hang thicker than the salt fog.
- **Wrackstone Shelf** - A treacherous reef at the estuary mouth, marked by broken timbers and the bones of old wrecks.
- **Stillwater Lantern** - A harbour light tower on a rocky islet, reachable by a causeway that floods at high spring tide. Its apparatus can broadcast coloured-light signals.
- **The Drowned Oar** - A salt-stained tavern where fishermen drink through their grief and rumours breed in the corners.
- **the mudflats** - A vast expanse of estuary mud exposed at low tide, where the Wrecking Crew camps among the reeds and wrecks. Small lights move here after dark.
- **the keeper's cottage** - 
- **the boathouse** - 

## Endings

### The Light Restored *(bittersweet)*

The party presents hard evidence to the town and corners Aldric at the lantern tower. He is taken in chains and the Stillwater Lantern burns amber again—but the Kellwater Syndicate will come looking for their debtor, and Saltmarsh Reach's relief is tempered by the knowledge that darker forces now have reason to notice the town.

*Authored climax:* The party produces Petric's chart and Maren's confession on the tower steps as the Fourth Boat swings safely into harbour; Aldric, caught at the apparatus with nowhere to run, is dragged before Constable Bryce in irons.

Scores when:

- +5 if **Confront the saboteur at the lantern** is *completed* — The party cornered Aldric at the tower and stopped the wrecking.
- +3 if **Prove the light is sabotage** is *completed* — Hard evidence of sabotage was assembled before the confrontation.
- +2 if **Constable Bryce** is *allied* — Constable Bryce stands with the party, enabling lawful arrest.
- +3 if dial *proof_assembled* >= 2 — The party consistently built a case rather than acting on impulse.
- +2 if dial *lethal_force* <= -1 — The party showed restraint, enabling capture rather than a killing.
- +2 if dial *urgency* >= 1 — The party moved fast enough to reach the tower before the Fourth Boat was lost.
- -2 if dial *pragmatism* >= 2 — A deal-favoring posture undercuts the case for lawful capture.
- -4 if **Aldric Venn** is *dead* — If Aldric is dead, this ending cannot fire—he was never taken in chains.

### Blood Money *(bittersweet)*

The party cuts a deal with Aldric: his freedom for the signalling equipment and the location of his scavenged goods. He disappears into the night and Saltmarsh Reach keeps the salvaged wealth—haunted but solvent, with no one to answer for the dead.

*Authored climax:* On the flooding causeway the party lowers their weapons and names their price; Aldric hands over the wrecking apparatus and a chart of hidden caches, then vanishes into the marsh fog as the Fourth Boat's lantern swings safely past the Wrackstone Shelf.

Scores when:

- +4 if **Confront the saboteur at the lantern** is *completed* — The party resolved the climax, but the resolution is a bargain, not a capture.
- +5 if dial *pragmatism* >= 2 — This ending requires the party to have shown a consistent willingness to compromise.
- +2 if dial *lethal_force* <= -1 — Non-lethal posture makes negotiation plausible.
- +3 if **Aldric Venn** is *alive* — Aldric must survive for the deal to happen.
- -5 if **Aldric Venn** is *dead* — Dead men cannot bargain.
- -2 if dial *proof_assembled* >= 3 — A strong evidence case makes capture more attractive than bargaining.
- -3 if **Constable Bryce** is *allied* — Bryce's presence pushes toward lawful arrest, not private deals.
- +2 if **Reach the tower before the tide** is *failed* — If the party didn't reach the tower in time, Aldric has more leverage to deal.

### The Fourth Wreck *(tragic)*

The party moved too slowly and the Fourth Boat founders on the Wrackstone Shelf. They catch Aldric in the act at the tower but must choose between saving the drowning sailors or stopping him from escaping across the estuary mud—one life or another, and the town's grief deepens.

*Authored climax:* The party bursts into the lantern chamber as the Fourth Boat's mast-light tilts and vanishes behind the Shelf; Aldric is already on the window ledge, and the party must decide in seconds whether to pull him back or plunge into the black water toward the drowning fishermen.

Scores when:

- +5 if **Confront the saboteur at the lantern** is *failed* — The climax was resolved through sacrifice or loss, not clean success.
- +4 if **Reach the tower before the tide** is *failed* — The party did not reach the tower before the tide—the direct cause of the fourth wreck.
- +4 if dial *urgency* <= -2 — Slow, cautious play directly enables this outcome.
- -3 if dial *proof_assembled* >= 3 — If the party gathered strong evidence, they had every reason to move faster; this undercuts the tragedy.
- +2 if **Prove the light is sabotage** is *failed* — If the party never confirmed the sabotage, the delay is more understandable.
- -2 if dial *lethal_force* >= 2 — A lethal posture pushes toward killing Aldric rather than the rescue-vs-capture choice.

### Tide's Verdict *(pyrrhic)*

The party kills Aldric and dumps his body on the Wrackstone Shelf, letting the tide scatter the evidence. The light burns true again and no one in Saltmarsh Reach ever learns what really happened—but the Kellwater Syndicate's questions remain unanswered, and their arrival will find only silence and suspicion.

*Authored climax:* Aldric falls from the lantern gallery and the party lets the estuary take him; by dawn the Wrackstone Shelf has claimed another body, and the town wakes to a keeper gone missing and a light that burns amber for the first time in months.

Scores when:

- +4 if **Confront the saboteur at the lantern** is *completed* — The party stopped the wrecking at the climax—but by killing, not capturing.
- +5 if **Aldric Venn** is *dead* — This ending requires Aldric's death at the party's hands.
- +5 if dial *lethal_force* >= 2 — A pattern of lethal violence is the core trigger.
- +2 if dial *pragmatism* >= 1 — A pragmatic posture supports the calculus of killing and covering up.
- -4 if **Constable Bryce** is *allied* — Bryce's presence makes a cover-up nearly impossible and pushes toward lawful resolution.
- -2 if dial *proof_assembled* >= 3 — If the party had strong evidence, killing Aldric is unnecessary—they could have arrested him.
- +2 if **Aldric Venn** is *hostile* — If Aldric was actively hostile to the party, lethal force is more plausible.

## Audit

- **Entry contract covers 2/4 objectives.** When it completes, its loop closes while later objectives are still to come.
- 2 objective(s) belong to no contract at all: Reach the tower before the tide; Confront the saboteur at the lantern
- Ending **The Light Restored**: side signals total +12 vs a climax claim of +5 - it can land while its own premise is false.
- Ending **Blood Money**: side signals total +12 vs a climax claim of +4 - it can land while its own premise is false.
- Ending **The Fourth Wreck**: side signals total +10 vs a climax claim of +5 - it can land while its own premise is false.
- Ending **Tide's Verdict**: side signals total +14 vs a climax claim of +4 - it can land while its own premise is false.

### What the pipeline itself flagged

- *stage 4* **[info]** Chapter 1 coop: coop set "coop:wrecking-codes-identification" was demoted to plain ingredients: all members must be clues; every member needs a reveals_to affinity
- *stage 5* **[info]** Battle encounter is over budget: 800 adjusted XP vs a 300 XP standard target for 2 level-3 characters.
- *stage 5* **[info]** Battle encounter is over budget: 825 adjusted XP vs a 300 XP standard target for 2 level-3 characters.
- *stage 5* **[info]** $.encounters[7]: rebalanced from 1800 to 825 adjusted XP (target 300 for 2 level-3) - dropped duplicate bodies; downgraded Aldric Venn CR 3 -> 2 - now within the survivable ceiling.
- *stage 5* **[info]** $.encounters[2]: rebalanced from 1100 to 713 adjusted XP (target 300 for 2 level-3) - dropped duplicate bodies - now within the survivable ceiling.
- *stage 5* **[info]** $.encounters[6]: rebalanced from 2200 to 825 adjusted XP (target 300 for 2 level-3) - dropped duplicate bodies; downgraded Aldric Venn CR 3 -> 2 - now within the survivable ceiling.
- *stage 7* **[info]** Aldric Venn operates under the alias 'Wren', but the alias 'Wren' is only mentioned in Aldric's description and not used elsewhere in the provided text.
- *stage 7* **[warning]** The ingredient 'event: At first dark, the Stillwater Lantern burns blood-red...' is a narrative event that is not reflected in any of the provided scenes or nodes.
- *stage 7* **[warning]** The ingredient 'event: Aldric, aware the party is closing in, moves to the tower early...' describes an event that is not reflected in any of the provided scenes or nodes.
- *stage 7* **[info]** The objective serving node#1 is "Reach the tower before the tide", but the node's description does not explicitly mention the tide as a constraint while the objective text does.
- *stage 7* **[info]** The objective serving node#2 is "Reach the tower before the tide", but the node's description does not explicitly mention the tide as a constraint while the objective text does.
- *stage 7* **[info]** The objective serving node#3 is "Reach the tower before the tide", but the node's description does not explicitly mention the tide as a constraint while the objective text does.
- *stage 7* **[info]** The objective serving node#6 is "Prove the light is sabotage", but the node's description does not explicitly mention Old Petric's water-stained chart while the objective text does.
- *stage 7* **[info]** The objective serving node#9 is "Confront the saboteur at the lantern", but the node's description does not explicitly mention "The Fourth Boat" while the objective text does.
- *stage 7* **[warning]** Node#10 serves objective "Investigate the harbour light", but its description focuses on Tomalen Quinn, who is central to obj#2 (proving sabotage), not the initial investigation of the light itself.
- *stage 7* **[info]** The objective serving node#12 is "Investigate the harbour light", but the node's description does not explicitly mention sabotage as a confirmation, unlike the objective text.
- *stage 7* **[warning]** The objective "Prove the light is sabotage" references Old Petric's water-stained chart as proof, but this item is not established as existing or obtainable anywhere prior to this objective's description.
- *stage 7* **[warning]** Old Petric is described as possessing a water-stained chart that serves as proof, but this item is not established as obtainable or present in any scene or narrative element prior to its reference in obj#2.
- *stage 7* **[info]** The objective "Reach the tower before the tide" references external content ('Scene 5 forces a choice') that is not present in the provided nodes.
- *stage 7* **[warning]** Objective "Investigate the harbour light" references 'Scene 1' which is not a provided node.
- *stage 7* **[warning]** Objective "Confront the saboteur at the lantern" references "The Fourth Boat" as a player in the climax, but this entity is not otherwise established or described.
- *stage 8* **[info]** [reachability:ending_needs_absent_npc_rapport] Ending "Tide's Verdict" needs Aldric Venn to become hostile, but they are authored as absent - nothing in play can build rapport with someone never present.
