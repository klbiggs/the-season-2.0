# Greenfield Specification: The Season

## Document Purpose

This document describes the complete requirements for rebuilding *The Season* from scratch. It captures WHAT the system does and WHY, never HOW. An implementation agent should use this as the sole specification, making all technology and architecture decisions independently.

---

## 1. System Overview

### Purpose

*The Season* is a single-player turn-based social-strategy and dynasty-simulation game set during the British Regency and early Victorian eras. The player guides a noble house across generations: rising in reputation, negotiating marriages, courting influence with patronesses, conducting espionage through whispers and schemes, weathering bankruptcy and scandal, and surviving duels and political tension between factions.

The system exists because the espionage/social-warfare genre is underserved at the granularity of conversation-level tactics combined with multi-generation house management. Other games either model one (action-paced tactics) or the other (grand-strategy dynasty), but rarely both with a unified deterministic combat engine that also supports natural-language player input.

### Core Value Proposition

The game lets a single player rise across multiple generations of a noble house by alternating between (a) a tick-driven strategic map where wealth, reputation, and scandal accumulate from location-bound activities, and (b) a freeform conversational ballroom where natural-language exchanges with up to five non-player characters resolve through deterministic trait-and-mood combat math, optionally modulated by a large-language-model phrasing-quality judgment. All systems — schemes, marriages, succession, courier-delayed whispers, faction tension, rival houses — feed a single tick clock so player decisions compound deterministically across a multi-decade campaign.

### Scope Boundaries

**The system IS:**
- A single-player desktop game with persistent save/load.
- Deterministic in gameplay math (combat, economy, scheme resolution, mood drift, rival actions, succession, conception, duels) given identical seeds and inputs.
- Non-deterministic only in the optional natural-language conversation layer, which sits above the deterministic combat engine and modulates outcomes by a bounded multiplier.
- Capable of running and persisting without a network connection if the conversational layer is disabled.

**The system IS NOT:**
- Multiplayer or networked between players.
- Real-time (no animations or reflex actions gate progress; all advancement is turn-based).
- A roguelike (campaigns span multiple in-game generations, ~100+ turns; save state is durable).
- A historically accurate simulation (Regency setting is thematic flavor, not a research target).
- A platform that ships user-authored content; all 32 traits, 5 moods, 7 locations, 8 scheme types, and 5 patronesses are fixed by the design.

---

## 2. Core Capabilities

### View Routing Between Modes
**What it does:** Routes the player between four primary interactive modes: a strategy map, a ballroom conversation surface, a ledger of accumulated game state, and a special-purpose elopement-chase overlay.
**Why it matters:** Each mode is optimized for a different decision pace; mixing them in a single view dilutes both.
**Key behaviors:**
- A "return to map" action is always available from the ballroom, ledger, and elopement views.
- Switching modes synchronously tears down the leaving view's interactive controls before mounting the next.
- An overlay mode (elopement sprint) suspends the underlying map without losing its state.

### Tick-Driven Time Advancement
**What it does:** Advances a single authoritative integer clock by one or more units per player action, applying a fixed-order sequence of system updates per tick.
**Why it matters:** A single clock keeps schemes, courier travel, rival actions, mood drift, global events, and aging in deterministic lockstep.
**Key behaviors:**
- Per-tick phase order is fixed: time advance, economy application, courier draining, scheme resolution, global-event rolling, mood drift, rival-house action rolling.
- The rival-house phase always runs last so its random-number draws cannot perturb prior phases' seeded outcomes.
- A separate "pass year" action ages every living character by one, processes succession if the player died, and processes one conception cycle per couple.

### Strategy Map (Location-Bound Activities)
**What it does:** Presents seven travel destinations, each with per-tick wealth/reputation/scandal deltas and a small set of location-only actions.
**Why it matters:** Choosing where to be each tick is the primary economic decision; some actions only fire in specific locations.
**Key behaviors:**
- Travel between locations consumes one tick and may be gated by era (e.g., a foreign capital is blockaded during a wartime era unless the player has earned a specific bypass).
- A high-society location is the only place where the player can attend a ball (entering the conversational mode) or request an audience with the monarch.
- A rural-estate location grants a specific trait to the player after sufficient consecutive ticks spent there, and is the only place to liquidate heirlooms as a bankruptcy escape valve.
- A research action in a later era permanently halves courier transit time for new payloads.

### Conversational Ballroom (Natural-Language Tactic Resolution)
**What it does:** A ring of up to five non-player characters surrounds the player; the player selects a target, optionally pins an explicit tactic via a button, types a freeform message, and receives an in-character reply along with deterministic deltas to affection, composure, and other state.
**Why it matters:** This is the system's signature interaction — the player's actual phrasing influences a phrasing-quality multiplier without subverting the deterministic underlying math.
**Key behaviors:**
- Four tactic buttons (Flattery, WittyBanter, SlyGossip, DeepEmpathy) double as suggested-phrasing prefills and as explicit-intent pins; the player can edit the prefill, freeform-type, or send as-is.
- A pinned explicit intent overrides any classification the language model produces; without a pin, the model classifies the player's text into one of the four tactics.
- A "stance" toggle (Wallflower / Mingle / TargetedPursuit) modifies the resolution math globally for the active session.
- The conversation layer is optional: if its credentials are absent, the ballroom shows a banner and disables the message-send action while all other game systems remain fully functional.
- Each ballroom session also surfaces buttons to start any of six schemes against the selected target and to propose marriage when affection and reputation thresholds are met.

