// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStore } from "../../game/store";
import * as dexie from "../../persist/dexie";
import { SettingsMenu } from "./SettingsMenu";

afterEach(cleanup);

function renderMenu() {
  const store = createStore({ seed: "settings-test" });
  render(<SettingsMenu store={store} onStatus={vi.fn()} onLoadError={vi.fn()} />);
  fireEvent.click(screen.getByTestId("settings-menu-trigger")); // open dropdown
}

describe("SettingsMenu — Reset Save (dev-only, P22 follow-up)", () => {
  it("renders the dev-only Reset Save button in the dropdown", () => {
    renderMenu();
    expect(screen.getByTestId("settings-menu-reset-save")).toBeTruthy();
  });

  it("requires a two-click confirm before deleting the save", async () => {
    const resetSpy = vi.spyOn(dexie, "resetSave").mockResolvedValue(undefined);
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ reload } as unknown as Location);
    renderMenu();

    const btn = screen.getByTestId("settings-menu-reset-save");
    // First click arms the confirm — no destructive call yet.
    fireEvent.click(btn);
    expect(resetSpy).not.toHaveBeenCalled();
    expect(btn.textContent).toContain("confirm?");

    // Second click performs the reset and reloads.
    fireEvent.click(btn);
    await vi.waitFor(() => expect(resetSpy).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

    resetSpy.mockRestore();
  });

  it("disarms the confirm when the menu is toggled", () => {
    renderMenu();
    const btn = screen.getByTestId("settings-menu-reset-save");
    fireEvent.click(btn); // arm
    expect(btn.textContent).toContain("confirm?");
    // Toggle the menu closed then open again — confirm should be disarmed.
    fireEvent.click(screen.getByTestId("settings-menu-trigger")); // close
    fireEvent.click(screen.getByTestId("settings-menu-trigger")); // reopen
    expect(screen.getByTestId("settings-menu-reset-save").textContent).toContain("(dev)");
  });
});
