# The Salt-Wake Ledger

*one_shot | mode full_ai | status guide_ready*

> A harbour town's tide-ledger records ships that never sailed. The harbourmaster is paid to keep writing them, and something in the water is collecting on the debt.

## Premise

In the crumbling harbour town of Marenfall, the tide-ledger has recorded ships that never sailed for decades. Harbourmaster Edric Vance is paid to keep writing false arrivals and departures, and something ancient in the water has been collecting on the debt ever since. The party arrives on the night the ledger's final entries come due, and the thing beneath the harbour has come to claim what it is owed.

**Antagonist:** The Drowned Creditor, a forgotten sea-entity bound to Marenfall's harbour by a covenant struck generations ago, which demands flesh and soul-payment for every false entry written in the tide-ledger. It advances its collection on the tide's own schedule, and tonight the final tide of the cycle will wash through the town regardless of what the party does.

## The job offered

- **ENTRY: Reach the Harbourmaster and Stop the Tide** - giver Tomas Reed, 60-120 gp, due in 1 days
  - stakes: Tomas's two sons are out on the water and he believes they will be claimed by the ledger's final entry tonight if no one reaches the harbourmaster before the tide finishes rising.
  - covers 2/4 objectives: Investigate the Harbourmaster's Office; Confront Edric Vance

## The spine

### Chapter 1: The Final Entry

The party arrives in Marenfall as the tide begins its final rise. The Wreckers are already pulling phantom ships into the harbour, and the Phantom Fleet is visible offshore, sailing toward a port that should not exist. Edric Vance is in his office, writing one last false entry in the tide-ledger to buy the town one more cycle, but the covenant is breaking down and the Drowned Creditor is rising at the Drowned Quay. The party must investigate the harbour, discover the truth of the tide-ledger and covenant, confront Edric, and find a way to resolve the debt before the tide peaks and the Drowned Creditor collects on every unpaid entry at once. Depending on the party's choices, they can destroy the ledger, sacrifice Edric, renegotiate the covenant, or fail to act in time, with each outcome permanently shaping what Marenfall becomes.

#### 1. Investigate the Harbourmaster's Office

*DM intent:* The party enters Marenfall as the tide rises unnaturally fast and the Wreckers haul phantom ships into port. They must reach the Harbourmaster's Office, find the tide-ledger open on the desk with Edric Vance present, and read deeply enough to uncover the covenant fragment that proves every false entry is a debt of flesh. The party does not yet know the ledger is generations old, that disappearances blamed on storms were actually collections, or that tonight's final entry is already half-written with a blank name space. This objective completes when the party has read the ledger and covenant fragment and understands what the false entries cost.

- **Route - attempt to persuade Edric Vance to reveal the ledger's…** *(social)*
  - The Harbourmaster's Office is surprisingly spartan, save for a single, imposing oak desk where a dense, salt-stained ledger lies open. Edric Vance, the Harbourmaster, nervously polishes a brass bell, his eyes darting towards the unnatural tide. As you approach, he quickly clenches the ledger shut.
  - at stake: Failure to uncover the truth behind the ledger's false entries means the phantom ships and their dark purpose remain unknown.
  - ways in: Talk: attempt to persuade Edric Vance to reveal the ledger's secrets
  - on success: `tide_ledger_read`, `covenant_fragment_found`
  - on failure: `edric_uncooperative`
  - on *full* -> **objective resolves**
  - on *failed* -> search the cellar for older ledgers and covenant fragments. — "Edric Vance remains tight-lipped, his fear overriding any desire to help. The party must find another way to access the ledger's secrets."
