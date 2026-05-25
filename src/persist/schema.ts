import { z } from "zod";
import { bootstrapNpcMountFamily } from "../game/bootstrap";
import { ConversationPairKeySchema, ExchangeSchema } from "../game/conversation/types";
import {
  ArtifactInstanceSchema,
  CharacterSchema,
  CourierPayloadSchema,
  DuelSchema,
  ElopementSprintStateSchema,
  FlavorContentEntrySchema,
  ForgeryRecordSchema,
  type GameState,
  GlobalEventSchema,
  type Grievance,
  HouseSchema,
  MarriageRecordSchema,
  PatronessRecordSchema,
  PendingTutorTraitChoiceSchema,
  ProposalLogEntrySchema,
  RivalActorStateSchema,
  SchemeSchema,
  StaffMemberSchema,
  ThiefAttemptSchema,
  TutorAssignmentLogEntrySchema,
  WhisperSchema,
} from "../game/entities";
import {
  ArtifactInstanceIdSchema,
  CharacterIdSchema,
  CourierPayloadIdSchema,
  DuelIdSchema,
  FactionPairKeySchema,
  FlavorContentIdSchema,
  ForgeryIdSchema,
  GlobalEventIdSchema,
  HouseIdSchema,
  MarriageIdSchema,
  PatronessIdSchema,
  RngStateSchema,
  SchemeIdSchema,
  StaffIdSchema,
  ThiefAttemptIdSchema,
  WhisperIdSchema,
  deserializeRegistry,
  serializeRegistry,
} from "../game/rng";

// Live save-format version. P19 (pre-v1.0 ship) deleted the v1→v16 migration
// ladder and rebased the single live schema to version 1 — the future
// post-ship migration ladder restarts from here. The migration discipline
// (named/pure/idempotent functions, named outputSchemas, per-migration
// idempotence tests) stays documented in CLAUDE.md §4 for the next ladder.
export const SAVE_VERSION_CURRENT = 1 as const;

export const SaveV1Schema = z.object({
  version: z.literal(1),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
  houses: z.array(z.tuple([HouseIdSchema, HouseSchema])),
  characters: z.array(z.tuple([CharacterIdSchema, CharacterSchema])),
  marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
  campaignName: z.string(),
  era: z.enum(["Earlier", "Later"]),
  conversationHistory: z.array(z.tuple([ConversationPairKeySchema, z.array(ExchangeSchema)])),
  affectionMap: z.array(z.tuple([ConversationPairKeySchema, z.number().int().min(0).max(100)])),
  schemes: z.array(z.tuple([SchemeIdSchema, SchemeSchema])),
  whispers: z.array(z.tuple([WhisperIdSchema, WhisperSchema])),
  couriers: z.array(z.tuple([CourierPayloadIdSchema, CourierPayloadSchema])),
  staff: z.array(z.tuple([StaffIdSchema, StaffMemberSchema])),
  proposalsLog: z.array(z.tuple([CharacterIdSchema, ProposalLogEntrySchema])),
  tutorAssignmentsLog: z.array(z.tuple([CharacterIdSchema, TutorAssignmentLogEntrySchema])),
  pendingTutorTraitChoices: z.array(z.tuple([CharacterIdSchema, PendingTutorTraitChoiceSchema])),
  patronesses: z.array(z.tuple([PatronessIdSchema, PatronessRecordSchema])),
  rivalActors: z.array(z.tuple([HouseIdSchema, RivalActorStateSchema])),
  factionTensions: z.array(z.tuple([FactionPairKeySchema, z.number().int().min(0).max(100)])),
  duels: z.array(z.tuple([DuelIdSchema, DuelSchema])),
  elopement: ElopementSprintStateSchema.nullable(),
  artifactInstances: z.array(z.tuple([ArtifactInstanceIdSchema, ArtifactInstanceSchema])),
  forgeries: z.array(z.tuple([ForgeryIdSchema, ForgeryRecordSchema])),
  thiefAttempts: z.array(z.tuple([ThiefAttemptIdSchema, ThiefAttemptSchema])),
  globalEvents: z.array(z.tuple([GlobalEventIdSchema, GlobalEventSchema])),
  flavorText: z.array(z.tuple([FlavorContentIdSchema, FlavorContentEntrySchema])),
});
export type SaveV1 = z.infer<typeof SaveV1Schema>;

