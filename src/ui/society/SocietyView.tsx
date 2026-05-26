// P22: "Society / The Ton" view — the third Family-Tree-tab mode. Renders the
// wider non-player world (every alive INDEPENDENT_HOUSE_ID member — baseline +
// procedural + replenished — plus all rival-house members), which is otherwise
// invisible outside the ballroom roster. A list/spatial pill toggle mirrors the
// Family↔Web pattern.
//
// SPEC / TRIP-HAZARD: this FULLY lifts the P16 "social web is player-house-only"
// trip-hazard — but only for THIS view. The player-perspective Social Web
// (SocialWebView) stays player-anchored; the Ton view is a separate surface.
//
// P23 SANCTIONED MUTATION: the Ton view now carries a per-row "Propose" action
// (the reachability surface for cross-house marriage — love-match for society
// rows, political alliance for rival rows; the rule routes by house class). This
// is a deliberate authorized mutation affordance on a roster (same precedent as
// P20's Social-Web propose deviation). Besides this + the fire-and-forget
// revealNpcBio reveal, the view is read-only.

import { useMemo, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useShallow } from "zustand/react/shallow";
import { ADULTHOOD_AGE_IN_YEARS } from "../../game/constants";
import { type ConversationPairKey, parsePairKey } from "../../game/conversation/types";
import type { Character, House } from "../../game/entities";
import { flavorStubFor } from "../../game/fixtures/flavorStubs";
import type { BetrothalId, CharacterId, FlavorContentId, HouseId } from "../../game/rng.seeds";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import type { ProposalOutcome } from "../../game/rules/proposal";
import type { SeasonStore } from "../../game/store";
import { houseDisplayName } from "../ledger/houseName";
import { ProposalOutcomeBanner } from "../shared/ProposalOutcomeBanner";
import { monogramLetter, monogramStyle } from "../shared/monogram";
import type { SocialGraphData, SocialLink, SocialNode } from "../socialWeb/SocialWebView";
import { PLAYER_NODE_COLOR, factionColor } from "../socialWeb/colors";

type Props = {
  store: SeasonStore;
};