- **Route - search the cellar for older ledgers and covenant fragments.** *(skill_challenge)*
  - The scent of brine and something far older hangs heavy in the air as you descend into the Harbourmaster's cellar. Cobwebs cling like spectral shrouds, and the stone walls drip with an unsettling dampness. This area contains older ledgers and covenant fragments, vital clues to the nature of the debt.
  - at stake: Without access to the ledger's true history, the party cannot understand the nature of the debt or the sacrifices made.
  - ways in: Attempt: search the cellar for any documents or artifacts pertaining to the ledger
  - on success: `tide_ledger_read`, `covenant_fragment_found`
  - on failure: `cellar_obscured`
  - on *full* -> **objective resolves**
  - on *failed* -> attempt to decipher the symbols and script within the older ledger to understand the covenant's history. — "The cellar offers only rot and damp, with no sign of the ledger or its secrets. The party may need to confront Edric Vance directly to learn the truth."
- **Route - attempt to decipher the symbols and script within the older ledger to understand the covenant's history.** *(puzzle)*
  - You find it: a thick, leather-bound tome tucked away on a dusty shelf, far older than the ledger in Edric's office. Its pages are brittle, filled with cramped script and strange symbols. The unnatural tide outside seems to pulse in time with your attempts to decipher its contents, suggesting this older ledger provides context for the covenant. It contains information about previous collections but is not the primary ledger the party needs to investigate.
  - at stake: Deciphering the ancient text is crucial to understanding the covenant and the true cost of Marenfall's unnatural prosperity.
  - ways in: Work out: attempt to decipher the symbols and script within the ancient tome
  - on success: `tide_ledger_read`, `covenant_fragment_found`
  - on failure: `covenant_obscure`
  - on *full* -> **objective resolves**
  - on *failed* -> Investigate the harbour and ledger — "The ancient language proves too difficult to decipher fully on your own. You will need to find another way to understand the covenant's true meaning."
- **RESCUE - Investigate the harbour and ledger** *(skill_challenge)*
  - Every other way to Investigate the harbour and ledger has closed behind the party. This is what is left, and it has to happen here, with what they have on them.
  - at stake: Whether the party achieves: Investigate the harbour and ledger
  - ways in: Attempt: Investigate the harbour and ledger
  - on success: `tide_ledger_read`, `covenant_fragment_found`
  - on *full* -> **objective resolves**

#### 2. Confront Edric Vance

*DM intent:* Edric Vance is found in the Harbourmaster's Office after Edric confesses he inherited the ledger and has written false entries for decades to buy the town time. He reveals the covenant can only be resolved at the Drowned Quay when the Drowned Creditor rises at peak tide: destroy the ledger and void the debt, sacrifice him to fulfill it, or renegotiate terms with the entity. He will not leave willingly and will fight to stop the ledger's destruction, believing his death is the only sure payment. The party does not yet know which path they will take, only what the options are. This objective completes when the party has heard Edric's confession and the three options and has decided how to proceed.

- **Route - question Edric Vance about the ledger and the covenant** *(social)*
  - As you finally gain access to the Harbourmaster's Office, Edric Vance is there, his face a mask of guilt and fear. He doesn't try to flee, instead turning to face you, his hands clasped as if in prayer. 'You've seen the ledger, haven't you?' he whispers, his voice cracking.
  - at stake: Edric Vance's confession and knowledge of the options are vital to resolving the pact; his resistance could doom the town.
  - ways in: Talk: question Edric Vance about the ledger and the covenant
  - on success: `edric_vance_confession_heard`
  - on failure: `edric_panicked`
  - on *full* -> **objective resolves**
  - on *failed* -> attempt to subdue Edric Vance without killing him — "Overcome by panic, Edric Vance bolts, attempting to escape into the rising tide before he can reveal the full truth. The party must pursue him."
