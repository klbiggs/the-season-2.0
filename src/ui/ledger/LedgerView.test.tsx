// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// FamilyTreeTab (default tab) can toggle into SocialWebView, which imports the
// canvas lib at module load — stub it.
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

import { createStore } from "../../game/store";
import { LedgerView } from "./LedgerView";

afterEach(cleanup);

const TAB_KEYS = [
  "family-tree",
  "whispers",
  "schemes",
  "patronesses",
  "grievances",
  "rivals",
  "staff",
  "artifacts",
  "dynasty",
  "scandal-sheet",
] as const;

describe("LedgerView (matrix #4)", () => {
  it("renders all 10 tab buttons and the default Family Tree panel", () => {
    const store = createStore({ seed: "ledger-test" });
    render(<LedgerView store={store} onExit={() => {}} />);
    for (const key of TAB_KEYS) {
      expect(screen.getByTestId(`ledger-tabbtn-${key}`)).toBeTruthy();
    }
    expect(screen.getByTestId("ledger-tab-family-tree")).toBeTruthy();
  });

  it("activates each tab on click", () => {
    const store = createStore({ seed: "ledger-test" });
    render(<LedgerView store={store} onExit={() => {}} />);
    for (const key of TAB_KEYS) {
      fireEvent.click(screen.getByTestId(`ledger-tabbtn-${key}`));
      expect(screen.getByTestId(`ledger-tab-${key}`)).toBeTruthy();
    }
  });

  it("fires onExit from the Back to Map button", () => {
    const store = createStore({ seed: "ledger-test" });
    const onExit = vi.fn();
    render(<LedgerView store={store} onExit={onExit} />);
    fireEvent.click(screen.getByTestId("ledger-back-btn"));
    expect(onExit).toHaveBeenCalledOnce();
  });
});