### Schemes (Multi-Tick Background Operations)
**What it does:** Schemes are wealth-costed multi-tick operations that resolve into deterministic state effects at completion.
**Why it matters:** Schemes give the player asymmetric long-game leverage beyond single-tick tactics.
**Key behaviors:**
- Eight active scheme types: Courting (slow affection accumulation), Sabotage (composure damage), Seduction (high affection with a discovery-roll branch into an elopement chase), Chaperone (defensive cancellation of in-flight Seductions), Smuggling (one-shot blockade bypass), Assassination (target death plus scandal), Treason Framing (consumes an unsurfaced forgery to crater a rival house's reputation and raise mutual hostility), and Officer Commission (a self-directed purchase granting a family member the military-officer trait).
- Treason Framing (the artifact-dependent scheme) and Officer Commission (the military-officer acquisition path) were both added after the original six; all eight are now active.
- Each scheme declares prerequisites via a flag set: family-member archetypes the player must have (a spinster aunt, a bohemian, a country exile), era restrictions, and required casus-belli or forged-items.
- Schemes are cancellable while active; cancellation refunds nothing.

### Elopement Sprint (1-D Chase Overlay)
**What it does:** A discovered Seduction triggers a tile-by-tile chase against the target's father, displayed as a special-purpose overlay.
**Why it matters:** Gives the high-risk/high-reward Seduction scheme an interactive failure mode rather than a die roll.
**Key behaviors:**
- Fixed 7-tile track; the player starts two tiles ahead.
- Three player actions: "push" (advance one but father advances one and player loses composure), "fresh horses" (advance two, costs wealth, capped at three uses), "surrender" (immediate loss with scandal penalty).
- Winning halves the house's reputation as the social cost; losing applies a large scandal penalty.

### Marriage, Conception & Succession
**What it does:** The player can propose marriage to high-affection characters; married couples produce children on a cadence; children inherit traits; on the player's death, an heir inherits.
**Why it matters:** Multi-generational play is the system's signature long-arc; without succession, every campaign is a single life.
**Key behaviors:**
- Proposal requires both an absolute affection threshold against the target and a reputation threshold for the house.
- Acceptance is probabilistic, sloping from a floor to a ceiling across the affection range above the threshold.
- Conception fires every two years per couple until either parent reaches a fertility-age ceiling.
- Children inherit traits via a hybrid scheme: two from the parental union plus one with a chance of novelty.
- A tutor archetype assigned during childhood grants an additional trait at adulthood.
- Heirs may marry before inheriting, producing the third generation alongside the current player's siblings.
- On the player's death, the heir inherits, the generation counter increments, and the house's reputation drops by a fixed penalty representing the "new money" effect.

### Espionage & Whisper Ledger
**What it does:** Synergy hits during conversation generate "whispers" (rumors) that travel from the source location to the player's home with a tick-based delay; whispers can be verified, weaponized into a scheme effect, or dismissed.
**Why it matters:** Espionage creates a parallel economy of information that the player accumulates and spends across ticks and locations.
**Key behaviors:**
- Travel delay is determined by a symmetric location-pair table; the farthest pair takes more than a dozen ticks to cross.
- Whispers progress through Unverified → Verified (after sufficient ticks) → Weaponized or Dismissed.
- A whisper may be generated additively by a language-model tool call during conversation, on top of the deterministic synergy-flag whisper.

### Patronesses & Faction Politics
**What it does:** Five named arbiters of social access track favor toward the player's house; their collective vote determines whether the player can attend the high-society ball.
**Why it matters:** Reputation alone does not guarantee social standing; gatekeepers can veto independently.
**Key behaviors:**
- Each patroness has a favor score [0,100]; if any single patroness's favor drops below a threshold, ball attendance at the high-society location is vetoed.
- High accumulated faction tension toward a patroness's affiliation doubles per-tick favor erosion against her.
- A successful audience with the monarch boosts all patronesses by a fixed amount.
- Patronesses are affiliated with one of three named factions; faction tension between any two factions can rise per pair to a ceiling.

### Duels & Grievances
**What it does:** Sabotage success and public faux-pas record formal grievances against the offending house; either side can later "demand satisfaction" to resolve the grievance through a duel.
**Why it matters:** Gives the player both an offense and a recourse against the system's automated rival houses.
**Key behaviors:**
- Duels resolve deterministically given the participants' composure, traits, and seeded random draws.
- The math uses a higher base power and doubled composure delta compared to conversation, emphasizing structural damage.
- A capped exchange count produces stalemate-favoring-defender if neither side breaks; otherwise the loser is killed or wounded by a 50/50 roll.

### Rival Houses (Automated Opposing Actors)
**What it does:** Three canonical rival houses with their own reputation, hostility, and faction affiliation roll automated actions against the player on each tick once their hostility passes an activation threshold.
**Why it matters:** Without automated opposition, the player has no external pressure beyond passive economy ticks.
**Key behaviors:**
- Hostility ranges [0,100]; passive decay of one per tick keeps inactive rivals from re-igniting indefinitely.
- Player Sabotage on a rival's NPC raises hostility; a public faux-pas raises it less; a successful monarch's audience lowers it.
- Each rival has an action cooldown that prevents the same rival from firing every tick.
- An action pool weights LeakWhisper, PettySabotage, OpenSabotage, and RaiseFactionTension; high faction tension between opposing rivals biases the pool toward OpenSabotage.

### Mood Drift
**What it does:** Non-player-character moods change randomly each tick from a weighted pool, and shift reactively into Defensive after a faux-pas.
**Why it matters:** Static moods would make memorized counters dominant; drift forces the player to read the room.
**Key behaviors:**
- Each tick, every NPC has a fixed probability of rerolling mood from a weighted pool (Receptive most likely; Grieving never rolled, only narrative).
- A faux-pas locks the target to Defensive for a fixed number of ticks; locked NPCs skip drift.

### Global Events
**What it does:** A small set of pre-defined named global events fire with a fixed per-tick probability, each lasting a fixed number of ticks and applying per-tick deltas to wealth, reputation, or scandal.
**Why it matters:** External pressure beyond rival action keeps the long campaign noisy.
**Key behaviors:**
- Active events of the same type cannot stack.
- Each event terminates at an absolute end-tick so save/load is deterministic.

### Ledger View (Accumulated State Display)
**What it does:** A tabbed read-mostly view of seven categories: Whispers, Schemes, Family Tree, Patronesses, Grievances, Rivals, Staff.
**Why it matters:** The player needs a single place to see every accumulated long-running state.
**Key behaviors:**
- Each tab exposes the relevant action affordances inline (e.g., the Grievances tab offers a "demand satisfaction" action against an outstanding grievance).
- The Staff tab is reserved as a placeholder for a future bribe/coatroom-assignment subsystem.

### Save & Load
**What it does:** Player triggers serialize the entire game state to a single file; the same trigger reloads it.
**Why it matters:** Campaigns span ~100+ in-game years; persistence is non-negotiable.
**Key behaviors:**
- The save format is versioned; loading an older version applies sequential additive migrations to bring it forward.
- All scheduled future events (courier arrivals, scheme completions, global-event expirations) are stored as absolute ticks so reloading restores them precisely without recomputation.
- Per-house deterministic random state is captured as a seed plus call-count so future random draws stay reproducible across save and load.

### Wardrobe, Artifacts & Heirlooms
**What it does:** A typed registry of jewellery, deeds, portraits, snuffboxes, carriages, and mounts. Equipping artifacts on a character grants reputation, optionally grants additional traits, and incurs scandal-risk while worn. Wardrobe items decay between social seasons, so wearing last-season's fashion to a major ball deals composure damage before the conversation phase begins.
**Why it matters:** Artifacts are the system's "ambiguity" knob — each one solves a problem and spawns another (a status-granting jewel attracts thieves; a forged version risks public surfacing).
**Key behaviors:**
- A canonical small registry seeds the artifact pool (each artifact has an id, family, reputation bonus, scandal-risk-while-worn, optional trait grants, forgeable flag).
- Some artifacts are forgeable (jewellery, snuffboxes, tiaras); others are not (deeds, portraits).
- A wardrobe refresh action at the high-society location consumes wealth; the most recent refresh tick gates the per-ball composure penalty.
- The pre-ball check applies a fixed composure penalty per equipped artifact whose family has aged past a refresh interval.

### Forgery & Theft
**What it does:** A bohemian-rake family member can commission a forged version of a forgeable artifact; while a forgery is unsurfaced it grants the full reputation bonus, but each tick rolls a small chance the forgery surfaces and propagates moral consequences. Independently, thieves notice high-reputation houses and attempt to steal valuable equipped artifacts; a spymaster family member can thwart attempts.
**Why it matters:** Closes the artifact loop — every shortcut (forge instead of inherit) buys a long-tail risk; every accumulated prestige attracts opposition.
**Key behaviors:**
- Forgery commissioning requires a bohemian-rake archetype in the family; it costs wealth and records the forger identity at commission time.
- Per-tick forgery-surfacing roll fires at a small fixed probability; on surface, every Vain non-player character shifts to Defensive for a fixed lock period and loses a fixed affection delta toward the player.
- Thief notice rolls fire only above a reputation threshold AND only when the house owns at least one high-value artifact.
- Thwart resolution requires a living spymaster archetype, costs wealth, and succeeds at a high probability; failure removes the artifact from its owner.

### Treason Framing (Forged-Artifact Scheme)
**What it does:** An artifact-dependent scheme type that uses an unsurfaced forgery to drop a rival house's reputation severely and raise mutual hostility, consuming the forgery in the process.
**Why it matters:** This is the apex outcome of the forgery loop and the only scheme that *requires* an artifact-derived resource.
**Key behaviors:**
- Available only when the player's house holds at least one unsurfaced forgery record.
- On completion, drops the target rival's reputation by a fixed amount, raises that rival's hostility by a fixed amount, and marks the consumed forgery as surfaced so it cannot be reused.

### Hyde Park Daytime Promenade
**What it does:** A daytime alternative to the ballroom available at the high-society location. The player engages a single deterministically-picked non-player character in conversation; the interaction format omits the faux-pas penalty and adds a "compliment mount" tactic that rewards affection when the target owns a mount-family artifact.
**Why it matters:** Gives players a low-risk way to spend a tick socially without the volatility of a full ball; surfaces the mount/carriage artifact subfamily.
**Key behaviors:**
- Available only at the high-society location; consumes one tick per visit.
- Three actions: a witty-banter equivalent, a deep-empathy equivalent, and "compliment mount" (gated on the target owning a mount-family artifact, rewards a fixed affection bonus, no composure cost).
- An owned mount-family artifact grants a per-promenade affection bonus while the player is in the Mingle stance.

### Staff Espionage (Downstairs Network)
**What it does:** The player assigns household staff to information-gathering posts (cloakroom snooping, carriage-driver bribery, mail interception) which produce whispers over time. Underpaid Greedy-trait staff can be turned by rival houses to leak the player's own family secrets.
**Why it matters:** Whispers are the espionage currency; conversation synergy hits alone are insufficient supply. Staff give the player a dedicated investment vehicle and create a counter-espionage threat.
**Key behaviors:**
- Each staff member has a loyalty score and an upkeep cost; underpaying a Greedy-trait staff member raises a per-tick probability of rival bribery.
- Bribed staff produce *inbound* whispers about the player house that travel via courier to rival houses; the player learns about the leak only via downstream consequences.
- Player-loyal staff produce *outbound* whispers at a fixed cadence determined by assignment (snoop in cloakroom, bribe carriage driver, intercept mail).

### Whisper Weaponization Branches
**What it does:** A verified whisper can be spent down one of three distinct paths instead of being held or dismissed.
**Why it matters:** Each path expresses a different risk-reward profile and replaces a single opaque "weaponize" state with three meaningful choices.
**Key behaviors:**
- **Blackmail**: forces a target character into compliance with one scheme action (the target's faction-tension or hostility flips to satisfy the player's request); consumes the whisper; spends a modest scandal cost.
- **Scandal Sheet**: publishes the whisper anonymously, damaging the target house's reputation severely. Carries a probability of attribution; on attribution, the player house is exiled (out-of-bounds endgame).
- **Accidental Slip**: degrades the target's reputation gradually during conversation turns over multiple ticks (a drip-feed effect rather than an event spike).

### Sibling Rivals (Autonomous Slighted Heirs)
**What it does:** On succession, any adult sibling who felt slighted (e.g., higher affection with the deceased head than with the new heir) is promoted to an autonomous actor with its own action loop.
**Why it matters:** Without slighted-sibling autonomy, succession is purely a player buff/penalty event; with it, succession plants a long-tail internal antagonist.
**Key behaviors:**
- Each rival has a hostility score (0–100), an action cooldown, and a reconciled flag.
- A per-tick action roller picks from a small weighted pool: living off the family (drains wealth), leaking a secret (generates an inbound whisper about the player), petty sabotage (per-tick reputation drain), or auto-starting a sabotage scheme against the player.
- A reconciliation action at the high-society location attempts to flip the reconciled flag at a probability proportional to inverse hostility; failure raises hostility further.
- When hostility decays naturally to zero the rival is auto-flagged reconciled and reverts to a Dependent role.

### Family Archetype Auto-Classification ("On The Shelf")
**What it does:** At succession and at child-maturation, each unwed adult family member is classified into one of four archetypes (Spymaster, Bohemian Rake, Tutor, Country Exile) or left unclassified, based on role and traits.
**Why it matters:** Archetype gates scheme prerequisites (Spymaster for Chaperone, Bohemian Rake for Assassination/Forgery, Country Exile as deniable proxy) and unlocks per-archetype actions.
**Key behaviors:**
- Classification is a pure function of role and trait set; first-match-wins ordering produces deterministic outcomes.
- Each archetype unlocks a distinct family-tab action: Spymaster intercepts inbound mail (drops one in-flight payload), Bohemian Rake commissions forgeries, Tutor guides children's mood toward Receptive, Country Exile demands periodic wealth ransom AND acts as a deniable proxy for Assassination/Treason-Framing schemes.

### Tutor Influence
**What it does:** A character with the Tutor archetype is assigned to a child; while assigned, the tutor periodically pushes the child's mood toward Receptive and grants one extra trait at adulthood from a per-archetype pool (e.g., Spymasters pass Observant or Cunning; Bohemians pass Jaded or Melancholic).
**Why it matters:** Gives the player a long-arc lever on each child's adult disposition and represents the "experienced unmarried relatives make shrewd heirs" trope.
**Key behaviors:**
- A tutor-assignment action lives in the family ledger; reassignment before adulthood costs wealth; assignment is locked once the child reaches adulthood.
- The guide-opinion effect fires at most once per child per fixed cooldown; respects existing mood locks (a Defensive-locked child does not drift).
- The granted trait at adulthood is selected by player choice from the archetype's two-option pool.

### Inherited Secrets & Blood Feuds
**What it does:** Verified whispers about the player house accumulate into an inherited-secrets ledger that survives across generations. Per-tick rolls draw from this ledger and may "surface" a secret against a rival house, recording a long-tail feud and triggering automatic affection penalties from that rival's associates.
**Why it matters:** Multi-generation play requires multi-generation antagonism; secrets from three generations ago can erupt during the current heir's reign.
**Key behaviors:**
- A small per-tick probability per active secret rolls a surfacing attempt; on surface, a hostile rival house is picked, a casus belli is recorded against it, and all of its associated characters drop a large affection delta toward the player.
- Surfaced feuds remain in an active-feuds list until resolved (by duel, satisfaction-demanded, or generational decay).
- The ledger is bounded to a maximum number of most-recent entries; older entries collapse into the per-generation ancestor summary.

### Dynasty Legacies (Renown Perks)
**What it does:** Completing certain milestone sequences across generations unlocks permanent house-level perks visible in the ledger.
**Why it matters:** Long campaigns need cumulative non-state rewards beyond just accumulated wealth and reputation; perks are the answer.
**Key behaviors:**
- Three named perks: a patronage perk (permanent boost to events hosted at the rural estate), a seduction perk (permanent base boost to seduction schemes plus reduced scandal on discovery), and a whispers perk (whisper verification time halved; resistance to rival espionage).
- Each perk is awarded on a defined trigger (e.g., three consecutive heirs surviving to natural death; four consecutive successful seductions; a fixed total of verified-then-weaponized whispers across generations).
- Perks are permanent once awarded and round-trip through save/load.

### Social Web Visualization
**What it does:** A graphical alternative to the textual ledger that renders the player house's affection network as a canvas of portrait nodes connected by edges weighted by affection score. Reactive animations express social movements (a faux-pas slides the target's portrait physically away from the player).
**Why it matters:** Reading affection across thirty characters as numeric rows is poor UX at scale; a spatial visualization makes social distance tangible.
**Key behaviors:**
- Pan and zoom across a freely-arranged canvas; portraits cluster spatially by affection magnitude.
- Reactive animations on faux-pas, sabotage success, and proposal rejection slide the affected portrait away from the player.
- Reading-only view; all mutations happen elsewhere (ballroom, schemes, ledger).

