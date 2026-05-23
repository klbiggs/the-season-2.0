// In-memory entity shapes for Character / House / MarriageRecord. Separated
// from store.ts so the rule layer can import them without crossing the
// game-rules → game-store boundary (spec §8 forbids game-rules from depending
// on the store; entity TYPES don't carry that concern).
//
// The Zod schemas here describe the in-memory shape. The save-format schemas
// (in src/persist/schema.ts at SaveV2) reference these via type, but the
// save shape uses serialized Array<[Id, Entity]> tuples — bridged by
// serializeRegistry / deserializeRegistry.

import { z } from "zod";
import {
  COURIER_DIRECTIONS,
  COURIER_PAYLOAD_TYPES,
  COURIER_STATUSES,
  ELOPEMENT_FRESH_HORSES_MAX_USES,
  ELOPEMENT_TRACK_LENGTH,
  GRIEVANCE_SOURCES,
  SCHEME_FAILURE_REASONS,
  SCHEME_KINDS,
  SCHEME_STATUSES,
  SIBLING_RIVAL_HOSTILITY_MAX,
  STAFF_ASSIGNMENTS,
  WEAPONIZATION_BRANCHES,
  WHISPER_STATUSES,
} from "./constants";
import { ConversationPairKeySchema, ExchangeSchema } from "./conversation/types";
import { ArchetypeSchema } from "./fixtures/archetypes";
import { ARTIFACT_FAMILIES } from "./fixtures/artifacts";
import { LocationIdSchema } from "./fixtures/locations";
import { MoodSchema } from "./fixtures/moods";
import { RoleSchema } from "./fixtures/roles";
import {
  ArtifactInstanceIdSchema,
  BloodFeudIdSchema,
  CharacterIdSchema,
  CourierPayloadIdSchema,
  DuelIdSchema,
  FactionIdSchema,
  FactionPairKeySchema,
  ForgeryIdSchema,
  GlobalEventIdSchema,
  GrievanceIdSchema,
  HouseIdSchema,
  InheritedSecretIdSchema,
  MarriageIdSchema,
  PatronessIdSchema,
  RngStateSchema,
  SchemeIdSchema,
  SiblingRivalActorIdSchema,
  StaffIdSchema,
  ThiefAttemptIdSchema,
  TraitIdSchema,
  WhisperIdSchema,
} from "./rng";

// P5: Grievance entity. Stored on House.grievances array (the house is the
// VICTIM; the perpetrator is referenced by perpetratorHouseId). Spec §4
// line 541 ("social grievances") + §3 line 122 (Sabotage + public faux-pas
// record formal grievances). Insertion order is hash-relevant via
// serializeRegistry's Map-key-only sort — `grievances` arrays serialize
// in-place; UI render-time sort by GrievanceId is a separate concern.
//
// P8: `defendantCharacterId` added as NULLABLE — legacy V5-V8 grievances are
// all player-perpetrated and not actionable via demandSatisfaction (player
// can't sensibly duel themselves), so the V8→V9 migration backfills `null`.
// New post-P8 grievances created by rival-owned schemes set this to the
// rival's aggressor character — those ARE the v1 duel loop.
export const GrievanceSchema = z.object({
  id: GrievanceIdSchema,
  perpetratorHouseId: HouseIdSchema,
  // P8: nullable + default(null) — legacy V5-V8 grievances on disk lack this
  // field; the .default(null) backfill lets SaveV{N}Schema.parse accept legacy
  // saves without a strip cascade rebuild. Legacy grievances default to null
  // (LegacyGrievanceUnactionable — player can't duel themselves). New post-P8
  // grievances set this explicitly to the perpetrator's aggressor character.
  defendantCharacterId: CharacterIdSchema.nullable().default(null),
  source: z.enum(GRIEVANCE_SOURCES),
  schemeId: SchemeIdSchema.nullable(), // non-null when source === "Sabotage"
  recordedAtTick: z.number().int().nonnegative(),
  resolved: z.boolean(), // P8 ships duel resolution that flips this
});
export type Grievance = z.infer<typeof GrievanceSchema>;

