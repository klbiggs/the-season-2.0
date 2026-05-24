// P14: Whispers tab. Thin wrapper around the existing WhisperLedgerPanel
// (moved here from the MapView sidebar). The panel already covers the all-zero
// empty-state + the three weaponize branches + Dismiss, so the wrapper only
// adds tab-page chrome.

import type { SeasonStore } from "../../../game/store";
import { WhisperLedgerPanel } from "../WhisperLedgerPanel";

type Props = {
  store: SeasonStore;
};

export function WhispersTab({ store }: Props) {
  return (
    <section data-testid="ledger-tab-whispers" className="space-y-4">
      <h2 className="text-lg font-semibold text-stone-800">Whispers</h2>
      <WhisperLedgerPanel store={store} />
    </section>
  );
}