### Generated Flavor Content (LLM-Authored, Persisted)
**What it does:** Optionally uses the remote model service to author flavor text once per content item — artifact backstories, generational scandal-sheet columns, NPC biographical notes — then persists the generated text in the save file so subsequent reads are deterministic.
**Why it matters:** Authored content scales linearly with content volume; generated-and-persisted content scales with the campaign's actual surface area rather than with author time.
**Key behaviors:**
- Each generated piece is produced at most once, at first encounter, and stored in the save file.
- A failed generation falls back to a designer-authored stub so play is uninterrupted.
- Subsequent reads of the same content item return the persisted text verbatim; the model is not re-invoked on save/load.
- A periodic scandal-sheet aggregation reads the recent event log and produces a stylized in-game gossip column displayed in the ledger; the column is read-only and does not mutate game state.

### Audio, Localization & Procedural Identity (Content Tier)
**What it does:** Period audio (ambient ballroom murmur, faux-pas gasps, sabotage stings synchronized to portrait-slide animations), translation scaffolding for all UI strings, and procedural generation of large numbers of non-player-character names, portraits, and trait sets so the world feels populated beyond a hand-crafted fixture set.
**Why it matters:** A polished release needs audio, internationalization, and crowd density that hand-authoring cannot supply.
**Key behaviors:**
- All UI text must be reachable through a single translation table so retrofitting languages is mechanical, not archaeological.
- Procedural non-player characters are seeded from name banks plus the canonical 32-trait pool with archetype-aware distributions; each generated character's identity is persisted at first creation.
- Audio cues are tied to existing gameplay events (faux-pas, sabotage success, scheme completion) and play through a single ambient mixer.

### Real Semantic Memory (Embedding-Based Retrieval, Optional)
**What it does:** Augments the recency-window conversation history with embedding-based retrieval over the full lifetime of accumulated game events (past exchanges, whispers, scheme completions, casus belli, succession events, and pre-authored lore). At conversation start, the player's message is embedded; the top semantically-similar past entries are retrieved and merged with the recency window in the system prompt.
**Why it matters:** A recency window cannot surface deep memory — a consoling moment thirty ticks ago, a barbed exchange from a prior generation, a scandal column referencing a grandfather's duel. Real semantic retrieval surfaces those threads.
**Key behaviors:**
- Subscribes to the same events that already drive conversation history (exchange completion, whisper publication, scheme completion, casus belli recording, succession) plus a one-time lore-corpus pass at first game start.
- Retrieval is filtered by `(house identifier, character identifier)` when applicable; cross-house retrieval is out of scope for the initial implementation.
- The recency window is preserved as a short-term anchor; semantic hits are additive in a separate prompt section.
- The index is bounded by entry count with first-in-first-out eviction by tick, and stores embedding model identifier so re-ranking with a newer model is detectable.

---

## 3. Business Logic & Rules

### Conversation Combat Math

- The system must compute an Affection delta as `Base + (count of matching bonus traits × BonusValue) + (matching bonus mood ? BonusValue : 0)` where `Base = 10`, `BonusValue = +15`.
- The system must compute a Composure delta as `(count of matching penalty traits) × PenaltyValue` where `PenaltyValue = -10`.
- Two named overrides apply: a Flattery tactic against a Defensive target is an instant-fail returning zero affection and `-20` composure plus a faux-pas flag; a WittyBanter tactic against a Distracted target is a yield-zero returning both deltas as zero.
- A side-effect flag set (whisper generation, etc.) keys on the synergy hit condition (any bonus trait or bonus mood match), not on the post-modulation affection sign.
- A faux-pas fires when the player's composure crosses to zero or below after tactic resolution; this triggers a reactive mood shift on the target to Defensive locked for five ticks.

