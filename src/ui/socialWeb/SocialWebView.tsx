// P14: Social Web visualization. A spatial, reading-only alternative to the
// textual Family Tree — renders the player house's OUTBOUND affection network
// as a force-directed canvas (react-force-graph-2d). Player-house characters
// are gold hubs; affection targets cluster by affection magnitude (higher
// affection → shorter link → closer to the player head). Reactive slide-away
// physics fire on faux-pas / sabotage-success / proposal-rejection via the
// useSocialWebReactions cue source. Zero mutation affordances (spec §3 line
// 262 "all mutations happen elsewhere").

import { useEffect, useMemo, useRef } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { useShallow } from "zustand/react/shallow";
import { type ConversationPairKey, parsePairKey } from "../../game/conversation/types";
import type { Character, House } from "../../game/entities";
import type { CharacterId, HouseId } from "../../game/rng.seeds";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import type { SeasonStore } from "../../game/store";
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

  const graphData = useMemo(
    () => buildSocialGraphData(characters, houses, affectionMap),
    [characters, houses, affectionMap],
  );

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
      className="rounded-md border border-stone-300 bg-stone-900"
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
      />
    </div>
  );
}