// P11: SiblingRivalState — per-promoted-sibling autonomous actor state. Stored
// on House.siblingRivals array (only the player house owns sibling-rivals at v1
// per spec §3 line 217 "internal antagonist within the dynasty").
export const SiblingRivalStateSchema = z.object({
  id: SiblingRivalActorIdSchema,
  characterId: CharacterIdSchema,
  hostility: z.number().int().min(0).max(SIBLING_RIVAL_HOSTILITY_MAX),
  lastActionTick: z.number().int().nonnegative(),
  reconciled: z.boolean(),
  promotedAtTick: z.number().int().nonnegative(),
});
export type SiblingRivalState = z.infer<typeof SiblingRivalStateSchema>;

// P11: InheritedSecret — multi-generation ledger entry on the player house.
// Accumulated at succession from verified+weaponized whispers about the player
// house. Surfaced per-tick via INHERITED_SECRET_SURFACING_PROBABILITY_BASIS_POINTS
// roll. surfacedAgainstHouseId is a ONE-WAY LATCH.
export const InheritedSecretSchema = z.object({
  id: InheritedSecretIdSchema,
  sourceWhisperId: WhisperIdSchema,
  description: z.string(),
  originatingGenerationCount: z.number().int().nonnegative(),
  originatingTick: z.number().int().nonnegative(),
  surfacedAgainstHouseId: HouseIdSchema.nullable(),
  surfacedAtTick: z.number().int().nonnegative().nullable(),
});
export type InheritedSecret = z.infer<typeof InheritedSecretSchema>;

// P11: BloodFeud — active feud minted on inherited-secret surfacing. Each
// surfacing creates ONE BloodFeud + ONE Grievance with source="BloodFeud" on
// the player house (linked via triggeringGrievanceId FK). Resolves via duel
// resolution (covers satisfaction-demanded duel-mint path) OR generational decay
// at BLOOD_FEUD_DECAY_TICKS_MAX ticks after incurredAtTick.
export const BloodFeudSchema = z.object({
  id: BloodFeudIdSchema,
  offendingHouseId: HouseIdSchema,
  triggeringSecretId: InheritedSecretIdSchema,
  triggeringGrievanceId: GrievanceIdSchema,
  incurredAtTick: z.number().int().nonnegative(),
  resolved: z.boolean(),
  resolvedAtTick: z.number().int().nonnegative().nullable(),
  resolutionKind: z.enum(["DuelWin", "DuelLoss", "GenerationalDecay"]).nullable(),
});
export type BloodFeud = z.infer<typeof BloodFeudSchema>;

export const HouseSchema = z.object({
  id: HouseIdSchema,
  wealth: z.number(),
  reputation: z.number().int().min(0).max(100),
  scandal: z.number().int().min(0).max(100),
  headOfHouseCharacterId: CharacterIdSchema,
  generation: z.number().int().nonnegative(),
  ancestorSummary: z.array(z.string()),
  heirless: z.boolean(),
  // P3 additions:
  currentLocation: LocationIdSchema,
  consecutiveTicksAtCurrentLocation: z.number().int().nonnegative(),
  lastAudienceTick: z.number().int().nullable(),
  wardrobeLastRefreshTick: z.number().int().nullable(),
  blockadeBypassEarned: z.boolean(),
  // P5 addition: list of grievances this house HOLDS against others (the
  // house is the VICTIM, perpetrator referenced by perpetratorHouseId).
  // Hash-relevant in insertion order; never reorder on save.
  grievances: z.array(GrievanceSchema),
  // P6 addition: terminal-state flag set by the Scandal Sheet attribution
  // endgame (spec §3 line 462). Default false on fresh state and every
  // legacy lift. When true, the campaign is "out of bounds" — the rule-layer
  // exile gate rejects all player-elected mutation actions.
  exiled: z.boolean(),
  // P8 additions: hostility (0 on player + Independent; load-bearing only on
  // rival entries — the RIVAL_HOSTILITY_ACTIVATION_THRESHOLD predicate reads
  // this field; player-action hostility deltas like PLAYER_SABOTAGE_HOSTILITY_DELTA
  // target rival entries only). factionId (every house carries a faction;
  // player + Independent default "faction-crown"; rivals per RIVAL_HOUSES_FIXTURE).
  // Both use `.default()` so legacy V6/V7/V8 saves missing these fields parse
  // cleanly with backfilled defaults — avoids a full Pre-shape strip cascade
  // rebuild while preserving forward-compatibility.
  hostility: z.number().int().min(0).max(100).default(0),
  factionId: FactionIdSchema.default("faction-crown" as import("./rng").FactionId),
  // P11 additions: three new per-house array fields. Player house owns all three;
  // non-player houses default to empty (sibling-rivals only promote within the
  // player dynasty; inherited-secrets ledger + blood-feuds attach to the player
  // house per spec §4 line 541). All three use `.default([])` so legacy V1-V11
  // saves missing these fields parse cleanly (P8 backward-compat shortcut).
  siblingRivals: z.array(SiblingRivalStateSchema).default([]),
  inheritedSecrets: z.array(InheritedSecretSchema).default([]),
  bloodFeuds: z.array(BloodFeudSchema).default([]),
  // P13 addition: Later-era research-action one-shot latch. Set true by
  // researchFastCouriers store action (free action; wealth-costed; gated on
  // era === "Later"). When true, transitTicks halves outbound courier transit
  // for couriers ORIGINATING from this house (in-flight couriers retain their
  // absolute arrivalTick per CLAUDE.md non-negotiable §2). `.default(false)`
  // parses legacy SaveV1-V12 HouseSchema payloads cleanly (P8/P9 backward-
  // compat shortcut precedent).
  courierResearchEarned: z.boolean().default(false),
});
export type House = z.infer<typeof HouseSchema>;