- **Route - attempt to subdue Edric Vance without killing him** *(combat)*
  - Edric Vance, cornered and desperate, lets out a choked cry. 'You cannot defy the pact!' He lunges not at you, but at the ledger, his intent clear: to protect it and the deal it represents at all costs. His movements are surprisingly agile for a man his age, fueled by fear and generations of complicity.
  - at stake: If Edric Vance is allowed to destroy the ledger or escape, the party loses their chance to confront the entity and settle the debt.
  - ways in: Fight: attempt to subdue Edric Vance without killing him
  - on success: `edric_vance_confession_heard`
  - on failure: `edric_escaped_conflict`
  - on *full* -> **objective resolves**
  - on *failed* -> Confront Edric Vance — "Edric Vance, in his desperation, manages to slip through your grasp and disappears into the encroaching fog. The party must now find him before the tide peaks."
- **RESCUE - Confront Edric Vance** *(skill_challenge)*
  - Every other way to Confront Edric Vance has closed behind the party. This is what is left, and it has to happen here, with what they have on them.
  - at stake: Whether the party achieves: Confront Edric Vance
  - ways in: Attempt: Confront Edric Vance
  - on success: `edric_vance_confession_heard`
  - on *full* -> **objective resolves**

#### 3. Reach the Drowned Quay

*DM intent:* The party must descend from the Harbourmaster's Office to the Drowned Quay as the final tide peaks. The quay is half-submerged, and the covenant's terms are etched into the stones, which the rising water will soon cover. The Wreckers may oppose the descent, and Edric may resist being brought along if the party intends to use him as payment. The party does not yet know what the Drowned Creditor will actually look like or that it speaks with the voices of everyone the ledger has claimed. This objective completes when the party stands on the Drowned Quay before the risen entity.

- **Route - navigate the treacherous, flooded docks to reach the…** *(skill_challenge)*
  - The descent from the Harbourmaster's Office is treacherous. Water laps at your ankles, then your knees, as you make your way towards the Drowned Quay. The air is thick with the stench of salt and decay, and the unnatural tide continues its relentless rise, swallowing the familiar docks and landmarks.
  - at stake: Reaching the Drowned Quay before the entity fully rises is critical to confronting it on the party's terms.
  - ways in: Attempt: navigate the treacherous, flooded docks to reach the Drowned Quay
  - on success: `drowned_quay_reached`
  - on failure: `trapped_by_tide`
  - on *full* -> **objective resolves**
  - on *failed* -> engage the Wreckers in combat to clear a path — "The rising tide has cut off your path to the Drowned Quay. You must find an alternate, possibly more perilous, route."
- **Route - engage the Wreckers in combat to clear a path** *(combat)*
  - As you make your way to the Drowned Quay, shadowy figures emerge from the swirling mist and churning water – the Wreckers, animated by the pact. They move with unnerving speed, their forms indistinct, wielding harpoons and nets as they attempt to bar your passage.
  - at stake: The Wreckers are guardians of the pact; their intervention threatens to prevent the party from reaching the Drowned Quay and confronting the entity.
  - ways in: Fight: engage the Wreckers in combat to clear a path
  - on success: `drowned_quay_reached`
  - on failure: `wreckers_repelled`
  - on *full* -> **objective resolves**
  - on *failed* -> Reach the Drowned Quay — "Though you fought valiantly, the Wreckers have forced you back, their numbers overwhelming. You must find another way to reach the Drowned Quay."
- **RESCUE - Reach the Drowned Quay** *(skill_challenge)*
  - Every other way to Reach the Drowned Quay has closed behind the party. This is what is left, and it has to happen here, with what they have on them.
  - at stake: Whether the party achieves: Reach the Drowned Quay
  - ways in: Attempt: Reach the Drowned Quay
  - on success: `drowned_quay_reached`
  - on *full* -> **objective resolves**

#### 4. Settle the debt at the Quay

*DM intent:* This is the climax. The Drowned Creditor has risen at the Drowned Quay, a towering figure of kelp, bone, and drowned wood speaking with the voices of all the ledger has claimed. The covenant's terms are etched on the quay stones, and the water is rising to cover them. The party must now make their decisive act: destroy the tide-ledger and break the covenant, sacrifice Edric Vance as final payment, or renegotiate the covenant by offering a new binding. If they fail to act before the water covers the stones, the Drowned Creditor collects everything. Whatever they choose, Marenfall is forever changed and the story resolves.

