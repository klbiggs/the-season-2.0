import { useShallow } from "zustand/react/shallow";
import { PATRONESS_FAVOR_EROSION_SCANDAL_THRESHOLD } from "../../game/constants";
import { LOCATION_LABELS } from "../../game/fixtures/locations";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import { getEffectiveReputation } from "../../game/rules/artifacts";
import type { SeasonStore } from "../../game/store";

// Campaign-meta header. Always-mounted persistent chrome above the map.
//
// Head-age lookup uses the two-step s.houses → s.characters pattern from
// the dev-shell <HeadAgeReadout />. Optional-chaining tolerates the
// transient between replaceState calls where one Map is updated but the
// next isn't (the pure-rules layer uses getCharacterOrThrow; the UI cannot
// afford a mid-render throw without an error boundary). Post-succession
// the lookup naturally returns the newly-promoted head's age.

type Props = {
  store: SeasonStore;
  // P14: opens the Ledger view. Disabled while an elopement modal is active.
  onEnterLedger?: (() => void) | undefined;
};

export function TopBar({ store, onEnterLedger }: Props) {
  const tick = store((s) => s.tick);
  const campaignName = store((s) => s.campaignName);
  const headAge = store((s) => {
    const house = s.houses.get(PLAYER_HOUSE_ID);
    if (house === undefined) return null;
    const head = s.characters.get(house.headOfHouseCharacterId);
    return head?.age ?? null;
  });
  const currentLocation = store((s) => s.houses.get(PLAYER_HOUSE_ID)?.currentLocation ?? null);
  // P14: wealth + effective-reputation read-outs. useShallow bundles the
  // multi-Map read (getEffectiveReputation walks both s.houses AND
  // s.characters) into a single subscription per the WhisperLedgerPanel
  // precedent — both fields return primitives so the shallow-equality check
  // matches Zustand's default selector semantics.
  const { wealth, effectiveReputation, scandal, generation } = store(
    useShallow((s) => ({
      wealth: s.houses.get(PLAYER_HOUSE_ID)?.wealth ?? null,
      effectiveReputation:
        s.houses.get(PLAYER_HOUSE_ID) !== undefined
          ? getEffectiveReputation(s, PLAYER_HOUSE_ID)
          : null,
      // P20: scandal is the player's clamped [0,100] censure scalar. Its real
      // threshold consequence is patroness favor erosion at ≥ 50
      // (PATRONESS_FAVOR_EROSION_SCANDAL_THRESHOLD) — NOT a direct exile trigger
      // (exile only fires from Scandal-Sheet self-attribution). The cue reflects
      // that real mechanic, not an invented exile-proximity.
      scandal: s.houses.get(PLAYER_HOUSE_ID)?.scandal ?? null,
      generation: s.houses.get(PLAYER_HOUSE_ID)?.generation ?? null,
    })),
  );
  // ancestorSummary is a stable array reference until succession appends a line,
  // so a plain selector is safe under Object.is (no useShallow needed).
  const ancestorSummary = store((s) => s.houses.get(PLAYER_HOUSE_ID)?.ancestorSummary ?? null);
  const underCensure = scandal !== null && scandal >= PATRONESS_FAVOR_EROSION_SCANDAL_THRESHOLD;
  // P14: elopement-modal gate — disable Ledger entry while the sprint overlay
  // owns the screen (mirrors the rule-layer modal-state gate principle).
  const elopement = store((s) => s.elopement);
  return (
    <header className="w-full bg-stone-100 border-b border-stone-300 px-6 py-3 flex items-center gap-6">
      <h1 className="text-lg font-semibold text-stone-800 flex-1" data-testid="campaign-name">
        {campaignName}
      </h1>
      <div className="text-sm text-stone-600" data-testid="current-location-label">
        Location:{" "}
        <span className="font-medium text-stone-800">
          {currentLocation === null ? "—" : LOCATION_LABELS[currentLocation]}
        </span>
      </div>
      <div className="text-sm text-stone-600" data-testid="head-age-readout">
        Head age: <span className="font-medium text-stone-800">{headAge ?? "—"}</span>
      </div>
      <div className="text-sm text-stone-600" data-testid="wealth-readout">
        Wealth: <span className="font-medium text-stone-800">{wealth ?? "—"}</span>
      </div>
      <div className="text-sm text-stone-600" data-testid="effective-reputation-readout">
        Reputation: <span className="font-medium text-stone-800">{effectiveReputation ?? "—"}</span>
      </div>
      <div
        className="text-sm text-stone-600"
        data-testid="scandal-readout"
        title={
          underCensure
            ? `Scandal ≥ ${PATRONESS_FAVOR_EROSION_SCANDAL_THRESHOLD}: a patroness's favor erodes each tick.`
            : "Scandal accrues from rejections, schemes, and bankruptcy."
        }
      >
        Scandal:{" "}
        <span className={`font-medium ${underCensure ? "text-rose-700" : "text-stone-800"}`}>
          {scandal ?? "—"}
        </span>
        {underCensure && (
          <span
            className="ml-1 text-xs font-semibold text-rose-700"
            data-testid="scandal-censure-cue"
          >
            (censure)
          </span>
        )}
      </div>
      <div className="text-sm text-stone-600" data-testid="generation-readout">
        Gen: <span className="font-medium text-stone-800">{generation ?? "—"}</span>
      </div>
      {ancestorSummary !== null && ancestorSummary.length > 0 && (
        <details className="text-sm text-stone-600" data-testid="ancestor-summary">
          <summary className="cursor-pointer select-none text-stone-500 hover:text-stone-800">
            Lineage ({ancestorSummary.length})
          </summary>
          <ul className="absolute z-10 mt-1 max-w-xs space-y-0.5 rounded border border-stone-300 bg-white p-2 text-xs text-stone-600 shadow-md">
            {ancestorSummary.map((line, i) => (
              <li key={`${i}-${line}`}>{line}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="text-sm text-stone-600" data-testid="tick-readout">
        Tick: <span className="font-medium text-stone-800">{tick}</span>
      </div>
      <button
        type="button"
        onClick={onEnterLedger}
        disabled={elopement !== null}
        data-testid="open-ledger-btn"
        className="rounded-md bg-stone-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        View Ledger
      </button>
    </header>
  );
}