export const CharacterSchema = z.object({
  id: CharacterIdSchema,
  houseId: HouseIdSchema,
  name: z.string(),
  // birthTick is z.number().int() WITHOUT .nonnegative() — synthetic test
  // fixtures construct mid-life states with negative birthTick.
  birthTick: z.number().int(),
  age: z.number().int().nonnegative(),
  deathAge: z.number().int().min(70).max(95),
  alive: z.boolean(),
  diedAtTick: z.number().int().nullable(),
  mood: MoodSchema,
  moodLockUntilTick: z.number().int().nonnegative(),
  role: RoleSchema,
  archetype: ArchetypeSchema,
  traits: z.array(TraitIdSchema),
  marriageId: MarriageIdSchema.nullable(),
  // P4 additions: per-character composure. Clamped [0, maxComposure] at
  // every mutation site (CLAUDE.md non-negotiable §6). Defaults to 100;
  // maxComposure is reserved as a per-character ceiling (later phases
  // may grant trait-based bumps).
  composure: z.number().int(),
  maxComposure: z.number().int().positive(),
  // P7 additions. All clamps re-applied at mutation sites per CLAUDE.md.
  // happiness: spec §3 line 467-469. Drains -1/tick on Dull-spouse exposure;
  // crosses HAPPINESS_TEMPTATION_THRESHOLD to flip temptationHookUnlocked.
  happiness: z.number().int().min(0).max(100),
  // One-way latch (§10 Q23). Flips false → true at first sub-threshold tick
  // post-Dull-marriage; never reverts.
  temptationHookUnlocked: z.boolean(),
  // Set by assignTutor; cleared via pruneOrphanedConversationKeys on tutor
  // death. Locked at maturation (assignTutor rejects ChildAlreadyAdult).
  assignedTutorCharacterId: CharacterIdSchema.nullable(),
  // Flips once at child maturation when player chooses one of the archetype
  // pool's 2 traits via chooseTutorBonusTrait.
  tutorBonusTraitGranted: z.boolean(),
  // Tick at which this character entered a Dull-trait spouse marriage.
  // Nulled on Dull-spouse death by the orphan-prune cascade.
  dullSpouseExposureStartTick: z.number().int().nonnegative().nullable(),
  // Lex-sorted [spouseA, spouseB] pair at conception. null for baseline NPCs
  // + player character (pre-history parents).
  parentCharacterIds: z.tuple([CharacterIdSchema, CharacterIdSchema]).nullable(),
  // Required by the classifier (Spinster + Bohemian branches gate on gender).
  // Bootstrap path derives via hashCharIdToGender(id) — single source of truth
  // with the legacy-lift path so v1→v8 chain hash parity holds.
  gender: z.enum(["Female", "Male"]),
  // P10 addition. Per-character equipment list. Order is hash-relevant (the
  // array is preserved as-is on serialization; mid-equip rearrangement
  // advances the hash). Equip is a strict subset of own: every entry must
  // resolve to a state.artifactInstances entry whose ownerCharacterId === this
  // character.id. Default `[]` via Zod backfill so legacy V1-V10 characters
  // parse cleanly without a Pre-shape rebuild (P8 precedent).
  equippedArtifactIds: z.array(ArtifactInstanceIdSchema).default([]),
});
export type Character = z.infer<typeof CharacterSchema>;

