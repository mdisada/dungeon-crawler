# The Salt-Wake Ledger

*one_shot | mode full_ai | status guide_ready*

> A harbour town's tide-ledger records ships that never sailed. The harbourmaster is paid to keep writing them, and something in the water is collecting on the debt.

## Premise

The party arrives in Saltmire Harbour to find the fishing fleet grounded and locals vanishing after dark. The tide-ledger in the harbourmaster's office logs dozens of ships that never existed, each with a departure date already past and a cargo marked 'souls.' Something beneath the harbour is calling in those debts, and the harbourmaster has been paid to keep the false records flowing. The party has one night to uncover the scheme before the ledger's next entry comes due and the sea collects what it is owed.

**Antagonist:** Harbourmaster Eldra Voss, who inherited a drowning town and chose to save it by feeding drifters and the forgotten to the Drowned Margin in exchange for fish, calm waters, and silence. She is not cruel—she is desperate, and she believes the next entry in the ledger is the last one she will ever have to write.

## The job offered

- **ENTRY: The Tide-Ledger Discrepancy** - giver Mira Wren, 30-75 gp, due in 2 days
  - stakes: Mira fears she'll be blamed—or worse, silenced—if she reports the discrepancy herself, and the harbourmaster's office lock was changed without explanation last week.
  - covers 1/3 objectives: Investigate the Tide-Ledger

## The spine

### Chapter 1: The Ledger of Ghost Ships

The party arrives in Saltmire Harbour as dusk falls and finds the town wrong: nets empty, doors shut, the harbour too quiet. Investigating the harbourmaster's office, they discover the tide-ledger logging dozens of ships that never sailed—each with a departure date and a cargo entry reading 'souls,' with a number. Several dates are past and their corresponding cargo tallies match the recent disappearances locals whisper about. One entry is dated tonight: the ship Pelagic, cargo 47 souls, departing at dawn. Eldra Voss is nearby, calm and helpful, but her story about 'customs records' does not hold, and the party can find Mira Wren who admits the entries match nothing real. As night settles, the party hears something wet moving on the docks, and Tomas Heddle—whose name they may have seen scrawled in a margin—stumbles past them toward the water, not entirely awake. The chapter escalates from mystery to urgency: the ledger is a contract, the harbourmaster is complicit, and the first collection of the night is happening now.

#### 1. Investigate the Tide-Ledger

*DM intent:* The party must investigate the tide-ledger in the harbourmaster's office and corroborate its ghost-ship entries against reality. Scenes 2 and 3 ground this: Eldra's 'customs records' explanation collapses under scrutiny because the ships never existed, the ink is fresh, and Mira Wren's cross-referencing confirms no registrations match any of the ledger's entries. The party does not yet know the ledger is a soul-contract with something beneath the harbour—they only know the entries are fraudulent and the handwriting is Eldra's. This objective completes when the party has enough evidence to understand the ledger is not what Eldra claims it is.

- **Route - Ask Eldra Voss to see the ledger.** *(social)*
  - The Harbourmaster's office is cramped and smells perpetually of salt and old paper. Eldra Voss watches you, her eyes sharp as a gull's.
  - at stake: Eldra may cover up her tracks, making the truth of the ledger impossible to find.
  - ways in: Talk: Ask Eldra Voss to see the ledger. / Talk: Press Eldra Voss on the ghost ship entries.
  - on success: `ledger_fraud_exposed`
  - on failure: `eldra_uncooperative`
  - on *full* -> **objective resolves**
  - on *failed* -> Ask Mira Wren to cross-reference the ledger entries with… — "Eldra firmly shuts down any line of questioning about the ledger's specifics, forcing the party to seek evidence elsewhere."
- **Route - Ask Mira Wren to cross-reference the ledger entries with…** *(skill_challenge)*
  - The dusty shelves of the Harbourmaster's office groan under the weight of countless ledgers. Mira Wren, her brow furrowed in concentration, pores over recent shipping manifests.
  - at stake: Your cross-referencing might miss a crucial detail, allowing Eldra's deception to remain hidden.
  - ways in: Attempt: Ask Mira Wren to cross-reference the ledger entries with official shipping registrations. / Attempt: Look for clues about the ledger's age and authenticity.
  - on success: `ledger_fraud_exposed`
  - on failure: `false_leads`
  - on *full* -> **objective resolves**
  - on *failed* -> Uncover the truth of the ledger — "Mira's initial checks seem to align with Eldra's claims, but a nagging inconsistency remains, prompting a re-examination of other evidence."