// Pure derivation — exported for unit tests. Nodes: every alive non-player
// character (Independent + rivals), faction-colored, PLUS the player head (gold,
// the affection anchor). Links: every affectionMap edge, both directions
// (outbound player→NPC, inbound NPC-house-head→player-head). Society NPCs the
// player never met render as unconnected nodes — the intended "crowd" density.
export function buildSocietyGraphData(
  characters: ReadonlyMap<CharacterId, Character>,
  houses: ReadonlyMap<HouseId, House>,
  affectionMap: ReadonlyMap<ConversationPairKey, number>,
): SocialGraphData {
  const playerHead = houses.get(PLAYER_HOUSE_ID)?.headOfHouseCharacterId ?? null;
  const nodeIds = new Set<CharacterId>();

  for (const c of characters.values()) {
    if (c.houseId !== PLAYER_HOUSE_ID && c.alive) nodeIds.add(c.id);
  }
  if (playerHead !== null) nodeIds.add(playerHead);

  const links: SocialLink[] = [];
  for (const [key, affection] of affectionMap) {
    const { houseId, characterId } = parsePairKey(key);
    if (houseId === PLAYER_HOUSE_ID) {
      if (playerHead !== null && characterId !== playerHead) {
        links.push({
          source: playerHead,
          target: characterId,
          weight: affection / 100,
          direction: "outbound",
        });
      }
    } else {
      const holderHead = houses.get(houseId)?.headOfHouseCharacterId ?? null;
      if (holderHead !== null && holderHead !== characterId) {
        links.push({
          source: holderHead,
          target: characterId,
          weight: affection / 100,
          direction: "inbound",
        });
      }
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

function SocietyRow({
  c,
  factionId,
  bio,
  onRevealBio,
  onPropose,
  onBetroth,
}: {
  c: Character;
  factionId: House["factionId"] | undefined;
  bio: string;
  onRevealBio: () => void;
  onPropose: () => void;
  onBetroth: (() => void) | null;
}) {
  const mono = monogramStyle(c.id, factionId);
  const traits = c.traits.slice(0, 4);
  const overflow = c.traits.length - traits.length;
  return (
    <li
      data-testid={`society-row-${c.id}`}
      className="rounded-md border border-stone-200 px-3 py-2 text-sm"
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold"
          style={{
            backgroundColor: mono.backgroundColor,
            color: "#1c1917",
            boxShadow: `0 0 0 2px ${mono.ringColor}`,
          }}
        >
          {monogramLetter(c.name)}
        </span>
        <span className="w-44 font-medium text-stone-800">{c.name}</span>
        <span className="w-10 text-stone-500">{c.age}y</span>
        <span className="w-24 text-stone-500">{c.role}</span>
        <span className="w-24 text-stone-500">{c.archetype}</span>
        <span className="w-20 text-stone-500">{c.mood}</span>
        {c.equippedArtifactIds.length > 0 && (
          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
            {c.equippedArtifactIds.length} equipped
          </span>
        )}
        <span className="flex flex-1 flex-wrap justify-end gap-1">
          {traits.map((t) => (
            <span key={t} className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">
              {t}
            </span>
          ))}
          {overflow > 0 && <span className="text-xs text-stone-400">+{overflow} more</span>}
        </span>
        <button
          type="button"
          onClick={onPropose}
          data-testid={`society-propose-${c.id}`}
          className="shrink-0 rounded border border-stone-300 px-2 py-0.5 text-xs font-medium text-stone-700 hover:bg-stone-100"
        >
          Propose
        </button>
        {onBetroth !== null && (
          <button
            type="button"
            onClick={onBetroth}
            data-testid={`society-betroth-${c.id}`}
            className="shrink-0 rounded border border-stone-300 px-2 py-0.5 text-xs font-medium text-stone-700 hover:bg-stone-100"
          >
            Betroth
          </button>
        )}
      </div>
      <details
        data-testid={`society-bio-${c.id}`}
        className="mt-1 text-xs text-stone-500"
        onToggle={(e) => {
          if (e.currentTarget.open) onRevealBio();
        }}
      >
        <summary className="cursor-pointer select-none text-stone-400 hover:text-stone-600">
          Who is this?
        </summary>
        <p className="mt-1 italic leading-relaxed text-stone-600">{bio}</p>
      </details>
    </li>
  );
}

export function SocietyView({ store }: Props) {
  const { characters, houses, affectionMap, flavorText, betrothals } = store(
    useShallow((s) => ({
      characters: s.characters,
      houses: s.houses,
      affectionMap: s.affectionMap,
      flavorText: s.flavorText,
      betrothals: s.betrothals,
    })),
  );
  const revealNpcBio = store((s) => s.revealNpcBio);
  const proposeMarriage = store((s) => s.proposeMarriage);
  const arrangeBetrothal = store((s) => s.arrangeBetrothal);
  const breakBetrothal = store((s) => s.breakBetrothal);
  const [spatial, setSpatial] = useState(false);
  // P23: last propose outcome + the target's name, for the outcome banner.
  const [proposal, setProposal] = useState<{ outcome: ProposalOutcome; name: string } | null>(null);
  // P23: selected player pre-adult child for arranging a betrothal + a status line.
  const [betrothChildId, setBetrothChildId] = useState<CharacterId | "">("");
  const [betrothalNote, setBetrothalNote] = useState<string | null>(null);

  // Eligible player children to betroth: alive, pre-adult, unmarried, not
  // already Pending-betrothed.
  const pendingPartyIds = useMemo(() => {
    const s = new Set<CharacterId>();
    for (const b of betrothals.values()) {
      if (b.status !== "Pending") continue;
      s.add(b.partyAId);
      s.add(b.partyBId);
    }
    return s;
  }, [betrothals]);
  const eligibleChildren = [...characters.values()].filter(
    (c) =>
      c.houseId === PLAYER_HOUSE_ID &&
      c.alive &&
      c.age < ADULTHOOD_AGE_IN_YEARS &&
      c.marriageId === null &&
      !pendingPartyIds.has(c.id),
  );
  const pendingBetrothals = [...betrothals.values()].filter((b) => b.status === "Pending");

  function onBetroth(npc: Character): void {
    if (betrothChildId === "") {
      setBetrothalNote("Select one of your children first.");
      return;
    }
    const result = arrangeBetrothal(betrothChildId as CharacterId, npc.id);
    setBetrothalNote(
      result.ok
        ? `Betrothal arranged with ${npc.name}.`
        : `Could not arrange betrothal: ${result.reason.kind}.`,
    );
  }

  const graphData = useMemo(
    () => buildSocietyGraphData(characters, houses, affectionMap),
    [characters, houses, affectionMap],
  );

  // Non-player houses, lex-sorted, each with its alive members lex-sorted.
  const houseGroups = [...houses.values()]
    .filter((h) => h.id !== PLAYER_HOUSE_ID)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((h) => ({
      house: h,
      members: [...characters.values()]
        .filter((c) => c.houseId === h.id && c.alive)
        .sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .filter((g) => g.members.length > 0);

  const bioFor = (c: Character): string => {
    const id = `bio:${c.id}` as FlavorContentId;
    return flavorText.get(id)?.text ?? flavorStubFor(id, { character: c });
  };

  return (
    <section data-testid="society-view" className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium uppercase tracking-wide text-stone-500">
          The Ton — Society &amp; Rivals
        </h3>
        <button
          type="button"
          onClick={() => setSpatial((v) => !v)}
          data-testid="society-spatial-toggle"
          aria-pressed={spatial}
          className="rounded-full border border-stone-300 px-3 py-1 text-sm font-medium text-stone-700 hover:bg-stone-100"
        >
          {spatial ? "View as List" : "View as Web"}
        </button>
      </div>

      {proposal !== null && (
        <ProposalOutcomeBanner
          outcome={proposal.outcome}
          targetName={proposal.name}
          onDismiss={() => setProposal(null)}
        />
      )}

      {/* P23: betrothal panel — pick one of your pre-adult children, then click
          "Betroth" on a pre-adult society/rival child below. Auto-honors at
          adulthood (year-pass). */}
      <div
        data-testid="betrothal-panel"
        className="space-y-1 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm"
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-stone-700">Arrange a betrothal:</span>
          <select
            data-testid="betroth-child-select"
            value={betrothChildId}
            onChange={(e) => setBetrothChildId(e.target.value as CharacterId | "")}
            className="rounded border border-stone-300 px-1.5 py-0.5 text-xs"
          >
            <option value="">— your child —</option>
            {eligibleChildren.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.age}y)
              </option>
            ))}
          </select>
          <span className="text-xs text-stone-500">
            then click "Betroth" on a young society or rival member below.
          </span>
        </div>
        {betrothalNote !== null && (
          <p data-testid="betrothal-note" className="text-xs text-stone-600">
            {betrothalNote}
          </p>
        )}
        {pendingBetrothals.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {pendingBetrothals.map((b) => (
              <li key={b.id} className="flex items-center gap-2 text-xs text-stone-600">
                <span>
                  {characters.get(b.partyAId)?.name ?? b.partyAId} ⟷{" "}
                  {characters.get(b.partyBId)?.name ?? b.partyBId} (pending)
                </span>
                <button
                  type="button"
                  data-testid={`betroth-break-${b.id}`}
                  onClick={() => {
                    const r = breakBetrothal(b.id as BetrothalId);
                    setBetrothalNote(
                      r.ok ? "Betrothal broken." : `Could not break: ${r.reason.kind}.`,
                    );
                  }}
                  className="rounded border border-stone-300 px-1.5 py-0.5 font-medium text-stone-700 hover:bg-stone-100"
                >
                  Break
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {spatial ? (
        <div
          data-testid="society-web"
          role="img"
          aria-label="Society web — the ton's affection network"
          className="rounded-md border border-stone-300 bg-stone-900"
        >
          <ForceGraph2D
            width={640}
            height={420}
            graphData={graphData}
            nodeId="id"
            nodeLabel="name"
            nodeColor={(node: SocialNode) => node.color}
            nodeRelSize={5}
            linkColor={(link: SocialLink) => (link.direction === "inbound" ? "#0d9488" : "#57534e")}
            linkWidth={(link: SocialLink) => Math.max(1, link.weight * 4)}
            linkDirectionalArrowLength={(link: SocialLink) =>
              link.direction === "inbound" ? 4 : 0
            }
            linkDirectionalArrowRelPos={1}
            backgroundColor="#1c1917"
          />
        </div>
      ) : (
        <div className="space-y-5">
          {houseGroups.map(({ house, members }) => (
            <div key={house.id} className="space-y-1">
              <h4
                className="flex items-center gap-2 text-sm font-semibold text-stone-700"
                data-testid={`society-house-${house.id}`}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: factionColor(house.factionId) }}
                />
                {houseDisplayName(house.id)}
                <span className="text-xs font-normal text-stone-400">({members.length})</span>
              </h4>
              <ul className="space-y-1">
                {members.map((c) => (
                  <SocietyRow
                    key={c.id}
                    c={c}
                    factionId={house.factionId}
                    bio={bioFor(c)}
                    onRevealBio={() => revealNpcBio(c.id)}
                    onPropose={() => setProposal({ outcome: proposeMarriage(c.id), name: c.name })}
                    onBetroth={c.age < ADULTHOOD_AGE_IN_YEARS ? () => onBetroth(c) : null}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