// P7 entities — ledger/log entries for proposals, tutor assignments, and
// pending tutor-trait choices. All three ride as top-level GameState Maps
// (not inline character fields) so the diff helpers can walk them cleanly.
export const ProposalLogEntrySchema = z.object({
  outcome: z.enum(["Accepted", "Rejected"]),
  tick: z.number().int().nonnegative(),
  // The proposer (always player head at P7; P8 widens when rivals propose).
  byCharacterId: CharacterIdSchema,
});
export type ProposalLogEntry = z.infer<typeof ProposalLogEntrySchema>;

export const TutorAssignmentLogEntrySchema = z.object({
  tutorCharacterId: CharacterIdSchema,
  assignedAtTick: z.number().int().nonnegative(),
  // 0 on first assignment; +1 per reassignment. Gates the wealth-cost
  // predicate in assignTutor (first assignment is free).
  reassignmentCount: z.number().int().nonnegative(),
});
export type TutorAssignmentLogEntry = z.infer<typeof TutorAssignmentLogEntrySchema>;

export const PendingTutorTraitChoiceSchema = z.object({
  childId: CharacterIdSchema,
  tutorId: CharacterIdSchema,
  // Narrowed to non-None archetypes — maturation only creates pending choices
  // when pool !== null (None archetype maps to null per
  // ARCHETYPE_MATURATION_TRAIT_POOL); a hand-corrupted save with
  // archetype: "None" would parse against the bare ArchetypeSchema but then
  // crash at choose-trait time. The narrowed schema rejects the corruption
  // at parse time.
  archetype: z.enum(["Spymaster", "BohemianRake", "Tutor", "CountryExile"]),
  // Exact 2-tuple per ARCHETYPE_MATURATION_TRAIT_POOL. Snapshot captured at
  // maturation tick; later resolved by chooseTutorBonusTrait validating
  // chosenTraitId ∈ acceptableTraitIds.
  acceptableTraitIds: z.tuple([TraitIdSchema, TraitIdSchema]),
  createdAtTick: z.number().int().nonnegative(),
});
export type PendingTutorTraitChoice = z.infer<typeof PendingTutorTraitChoiceSchema>;

export const MarriageRecordSchema = z.object({
  id: MarriageIdSchema,
  spouseAId: CharacterIdSchema, // lex-smaller of the two at marriage creation
  spouseBId: CharacterIdSchema, // lex-larger of the two at marriage creation
  marriedAtTick: z.number().int().nonnegative(),
  dissolved: z.boolean(),
  dissolvedAtTick: z.number().int().nullable(),
  // P9 addition: true ONLY when the marriage was minted by an elopement win
  // (spec §4 line 546). Legacy V1-V9 marriages default to false via the Zod
  // `.default(false)` parse-side backfill — no Pre-shape rebuild required.
  // Emit-side strip helper drops the field for toSaveV1..V9 round-trip
  // byte-identity parity.
  viaElopement: z.boolean().default(false),
});
export type MarriageRecord = z.infer<typeof MarriageRecordSchema>;

// P5: Scheme entity. Spec §4 line 543 + §6 line 567 — references BOTH the
// aggressor character AND the aggressor's owning house. accumulatedAffection
// is hash-relevant but dead data at v1 (one-shot discovery per OQ #6
// resolution); reserved for v1.5 multi-tick suspicion mechanic.
// failureReason is the diff-helper's discriminator for Seduction's two
// Failed paths (Discovered vs TargetDied).
export const SchemeSchema = z.object({
  id: SchemeIdSchema,
  kind: z.enum(SCHEME_KINDS),
  ownerHouseId: HouseIdSchema, // aggressor's house — owns the scheme (§6 line 567)
  aggressorCharacterId: CharacterIdSchema, // §4 line 543 + §6 line 567
  targetCharacterId: CharacterIdSchema.nullable(), // null for Smuggling only
  startedAtTick: z.number().int().nonnegative(),
  endsAtTick: z.number().int().nonnegative(), // ABSOLUTE end-tick (CLAUDE.md §2)
  status: z.enum(SCHEME_STATUSES),
  resolvedAtTick: z.number().int().nonnegative().nullable(),
  failureReason: z.enum(SCHEME_FAILURE_REASONS).nullable(),
  accumulatedAffection: z.number().int().nonnegative(), // v1: always 0; v1.5 future-suspicion
});
export type Scheme = z.infer<typeof SchemeSchema>;

