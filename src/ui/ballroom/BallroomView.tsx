// Top-level ballroom surface. Session-local state (selected target, pinned
// tactic, stance, freeform message, player composure, in-flight flag,
// banner) lives here in React; persisted game state (history, affection,
// target's composure/mood) is read from the store.
//
// Per spec §3 "Conversational Ballroom" + plan "Ballroom UI" section.

import { useEffect, useState } from "react";
import { COMPOSURE_DEFAULT, type Stance, type Tactic } from "../../game/constants";
import { type ConversationFailure, makePairKey } from "../../game/conversation/types";
import { INDEPENDENT_HOUSE_ID, PLAYER_HOUSE_ID } from "../../game/rng";
import type { SeasonStore } from "../../game/store";
import { conversationBus } from "../../runtime/events/conversation";
import { useApiKey } from "../shared/KeyContext";
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
};

export function BallroomView({ store, onExit }: Props) {
  // Game state via store hooks
  const characters = store((s) => s.characters);
  const conversationHistory = store((s) => s.conversationHistory);
  const houses = store((s) => s.houses);

  const { key } = useApiKey();

  // Independent's living NPCs are the ballroom roster at P4 (P8 may
  // augment with rival-house NPCs).
  const npcs = [...characters.values()].filter(
    (c) => c.houseId === INDEPENDENT_HOUSE_ID && c.alive,
  );

  // Session-local React state
  const [selectedTargetId, setSelectedTargetId] = useState(npcs[0]?.id ?? null);
  const [pinnedTactic, setPinnedTactic] = useState<Tactic | null>(null);
  const [stance, setStance] = useState<Stance>("Mingle");
  const [draftMessage, setDraftMessage] = useState("");
  const [inFlight, setInFlight] = useState(false);
  const [failure, setFailure] = useState<ConversationFailure | null>(null);

  // Session player composure starts from the player head's persisted value.
  const playerHouse = houses.get(PLAYER_HOUSE_ID);
  const playerHead =
    playerHouse !== undefined ? characters.get(playerHouse.headOfHouseCharacterId) : undefined;
  const initialComposure = playerHead?.composure ?? COMPOSURE_DEFAULT;
  const maxComposure = playerHead?.maxComposure ?? COMPOSURE_DEFAULT;
  const [sessionComposure, setSessionComposure] = useState(initialComposure);

  // Subscribe to conversation events to update session composure on resolve
  // and on faux-pas. (The orchestrator's session composure is React-local
  // by design; we read combat deltas off the bus.)
  useEffect(() => {
    const unsubResolved = conversationBus.subscribe("ConversationResolved", (e) => {
      setSessionComposure((prev) => Math.max(0, Math.min(maxComposure, prev + e.composureDelta)));
    });
    const unsubFailed = conversationBus.subscribe("ConversationFailed", (e) => {
      setFailure(e.failure);
    });
    return () => {
      unsubResolved();
      unsubFailed();
    };
  }, [maxComposure]);

  const selectedTarget = selectedTargetId !== null ? characters.get(selectedTargetId) : undefined;
  const pairKey = selectedTargetId !== null ? makePairKey(PLAYER_HOUSE_ID, selectedTargetId) : null;
  const exchanges = pairKey !== null ? (conversationHistory.get(pairKey) ?? []) : [];

  const disabledReason =
    key === null || key === ""
      ? "Enter your Gemini API key in settings to send messages."
      : inFlight
        ? "Awaiting response…"
        : selectedTarget === undefined
          ? "Select a target NPC."
          : "";

  const sendDisabled = key === null || key === "" || inFlight || selectedTarget === undefined;

  const onSend = async () => {
    if (selectedTargetId === null || key === null || key === "") return;
    setInFlight(true);
    setFailure(null);
    try {
      await store.getState().sendBallroomMessage(
        {
          targetCharacterId: selectedTargetId,
          pinnedTactic,
          stance,
          freeformMessage: draftMessage,
        },
        key,
      );
      setDraftMessage("");
    } finally {
      setInFlight(false);
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
        onSelect={(id) => {
          setSelectedTargetId(id);
          setPinnedTactic(null);
          setDraftMessage("");
        }}
      />

      <ConversationFailureBanner failure={failure} onDismiss={() => setFailure(null)} />

      {selectedTarget !== undefined && (
        <>
          <ChatLog exchanges={exchanges} npcName={selectedTarget.name} />
          <StanceToggle stance={stance} onChange={setStance} />
          <TacticButtons
            pinned={pinnedTactic}
            disabled={inFlight}
            onPin={(t, prefill) => {
              setPinnedTactic(t);
              setDraftMessage(prefill);
            }}
          />
          {/* P5: scheme launch buttons. Free action — does NOT advance the
              tick (the tick advances via map travel/audience/etc). */}
          <SchemeButtons store={store} selectedTargetId={selectedTargetId} />
          {inFlight ? (
            <>
              <ThinkingIndicator />
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