- **Route - attempt to decipher the covenant's terms etched into the…** *(puzzle)*
  - Before you, the Drowned Creditor has risen, a colossal, horrifying amalgamation of kelp, bone, and driftwood. Its voice, a cacophony of drowned souls, echoes across the rapidly submerging Drowned Quay. The covenant's terms are etched into the stone beneath your feet, the rising water threatening to erase them forever.
  - at stake: Failing to act before the covenant's terms are lost to the tide means the Drowned Creditor will claim everything, dooming Marenfall.
  - ways in: Work out: attempt to decipher the covenant's terms etched into the quay stones before they are submerged
  - on success: `ledger_destroyed`
  - on failure: `terms_obscured`
  - on *full* -> **objective resolves**
  - on *failed* -> offer Edric Vance as a sacrifice to the Drowned Creditor — "The rising water has submerged the quay stones, obscuring the covenant's terms. You must now rely on your understanding of the pact and its options to proceed."
- **Route - offer Edric Vance as a sacrifice to the Drowned Creditor** *(social)*
  - The Drowned Creditor looms, its many voices pleading and accusing, while the waters of the Drowned Quay rise with terrifying speed. Edric Vance, brought to the quay, trembles beside you. 'What will you do?' he asks, his voice barely audible above the roar of the tide and the entity's lament.
  - at stake: The party's decision dictates the fate of Marenfall and its inhabitants, as well as their own.
  - ways in: Talk: offer Edric Vance as a sacrifice to the Drowned Creditor / Talk: attempt to destroy the tide-ledger and break the covenant / Talk: attempt to renegotiate the terms of the covenant with the Drowned Creditor
  - on success: `ledger_destroyed`
  - on failure: `creditor_collects`
  - on *full* -> **objective resolves**
  - on *failed* -> Settle the debt at the Quay — "Hesitation has cost you. The Drowned Creditor, its patience exhausted, begins to collect its due. Marenfall's fate is sealed."
- **RESCUE - Settle the debt at the Quay** *(skill_challenge)*
  - Every other way to Settle the debt at the Quay has closed behind the party. This is what is left, and it has to happen here, with what they have on them.
  - at stake: Whether the party achieves: Settle the debt at the Quay
  - ways in: Attempt: Settle the debt at the Quay
  - on success: `ledger_destroyed`
  - on *full* -> **objective resolves**

## Cast

- **Edric Vance** (npc) - A gaunt, hollow-eyed man in a salt-stained harbourmaster's coat, gripping a quill over the open tide-ledger.
- **The Drowned Creditor** (boss) *[absent]* - A towering figure of woven kelp, driftwood, and human bone, rising from black harbour water at high tide.
- **Tomas Reed** (npc) - A sinewy fisherman with rope-burned hands and wild eyes, standing near the flooded landward gate. He spreads rumors about the harbourmaster's unusual activities.
- **Hettie Vance** (npc) - A grey-haired woman holding a lantern at the harbour crossroads. She does not block the path to the office but is a notable figure in Marenfall, whispering rumors about Edric Vance's inherited responsibilities.

## Places

- **Marenfall** - A crumbling harbour town of salt-eaten stone and sagging rooftops, its streets flooding with brine as the tide rises unnaturally fast.
- **The Harbourmaster's Office** - A timber-and-stone building above the harbour, its door bolted, containing Edric Vance's desk and, on shelves, generations of water-stained ledgers and shipping records.
- **The Drowned Quay** - A half-submerged stone pier at the harbour's edge, its surface carved with covenant terms now being covered by rising black water.

## Endings

### The Ledger Burns *(pyrrhic)*

The party destroys the tide-ledger and breaks the covenant, freeing Marenfall from the debt but unbinding the Drowned Creditor to roam the open sea, collecting from other ports.