// P6: Whisper entity. Spec §4 line 542. `status` is the canonical state
// machine; `weaponizedAs` discriminates which weaponization branch the
// player chose; `scandalSheetAttribution` is the attribution-roll outcome
// (null until weaponized as ScandalSheet); `accidentalSlipDripsRemaining`
// is the per-conversation drip counter (0 unless weaponized as
// AccidentalSlip). `llmGenerated` distinguishes deterministic synergy
// whispers from LLM-additive whispers — hash-relevant for replay debug.
export const WhisperSchema = z.object({
  id: WhisperIdSchema,
  text: z.string(),
  originatingTick: z.number().int().nonnegative(),
  sourceCharacterId: CharacterIdSchema,
  subjectCharacterId: CharacterIdSchema,
  destinationHouseId: HouseIdSchema,
  arrivedAtTick: z.number().int().nonnegative().nullable(),
  verificationProgress: z.number().int().min(0).max(100),
  status: z.enum(WHISPER_STATUSES),
  weaponizedAs: z.enum(WEAPONIZATION_BRANCHES).nullable(),
  weaponizedAtTick: z.number().int().nonnegative().nullable(),
  scandalSheetAttribution: z.boolean().nullable(),
  accidentalSlipDripsRemaining: z.number().int().min(0),
  llmGenerated: z.boolean(),
});
export type Whisper = z.infer<typeof WhisperSchema>;

// P6: CourierPayload entity. Spec §4 line 545. `whisperId` is REQUIRED at
// v1 (only "Whisper" payloadType ships); `direction` is stored explicitly
// so P8 multi-house routing can filter without deriving; `interceptable`
// gates the Spymaster + InterceptMail filter. `arrivalTick` is absolute
// per CLAUDE.md non-negotiable #2.
export const CourierPayloadSchema = z.object({
  id: CourierPayloadIdSchema,
  payloadType: z.enum(COURIER_PAYLOAD_TYPES),
  whisperId: WhisperIdSchema,
  originHouseId: HouseIdSchema,
  destinationHouseId: HouseIdSchema,
  originLocation: LocationIdSchema,
  destinationLocation: LocationIdSchema,
  originTick: z.number().int().nonnegative(),
  arrivalTick: z.number().int().nonnegative(),
  interceptable: z.boolean(),
  direction: z.enum(COURIER_DIRECTIONS),
  status: z.enum(COURIER_STATUSES),
  resolvedAtTick: z.number().int().nonnegative().nullable(),
});
export type CourierPayload = z.infer<typeof CourierPayloadSchema>;

// P6: StaffMember entity. Spec §4 line 558. Staff are a separate entity type
// from Character — no mood, no traits array, no aging. `isGreedy` is the
// only trait that matters at v1 (bribery-risk multiplier per spec §3 line
// 204). `lastOutputTick: null` means "never produced"; set to state.tick
// after first cadence fire OR first reassignment.
export const StaffMemberSchema = z.object({
  id: StaffIdSchema,
  houseId: HouseIdSchema,
  name: z.string(),
  isGreedy: z.boolean(),
  loyalty: z.number().int().min(0).max(100),
  upkeepPerTick: z.number().int().positive(),
  assignment: z.enum(STAFF_ASSIGNMENTS),
  lastOutputTick: z.number().int().nullable(),
  bribedAtTick: z.number().int().nonnegative().nullable(),
});
export type StaffMember = z.infer<typeof StaffMemberSchema>;