### Stance Modifiers

- Stance Wallflower multiplies affection delta by 0.5, and grants a bonus whisper when SlyGossip produces a synergy hit. The bonus whisper targets a deterministically picked non-target NPC.
- Stance Mingle is baseline with no modifier.
- Stance TargetedPursuit multiplies affection delta by 1.25 only when the player is acting against the explicitly selected target; additionally, when the player is the victim of a Sabotage scheme, the target composure hit is doubled.

### Language-Model Quality Modulation

- The system must apply a phrasing-quality multiplier in `[0.5, 1.5]` to the affection delta only; composure delta is never modulated (structural damage is phrasing-independent).
- The system must clamp received multipliers defensively; out-of-range values fall back to the nearest bound.
- Unknown classifications returned from the model fall back to the explicitly pinned intent (or Flattery if none was pinned).
- A language-model failure (timeout, network error, malformed response) must not advance the tick, must not apply combat resolution, and must not append to conversation history.

### Economy & Bankruptcy

- The system must classify wealth into four tiers: Solvent (wealth ≥ 0), Hemorrhaging (-100 < wealth < 0), Embarrassed (-500 < wealth ≤ -100), Ruined (wealth ≤ -500).
- Per-tick penalties stack by tier: Hemorrhaging applies `-2 wealth, -1 reputation`; Embarrassed applies `-3 wealth, -1 reputation, +1 scandal`; Ruined applies `-5 wealth, -2 reputation, +2 scandal`.
- An escape-valve action is available only at the rural-estate location while wealth is negative, applying `+50 wealth, +5 scandal`.
- Wealth is uncapped (bankruptcy is the response to extreme negative wealth); reputation and scandal are both clamped to `[0, 100]`.
- Affection between any two characters is clamped to `[0, 100]`. Clamping is applied at every mutation site, not only at display time.

### Monarch's-Audience Resolution

- Requires reputation ≥ 30 and presence at the high-society location.
- A cooldown of 30 ticks since the last audience attempt must elapse.
- Outcome is keyed off pre-cost reputation: full success at ≥ 50 wipes scandal to zero and grants `+5` to all patronesses; partial success at 30–49 adds `+10` scandal; denied if reputation < 30; cooldown is a no-op.
- The cost `-50 wealth, -10 reputation` is paid only on partial or full success.
- A full-success audience also drops rival hostility by `5` against the player; this drop fires on the same tick as the audience, before the rival-action roll, so a rival cannot retaliate the same turn it was placated.

### Marriage, Conception & Inheritance

- Proposal requires affection ≥ 80 toward the target and house reputation ≥ 40.
- Acceptance probability slopes linearly from 0.5 at affection 80 to 0.95 at affection 100, clamped to `[0, 1]`.
- Marriage is held per-character (not per-house) so an heir can marry before inheriting.
- Rejection applies `+5 scandal`.
- Conception fires every two years for an active marriage until either parent reaches age 40.
- Trait inheritance picks two traits from the union of parental traits plus a third trait drawn 30% from a novelty pool and 70% from the union.
- A tutor archetype optionally assigned during childhood grants one additional trait at adulthood from a per-archetype pool of two.

### Succession

- On the player's death, the heir is resolved from the family pool first, then from adult children, then promoted into the player slot.
- The new head incurs a fixed `-20` reputation penalty representing the "new money" effect.
- The generation counter increments by one; an ancestor summary appends one line per generation.
- The dead head's spouse marriage record is marked dissolved on the surviving spouse so widows can remarry.
- The genealogical record of children is preserved across generations (never pruned).

### Scheme Costs, Durations & Requirements

| Scheme | Wealth Cost | Duration (ticks) | Final Effect | Prerequisites |
|---|---|---|---|---|
| Courting | 10 | 5 | +40 affection | None |
| Sabotage | 15 | 3 | -30 target composure, may record grievance | None |
| Seduction | 25 | 7 | +80 affection or discovery → elopement sprint | None |
| Chaperone | 5 | 1 | Cancels in-flight Seductions on same target | Family must contain a living spinster archetype |
| Smuggling | 20 | 4 | Sets a one-shot blockade bypass flag | Era must be the earlier (wartime) era; scheme must not complete past era transition |
| Assassination | 50 | 6 | Target dies, +25 scandal | Family must contain a living bohemian or country-exile archetype |
| Treason Framing | 40 | 5 | Consumes an unsurfaced forgery; craters the target rival house's reputation, raises mutual hostility | Family must contain a living bohemian-rake archetype (the only forger); an unsurfaced forgery owned by the house |
| Officer Commission | 40 | 8 | Grants a family member the military-officer trait (self-directed; no target) | None |

