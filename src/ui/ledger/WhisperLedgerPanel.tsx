// P6: inline ledger panel showing whispers by status. Verified whispers
// expose three weaponize buttons (Blackmail / Scandal Sheet /
// Accidental Slip) plus Dismiss; Unverified whispers show a verification
// progress bar. Renders as a collapsible section on the strategy-map
// sidebar — P14 ships the full tabbed ledger view.

import { useShallow } from "zustand/react/shallow";
import type { WeaponizationBranch } from "../../game/constants";
import type { WhisperId } from "../../game/rng.seeds";
import type { SeasonStore } from "../../game/store";

type Props = {
  store: SeasonStore;
};

export function WhisperLedgerPanel({ store }: Props) {
  const { whispers, characters } = store(
    useShallow((s) => ({
      whispers: s.whispers,
      characters: s.characters,
    })),
  );
  const weaponizeWhisper = store((s) => s.weaponizeWhisper);
  const dismissWhisper = store((s) => s.dismissWhisper);

  const sorted = [...whispers.values()].sort((a, b) => a.id.localeCompare(b.id));
  const unverified = sorted.filter((w) => w.status === "Unverified");
  const verified = sorted.filter((w) => w.status === "Verified");
  const weaponized = sorted.filter((w) => w.status === "Weaponized");

  if (sorted.length === 0) {
    return (
      <div className="whisper-ledger-panel">
        <h3 className="whisper-ledger-panel__title">Whispers</h3>
        <p className="whisper-ledger-panel__empty">No whispers yet.</p>
      </div>
    );
  }

  const charName = (id: string): string => characters.get(id as never)?.name ?? id;

  const onWeaponize = (whisperId: WhisperId, branch: WeaponizationBranch) => {
    const result = weaponizeWhisper(whisperId, branch);
    if (!result.ok) {
      console.warn(`weaponizeWhisper(${whisperId}, ${branch}) rejected:`, result.reason);
    }
  };

  const onDismiss = (whisperId: WhisperId) => {
    if (!window.confirm("Dismiss this whisper? This is irreversible.")) return;
    const result = dismissWhisper(whisperId);
    if (!result.ok) {
      console.warn(`dismissWhisper(${whisperId}) rejected:`, result.reason);
    }
  };

  return (
    <div className="whisper-ledger-panel">
      <h3 className="whisper-ledger-panel__title">Whispers</h3>
      {unverified.length > 0 && (
        <section>
          <h4 className="whisper-ledger-panel__heading">Unverified ({unverified.length})</h4>
          <ul className="whisper-ledger-panel__list">
            {unverified.map((w) => (
              <li key={w.id} className="whisper-ledger-panel__row">
                <span className="whisper-ledger-panel__subject">
                  About {charName(w.subjectCharacterId)}
                </span>
                <span className="whisper-ledger-panel__progress">
                  {w.arrivedAtTick === null
                    ? "in transit"
                    : `verifying ${w.verificationProgress}/100`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {verified.length > 0 && (
        <section>
          <h4 className="whisper-ledger-panel__heading">Verified ({verified.length})</h4>
          <ul className="whisper-ledger-panel__list">
            {verified.map((w) => (
              <li key={w.id} className="whisper-ledger-panel__row">
                <span className="whisper-ledger-panel__subject">
                  About {charName(w.subjectCharacterId)}
                </span>
                <div className="whisper-ledger-panel__actions">
                  <button
                    type="button"
                    className="whisper-ledger-panel__btn"
                    title="Blackmail: modest scandal cost, small affection boost from subject."
                    onClick={() => onWeaponize(w.id, "Blackmail")}
                  >
                    Blackmail
                  </button>
                  <button
                    type="button"
                    className="whisper-ledger-panel__btn"
                    title="Scandal Sheet: large rep damage to subject; 15% chance of self-exile."
                    onClick={() => onWeaponize(w.id, "ScandalSheet")}
                  >
                    Scandal Sheet
                  </button>
                  <button
                    type="button"
                    className="whisper-ledger-panel__btn"
                    title="Accidental Slip: drip-feed rep damage over 5 conversation turns."
                    onClick={() => onWeaponize(w.id, "AccidentalSlip")}
                  >
                    Slip
                  </button>
                  <button
                    type="button"
                    className="whisper-ledger-panel__btn whisper-ledger-panel__btn--dismiss"
                    onClick={() => onDismiss(w.id)}
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {weaponized.length > 0 && (
        <section>
          <h4 className="whisper-ledger-panel__heading">Weaponized ({weaponized.length})</h4>
          <ul className="whisper-ledger-panel__list">
            {weaponized.map((w) => (
              <li key={w.id} className="whisper-ledger-panel__row">
                <span className="whisper-ledger-panel__subject">
                  About {charName(w.subjectCharacterId)}
                </span>
                <span className="whisper-ledger-panel__meta">
                  {w.weaponizedAs}
                  {w.weaponizedAs === "ScandalSheet" && w.scandalSheetAttribution === true
                    ? " — attributed!"
                    : ""}
                  {w.weaponizedAs === "AccidentalSlip" && w.accidentalSlipDripsRemaining > 0
                    ? ` (${w.accidentalSlipDripsRemaining} drips left)`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