// P8: PatronessRecord entity. Spec §3 line 113 + §4 line 548. 5 canonical
// patronesses seeded via PATRONESSES_FIXTURE; favor [0, 100] starting 50;
// affiliated with one of the 3 non-Crown factions.
export const PatronessRecordSchema = z.object({
  id: PatronessIdSchema,
  displayName: z.string(),
  favor: z.number().int().min(0).max(100),
  factionId: FactionIdSchema,
});
export type PatronessRecord = z.infer<typeof PatronessRecordSchema>;

// P8: RivalActorState entity. Sibling Map to state.houses — the rival's House
// entity lives in state.houses keyed by the same HouseId; this carries ONLY
// the per-rival action-loop state (associated character ids, cooldown gate).
// `lastActionTick: null` means never-acted; the cooldown predicate passes
// immediately on first eligibility.
export const RivalActorStateSchema = z.object({
  houseId: HouseIdSchema,
  factionId: FactionIdSchema,
  associatedCharacterIds: z.array(CharacterIdSchema),
  lastActionTick: z.number().int().nullable(),
});
export type RivalActorState = z.infer<typeof RivalActorStateSchema>;

// P8: Duel entity. Spec §3 lines 364-370. Status is just Active|Resolved (the
// outcome field discriminates resolved duels). loserCasualty is REQUIRED (not
// nullable) — defaults to "Unharmed" at creation; flipped to "Killed" /
// "Wounded" on decisive resolve; stays "Unharmed" on Stalemate.
export const DUEL_STATUSES = ["Active", "Resolved"] as const;
export const DUEL_OUTCOMES = ["ChallengerVictory", "DefenderVictory", "Stalemate"] as const;
export const DUEL_CASUALTIES = ["Killed", "Wounded", "Unharmed"] as const;
export type DuelOutcome = (typeof DUEL_OUTCOMES)[number];
export type DuelCasualty = (typeof DUEL_CASUALTIES)[number];

export const DuelSchema = z.object({
  id: DuelIdSchema,
  challengerCharacterId: CharacterIdSchema,
  defenderCharacterId: CharacterIdSchema,
  grievanceId: GrievanceIdSchema,
  initiatedAtTick: z.number().int().nonnegative(),
  status: z.enum(DUEL_STATUSES),
  resolvedAtTick: z.number().int().nonnegative().nullable(),
  outcome: z.enum(DUEL_OUTCOMES).nullable(),
  loserCasualty: z.enum(DUEL_CASUALTIES),
  exchangesElapsed: z.number().int().min(0).max(12),
});
export type Duel = z.infer<typeof DuelSchema>;

// P9: ElopementSprintState entity. Spec §4 line 551. Singleton (NOT a Map)
// hosted on GameState.elopement (nullable). The Q2 verdict's per-aggressor
// `tryStartScheme` gate makes concurrent sprints unreachable; the singleton
// matches the spec's "overlay route" framing. Numeric bounds reference the
// canonical constants from constants.ts; entities.ts already imports at
// runtime so no module-load cycle exists.
export const ElopementSprintStateSchema = z.object({
  // The originating Seduction whose Discovered branch launched this sprint.
  schemeId: SchemeIdSchema,
  elopingCharacterId: CharacterIdSchema, // = source scheme's aggressorCharacterId
  targetCharacterId: CharacterIdSchema, // = source scheme's targetCharacterId
  playerTilePosition: z.number().int().min(0).max(ELOPEMENT_TRACK_LENGTH),
  fatherTilePosition: z.number().int().min(0).max(ELOPEMENT_TRACK_LENGTH),
  freshHorsesUsedCount: z.number().int().min(0).max(ELOPEMENT_FRESH_HORSES_MAX_USES),
  // Provenance anchor for the P14 ledger (sprint duration display); never
  // read by resolution logic (tile positions drive outcome). Hash-relevant
  // so mid-sprint save/load reproduces exactly.
  startedAtTick: z.number().int().nonnegative(),
});
export type ElopementSprintState = z.infer<typeof ElopementSprintStateSchema>;

// P10 entities — per-instance artifact, forgery record, thief attempt. All
// three live as top-level GameState Maps; definitions for ArtifactInstance
// reference ARTIFACT_REGISTRY (fixture, NOT in state) via definitionId.