- **RESCUE - Uncover the truth of the ledger** *(skill_challenge)*
  - Every other way to Uncover the truth of the ledger has closed behind the party. This is what is left, and it has to happen here, with what they have on them.
  - at stake: Whether the party achieves: Uncover the truth of the ledger
  - ways in: Attempt: Uncover the truth of the ledger
  - on success: `ledger_fraud_exposed`
  - on *full* -> **objective resolves**

#### 2. Rescue Tomas Heddle

*DM intent:* Scene 5 is the chapter's pivot from mystery to urgency. Full dark brings the tide-walkers—sodden, silent figures emerging from the harbour to collect Tomas Heddle, whose name is scrawled in the margin of tonight's ledger page. He walks toward the water in a trance. The party may fight the walkers, wake Tomas, or physically drag him away. This is the party's first concrete encounter with the Drowned Margin's collection mechanism and proves the ledger's entries are active death sentences. Whatever the outcome, the walkers' appearance makes the Pelagic entry—a collection of 47 souls—feel real and immediate.

- **Route - Attack the tide-walkers directly.** *(combat)*
  - The tide is coming in, and with it, the whisper of sodden cloth and the gleam of vacant eyes. Tomas Heddle walks towards the churning water, his eyes glazed, a name scrawled in the ledger's margin.
  - at stake: Tomas Heddle will be claimed by the harbour if he reaches the water.
  - ways in: Fight: Attack the tide-walkers directly. / Fight: Attempt to break Tomas Heddle's trance. / Fight: Physically pull Tomas Heddle from the water's edge.
  - on success: `tomas_rescued`
  - on failure: `tomas_escapes`
  - on *full* -> **objective resolves**
  - on *failed* -> Find a way to interfere with the tide-walkers' procession. — "Despite your efforts, fog and grasping, cold hands obscure your rescue attempt, and Tomas vanishes into the tide."
- **Route - Find a way to interfere with the tide-walkers' procession.** *(skill_challenge)*
  - The air grows heavy and cold as the tide creeps higher. Figures begin to coalesce from the mist, their movements slow and unnervingly deliberate. Tomas Heddle is among them.
  - at stake: Tomas Heddle is walking to his doom, and the Drowned Margin's power will be cemented if he is taken.
  - ways in: Attempt: Find a way to interfere with the tide-walkers' procession. / Attempt: Cause a loud enough disturbance to break Tomas's trance. / Attempt: Use the environment to physically impede Tomas's path to the sea.
  - on success: `tomas_rescued`
  - on failure: `progress_to_sea`
  - on *full* -> **objective resolves**
  - on *failed* -> Save Tomas from the tide-walkers — "Your attempts to divert or block Tomas are too slow; he continues his inexorable march towards the waiting tide."
- **RESCUE - Save Tomas from the tide-walkers** *(skill_challenge)*
  - Every other way to Save Tomas from the tide-walkers has closed behind the party. This is what is left, and it has to happen here, with what they have on them.
  - at stake: Whether the party achieves: Save Tomas from the tide-walkers
  - ways in: Attempt: Save Tomas from the tide-walkers
  - on success: `tomas_rescued`
  - on *full* -> **objective resolves**

#### 3. Confront the Dawn Collection

*DM intent:* The climax. With the ledger exposed as a soul-contract and the tide-walkers proven real, the party must confront Eldra Voss before dawn and decide the fate of the Pelagic entry—a collection of 47 souls including everyone in Saltmire. This resolves the chapter's story: Eldra is desperate, not cruel, and believes this entry will be the last. The party may destroy the ledger and force her to name every false entry, kill her and leave the Drowned Margin unbound, take the ledger and write their own names to settle the debt themselves, or expose her to the town and let Saltmire face the Margin together. Whichever path, this is the decisive act that earns an ending.

- **Route - Attempt to destroy the ledger before the entry is complete.** *(combat)*
  - Dawn is a bruised smudge on the horizon. Eldra Voss clutches the tide-ledger, her face a mask of desperation, as the Drowned Margin's final collection approaches.
  - at stake: If the Pelagic entry is fulfilled, dozens of souls will be collected by the Drowned Margin.
  - ways in: Fight: Attempt to destroy the ledger before the entry is complete. / Fight: Engage Eldra Voss directly. / Fight: Raise the alarm and reveal Eldra's actions to the town.
  - on success: `ledger_destroyed`
  - on failure: `eldra_reaches_dawn`
  - on *full* -> **objective resolves**
  - on *failed* -> Propose a personal sacrifice to alter the ledger's terms. — "Eldra sacrifices herself in a desperate act, ensuring the ledger's pages continue to turn, but the collection is averted... for now."