// Live emitter. flavorText serializes directly via serializeRegistry
// (lex-sorted by FlavorContentId), same home as conversationHistory.
export function toSaveV1(state: GameState): SaveV1 {
  return SaveV1Schema.parse({
    version: SAVE_VERSION_CURRENT,
    tick: state.tick,
    rng: serializeRegistry(state.rng),
    houses: serializeRegistry(state.houses),
    characters: serializeRegistry(state.characters),
    marriages: serializeRegistry(state.marriages),
    campaignName: state.campaignName,
    era: state.era,
    conversationHistory: serializeRegistry(state.conversationHistory),
    affectionMap: serializeRegistry(state.affectionMap),
    schemes: serializeRegistry(state.schemes),
    whispers: serializeRegistry(state.whispers),
    couriers: serializeRegistry(state.couriers),
    staff: serializeRegistry(state.staff),
    proposalsLog: serializeRegistry(state.proposalsLog),
    tutorAssignmentsLog: serializeRegistry(state.tutorAssignmentsLog),
    pendingTutorTraitChoices: serializeRegistry(state.pendingTutorTraitChoices),
    patronesses: serializeRegistry(state.patronesses),
    rivalActors: serializeRegistry(state.rivalActors),
    factionTensions: serializeRegistry(state.factionTensions),
    duels: serializeRegistry(state.duels),
    elopement: state.elopement,
    artifactInstances: serializeRegistry(state.artifactInstances),
    forgeries: serializeRegistry(state.forgeries),
    thiefAttempts: serializeRegistry(state.thiefAttempts),
    globalEvents: serializeRegistry(state.globalEvents),
    flavorText: serializeRegistry(state.flavorText),
  });
}

// Bare lifter — pure deserialization, NO NPC-mount seeding. The live loader
// fromSaveV1 composes this with the idempotent mount step.
export function fromSaveV1Bare(save: SaveV1): GameState {
  return {
    tick: save.tick,
    rng: deserializeRegistry(save.rng) as GameState["rng"],
    houses: deserializeRegistry(save.houses) as GameState["houses"],
    characters: deserializeRegistry(save.characters) as GameState["characters"],
    marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
    campaignName: save.campaignName,
    era: save.era,
    conversationHistory: deserializeRegistry(
      save.conversationHistory,
    ) as GameState["conversationHistory"],
    affectionMap: deserializeRegistry(save.affectionMap) as GameState["affectionMap"],
    schemes: deserializeRegistry(save.schemes) as GameState["schemes"],
    whispers: deserializeRegistry(save.whispers) as GameState["whispers"],
    couriers: deserializeRegistry(save.couriers) as GameState["couriers"],
    staff: deserializeRegistry(save.staff) as GameState["staff"],
    proposalsLog: deserializeRegistry(save.proposalsLog) as GameState["proposalsLog"],
    tutorAssignmentsLog: deserializeRegistry(
      save.tutorAssignmentsLog,
    ) as GameState["tutorAssignmentsLog"],
    pendingTutorTraitChoices: deserializeRegistry(
      save.pendingTutorTraitChoices,
    ) as GameState["pendingTutorTraitChoices"],
    patronesses: deserializeRegistry(save.patronesses) as GameState["patronesses"],
    rivalActors: deserializeRegistry(save.rivalActors) as GameState["rivalActors"],
    factionTensions: deserializeRegistry(save.factionTensions) as GameState["factionTensions"],
    duels: deserializeRegistry(save.duels) as GameState["duels"],
    elopement: save.elopement,
    artifactInstances: deserializeRegistry(
      save.artifactInstances,
    ) as GameState["artifactInstances"],
    forgeries: deserializeRegistry(save.forgeries) as GameState["forgeries"],
    thiefAttempts: deserializeRegistry(save.thiefAttempts) as GameState["thiefAttempts"],
    globalEvents: deserializeRegistry(save.globalEvents) as GameState["globalEvents"],
    flavorText: deserializeRegistry(save.flavorText) as GameState["flavorText"],
  };
}

// Live loader. Composes the Bare deserialize + the idempotent NPC-mount seed.
// flavorText round-trips from the save verbatim.
export function fromSaveV1(save: SaveV1): GameState {
  const bare = fromSaveV1Bare(save);
  const characters = new Map(bare.characters);
  const artifactInstances = new Map(bare.artifactInstances);
  bootstrapNpcMountFamily(characters, artifactInstances, save.tick);
  return { ...bare, characters, artifactInstances };
}

export type { Grievance };