// Per-instance artifact entity. The instance carries the wardrobe-decay
// clock (per-instance, NOT per-house) so a refresh resets every equipped
// instance and an unequipped instance's clock stays frozen.
export const ArtifactInstanceSchema = z.object({
  id: ArtifactInstanceIdSchema,
  definitionId: z.string(), // FK into ARTIFACT_REGISTRY
  ownerHouseId: HouseIdSchema,
  ownerCharacterId: CharacterIdSchema,
  lastRefreshTick: z.number().int().nonnegative(),
  forgedFlag: z.boolean(), // true ⇔ a ForgeryRecord references this instance
});
export type ArtifactInstance = z.infer<typeof ArtifactInstanceSchema>;

// Per spec §4 line 554. ONE-WAY LATCH on `surfaced` (false → true). Dual
// entry-point: surfacing roll (`applyForgerySurfacingPhase`) AND Treason
// Framing consumption (`applySchemeResolutionPhase`).
export const ForgeryRecordSchema = z.object({
  id: ForgeryIdSchema,
  forgedArtifactInstanceId: ArtifactInstanceIdSchema,
  forgerCharacterId: CharacterIdSchema, // spec §3 line 180 — recorded at commission
  forgedAtTick: z.number().int().nonnegative(),
  surfaced: z.boolean(),
  surfacedAtTick: z.number().int().nullable(),
});
export type ForgeryRecord = z.infer<typeof ForgeryRecordSchema>;

// Per spec §4 line 555. Carries in-flight AND historical entries; status
// is encoded by `thwarted: boolean | null` (null = in-flight, awaiting
// thwart decision; true|false = resolved).
export const ThiefAttemptSchema = z.object({
  id: ThiefAttemptIdSchema,
  targetedArtifactInstanceId: ArtifactInstanceIdSchema,
  ownerCharacterId: CharacterIdSchema, // owner at notice-time
  noticedAtTick: z.number().int().nonnegative(),
  thwarted: z.boolean().nullable(),
  resolvedAtTick: z.number().int().nullable(),
});
export type ThiefAttempt = z.infer<typeof ThiefAttemptSchema>;

// P13: GlobalEvent discriminated union. Per spec §3 line 392, every active
// event carries its absolute start and end ticks so save/load preserves
// lifecycle. MonarchsMood uniquely carries the cultural-pivot favored-family
// rolled at start (per spec line 391, "at start, a 'favored culture' (one of
// a small fixed set) is rolled"). The "small fixed set" maps to
// ARTIFACT_FAMILIES directly (user-resolved P13 design decision; see plan).
export const GlobalEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("WarEffort"),
    id: GlobalEventIdSchema,
    startTick: z.number().int().nonnegative(),
    endTick: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("MarketCrash"),
    id: GlobalEventIdSchema,
    startTick: z.number().int().nonnegative(),
    endTick: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("MonarchsMood"),
    id: GlobalEventIdSchema,
    startTick: z.number().int().nonnegative(),
    endTick: z.number().int().nonnegative(),
    favoredFamily: z.enum(ARTIFACT_FAMILIES),
  }),
]);
export type GlobalEvent = z.infer<typeof GlobalEventSchema>;