*Authored climax:* The ledger pages catch fire on the quay stones and the Drowned Creditor screams in a chorus of drowned voices as the covenant's chains dissolve; the entity sinks below, but the water does not recede with relief — it recedes with release, and the harbour goes quiet in a way that promises nothing.

Scores when:

- +5 if **Settle the debt at the Quay** is *completed* — The party acted decisively at the climax — destroying the ledger is the completion path.
- +3 if dial *covenant_respect* <= -2 — Destroying the ledger aligns with rejecting the covenant's framework.
- +2 if **Edric Vance** is *alive* — Edric surviving suggests the party chose destruction over his sacrifice.
- +2 if **The Drowned Creditor** is *hostile* — The Drowned Creditor is hostile toward the party — it is being unbound against its will, not negotiated with.
- +1 if dial *mercy* >= 1 — Sparing Edric nudges toward this path over the sacrifice ending.

### The Harbourmaster's Due *(bittersweet)*

The party sacrifices Edric to the Drowned Creditor as final payment, settling the debt permanently but inheriting the harbourmaster's mantle and the curse that comes with it.

*Authored climax:* Edric is dragged or walks into the surf at the entity's gesture; the Drowned Creditor's many-voiced sigh settles the water, and the tide-ledger's pages go blank — but the last blank space now bears the party's names, and the quill waits in a dead man's office.

Scores when:

- +5 if **Settle the debt at the Quay** is *completed* — The party completed the climax — by choosing the sacrifice option.
- +4 if **Edric Vance** is *dead* — Edric is dead, which is the core signal that the sacrifice path was taken.
- +2 if dial *mercy* <= -1 — Ruthless play leans toward this ending.
- +1 if dial *covenant_respect* >= 1 — Sacrifice fulfills the covenant rather than breaking it.

### A New Ledger *(bittersweet)*

The party renegotiates the covenant by offering a new binding — themselves or another — writing a fresh ledger that buys Marenfall another generation but at a deeper, more personal cost.

*Authored climax:* The quill scratches new names on water-stained pages as the party speaks terms to the Drowned Creditor; the entity considers, then nods with a corpse's deliberation, and the tide recedes — but the new ledger sits heavy in willing hands, and twenty years is not so long.

Scores when:

- +5 if **Settle the debt at the Quay** is *completed* — The party completed the climax — via renegotiation.
- +3 if **Edric Vance** is *alive* — Edric must survive to broker or witness the new terms.
- +3 if **The Drowned Creditor** is *allied* — The Drowned Creditor must be willing to accept new terms — allied signals successful negotiation.
- +3 if dial *covenant_respect* >= 2 — Renegotiation requires deep engagement with the covenant's framework.
- +1 if dial *mercy* >= 1 — Mercy toward Edric supports choosing renegotiation over his sacrifice.

### The Final Tide *(tragic)*

The party fails to act before the tide peaks and the Drowned Creditor collects everything, dragging Marenfall beneath the waves in a final settlement that leaves only the ledger behind on still-wet stones.

*Authored climax:* The water covers the covenant stones and the Drowned Creditor's many voices rise to a roar as Marenfall's streets fill with cold sea; when morning comes there is only glass-flat water, gull cries, and a tide-ledger lying open on the quay, its pages full of names that will never be read.

Scores when:

- +5 if **Settle the debt at the Quay** is *failed* — The climax objective failed — the party did not act in time.
- +3 if dial *urgency* <= -2 — Low urgency throughout the adventure signals the party was too slow.
- +2 if **The Drowned Creditor** is *hostile* — The Drowned Creditor hostile and unresolved points toward collection.
- -1 if **Edric Vance** is *dead* — If Edric is already dead, the sacrifice was made — this argues against the failure ending.

## Audit

