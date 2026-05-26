// P14: Social Web visualization. A spatial alternative to the textual Family
// Tree — renders the player house's OUTBOUND affection network as a
// force-directed canvas (react-force-graph-2d). Player-house characters are
// gold hubs; affection targets cluster by affection magnitude (higher
// affection → shorter link → closer to the player head). Reactive slide-away
// physics fire on faux-pas / sabotage-success / proposal-rejection via the
// useSocialWebReactions cue source.
//
// P20 SPEC OVERRIDE (authorized in writing — see plans/phases/20-coreloop-
// reachability.md Decision 1): spec §3 line 262 declares this a "Reading-only
// view; all mutations happen elsewhere." P20 adds ONE deliberate, user-
// authorized exception — a propose-marriage action on clicked target nodes
// (the secondary propose surface; the ballroom is the spine). This is the only
// mutation affordance on the web; the slide-away physics above remain
// read-only and coexist with it (the DOM overlay banner and the canvas
// physics act on different layers, so they do not contend for the node).

import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { useShallow } from "zustand/react/shallow";
import { type ConversationPairKey, parsePairKey } from "../../game/conversation/types";
import type { Character, House } from "../../game/entities";
import type { CharacterId, HouseId } from "../../game/rng.seeds";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import type { ProposalOutcome } from "../../game/rules/proposal";
import type { SeasonStore } from "../../game/store";
import { ProposalOutcomeBanner } from "../shared/ProposalOutcomeBanner";
import { PLAYER_NODE_COLOR, REACTING_NODE_COLOR, factionColor } from "./colors";
import { useSocialWebReactions } from "./useSocialWebReactions";

type Props = {
  store: SeasonStore;
};

export type SocialNode = {
  id: string;
  name: string;
  isPlayer: boolean;
  color: string;
};

export type SocialLink = {
  source: string;
  target: string;
  weight: number; // affection / 100, in [0, 1]
};

export type SocialGraphData = {
  nodes: SocialNode[];
  links: SocialLink[];
};

// Pure derivation — exported for unit tests (verification matrix #11). Nodes:
// every alive player-house character PLUS every affection target. Links: every
// player-OUTBOUND affectionMap entry (parsed.houseId === PLAYER_HOUSE_ID),
// drawn from the player head to the target. NPC-side affection keys exist in
// affectionMap but are intentionally excluded at v1 (player-perspective web).
export function buildSocialGraphData(
  characters: ReadonlyMap<CharacterId, Character>,
  houses: ReadonlyMap<HouseId, House>,
  affectionMap: ReadonlyMap<ConversationPairKey, number>,
): SocialGraphData {
  const playerHead = houses.get(PLAYER_HOUSE_ID)?.headOfHouseCharacterId ?? null;
  const nodeIds = new Set<CharacterId>();

  for (const c of characters.values()) {
    if (c.houseId === PLAYER_HOUSE_ID && c.alive) nodeIds.add(c.id);
  }

  const links: SocialLink[] = [];
  for (const [key, affection] of affectionMap) {
    const { houseId, characterId } = parsePairKey(key);
    if (houseId !== PLAYER_HOUSE_ID) continue;
    nodeIds.add(characterId);
    if (playerHead !== null && characterId !== playerHead) {
      links.push({ source: playerHead, target: characterId, weight: affection / 100 });
    }
  }

  const nodes: SocialNode[] = [...nodeIds]
    .sort((a, b) => a.localeCompare(b))
    .map((id) => {
      const c = characters.get(id);
      const isPlayer = c?.houseId === PLAYER_HOUSE_ID;
      const houseFaction = c !== undefined ? houses.get(c.houseId)?.factionId : undefined;
      return {
        id,
        name: c?.name ?? id,
        isPlayer,
        color: isPlayer ? PLAYER_NODE_COLOR : factionColor(houseFaction),
      };
    });

  return { nodes, links };
}

