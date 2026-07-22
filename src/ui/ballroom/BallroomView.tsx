// Top-level ballroom surface. Session-local state (selected target, pinned
// tactic, stance, freeform message, player composure, in-flight flag,
// banner) lives here in React; persisted game state (history, affection,
// target's composure/mood) is read from the store.
//
// Per spec §3 "Conversational Ballroom" + plan "Ballroom UI" section.

import { useEffect, useState } from "react";
import {
  AFFECTION_PROPOSAL_THRESHOLD,
  COMPOSURE_DEFAULT,
  PROPOSAL_REPUTATION_THRESHOLD,
  type Stance,
  type Tactic,
} from "../../game/constants";
import { type ConversationFailure, makePairKey } from "../../game/conversation/types";
import type { Character } from "../../game/entities";
import { flavorStubFor } from "../../game/fixtures/flavorStubs";
import type { Mood } from "../../game/fixtures/moods";
import { type CharacterId, type FlavorContentId, PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import { ballroomRoster, characterEquipsMountFamily } from "../../game/rules/promenade";
import type { ProposalOutcome } from "../../game/rules/proposal";
import type { SeasonStore } from "../../game/store";
import { conversationBus } from "../../runtime/events/conversation";
import { ProposalOutcomeBanner } from "../shared/ProposalOutcomeBanner";
import { ChatLog } from "./ChatLog";
import { ComposureBar } from "./ComposureBar";
import { ConversationFailureBanner } from "./ConversationFailureBanner";
import { MessageInput } from "./MessageInput";
import { PortraitRing } from "./PortraitRing";
import { SchemeButtons } from "./SchemeButtons";
import { StanceToggle } from "./StanceToggle";
import { TacticButtons } from "./TacticButtons";
import { ThinkingIndicator } from "./ThinkingIndicator";

type Props = {
  store: SeasonStore;
  onExit: () => void;
  // P26 (Q14): the NPC who approached the player first this entry (from
  // enterBallroom's return), pre-selected as the initial target. null = no
  // approach; the ring defaults to its first member.
  approachingCharacterId?: CharacterId | null;
};

export function BallroomView({ store, onExit, approachingCharacterId = null }: Props) {
  // Game state via store hooks
  const characters = store((s) => s.characters);
  const conversationHistory = store((s) => s.conversationHistory);
  const houses = store((s) => s.houses);
  const flavorText = store((s) => s.flavorText);
  // P20: affection map (for the propose-gate + standing readouts) and tick (for
  // the per-portrait faux-pas mood-lock badge).
  const affectionMap = store((s) => s.affectionMap);
  const tick = store((s) => s.tick);

  // P18: persisted bio if generated (on first "Who is this?" reveal), else stub.
  const bioFor = (c: Character): string => {
    const id = `bio:${c.id}` as FlavorContentId;
    return flavorText.get(id)?.text ?? flavorStubFor(id, { character: c });
  };
  const revealNpcBio = store((s) => s.revealNpcBio);

  // P23/P26: the ballroom roster is every alive SOCIETY-house NPC (INDEPENDENT +
  // minted soc-house-<n> dynasties) so society members who married into a
  // sub-house stay conversable, PLUS every alive rival-house character (P25 R6 —
  // rivals are conversable + scheme-targetable, which is also the scheme-target
  // surface that makes player→rival Sabotage reachable). The player's own house
  // is excluded. Consumes the pure lex-sorted `ballroomRoster` projection so the
  // visible ring is the SAME set (and order) as the ballroom-approach draw pool
  // by construction — the rival widening lives in THAT projection, not here.
  const npcs = ballroomRoster(store.getState())
    .map((id) => characters.get(id))
    .filter((c): c is Character => c !== undefined);

  // Session-local React state. P26: pre-select the approaching NPC when the
  // entry rolled one (and it's on the roster), else the first ring member.
  const [selectedTargetId, setSelectedTargetId] = useState<CharacterId | null>(
    approachingCharacterId !== null && npcs.some((c) => c.id === approachingCharacterId)
      ? approachingCharacterId
      : (npcs[0]?.id ?? null),
  );
  const [pinnedTactic, setPinnedTactic] = useState<Tactic | null>(null);
  const [stance, setStance] = useState<Stance>("Mingle");
  const [draftMessage, setDraftMessage] = useState("");
  const [inFlight, setInFlight] = useState(false);
  const [failure, setFailure] = useState<ConversationFailure | null>(null);
  // P26 (G1): partial streamed tokens for progressive render (never persisted).
  const [streamingText, setStreamingText] = useState("");
  // P20: proposal outcome (rendered via the shared banner), per-turn combat
  // result, and faux-pas blunder notice. All session-local.
  const [proposalOutcome, setProposalOutcome] = useState<ProposalOutcome | null>(null);
  const [turnResult, setTurnResult] = useState<{
    affectionDelta: number;
    synergy: boolean;
    moodHint: Mood | null;
  } | null>(null);
  const [fauxPas, setFauxPas] = useState<{
    targetCharacterId: CharacterId;
    lockUntilTick: number;
  } | null>(null);

  // Session player composure starts from the player head's persisted value.
  const playerHouse = houses.get(PLAYER_HOUSE_ID);
  const playerHead =
    playerHouse !== undefined ? characters.get(playerHouse.headOfHouseCharacterId) : undefined;
  const initialComposure = playerHead?.composure ?? COMPOSURE_DEFAULT;
  const maxComposure = playerHead?.maxComposure ?? COMPOSURE_DEFAULT;
  const [sessionComposure, setSessionComposure] = useState(initialComposure);

  // P20: subscribe to conversation events. ConversationResolved updates session
  // composure AND surfaces the per-turn combat result (affectionDelta / synergy
  // / moodHint — previously only composureDelta was consumed). FauxPasFired
  // surfaces the social blunder + drives the per-portrait mood-lock badge (the
  // composure drop otherwise showed with no explanation). The orchestrator's
  // session composure is React-local by design; combat deltas are read off the
  // bus. (Pre-P20 this effect handled only Resolved/Failed — the stale comment
  // claiming faux-pas handling is now true.)
  useEffect(() => {
    const unsubResolved = conversationBus.subscribe("ConversationResolved", (e) => {
      setSessionComposure((prev) => Math.max(0, Math.min(maxComposure, prev + e.composureDelta)));
      setTurnResult({ affectionDelta: e.affectionDelta, synergy: e.synergy, moodHint: e.moodHint });
    });
    const unsubFailed = conversationBus.subscribe("ConversationFailed", (e) => {
      setFailure(e.failure);
    });
    const unsubFauxPas = conversationBus.subscribe("FauxPasFired", (e) => {
      setFauxPas({ targetCharacterId: e.targetCharacterId, lockUntilTick: e.lockUntilTick });
    });
    return () => {
      unsubResolved();
      unsubFailed();
      unsubFauxPas();
    };
  }, [maxComposure]);

  const selectedTarget = selectedTargetId !== null ? characters.get(selectedTargetId) : undefined;
  // P26 (H4): does the selected target own a mount-family artifact? Gates the
  // ComplimentMount tactic's tooltip (a mountless target ZeroYields).
  const targetEquipsMount =
    selectedTarget !== undefined &&
    characterEquipsMountFamily(store.getState(), selectedTarget.equippedArtifactIds);
  const pairKey = selectedTargetId !== null ? makePairKey(PLAYER_HOUSE_ID, selectedTargetId) : null;
  const exchanges = pairKey !== null ? (conversationHistory.get(pairKey) ?? []) : [];

  // P20 propose-gate readouts. Affection drives gate 13; reputation drives
  // gate 12 — which tests RAW playerHouse.reputation (proposal.ts:143), NOT the
  // TopBar's effective/artifact-walked value. A reputation-boosting artifact can
  // push effective ≥ threshold while raw is below it, so the gate readout MUST
  // read raw or it misrepresents whether the proposal can be accepted.
  const selectedAffection = pairKey !== null ? (affectionMap.get(pairKey) ?? 0) : 0;
  const rawReputation = playerHouse?.reputation ?? 0;
  const affectionMet = selectedAffection >= AFFECTION_PROPOSAL_THRESHOLD;
  const reputationMet = rawReputation >= PROPOSAL_REPUTATION_THRESHOLD;

  const onPropose = () => {
    if (selectedTargetId === null) return;
    // proposeMarriage gates internally; the returned ProposalOutcome carries
    // the accept / roll-reject / predicate-rejection result for the banner.
    setProposalOutcome(store.getState().proposeMarriage(selectedTargetId));
  };

  const disabledReason = inFlight
    ? "Awaiting response…"
    : selectedTarget === undefined
      ? "Select a target NPC."
      : "";

  const sendDisabled = inFlight || selectedTarget === undefined;

  const onSend = async () => {
    if (selectedTargetId === null) return;
    setInFlight(true);
    setFailure(null);
    setTurnResult(null);
    setFauxPas(null);
    // P26 (G1): stream the reply. `streamingText` is UI-ephemeral — the
    // committed exchange comes from the store after both legs resolve, so a
    // failed turn leaves no trace.
    setStreamingText("");
    try {
      await store.getState().sendBallroomMessage({
        targetCharacterId: selectedTargetId,
        pinnedTactic,
        stance,
        freeformMessage: draftMessage,
        onDelta: (chunk) => setStreamingText((prev) => prev + chunk),
      });
      setDraftMessage("");
    } finally {
      setInFlight(false);
      setStreamingText("");
    }
  };

  const onExitBallroom = () => {
    store.getState().exitBallroom(sessionComposure);
    onExit();
  };

  const onAbort = () => {
    store.getState().abortBallroomRequest();
    setInFlight(false);
  };

  return (
    <section className="flex flex-col gap-4 p-6" aria-label="Ballroom" data-testid="ballroom-view">
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-stone-800">High-Society Ball</h2>
        <button
          type="button"
          onClick={onExitBallroom}
          className="rounded border border-stone-300 px-3 py-1 text-sm text-stone-700 hover:bg-stone-50"
          data-testid="ballroom-exit"
        >
          Leave the ball
        </button>
      </header>

      <ComposureBar value={sessionComposure} max={maxComposure} />

      <PortraitRing
        npcs={npcs}
        selectedTargetId={selectedTargetId}
        bioFor={bioFor}
        onRevealBio={revealNpcBio}
        onAuthorBio={(id, text) =>
          store.getState().authorFlavorText(`bio:${id}` as FlavorContentId, "NpcBio", text)
        }
        onRegenerateBio={(id) => store.getState().regenerateNpcBio(id)}
        onSelect={(id) => {
          setSelectedTargetId(id);
          setPinnedTactic(null);
          setDraftMessage("");
          // P20: outcome/turn banners are target-specific — clear on switch.
          setProposalOutcome(null);
          setTurnResult(null);
          setFauxPas(null);
        }}
        tick={tick}
      />

      <ConversationFailureBanner failure={failure} onDismiss={() => setFailure(null)} />

      {selectedTarget !== undefined && (
        <>
          {/* P20: running standing + last-turn combat result for the selected
              NPC. The affection number doubles as the propose-gate readout. */}
          <div
            className="flex flex-wrap items-center gap-3 text-sm text-stone-700"
            data-testid="npc-standing-readout"
          >
            <span>
              Affection with {selectedTarget.name}:{" "}
              <span className="font-semibold text-stone-900" data-testid="npc-affection-value">
                {selectedAffection}
              </span>
              /100
            </span>
            {turnResult !== null && (
              <span className="text-stone-500" data-testid="turn-result-readout">
                Last line:{" "}
                <span
                  className={turnResult.affectionDelta >= 0 ? "text-emerald-700" : "text-rose-700"}
                >
                  {turnResult.affectionDelta >= 0 ? "+" : ""}
                  {turnResult.affectionDelta} affection
                </span>
                {turnResult.synergy ? " · synergy!" : ""}
                {turnResult.moodHint !== null ? ` · mood: ${turnResult.moodHint}` : ""}
              </span>
            )}
          </div>

          {fauxPas !== null && (
            <div
              role="alert"
              className="rounded-md border-l-4 border-rose-500 bg-rose-50 px-3 py-2 text-sm text-rose-900"
              data-testid="faux-pas-banner"
            >
              A faux pas! {characters.get(fauxPas.targetCharacterId)?.name ?? "Your target"} recoils
              — their mood is locked to Defensive until tick {fauxPas.lockUntilTick}.
            </div>
          )}

          <ChatLog exchanges={exchanges} npcName={selectedTarget.name} />
          <StanceToggle stance={stance} onChange={setStance} />
          <TacticButtons
            pinned={pinnedTactic}
            disabled={inFlight}
            targetEquipsMount={targetEquipsMount}
            onPin={(t, prefill) => {
              setPinnedTactic(t);
              setDraftMessage(prefill);
            }}
          />
          {/* P5: scheme launch buttons. Free action — does NOT advance the
              tick (the tick advances via map travel/audience/etc). */}
          <SchemeButtons store={store} selectedTargetId={selectedTargetId} />

          {/* P20: propose marriage to the selected NPC. Unlike schemes, this
              DOES advance a tick (proposeMarriage's wrapper). Gate readout shows
              affection vs threshold + RAW reputation vs threshold so the gate is
              legible before the click; the rule still produces every rejection
              reason if clicked while a gate is unmet. */}
          <div className="flex flex-col gap-2" data-testid="propose-section">
            <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
              <span className={affectionMet ? "text-emerald-700" : "text-rose-700"}>
                Affection {selectedAffection} / {AFFECTION_PROPOSAL_THRESHOLD}
              </span>
              <span className={reputationMet ? "text-emerald-700" : "text-rose-700"}>
                Reputation {rawReputation} / {PROPOSAL_REPUTATION_THRESHOLD}
              </span>
            </div>
            <button
              type="button"
              onClick={onPropose}
              disabled={inFlight}
              title={
                affectionMet && reputationMet
                  ? "Propose marriage to the selected NPC."
                  : "Thresholds unmet — proposing will be declined, but you may try."
              }
              className="self-start rounded bg-rose-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="propose-marriage-btn"
            >
              Propose Marriage to {selectedTarget.name}
            </button>
            <ProposalOutcomeBanner
              outcome={proposalOutcome}
              targetName={selectedTarget.name}
              onDismiss={() => setProposalOutcome(null)}
            />
          </div>
          {inFlight ? (
            <>
              {/* P26 (G1): progressive render — partial tokens until the first
                  delta arrives, then the streamed prose in place. */}
              {streamingText === "" ? (
                <ThinkingIndicator />
              ) : (
                <p
                  className="rounded border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800"
                  aria-live="polite"
                  data-testid="ballroom-streaming-text"
                >
                  {streamingText}
                </p>
              )}
              <button
                type="button"
                onClick={onAbort}
                className="self-end rounded border border-stone-300 px-2 py-1 text-xs text-stone-700 hover:bg-stone-50"
                data-testid="ballroom-abort"
              >
                Cancel
              </button>
            </>
          ) : (
            <MessageInput
              value={draftMessage}
              disabled={sendDisabled}
              disabledReason={disabledReason}
              onChange={setDraftMessage}
              onSend={onSend}
            />
          )}
        </>
      )}
    </section>
  );
}
