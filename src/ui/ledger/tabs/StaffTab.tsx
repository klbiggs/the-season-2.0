// P14: Staff tab. Wraps the existing StaffPanel (roster + assignment) and
// SpymasterInterceptCard (spymaster action), both moved here from the MapView
// sidebar. Zero behavioral change to either panel.

import type { SeasonStore } from "../../../game/store";
import { SpymasterInterceptCard } from "../SpymasterInterceptCard";
import { StaffPanel } from "../StaffPanel";

type Props = {
  store: SeasonStore;
};

export function StaffTab({ store }: Props) {
  return (
    <section data-testid="ledger-tab-staff" className="space-y-6">
      <h2 className="text-lg font-semibold text-stone-800">Staff</h2>
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">Roster</h3>
        <StaffPanel store={store} />
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
          Spymaster Action
        </h3>
        <SpymasterInterceptCard store={store} />
      </div>
    </section>
  );
}