- **Entry contract covers 2/4 objectives.** When it completes, its loop closes while later objectives are still to come.
- 2 objective(s) belong to no contract at all: Reach the Drowned Quay; Settle the debt at the Quay
- Ending **The Ledger Burns**: side signals total +8 vs a climax claim of +5 - it can land while its own premise is false.
- Ending **The Harbourmaster's Due**: side signals total +7 vs a climax claim of +5 - it can land while its own premise is false.
- Ending **A New Ledger**: side signals total +10 vs a climax claim of +5 - it can land while its own premise is false.

### What the pipeline itself flagged

- *stage 4* **[info]** Chapter 1 coop: coop set "coop:ledger-covenant" was demoted to plain ingredients: every member needs a reveals_to affinity
- *stage 5* **[info]** Battle encounter is over budget: 800 adjusted XP vs a 300 XP standard target for 2 level-3 characters.
- *stage 5* **[info]** Battle encounter is over budget: 825 adjusted XP vs a 300 XP standard target for 2 level-3 characters.
- *stage 5* **[info]** $.encounters[2]: rebalanced from 1300 to 825 adjusted XP (target 300 for 2 level-3) - dropped duplicate bodies - now within the survivable ceiling.
- *stage 7* **[info]** Hettie Vance is described as a notable figure and whispers rumors (ing#8), but she is not integrated into any specific objective or scene, making her role feel less impactful.
- *stage 7* **[warning]** The objective for the Harbourmaster's Office, obj#1, states the party must 'find the tide-ledger,' but node#5's description of descending into the cellar and finding cobwebs does not seem to lead to finding the ledger or its contents.
- *stage 7* **[info]** Node#4 states Edric Vance is 'at the desk' when the party 'gain access' to the office, but the objective description for obj#2 implies Edric confesses and reveals information *after* being found, suggesting a sequence that isn't clear here.
- *stage 7* **[warning]** Node#6 describes finding an older tome, but the meta loop and other ingredients focus on the tide-ledger and the covenant etched on the Drowned Quay, leaving the purpose and content of this discovered tome unclear and potentially unreachable by the narrative.
- *stage 7* **[warning]** The Wreckers are introduced as hauling phantom ships in ing#4 and are part of the meta loop, but they only appear as animated figures in node#12 during the 'Reach the Drowned Quay' objective, with no prior setup for their animation or combat potential.
- *stage 7* **[info]** Node#11 describes a treacherous descent with water lapping at ankles and knees, but this doesn't directly tie into the rising tide described in the meta loop and other objectives, making the 'treacherous' nature feel generic.
- *stage 7* **[warning]** Obj#1 states the party must 'find the tide-ledger,' but the meta loop and other objectives imply the ledger is already known to be in the Harbourmaster's Office, and Edric is holding it.
- *stage 7* **[warning]** The objective description states Edric Vance is found in the Harbourmaster's Office, but the prose for node#4 indicates he is at the desk when the party enters the office, which contradicts the idea of 'finding' him there after a confession.
- *stage 7* **[warning]** Node#6 describing a 'tome tucked away on a dusty shelf, far older than the ledger in Edric's office' that contains 'cramped script' seems to imply it's the original covenant, but this is not established in any other objective, NPC, location, or ingredient.
- *stage 7* **[info]** Tomas Reed is introduced as spreading rumors about the harbourmaster, but his only listed rumor (ing#3) is about the harbourmaster calling in ships, which is already covered by ing#4 and the meta loop.
- *stage 8* **[info]** [reachability:ending_needs_absent_npc_rapport] Ending "The Ledger Burns" needs The Drowned Creditor to become hostile, but they are authored as absent - nothing in play can build rapport with someone never present.
- *stage 8* **[info]** [reachability:ending_needs_absent_npc_rapport] Ending "A New Ledger" needs The Drowned Creditor to become allied, but they are authored as absent - nothing in play can build rapport with someone never present.
- *stage 8* **[info]** [reachability:ending_needs_absent_npc_rapport] Ending "The Final Tide" needs The Drowned Creditor to become hostile, but they are authored as absent - nothing in play can build rapport with someone never present.
