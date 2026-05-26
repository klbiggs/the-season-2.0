// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CharacterId, MarriageId } from "../../game/rng.seeds";
import type { ProposalOutcome, ProposalRejection } from "../../game/rules/proposal";
import { ProposalOutcomeBanner } from "./ProposalOutcomeBanner";

afterEach(cleanup);

// Every ProposalRejection variant (proposal.ts:42-56). The compile-time
// exhaustiveness guard lives INSIDE the component (`const exhaustive: never`);
// this list is the runtime case-per-variant coverage. If a variant is added to
// the union, the component fails to typecheck AND this array should grow.
const ALL_REJECTIONS: ProposalRejection[] = [
  { kind: "TargetTooYoung" },
  { kind: "TargetExiled" },
  { kind: "TargetDead" },
  { kind: "TargetAlreadyMarried" },
  { kind: "TargetIsPlayerHead" },
  { kind: "TargetIsSameHouse" },
  { kind: "CrossHouseMarriageNotSupported" },
  { kind: "TargetNotFound" },
  { kind: "InsufficientAffection", current: 40, required: 80 },
  { kind: "InsufficientReputation", current: 20, required: 40 },
  { kind: "PlayerAlreadyMarried" },
  { kind: "PlayerHeadDead" },
  { kind: "PlayerExiled" },
  { kind: "ElopementInProgress" },
];

describe("ProposalOutcomeBanner", () => {
  it("renders nothing for a null outcome", () => {
    const { container } = render(<ProposalOutcomeBanner outcome={null} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a success banner with the target name on acceptance", () => {
    const outcome: ProposalOutcome = {
      ok: true,
      accepted: true,
      marriageId: "m-x" as MarriageId,
      spouseRoleFlipped: "c-x" as CharacterId,
    };
    render(
      <ProposalOutcomeBanner outcome={outcome} targetName="Miss Blackwood" onDismiss={() => {}} />,
    );
    const banner = screen.getByTestId("proposal-outcome-banner");
    expect(banner.getAttribute("data-tone")).toBe("success");
    expect(banner.textContent).toContain("Miss Blackwood");
    expect(banner.textContent).toContain("accepted");
  });

  it("renders a warn banner with the scandal delta on roll-rejection", () => {
    const outcome: ProposalOutcome = { ok: true, accepted: false, scandalDelta: 5 };
    render(<ProposalOutcomeBanner outcome={outcome} onDismiss={() => {}} />);
    const banner = screen.getByTestId("proposal-outcome-banner");
    expect(banner.getAttribute("data-tone")).toBe("warn");
    expect(banner.textContent).toContain("+5 scandal");
  });

  it.each(ALL_REJECTIONS.map((r) => [r.kind, r] as const))(
    "renders error prose for rejection %s",
    (_kind, reason) => {
      const outcome: ProposalOutcome = { ok: false, reason };
      render(<ProposalOutcomeBanner outcome={outcome} onDismiss={() => {}} />);
      const banner = screen.getByTestId("proposal-outcome-banner");
      expect(banner.getAttribute("data-tone")).toBe("error");
      // Non-empty, non-fallback prose for every variant.
      expect(banner.textContent?.trim().length ?? 0).toBeGreaterThan(0);
      cleanup();
    },
  );

  it("interpolates the current/required values for threshold rejections", () => {
    render(
      <ProposalOutcomeBanner
        outcome={{
          ok: false,
          reason: { kind: "InsufficientAffection", current: 40, required: 80 },
        }}
        onDismiss={() => {}}
      />,
    );
    const banner = screen.getByTestId("proposal-outcome-banner");
    expect(banner.textContent).toContain("40");
    expect(banner.textContent).toContain("80");
  });
});