- **Route - Propose a personal sacrifice to alter the ledger's terms.** *(social)*
  - The harbourmaster's office is a war room, the tide-ledger spread between you and Eldra Voss. The sun is moments from breaking the horizon, and the weight of the Drowned Margin's final collection hangs in the air.
  - at stake: The fate of Saltmire and the souls bound by the ledger rests on your decision.
  - ways in: Talk: Propose a personal sacrifice to alter the ledger's terms. / Talk: Force Eldra Voss to reveal the true nature of the ledger and its creator. / Talk: Seize the ledger from Eldra Voss.
  - on success: `ledger_destroyed`
  - on failure: `agreement_fails`
  - on *full* -> **objective resolves**
  - on *failed* -> Stop the dawn collection — "Your pleas and threats fall on deaf ears; Eldra's pact is sealed, and the dawn collection proceeds as written."
- **RESCUE - Stop the dawn collection** *(skill_challenge)*
  - Every other way to Stop the dawn collection has closed behind the party. This is what is left, and it has to happen here, with what they have on them.
  - at stake: Whether the party achieves: Stop the dawn collection
  - ways in: Attempt: Stop the dawn collection
  - on success: `ledger_destroyed`
  - on *full* -> **objective resolves**

## Cast

- **Cael Arness** (npc) - A retired fisherman with rope-scarred hands who lingers near the chandlery watching newcomers.
- **Mira Wren** (npc) - A young harbour clerk working late among dusty registry shelves, fingers trembling over cross-reference notes.
- **Tomas Heddle** (npc) - A gaunt fisherman with salt-bleached hair who moves through the dark in a foggy, shuffling trance.
- **Eldra Voss** (boss) - A weathered woman in a harbourmaster's coat, her ink-stained hands never quite still. She is desperate to manage the Drowned Margin's demands, and she alone holds the new key to the harbourmaster's office and the Pelagic

## Places

- **Saltmire Harbour** - A dying fishing town where shutters bolt before full dark and boats sit dry on empty moorings.
- **The Pelagic** - A wrecked vessel half-submerged at the far end of the harbour, listing as if waiting for a cargo. It serves as a focal point for the Drowned Margin's collection mechanism, where souls are tallied agai

## Endings

### The Ledger Burned, the Names Spoken *(bittersweet)*

The party destroys the tide-ledger and forces Eldra to name every false entry aloud, breaking the soul-contract. The Drowned Margin withdraws, but the fish and calm waters it brought leave with it—Saltmire survives honest and slowly starving.

*Authored climax:* The party burns the ledger on the docks at dawn's first light while Eldra, weeping, speaks each ghost ship's name to the dark water. The harbour goes still, then still in a different way—nothing rises, nothing offers, and the town must learn to fish again without the deep's help.

Scores when:

- +4 if **Confront the Dawn Collection** is *completed* — The party must confront Eldra and act decisively before dawn.
- +2 if **Investigate the Tide-Ledger** is *completed* — Understanding the ledger as a fraudulent contract is prerequisite to choosing to destroy it.
- +3 if dial *judgment_vs_mercy* <= -2 — Mercy toward Eldra aligns with forcing her to confess rather than killing or exposing her to mob justice—she must name the entries herself.
- +2 if dial *sacrifice_vs_preservation* >= 1 — Some willingness to accept hard costs rather than sacrifice others fits this ending's bittersweet honesty.
- -2 if dial *sacrifice_vs_preservation* <= -3 — Strong self-preservation argues against an ending that accepts a slow starvation the party will share.
- -4 if **Eldra Voss** is *dead* — Eldra must be alive to name the false entries aloud—killing her precludes this resolution.

### The Keeper Falls, the Harbour Follows *(tragic)*

The party kills Eldra before dawn, and the Drowned Margin—unbound from its keeper—takes the entire harbour as final payment. What was meant as one last collection becomes the last entry in a closing ledger, and Saltmire becomes a ghost town in truth.