// GameState lives here (not in store.ts) so the rule layer can import it.
// store.ts re-exports GameState/GameStateSchema for P0-era callers.
//
// In-memory uses `z.map(...)`; the save-format schema (SaveV2) uses
// `z.array(z.tuple(...))`. The two forms are bridged by serializeRegistry /
// deserializeRegistry. Never copy the array shape into GameStateSchema.
export const GameStateSchema = z.object({
  tick: z.number().int().nonnegative(),
  rng: z.map(HouseIdSchema, RngStateSchema),
  houses: z.map(HouseIdSchema, HouseSchema),
  characters: z.map(CharacterIdSchema, CharacterSchema),
  marriages: z.map(MarriageIdSchema, MarriageRecordSchema),
  campaignName: z.string(),
  // P3: read-only at this phase, hard-locked to "Earlier". P13 ships the
  // transition mechanism.
  era: z.enum(["Earlier", "Later"]),
  // P4 additions: conversation history + affection map, both keyed on
  // ConversationPairKey = `${HouseId}|${CharacterId}`. Shared key shape
  // lets the orphan-prune cascade in aging.ts walk both collections in
  // a single filter pass on NPC death.
  conversationHistory: z.map(ConversationPairKeySchema, z.array(ExchangeSchema)),
  affectionMap: z.map(ConversationPairKeySchema, z.number().int().min(0).max(100)),
  // P5: scheme registry. In-memory `z.map(K, V)` so rules can call
  // `state.schemes.get(schemeId)`; save-format `SaveV6Schema` uses
  // `z.array(z.tuple([SchemeIdSchema, SchemeSchema]))`; bridged by
  // serializeRegistry / deserializeRegistry. Grievances ride INSIDE
  // House.grievances — NEVER top-level (the schema↔projection↔selector
  // trip-wire only enforces top-level key equality; a misguided top-level
  // state.grievances addition wouldn't be caught).
  schemes: z.map(SchemeIdSchema, SchemeSchema),
  // P6: whisper / courier / staff registries. Same in-memory z.map / save-
  // format z.array(z.tuple) bridge as schemes. Whispers and couriers grow
  // monotonically across a campaign (never deleted; status flips only).
  // Staff seeded at campaign start (4 baseline members) and durable for
  // the campaign's lifetime; no runtime hire affordance at v1.
  whispers: z.map(WhisperIdSchema, WhisperSchema),
  couriers: z.map(CourierPayloadIdSchema, CourierPayloadSchema),
  staff: z.map(StaffIdSchema, StaffMemberSchema),
  // P7 additions — three new top-level Maps scoped per-character. All three
  // hit the schema↔projection↔selector↔overwriteFromGameState quad-sync
  // surfaces (CLAUDE.md non-negotiable): GameStateSchema (here), hashableState
  // (hash.ts), selectGameState (store.ts), overwriteFromGameState (store.ts).
  // Forgetting any surface silently breaks hash parity, save round-trip, or
  // tick-advancing mutation persistence.
  proposalsLog: z.map(CharacterIdSchema, ProposalLogEntrySchema),
  tutorAssignmentsLog: z.map(CharacterIdSchema, TutorAssignmentLogEntrySchema),
  pendingTutorTraitChoices: z.map(CharacterIdSchema, PendingTutorTraitChoiceSchema),
  // P8 additions — four new top-level Maps. All hit the
  // schema↔projection↔selector↔overwriteFromGameState quad-sync surfaces
  // (CLAUDE.md non-negotiable). Forgetting any surface silently breaks hash
  // parity, save round-trip, or tick-advancing mutation persistence.
  // patronesses: 5 canonical patronesses with favor scores.
  // rivalActors: 3 rival action-loop states (sibling Map to state.houses).
  // factionTensions: 6 pairwise tension counters (4 factions choose 2).
  // duels: every duel ever resolved (never deleted, status flips only).
  patronesses: z.map(PatronessIdSchema, PatronessRecordSchema),
  rivalActors: z.map(HouseIdSchema, RivalActorStateSchema),
  factionTensions: z.map(FactionPairKeySchema, z.number().int().min(0).max(100)),
  duels: z.map(DuelIdSchema, DuelSchema),
  // P9 addition — nullable singleton holding the active elopement sprint, or
  // null when no sprint is in flight. Hits the quint-sync surfaces (CLAUDE.md
  // non-negotiable + the 5th surface createInitialState in store.ts). The Q2
  // verdict's per-aggressor `tryStartScheme` gate makes concurrent sprints
  // unreachable; the singleton matches the spec's overlay-route framing.
  // Hash-relevant when non-null (mid-sprint save/load reproduces tile state).
  elopement: ElopementSprintStateSchema.nullable(),
  // P10 additions — three new top-level Maps. All hit the quint-sync surfaces
  // (CLAUDE.md non-negotiable: schema/hashableState/selectGameState/
  // overwriteFromGameState + createInitialState). Player-only ownership at v1
  // (rivals don't equip artifacts; see "Rival participation gate" in plan).
  artifactInstances: z.map(ArtifactInstanceIdSchema, ArtifactInstanceSchema),
  forgeries: z.map(ForgeryIdSchema, ForgeryRecordSchema),
  thiefAttempts: z.map(ThiefAttemptIdSchema, ThiefAttemptSchema),
});
export type GameState = z.infer<typeof GameStateSchema>;
