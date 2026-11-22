import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ScoreMeter, SegmentedBar, bandParts, scoreBand } from "./figures";

afterEach(cleanup);

it("puts a score in its band: 85 and over compliant, 60 to 84 at risk", () => {
  expect(scoreBand(85)).toBe("good");
  expect(scoreBand(84)).toBe("warning");
  expect(scoreBand(60)).toBe("warning");
  expect(scoreBand(59)).toBe("critical");
});

it("shows a score as a figure, its band in words, and a meter", () => {
  render(<ScoreMeter value={72.4} label="Overall score" />);
  expect(screen.getByText("72")).toBeTruthy();
  expect(screen.getByText("At risk")).toBeTruthy();
  const meter = screen.getByRole("meter", { name: "Overall score" });
  expect(meter.getAttribute("aria-valuenow")).toBe("72");
  expect(meter.getAttribute("aria-valuetext")).toBe("72 out of 100, At risk");
});

it("says there's no score rather than showing zero", () => {
  render(<ScoreMeter value={null} label="Overall score" />);
  expect(screen.getByText("No score")).toBeTruthy();
  expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBeNull();
});

it("splits a whole into labelled blocks with a legend and a tooltip", () => {
  render(
    <SegmentedBar
      label="Active staff by role"
      unit="staff"
      parts={[
        { key: "w", label: "Support workers", value: 9, color: "var(--viz-1)" },
        { key: "c", label: "Coordinators", value: 3, color: "var(--viz-2)" },
      ]}
    />,
  );
  expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
    "Active staff by role. Support workers: 9 staff, 75%; Coordinators: 3 staff, 25%",
  );
  expect(screen.getByText("75%")).toBeTruthy();
  expect(screen.getByText("Support workers")).toBeTruthy();
  fireEvent.focus(screen.getByLabelText("Coordinators: 3 staff, 25%"));
  expect(screen.getByRole("tooltip").textContent).toContain("Coordinators");
});

it("draws nothing for an empty part but keeps it in the legend", () => {
  render(<SegmentedBar label="Shifts by compliance" parts={bandParts({ compliant: 4, at_risk: 0, non_compliant: 1 })} />);
  expect(screen.queryByLabelText(/At risk: 0/)).toBeNull();
  expect(screen.getByText("At risk")).toBeTruthy();
});

it("says so when there's nothing to split", () => {
  render(<SegmentedBar label="x" parts={bandParts({ compliant: 0, at_risk: 0, non_compliant: 0 })} empty="No shifts yet" />);
  expect(screen.getByText("No shifts yet")).toBeTruthy();
});