// Link rest-lengths. A cued target's link is stretched so the force simulation
// pushes the portrait away from the player, then relaxes when the cue expires.
const BASE_LINK_DISTANCE = 40;
const SLIDE_LINK_DISTANCE = 130;

export function SocialWebView({ store }: Props) {
  const { characters, houses, affectionMap } = store(
    useShallow((s) => ({
      characters: s.characters,
      houses: s.houses,
      affectionMap: s.affectionMap,
    })),
  );
  const cues = useSocialWebReactions();
  const fgRef = useRef<ForceGraphMethods<SocialNode, SocialLink> | undefined>(undefined);

  // P20 (spec-override): a clicked non-player node becomes the propose target.
  const [proposeTargetId, setProposeTargetId] = useState<CharacterId | null>(null);
  const [proposalOutcome, setProposalOutcome] = useState<ProposalOutcome | null>(null);

  const graphData = useMemo(
    () => buildSocialGraphData(characters, houses, affectionMap),
    [characters, houses, affectionMap],
  );

  const proposeTarget = proposeTargetId !== null ? characters.get(proposeTargetId) : undefined;

  const onNodeClick = (node: SocialNode) => {
    // Player-house hubs are not proposal targets; clicking one clears the panel.
    if (node.isPlayer) {
      setProposeTargetId(null);
      setProposalOutcome(null);
      return;
    }
    setProposeTargetId(node.id as CharacterId);
    setProposalOutcome(null);
  };

  const onPropose = () => {
    if (proposeTargetId === null) return;
    setProposalOutcome(store.getState().proposeMarriage(proposeTargetId));
  };

  // Slide-away physics: reconfigure the link force's per-link distance whenever
  // the active cue set changes, then re-heat the simulation so cued targets
  // drift out and settle back.
  useEffect(() => {
    const fg = fgRef.current;
    if (fg === undefined) return;
    const linkForce = fg.d3Force("link");
    if (linkForce === undefined) return;
    linkForce.distance((link: SocialLink) => {
      const targetId =
        typeof link.target === "object" ? (link.target as SocialNode).id : link.target;
      return cues.has(targetId as CharacterId) ? SLIDE_LINK_DISTANCE : BASE_LINK_DISTANCE;
    });
    fg.d3ReheatSimulation();
  }, [cues]);

  return (
    <div
      data-testid="social-web-view"
      role="img"
      aria-label="Social Web visualization — affection network"
      className="relative rounded-md border border-stone-300 bg-stone-900"
    >
      <ForceGraph2D
        ref={fgRef}
        width={640}
        height={420}
        graphData={graphData}
        nodeId="id"
        nodeLabel="name"
        nodeColor={(node: SocialNode) =>
          cues.has(node.id as CharacterId) ? REACTING_NODE_COLOR : node.color
        }
        nodeRelSize={6}
        linkColor={() => "#57534e"}
        linkWidth={(link: SocialLink) => Math.max(1, link.weight * 4)}
        backgroundColor="#1c1917"
        onNodeClick={onNodeClick}
      />
      {/* P20 (spec-override): DOM overlay propose panel layered over the canvas
          — react-force-graph renders to canvas and cannot host DOM banners. */}
      {proposeTarget !== undefined && (
        <div
          className="absolute right-3 top-3 w-64 space-y-2 rounded-md border border-stone-300 bg-white/95 p-3 shadow-lg"
          data-testid="social-web-propose-panel"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-stone-800">{proposeTarget.name}</span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => {
                setProposeTargetId(null);
                setProposalOutcome(null);
              }}
              className="rounded px-1.5 text-xs text-stone-500 hover:text-stone-800"
            >
              ✕
            </button>
          </div>
          <button
            type="button"
            onClick={onPropose}
            className="w-full rounded bg-rose-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-800"
            data-testid="social-web-propose-btn"
          >
            Propose Marriage
          </button>
          <ProposalOutcomeBanner
            outcome={proposalOutcome}
            targetName={proposeTarget.name}
            onDismiss={() => setProposalOutcome(null)}
          />
        </div>
      )}
    </div>
  );
}