- Smuggling additionally cannot start if a previous Smuggling pass is still unclaimed.
- Smuggling must reject at start time if completion would land past the era transition (so the player isn't charged for a doomed pass).
- Each scheme can be cancelled while active; cancellation refunds nothing.

### Duel Resolution

- Each duellist begins at 100 composure.
- Each exchange applies a composure delta computed via the conversation math with base power `25` and `×2` composure multiplier.
- The challenger acts first; the defender acts second; the loop continues until one party's composure goes negative or until 12 exchanges have elapsed.
- A 12-exchange stalemate favors the defender (non-fatal).
- A decisive loss applies a 50/50 random draw between "killed" (target marked dead, propagating an OnCharacterDied cascade) and "wounded" (composure restored to a low value, narrative effect only).

### Elopement Sprint

- The race is a 7-tile track; the player begins two tiles ahead.
- "Push" advances the player by one and the father by one, costs 5 composure.
- "Fresh Horses" advances the player by two, costs 10 wealth, capped at three uses per sprint.
- "Surrender" sets the father to the finish line, immediate loss.
- Win condition: player reaches tile 7 first. Effect: house reputation halved (and clamped non-negative).
- Loss condition: father reaches tile 7, or player composure reaches zero. Effect: `+50 scandal`.

### Mood Transitions

- A faux-pas reactively shifts the target's mood to Defensive and locks it for five ticks; if already Defensive, the lock extends without firing a mood-change event.
- Each tick, every active character rolls a 15% chance to reroll mood from a weighted pool (Receptive 4, Defensive 2, Distracted 2, Jealous 1). The Grieving mood is narrative-only and is never rolled; locked characters skip the roll.

### Global Events

- A 5%-per-tick chance rolls a candidate event from a small fixed registry; duplicate active events of the same type are skipped.
- Six event types are defined: WarEffort (10 ticks), MarketCrash (5 ticks, `-3 wealth` per tick), MonarchsMood (5 ticks), RoyalFuneral (5 ticks, `-1 reputation` per tick to houses at the Capital), DucalWedding (7 ticks, `+1 reputation` per tick to houses at the Capital), and PeasantRevolt (5 ticks, `-2 wealth` per tick to houses at the Country estate). (The last three are location-keyed and were added after the original three.)
- **WarEffort effect:** per tick `+1 reputation, -2 wealth` — except rival houses profiteer from the war and gain `+3 wealth` per tick instead (the `+1 reputation` still applies to every house, rival or not). Additionally, any family character carrying a "military officer" trait or role receives a temporary positive multiplier on their Seduction-scheme outcomes against any target, AND has a small per-tick chance of dying at the front (a deterministic seeded roll); the death follows the usual OnCharacterDied cascade.
- **MonarchsMood effect (cultural-pivot mechanic):** at start, a "favored culture" (one of a small fixed set) is rolled. While active, any house with at least one equipped artifact whose family matches the favored culture gains a fixed per-tick reputation surge. Houses without a matching artifact see `+1 scandal` per tick as the King's snub propagates. The favored-culture roll is the same per-tick deterministic seeded draw used elsewhere.
- Events terminate at an absolute end-tick recorded at start so save/load preserves their lifecycle.

### Era Progression

- The era auto-transitions from the earlier (wartime) era to the later (industrial) era at a fixed tick threshold.
- The earlier era blocks travel to the foreign capital (Napoleonic blockade flavor) unless a Smuggling pass has been earned.
- The later era unlocks a one-time research action that permanently halves new courier travel times.

### Rival Houses

- Three canonical rival houses are seeded with names, factions, starting reputations, and starting hostilities.
- A rival acts only when its hostility ≥ 25; passive decay `-1`/tick keeps inactive rivals quiet.
- Action cooldown of 8 ticks between actions; the cooldown timer advances even on defensive no-ops so a stuck rival decays back below the threshold.
- Action pool weights: LeakWhisper 3, PettySabotage 2, OpenSabotage 2, RaiseFactionTension 1; when faction tension between opposing rivals is high, weights bias toward OpenSabotage in proportion to tension.
- Faction tension counters cap at 100 per pair.

### Patroness Favor

- Each patroness has a favor score [0,100] with starting value 50.
- Per-tick erosion of `-1` favor on one deterministically-picked patroness fires when house scandal ≥ 50.
- Erosion doubles to `-2` when faction tension toward that patroness's affiliation is ≥ 50.
- A monarch's-audience full success adds `+5` to all patronesses uniformly.
- A ball at the high-society location is vetoed when any single patroness's favor falls below 20.
- The high-society ball venue itself is a named institution within the high-society location (treated as the patronesses' gatekept venue); when vetoed, the rejection prose must name the snubbing patroness(es).

### Location-Bound Trait Acquisition & Risk Asymmetry

- The rural-estate location grants the "rustic" trait to the player after a fixed threshold of consecutive ticks spent there.
- The two continental finishing-school destinations (the cultured capital, the political capital) each apply a moderate per-tick wealth drain and a 20% per-tick chance of granting the "sophisticated" or "polyglot" trait respectively. The roll uses the deterministic seeded random draw.
- The two continental seduction-capital destinations (the canal city, the renaissance city) apply *lower* reputation penalties for in-progress Seduction schemes but a *higher* probability that scandal-bearing whispers from those cities arrive at the high-society location via the courier system. The probability multiplier is a fixed scalar on top of the standard inbound-courier flow.

### Wardrobe Decay & Pre-Ball Composure Penalty

- Wardrobe items are tagged with the absolute tick of their most recent refresh.
- An equipped artifact is considered "out of season" once a fixed refresh-interval has elapsed since its last refresh.
- Entering a ball applies a fixed per-out-of-season-artifact composure penalty BEFORE the conversation phase begins, drawn down from the player's current composure pool.
- A wardrobe-refresh action at the high-society location consumes a fixed wealth cost and resets the most-recent-refresh tick on all equipped artifacts.
- The reputation bonus from an equipped artifact is unaffected by seasonal decay; only the pre-ball composure check is.

### Forgery Surfacing

- Each unsurfaced forgery rolls a small per-tick probability (sub-percent) of surfacing, using the deterministic seeded random draw.
- On surface, the forgery's surfaced flag is set; every Vain non-player character is reactively shifted to Defensive locked for a fixed multi-tick lock period and loses a fixed affection delta toward the player.
- A surfaced forgery cannot be used as a Treason-Framing scheme prerequisite.

### Thief Notice & Thwart

- A per-tick small probability rolls a thief-notice attempt only when (a) the player house's reputation is at or above a high threshold AND (b) the house owns at least one equipped artifact whose reputation bonus is at or above a fixed valuable-artifact threshold.
- On notice, the system schedules a theft attempt against a deterministically picked valuable artifact on a deterministically picked owner character.
- A spymaster-archetype family member, when present, can thwart the attempt at a high success probability; the thwart costs wealth and consumes one in-flight payload slot.
- A non-thwarted theft removes the targeted artifact from its owner's equipped list and publishes a public theft event.

### Hyde Park Promenade

- Available only at the high-society location; consumes one tick per visit.
- Selects a single conversation partner deterministically via the seeded random draw from the present non-player characters.
- The available actions are a witty-banter equivalent, a deep-empathy equivalent, and "compliment mount" (gated on the partner owning a mount-family artifact; rewards a fixed affection bonus with no composure cost).
- Faux-pas penalties do NOT apply during a promenade.
- An owned mount-family artifact on the player grants a per-promenade affection bonus while the player is in the Mingle stance.

### Staff Espionage

- Each staff member has a loyalty score, a per-tick upkeep wealth cost, and an assignment.
- Loyalty drifts downward when upkeep is under-paid; Greedy-trait staff drift faster.
- Each tick, staff with sufficiently low loyalty roll a probability of being bribed by a rival house; on bribe, they switch to producing inbound whispers about the player.
- Assignments and their outputs: cloakroom snoop generates one outbound whisper per fixed cadence; carriage-driver bribe generates whispers about characters whose recent travel matches; mail interception drops one in-flight inbound courier payload per fixed cadence.

### Whisper Weaponization Branch Outcomes

- **Blackmail (cost: modest scandal, consumes the whisper):** the targeted character is compelled into one cooperative action — for one round, the player can dictate an attribute flip in the target's favor (e.g., reducing the rival's hostility or unlocking a scheme prerequisite).
- **Scandal Sheet (cost: consumes the whisper):** the target house's reputation drops by a large fixed amount; the publication carries a fixed attribution probability; if attribution lands, the player house is marked exiled and a terminal end-of-campaign condition fires.
- **Accidental Slip (cost: consumes the whisper):** over a fixed multi-tick window during conversation rounds with the target, the target's house reputation receives a per-tick drip-feed reduction.

### Happiness Drain From Dull-Spouse Marriages

- A `happiness` field on every character starts at 100 and is clamped to `[0, 100]`.
- A married character whose spouse carries the Dull trait loses a per-tick happiness delta.
- When a character's happiness falls below a defined threshold, the player gains explicit narrative-prompted access to the Seduction scheme against any non-spouse target with a discounted scandal-risk penalty (a deliberate temptation hook).

### Tutor Influence

- A tutor-assignment action assigns a tutor-archetype family member to a child.
- A guide-opinion effect fires at most once per child per fixed cooldown; respects existing mood locks (a Defensive-locked child does not drift).
- The granted trait at adulthood is selected by player choice from the archetype's two-option pool (e.g., Spymaster archetype offers Observant or Cunning; Bohemian Rake offers Jaded or Melancholic).
- Reassignment of a tutor before adulthood costs wealth; assignment becomes locked once the child reaches adulthood.

### Sibling-Rival Action Roller

- Promotion trigger: at succession, each adult sibling whose hostility derivation (e.g., affection-delta toward dead head vs. new heir) exceeds a fixed threshold is promoted to an autonomous sibling-rival actor.
- Per-tick action gating: rivals act only when `currentTick − lastActionTick ≥ 5` AND they are not reconciled.
- Weighted action pool: gambling-debt (heaviest), leak-secret, petty sabotage, auto-start a Sabotage scheme against the player (lightest).
- Per-action hostility delta: `-2` per action rolled (decay toward neutral); `+5` on a failed reconciliation; clamped `[0, 100]`.
- Auto-reconciliation: at hostility 0, the rival is auto-flagged reconciled and reverts to a Dependent role.
- A reconciliation action at the high-society location costs `−50 wealth, −10 reputation` per attempt; success probability scales with inverse hostility.

### Family Archetype Auto-Classification

- Classification runs at exactly two trigger points: succession (for surviving family) and child maturation (transition from child-record to adult character-model).
- The classification function is a pure mapping of role and trait set; first-match-wins ordering produces deterministic outcomes:
  - Spinster role + traits include any of {Cunning, Observant} → **Spymaster**.
  - Unwed adult male + at least one of {Frivolous, Romantic, Jaded} → **Bohemian Rake**.
  - Unwed adult + at least one of {Intellectual, Sophisticated} → **Tutor**.
  - Exile role OR traits include any of {ImpoverishedNobility, Rustic} → **Country Exile**.
  - Otherwise → **None**.
- Mid-life trait acquisition does NOT reclassify; classification is recomputed only at the two trigger points.

### Inherited Secrets & Blood-Feud Surfacing

- The inherited-secrets ledger accumulates verified whispers about the player house on succession (existing verified entries are copied in).
- Each active inherited-secret rolls a small per-tick probability (sub-percent) of surfacing against a deterministically picked hostile rival house.
- On surface: a casus belli is auto-recorded against the rival; all characters associated with that rival drop a large affection delta toward the player (clamped `[0, 100]`); an active-feud record is appended.
- The ledger is bounded; oldest entries past the bound collapse into the per-generation ancestor summary string.

### Dynasty-Legacy Award Triggers

- A patronage perk is awarded when three consecutive heirs survive to natural death (not killed in duel, not assassinated).
- A seduction perk is awarded after a cumulative four successful Seduction-scheme completions across all generations.
- A whispers perk is awarded after a cumulative fixed total of whispers reach the Weaponized state across all generations.
- Each perk applies a permanent house-level effect: the patronage perk multiplies events hosted at the rural estate; the seduction perk adds a fixed positive base to all Seduction-scheme outcomes AND halves the discovery-scandal penalty; the whispers perk halves whisper verification time AND adds a fixed probability of automatically intercepting inbound whispers about the player house.

### Validation Rules

- Action gating must be enforced consistently: an action whose preconditions fail must surface a player-readable rejection message AND must not partially mutate state. (No "deducted wealth then errored" failure paths.)
- All clamped numeric fields must be re-clamped at every mutation site, never relying solely on display-time clamping.

### State Machines & Transitions

- Whisper: Unverified → Verified (after sufficient ticks of verification progress past 100) → Weaponized or Dismissed.
- Scheme: Active → Completed | Cancelled | Failed.
- Marriage: Active → Dissolved (on spouse death; one-way; the dissolved flag is the gate that lets the survivor remarry).
- Era: Earlier → Later (one-way at the era-transition tick).
- Mood: Receptive | Defensive | Distracted | Jealous | Grieving; Defensive is reachable reactively and locked for five ticks after a faux-pas.
- Bankruptcy tier: function of current wealth; transition is implicit and recomputed each tick.

### Calculations & Formulas

- Affection delta: `Base(10) + BonusTraits×15 + BonusMood×15`, scaled by stance multiplier and optional language-model quality multiplier `[0.5, 1.5]`. Final result clamped to `[0, 100]` at write time.
- Composure delta: `PenaltyTraits × -10`. Never modulated by quality.
- Acceptance probability: `0.5 + (affection - 80) / 20 × 0.45`, clamped `[0, 1]`.
- Courier transit time: symmetric table per location pair; halved (rounded down, minimum 1) when railway research is unlocked, applied only to new payloads.
- Duel composure damage per exchange: conversation math with base power 25 and `×2` composure multiplier.

---

## 4. Data Model & Relationships

### Core Entities

- **Character**: A named individual with a unique identifier, a list of personality traits drawn from a fixed registry of 32, a hidden mood from a registry of 5, a role (head of house / heir / dependent / spinster / exile / bohemian / staff / sibling-rival), an optional "on-the-shelf" archetype (spymaster / country-exile / bohemian-rake / tutor / none), a faction affiliation, age and death-age, alive flag, current and max composure, a happiness score `[0, 100]`, a per-target affection map, an equipped-artifact identifier list, an optional marriage record, a current stance, a mood lock-until-tick, and a house identifier.
- **House**: A unique identifier, current wealth (unbounded), reputation and scandal both `[0, 100]`, political alignment, a per-house deterministic random seed plus call-count tracking, an heir identifier, a generation counter, an ancestor summary log, a list of children (genealogical record retained across generations), social grievances, faction-tension counters per faction, last-audience tick, additive flags for special states (e.g., earned blockade-bypass), a wardrobe last-refresh tick, a list of unsurfaced and surfaced forgery records, a list of pending thief attempts, a list of active sibling-rival actors, an inherited-secrets ledger, a list of active blood feuds, and a list of awarded dynasty perks.
- **Whisper**: A unique identifier, text body, originating tick, source and subject character identifiers, verification progress (0–100), and a status enum.
- **Active Scheme**: Identifier, type, aggressor character, target character, start tick, ticks remaining, status, and accumulated affection.
- **Active Global Event**: Identifier, type, start tick, absolute end tick.
- **Courier Payload**: Identifier, payload type, origin and destination locations, origin tick, absolute arrival tick, interceptable flag, source and subject character identifiers, opaque payload body.
- **Marriage Record**: Spouse character identifier, married-at tick, dissolved flag, dissolved-at tick, via-elopement flag.
- **Child Record**: Identifier, two parent identifiers, born-at tick, age, role, inherited traits, optional assigned tutor identifier, tutor-trait-granted flag.
- **Patroness Record**: Identifier, display name, favor score [0,100], faction affiliation.
- **Rival House**: Identifier, display name, faction affiliation, reputation, hostility [0,100], wealth, associated character identifiers, last-action tick.
- **Casus Belli**: A reason string, offending house identifier, incurred-at tick (the sign of which encodes a satisfied/unsatisfied state to keep the JSON shape additive).
- **Elopement Sprint State**: Active scheme identifier, target identifier, eloping character identifier, player tile, father tile, fresh-horses-used count, resolved flag.
- **Chat Exchange**: A speaker role from `{house-head, other}` (chosen so heir-promotion does not invalidate the term), text, optional classified tactic, tick.
- **Artifact Definition**: An identifier, a display name, a family enum (sapphires, tiara, snuffbox, phaeton, mount, family-deed, ancestral-portrait, etc.), a reputation bonus, a scandal-risk-while-worn value, a list of trait grants while equipped, a forgeable flag, and a forge wealth cost (when forgeable).
- **Forgery Record**: The forged artifact's identifier, the forger character identifier, the tick at which it was forged, and a surfaced flag.
- **Thief Attempt**: The targeted artifact identifier, the owner character identifier, the noticed-at tick, and a thwarted flag.
- **Sibling-Rival State**: The character identifier, the last-action tick, a hostility score `[0, 100]`, and a reconciled flag.
- **Blood Feud**: The offending house identifier, the triggering secret identifier, the incurred-at tick, and a resolved flag.
- **Staff Member**: An identifier, owning house identifier, traits (notably whether the character carries the Greedy trait), a loyalty score, a per-tick upkeep wealth cost, a current assignment enum (snoop / bribe-driver / intercept-mail / none / bribed-by-rival), and a last-output tick.
- **Inherited Secret**: An identifier, a description text, the originating-generation marker, and an optional surfaced-against rival house identifier.
- **Dynasty Perk Award**: A perk enum, the awarded-at tick, the awarded-during-generation marker.
- **Vector Index Entry** (when embedding-based retrieval ships): An identifier, an embedding vector, the source text, an entry-type enum, optional house and non-player-character identifier filters, and a tick.

### Relationships

- A house owns exactly one current head-of-house character, zero or more living family characters, zero or more children records (genealogical, may be deceased), and a directional affection map keyed by character identifier.
- A character belongs to exactly one house; multiple non-player characters with the same house identifier form rival houses.
- A scheme references one aggressor character and one target character; the aggressor's house owns the scheme.
- A whisper references a source character and a subject character; routing locates the whisper in the player's home location via courier.
- A marriage record is owned per-character (both spouses hold a reference), not per-house.
- The conversation history map keys on the pair `(house identifier, target character identifier)` rather than `(actor character identifier, target)` so that heir-promotion-on-succession preserves conversational rapport.

### Data Lifecycle

- Characters are created during initial campaign setup and during birth (as a child record), promoted to character-model at the adulthood age, marked dead by aging, killed by Assassination or duels, and pruned from active fixtures while remaining in the genealogical record.
- Schemes, whispers, and global events are created with an explicit start tick and an explicit absolute end tick (or absolute arrival tick); they expire by tick comparison, never by recomputation from a relative duration.
- Marriages dissolve on spouse death by flag flip; the record itself is retained.
- Conversation history is bounded per pair to the three most-recent exchanges; older exchanges are evicted oldest-first.
- On character death, references in rival-house associated-character lists and in conversation-history orphan keys must be pruned by the cascade.

### Consistency Requirements

- Per-character mutations to affection, composure, and mood must clamp at the mutation site, not at the display layer.
- All scheduled future events (courier payloads, scheme completions, global-event expirations) are stored as absolute ticks so save and load preserves their lifecycle deterministically.
- The per-house random seed and call-count must round-trip through save/load so deterministic random draws remain reproducible.
- A single visible "heir" invariant must hold across all display surfaces: stale heir-role flags on non-heir characters must be demoted at refresh time.
- The conversation-history pair key must be stable across heir succession (i.e., keyed by house identifier and target character identifier, not by actor character identifier).

---

## 5. External Integrations

### Remote Large-Language-Model Service

- **Purpose:** Generates in-character dialogue from non-player characters, classifies the player's freeform input into one of the four tactic types, and produces a phrasing-quality multiplier in `[0.5, 1.5]`. Optionally emits structured tool calls (initially only a whisper-generation tool) that the game executes as additive side effects.
- **Direction:** Outbound request, structured-JSON response.
- **Data exchanged:**
  - Outbound: a system instruction describing the target character (traits, mood, recent history), the conversation history for the (house, target) pair bounded to the three most-recent exchanges, the player's freeform message, optionally a pinned explicit intent, and a structured-response schema.
  - Inbound: a dialogue string, a classified tactic enum, a quality multiplier, an optional flavor mood hint, and zero or more tool calls.
- **Failure behavior:** A network failure, timeout (15-second budget), or schema-violation must result in a sentinel failure return that (a) does NOT call the combat resolver, (b) does NOT advance the tick, (c) does NOT append to the conversation history, and (d) re-enables the UI controls after surfacing a user-visible failure reason. The rest of the game must remain functional.
- **Model routing:** A faster, cheaper model is used by default; a more capable model is reserved for "first-meeting" interactions per (house, target) pair as identified by an empty conversation-history pair. Other key moments (proposal, scheme completion, duel, monarch's audience) are pre-wired as plumbing but not active in the initial release.
- **Cost mitigation:** Single-shot responses only (no streaming), capped output-token budget, capped system-instruction budget under 1500 tokens.

### Optional Embedding Service (Semantic Memory Retrieval)

- **Purpose:** When semantic retrieval over a long campaign history is enabled, this service converts text passages into fixed-dimensional numeric vectors so the conversation prompt can surface deep historical context beyond a fixed-size recency window. Without it, the system falls back cleanly to the recency window alone.
- **Direction:** Outbound text-to-vector request.
- **Data exchanged:** Outbound text passages (conversation exchanges, whisper bodies, scheme summaries, casus belli notes, location lore at startup); inbound numeric vectors of fixed dimension.
- **Failure behavior:** A failed embedding attempt is logged and dropped (the corresponding passage is not indexed); future conversation prompts proceed with whatever entries the index has accumulated plus the recency window. Game state is unaffected.
- **Pinning:** The chosen embedding model identifier must be pinned (not a "latest" alias) so embeddings stay comparable across save-and-reload.

### Filesystem Persistence

- **Purpose:** Persist and restore the entire game state.
- **Direction:** Local filesystem read and write.
- **Data exchanged:** A single human-readable structured-data file containing all game state including conversation history. When the embedding-based vector index ships, it may be persisted alongside as a sidecar binary keyed by save-game identifier to avoid bloating the human-readable save.
- **Failure behavior:** A missing file produces a new-game default state. A corrupted file must surface a readable error without crashing; the player retains the option to start a new game.

### Authentication Mechanism

- The remote model service requires a single secret key supplied via the player's environment, never stored in saves, never logged.
- A pre-flight check on this key must run cheaply (no network roundtrip) before the conversation UI activates.
- Absence of this key must gracefully disable only the conversation feature, leaving all other systems fully operational.

---

## 6. Authentication & Authorization

- The game is single-player and offline-capable; there is no inter-player authentication or authorization model.
- The only credential in the system is the remote-model service key, handled as described in §5.
- The credential must never be persisted to disk, never appear in logs, and never be transmitted to any party other than the remote model service.

---

## 7. Edge Cases & Error Handling

### Known Edge Cases

- **Mid-conversation view exit:** A player navigating away from the ballroom during an in-flight model request must not crash the UI; the in-flight request must be cancelled and post-response side effects must check that the destination UI elements still exist before mutating them.
- **Heir promotion mid-conversation:** If the player dies (via duel, Assassination, or natural causes) while a conversation is pending, the heir inherits the conversation-history pair (because history is keyed by house, not actor), and the heir does not re-trigger the "first-meeting" routing.
- **Era-flip during a Smuggling scheme:** A Smuggling scheme that would complete past the era-transition tick must be rejected at start time. A Smuggling scheme that completes after the era has already flipped (despite the start-time guard) must be a no-op on the bypass flag.
- **Same-tick monarch's audience and rival action:** A full-success audience must drop rival hostility before the rival action phase fires on the same tick.
- **Cancellation of in-flight Seduction by Chaperone:** A Chaperone completion must identify all in-flight Seductions targeting the same character and cancel them.
- **Mood-lock cascade prevention:** A locked-Defensive target receiving a second faux-pas must extend its lock without re-firing the mood-change event.
- **Affection/Composure mutation from multiple sites:** Each mutation site must clamp independently; relying on a single canonical clamp at display time is forbidden.
- **Save-data migration ordering:** Migrations between schema versions must be sequenced so each save flows through every applicable migration in order. A version-13 save must NOT re-run version-12 migrations.
- **Rival-house associated-character pruning:** On character death, the rival-house's associated-character list must drop the dead identifier so a future hostility roll doesn't reference a corpse.
- **Conversation history orphan keys:** On character death, all conversation-history entries keyed on the dead character (as the target) must be pruned.
- **Forgery surfacing cascade:** A surfacing forgery must apply the Vain-NPC mood lock and affection penalty in one transactional pass; partial application (some Vain NPCs locked, others missed) is forbidden.
- **Theft against an unequipped artifact:** If the targeted artifact has been unequipped or transferred between notice and resolution, the theft attempt must be treated as auto-thwarted (no theft) without spending a thwart cost.
- **Sibling-rival promotion of a corpse:** Succession promotion must only consider living adult siblings; a sibling who died during the same tick must not be promoted to autonomous-rival status.
- **Tutor reassignment after maturation:** A tutor reassignment action issued against a child who has already crossed the adulthood boundary must be rejected with a player-readable message; the wealth cost is not deducted.
- **Wardrobe refresh during bankruptcy:** A wardrobe refresh action must respect bankruptcy gating; if the refresh wealth cost would drop the house from Solvent to a worse tier, the player must be warned but allowed to proceed (player agency takes precedence).
- **Out-of-season artifact equipped mid-ball:** Entering a ball must snapshot the equipped artifacts at entry; equipping/unequipping mid-conversation does not retroactively alter the pre-ball composure penalty.
- **Staff bribery while assigned to mail interception:** A bribed staff member must immediately cease their player-loyal outputs; the next tick's mail-interception slot is forfeit and no inbound payload is dropped.
- **Inherited-secret surface against a now-allied rival:** A surfacing roll that picks a rival whose hostility has since dropped below the activation threshold must be treated as a missed roll (the secret remains active for a future roll) rather than fired against an inactive rival.
- **Dynasty perk award during the same tick as succession:** Perks are evaluated at the end of every tick after all per-tick rolls have resolved; succession-driven perks must compute against the post-succession house state, not the pre-succession state.
- **Embedding service failure during conversation start:** A failed embedding lookup at conversation start must not block the conversation; the prompt is built with the recency window only and a structured log entry records the miss.
- **Cultural-pivot Monarch's Mood against no-artifact house:** A MonarchsMood event whose favored culture matches no equipped artifact in the player house must apply only the `+1 scandal` per-tick drift; the `cultural surge` branch must not fire negatively (no scandal penalty doubling).

### Error Categories

- **Player-actionable rejection:** Insufficient wealth, missing archetype, wrong era, cooldown not elapsed. Surface as a readable message in the appropriate view; do not mutate state.
- **Transient external failure:** Model-service timeout or network drop. Surface as a conversation-failed banner; do not advance the tick; do not append to history.
- **Schema violation in external response:** Treat as the failure above; additionally clamp out-of-range fields defensively rather than erroring.
- **Missing credential:** Surface as a sticky banner; disable only the conversation-send affordance; leave all other systems running.
- **Save-corruption:** Surface as a readable load-error message; offer a new-game alternative.

### Failure Modes

- **Asynchronous continuation against freed UI:** Every post-await UI mutation must conjunctively check that the destination element is still valid AND still part of the active scene AND that the view is not in its exiting state. Without these three checks, the system will mutate freed memory.
- **Static event-bus subscriber leakage:** Any subscription to a process-lifetime event bus must be paired with an unsubscribe at view teardown; missing unsubscribes leak listeners across scene transitions.
- **Random-number-count drift between save sessions:** Any new random draw introduced into the per-tick flow must advance the per-house call-count by exactly the same amount on replay; failure to do so makes existing saves non-reproducible.
- **Action gating bypassed by mid-flight scheme starts:** Once a scheme is paid for, era flips, family deaths, and archetype losses between start and completion must not retroactively invalidate the completion; defensive checks at completion time are tolerated only if start-time gates have already deducted no resources.

---

## 8. Non-Functional Requirements

### Performance

- A single conversation round-trip must complete or fail within 15 seconds end-to-end; the UI must disable interactive controls during this window and re-enable them on either success or failure.
- A full save serialization must complete synchronously without a visible UI stall on a typical desktop.
- The bounded conversation history (three exchanges per pair, across up to ~30 NPCs) must keep total save size under 50 KB for that subsystem.
- The genealogical children list must be unbounded for the lifetime of a campaign, but each generation's records past two generations old must collapse into the per-generation ancestor summary string to keep growth linear in generation count, not in tick count.
- The inherited-secrets ledger must cap at a fixed maximum of most-recent entries; older entries collapse into the ancestor summary.
- The artifact and forgery lists per house must cap at a defined ceiling (e.g., 50 owned artifacts); historical (deceased-generation) ownership migrates to the ancestor summary.
- When the embedding-based vector index ships, it must cap at a defined number of most-recent entries with first-in-first-out eviction by tick; an embedding-bearing save must keep total save size under a defined ceiling (large, but bounded).
- The system must produce a stable test outcome across 30 consecutive automated test runs; flakes are not acceptable.

### Security

- The only sensitive datum is the remote-model service credential. It must be read from the player's environment, never persisted, never logged, never transmitted outside the model service.
- No multiplayer or networked attack surface exists; security beyond credential handling is out of scope.

### Observability

- Decision points in deterministic gameplay (stance multiplier applied, bonus whisper emitted, scheme completed, succession transition, mood drift, patroness erosion) must emit structured log lines with stable category tags to support manual replay debugging.
- Conversation failures must log the reason category (timeout, network, schema, missing-key) without logging the underlying credential or the player's freeform input verbatim.

### Configuration

- The remote-model service credential must be configurable per machine without code changes.
- All gameplay constants identified in §3 (thresholds, costs, durations, decay rates, cooldowns) must be defined in one canonical location each so that designer tuning never requires a hunt across multiple files.

### Determinism

- Every deterministic system (combat, economy, succession, conception, scheme resolution, mood drift, rival actions, duels, global events) must produce identical outputs given identical seeds, call-counts, and inputs across save and load cycles.
- The conversation layer is explicitly excluded from this determinism contract and must not advance any random-number call-count.

### Compatibility

- Save data must be forward-migratable: every save version must load and migrate through additive transformations into the current version without manual intervention.
- Behavioral changes that break determinism for an existing save (changes to combat constants, scheme costs, etc.) must be gated behind a new save-data version so existing saves cannot accidentally interleave old and new behavior.

---

## 9. Lessons Learned (Anti-Patterns to Avoid)

These requirements are derived from hindsight analysis of the prior implementation. Each represents a structural concern that a new implementation should address from the start.

### Architectural Requirements

- The system must separate pure gameplay logic from runtime orchestration. Pure logic (combat math, economy classification, scheme resolution, duel resolution, marriage acceptance, succession resolution, mood transitions) belongs in a layer with no dependency on the runtime engine, event bus, UI, or filesystem. Runtime orchestrators wrap pure logic and own all side effects (event-bus publishing, UI mutation, persistence I/O). This separation must be enforced; pure logic must never publish events.
- The system must marshal asynchronous continuations back to the UI thread at exactly one boundary per round-trip, not one per side effect. Multiple per-side-effect main-thread hops produce subtle race conditions across consecutive mutations.
- The system must use one canonical clock counter for gameplay; multiple competing tick counters lead to drift between schemes, courier delivery, and aging.

### Coupling & Boundary Requirements

- Avoid string-based runtime node lookups from one piece of code into another. Inter-component access must use either typed dependency injection or a typed registry of references, not opaque path strings that fail silently when a component is renamed.
- Avoid letting a single "event bus" file accumulate dozens of events. Group events into topically partitioned definitions so that adding a new event in one domain does not require editing a 200-line god method.
- Avoid letting any single view file exceed a maintainable size. The top-level view (the strategy map and the ballroom) must decompose into orchestrators by responsibility: tick orchestration, location routing, tactic dispatch, scheme panel state, conversation flow. Each orchestrator must be independently testable.
- Avoid placing test fixture identifiers (named NPCs, named houses) in user-interface code. Centralize them in a fixture registry so a rename touches one location.

### Reliability Requirements

- Avoid sequential-fall-through migration blocks that depend on cumulative side effects. Express each save-data migration as a named, idempotent, pure-function transformation from version N to N+1; unit-test each transformation in isolation.
- Avoid integration-test harnesses that duplicate runtime-orchestrator logic. Extract shared transitions (marriage acceptance, succession resolution, character-death pruning) into pure-logic services that both the runtime orchestrator and the test harness call directly; do not let test code "mirror" production logic.
- The system must guard every asynchronous post-await UI mutation with a conjunction of (a) destination-element validity, (b) destination-element still in the active scene, and (c) view not in its exiting state. A single guard is insufficient.
- Pair every subscription to a process-lifetime event bus with an unsubscribe at view teardown. Establish this as a non-negotiable convention from day one because the failure mode (subscribers accumulating across scene reloads) is silent.

### Maintainability Requirements

- Avoid letting orchestrator code accumulate behind-the-scenes logic that is not unit-testable. Every behavior eligible for unit testing — including UI state machines, control-enable radii, prefill substitution — must be extracted from the runtime orchestrator into a pure-logic helper before the runtime orchestrator wires up.
- Avoid mixing runtime-state types and designer-configuration types. Designer-edited configuration (location deltas, scheme definitions, trait registries) must be a distinct data tier from runtime per-house mutable state; the two must never share a base type.
- Document the autoload (or equivalent global-component) initialization order explicitly. Implicit ordering by file position breeds fragile dependencies.
- Codify the boundaries of any non-deterministic subsystem inline in the subsystem's source. The line between deterministic and non-deterministic logic must be unambiguous to future readers, and any new code in the non-deterministic layer must not advance the deterministic random-number call-count.

---

## 10. Constraints & Assumptions

### Hard Constraints

- The game is single-player; no architecture for concurrent players is required.
- The game runs offline except when the conversation feature is in use; offline play must remain fully functional.
- All gameplay math (32 traits, 5 moods, 7 locations, 8 schemes, 4 tactics, 3 rival houses, 5 patronesses, 4 factions, 2 eras) is fixed by design and not user-extensible.
- The conversation feature is optional and must gracefully degrade in its absence.
- The remote-model service credential must never leave the player's machine except to the model service itself.

### Assumptions

- A typical campaign spans 50–150 in-game years (ticks).
- A typical campaign engages with 10–30 named non-player characters at peak.
- The player is expected to read text; the game makes no accessibility claims for screen-reader-only use in the initial release.
- The player has access to a modern desktop platform with several gigabytes of RAM and an internet connection if they wish to use the conversation feature.

### Open Questions

- Whether successive heirs should inherit the patronesses' favor scores or whether favor should reset on succession.
- Whether the rival-house registry should be procedurally seeded per-campaign or remain canonical (the prior implementation chose canonical).
- Whether the sibling-rival mechanic (slighted siblings becoming autonomous antagonists) should be active in v1 or deferred.
- Whether the family-archetype auto-classification should run at the two trigger points (succession + child maturation) only, or also recompute on mid-life trait acquisition.
- Whether the conversation layer should route more "key moments" (proposal, scheme completion, duel, monarch's audience) to the more capable model in the initial release, or limit such routing to first-meetings only.
- Whether the discovery-roll branch of Seduction should remain a one-shot binary or expand into a multi-tick suspicion mechanic.
- Whether the Treason-Framing scheme (artifact-dependent) should ship in v1 alongside the artifact registry or be deferred until artifacts have shipped first.
- Whether faction tension between three factions should be visualized graphically beyond the per-pair numeric counter exposed in the rival ledger.
- Whether the Social Web visualization should replace the textual family/affection ledgers in v1 or coexist with them.
- Whether the wardrobe seasonal-decay should use a global tick threshold or be per-artifact-family (some fashions age faster than others).
- Whether forged artifacts should be distinguishable from genuine ones by any non-player character with a specific trait (e.g., Observant) at a probability, or remain hidden until the per-tick surfacing roll fires.
- Whether the embedding-based semantic-memory subsystem should be active in v1 or deferred (the simpler recency-window approach is sufficient for the first release).
- Whether the LLM tool surface should expand beyond a single whisper-generation tool in v1, and if so which additional tools (recording grievances, sharing secrets between non-player characters, revealing hidden moods) earn their keep.
- Whether NPC-initiated conversations (the NPC speaks first when the player enters their orbit) belong in v1 or are deferred polish.
- Whether streaming dialogue (token-by-token rendering with mid-stream cancellation) is worth the implementation complexity in v1 versus the simpler single-shot "thinking…" pattern.
- Whether Cross-house marriages with rival-house non-player characters should be available in v1 (affecting rival hostility based on the alliance) or deferred to a later phase.
- Whether pre-adulthood betrothals (children of different houses pre-committed to a future marriage) belong in v1 or are deferred Regency-flavor polish.
- Whether character lifespans should be a fixed value or rolled per-character (e.g., uniform within a range or trait-modified) so siblings have varied lifespans.
- Whether the staff-espionage subsystem should ship in v1 (giving the player a dedicated whisper-generation lever beyond conversation synergy hits) or be deferred.
- Whether the three whisper-weaponization branches (Blackmail / Scandal Sheet / Accidental Slip) should ship simultaneously or be introduced one at a time.
- Whether the cultural-pivot Monarch's Mood mechanic should be active before the artifact registry ships (since without artifacts the cultural-pivot has no positive branch).
- Whether dynasty-legacy renown perks should be retroactively awarded to players whose pre-perk campaigns satisfy the trigger conditions, or only awarded going-forward.
- Whether the happiness drain from Dull-spouse marriages should unlock the discounted-Seduction temptation hook automatically on threshold crossing, or only when the player explicitly elects it from a ledger action.