*Authored climax:* Eldra dies on the harbour office floor, and the tide-walkers do not stop at dawn. Without a keeper to name the debts, the Margin collects everything at once. The water rises, and by morning Saltmire Harbour is empty but for sodden footprints leading nowhere.

Scores when:

- +3 if **Confront the Dawn Collection** is *completed* — The party has reached and acted on the confrontation.
- +5 if **Eldra Voss** is *dead* — Eldra's death by the party's hand is the defining act—the Drowned Margin was bound to its keeper.
- +3 if dial *judgment_vs_mercy* >= 3 — Strong judgment toward Eldra aligns with choosing to kill her as punishment rather than redeem or expose her.
- +2 if dial *sacrifice_vs_preservation* <= -2 — Self-preservation-driven aggression correlates with lashing out rather than accepting personal cost.
- -3 if dial *defiance_vs_submission* <= -2 — This ending results from unbound chaos, not successful defiance—the party fails to contain what they unleash.

### The Pelagic Sails With New Names *(pyrrhic)*

The party takes the tide-ledger and writes their own names in place of the town's, sailing the wreck of the Pelagic out themselves to settle the debt directly with whatever waits beneath the water. Saltmire wakes to an empty dock and a ledger finally closed.

*Authored climax:* At low tide the party boards the half-sunk Pelagic, and the wreck rises for them as it rose for no one else. They sail it past the harbour's edge into water that should not be this deep, this close, this dark. The ledger's last page now reads their names, and the town they leave behind has no more debts to pay.

Scores when:

- +4 if **Confront the Dawn Collection** is *completed* — The party must reach the final confrontation and act.
- +5 if dial *sacrifice_vs_preservation* >= 4 — This ending requires the party to choose mortal self-sacrifice—the highest sacrifice dial value.
- +3 if dial *defiance_vs_submission* >= 2 — Sailing to face the Margin directly is an act of defiance—they go to it rather than flee from it.
- +2 if **Rescue Tomas Heddle** is *completed* — Having witnessed and resisted the collection mechanism makes the party's choice to replace the victims informed rather than naive.
- -3 if **Eldra Voss** is *dead* — Killing Eldra suggests the party sought to punish rather than redeem, working against a sacrificial resolution.
- -2 if dial *judgment_vs_mercy* >= 3 — High judgment toward Eldra works against this ending—this path redirects cost from Eldra and the town onto the party themselves.

### The Town Stands on the Docks *(triumphant)*

The party exposes Eldra to Saltmire's people and lets the town judge her. The Drowned Margin still comes at dawn—but the townsfolk stand on the docks with harpoons and lamps, and what follows is a siege, not a slaughter. Saltmire fights for itself, and survives changed.

*Authored climax:* Eldra stands before her neighbors as the tide-walkers rise, and for a moment it seems the town might tear her apart themselves. Instead they turn to face the water, and when the Margin reaches for them they are ready. Dawn finds Saltmire bloodied but standing, the ledger torn and the harbourmaster in chains of the town's own making.

Scores when:

- +4 if **Confront the Dawn Collection** is *completed* — The party must reach and resolve the final confrontation.
- +3 if **Investigate the Tide-Ledger** is *completed* — Full understanding of the ledger's fraud is prerequisite—the party needs evidence to expose Eldra convincingly.
- +4 if dial *defiance_vs_submission* >= 3 — This ending is defined by defiance—the town refuses to be collected and fights back.
- +2 if **Cael Arness** is *alive* — Cael Arness alive means a potential ally survives to rally the town—the fisherman's voice carries weight on the docks.
- +2 if **Mira Wren** is *alive* — Mira Wren alive means the party has someone who can corroborate the ledger's fraud to the town.
- -4 if **Eldra Voss** is *dead* — Eldra must be alive to be exposed—killing her precludes the town judging her.
- -2 if dial *sacrifice_vs_preservation* >= 4 — Very high sacrifice suggests the party takes the burden themselves rather than sharing it with the town.

### The Tide Collects Its Own *(tragic)*

The party fails to stop the final entry, and the Drowned Margin collects Saltmire Harbour at dawn as written. The town becomes the last ghost entry in a ledger that finally closes, and the party escapes—if they can—knowing what they let happen.

*Authored climax:* Dawn comes and the water rises without ceremony. The walkers walk, and the people of Saltmire walk with them—not screaming, not fighting, simply going. The party watches from the harbour road as the tide comes in and does not go out, and the ledger's last page fills itself.

