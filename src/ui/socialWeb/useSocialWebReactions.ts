// P14: reactive-animation cue source for the Social Web. Subscribes to the
// three bus events that express a "social rejection" — faux-pas, sabotage
// success, proposal rejection — and emits a time-boxed slide-away cue for the
// affected character. Cues are presentation-only; they never touch GameState
// or the gameplay PRNG. The TTL constant is a pure rendering value (NOT in
// src/game/constants.ts per the CLAUDE.md "designer constants" carve-out for
// pixel/timing UI values).
//
// Mount discipline: this hook lives INSIDE SocialWebView (not FamilyTreeTab
// top-level) — subscriptions exist only while the graph is visible. Events
// fired while the text view is showing are dropped (acceptable v1: cues are
// presentation-only and not load-bearing for state correctness).

import { useCallback, useEffect, useState } from "react";
import type { CharacterId } from "../../game/rng.seeds";
import { conversationBus } from "../../runtime/events/conversation";
import { familyBus } from "../../runtime/events/family";
import { schemeBus } from "../../runtime/events/scheme";
import { useBusEvent } from "../../runtime/events/useBusEvent";

export const SOCIAL_WEB_SLIDE_DURATION_MS = 2000;

export type AnimationCue = {
  characterId: CharacterId;
  expiresAtMs: number;
};

export function useSocialWebReactions(): ReadonlyMap<CharacterId, AnimationCue> {
  const [cues, setCues] = useState<Map<CharacterId, AnimationCue>>(() => new Map());

  const addCue = useCallback((characterId: CharacterId) => {
    setCues((prev) => {
      const next = new Map(prev);
      next.set(characterId, {
        characterId,
        expiresAtMs: Date.now() + SOCIAL_WEB_SLIDE_DURATION_MS,
      });
      return next;
    });
  }, []);

  const onFauxPas = useCallback(
    (event: { targetCharacterId: CharacterId }) => addCue(event.targetCharacterId),
    [addCue],
  );
  const onSchemeCompleted = useCallback(
    (event: { schemeKind: string; targetCharacterId: CharacterId | null }) => {
      // Type-system requires the null-guard before the Map.set (cue key is
      // CharacterId, never null). Smuggling is the canonical target-less scheme;
      // the schemeKind filter already excludes it, the null-guard is belt-and-
      // suspenders for any future target-less kind.
      if (event.schemeKind !== "Sabotage" || event.targetCharacterId === null) return;
      addCue(event.targetCharacterId);
    },
    [addCue],
  );
  const onProposalRejected = useCallback(
    (event: { targetId: CharacterId }) => addCue(event.targetId),
    [addCue],
  );

  useBusEvent(conversationBus, "FauxPasFired", onFauxPas);
  useBusEvent(schemeBus, "SchemeCompleted", onSchemeCompleted);
  useBusEvent(familyBus, "ProposalRejected", onProposalRejected);

  // Prune expired cues on an interval so the graph relaxes back to rest once
  // the slide-away window elapses. Only runs while at least one cue is live.
  useEffect(() => {
    if (cues.size === 0) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setCues((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [id, cue] of next) {
          if (cue.expiresAtMs <= now) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [cues.size]);

  return cues;
}