Scores when:

- +5 if **Confront the Dawn Collection** is *failed* — The defining condition—the party did not resolve the confrontation before the deadline.
- +3 if dial *defiance_vs_submission* <= -3 — Strong submission—avoiding confrontation, letting collections proceed—points toward this failure.
- +2 if **Investigate the Tide-Ledger** is *failed* — If the party never understood the ledger, they could not have acted against it.
- +2 if **Tomas Heddle** is *dead* — Tomas's death in chapter 1 shows the collection proceeding unchecked—a warning the party may not have heeded.
- -2 if dial *sacrifice_vs_preservation* >= 3 — High sacrifice argues against a failure ending—the party was willing to risk themselves, making total failure less likely.

## Audit

- **Entry contract covers 1/3 objectives.** When it completes, its loop closes while later objectives are still to come.
- 2 objective(s) belong to no contract at all: Rescue Tomas Heddle; Confront the Dawn Collection
- Ending **The Ledger Burned, the Names Spoken**: side signals total +7 vs a climax claim of +4 - it can land while its own premise is false.
- Ending **The Keeper Falls, the Harbour Follows**: side signals total +10 vs a climax claim of +3 - it can land while its own premise is false.
- Ending **The Pelagic Sails With New Names**: side signals total +10 vs a climax claim of +4 - it can land while its own premise is false.
- Ending **The Town Stands on the Docks**: side signals total +11 vs a climax claim of +4 - it can land while its own premise is false.
- Ending **The Tide Collects Its Own**: side signals total +7 vs a climax claim of +5 - it can land while its own premise is false.

### What the pipeline itself flagged

- *stage 4* **[info]** Chapter 1 coop: coop set "coop:ledger-cross-ref" was demoted to plain ingredients: every member needs a reveals_to affinity
- *stage 5* **[info]** Battle encounter is over budget: 800 adjusted XP vs a 300 XP standard target for 2 level-3 characters.
- *stage 5* **[info]** Battle encounter is over budget: 450 adjusted XP vs a 300 XP standard target for 2 level-3 characters.
- *stage 7* **[warning]** This objective's title "Confront the Dawn Collection" spoils the central twist that the town itself is the final entry to be collected.
- *stage 7* **[info]** The objective description mentions corroborating entries against reality, but the provided scene descriptions for chapter 1 only focus on investigating the ledger and Mira's notes, not directly comparing it to any observable 'reality' other than Tomas's name appearing in the ledger.
- *stage 7* **[info]** This objective's description states it's the 'chapter's pivot from mystery to urgency,' but the meta loop implies the urgency and the advance of the antagonist's plan is a continuous, uncontrolled progression throughout the night, not solely tied to this objective.
- *stage 7* **[info]** The hidden description for this objective mentions the tide-walkers being proven real, which is consistent with obj#2, but it doesn't explicitly reference the 'Drowned Margin's final collection' which comes from the meta loop.
- *stage 7* **[info]** The description of Eldra Voss states she is 'desperate to manage the Drowned Margin's demands,' but the meta loop states she 'cannot stop this; she can only decide whether to fight, confess, or let it happen,' implying a lack of agency in managing the demands themselves.
- *stage 7* **[info]** The description of the Pelagic states it 'serves as a focal point,' but its role in the narrative beyond being a wrecked vessel and potentially an entry point (implied by item#9) is not fully detailed or connected to the broader plot mechanics.
- *stage 7* **[info]** This clue states the lock was changed and Eldra has the only key, but then immediately contradicts this by saying the party 'finds themselves working in the office,' implying easy access which is not explained.
- *stage 7* **[info]** This item grants Eldra access to the Pelagic's hold, but the narrative doesn't establish a reason for her or the party to need access to the hold as part of the outlined objectives.
- *stage 7* **[info]** This scene description states 'Eldra Voss clutches the tide-ledger,' but the meta loop states the antagonist's plan advances without her control, and the objective descriptions for chapter 1 focus on the party investigating the ledger and confronting Eldra, not necessarily her actively clutching it at the climax.
- *stage 7* **[info]** This scene refers to the 'weight of the Drowned Margin's collection,' which is consistent with the meta loop, but it also states 'The sun is moments from breaking the horizon,' which only aligns with the third stage of the meta loop (dawn collection) and not the earlier stages that might also occur in this room.
