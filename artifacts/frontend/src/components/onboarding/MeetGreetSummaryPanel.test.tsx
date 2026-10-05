import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MeetGreetSummary } from "@/services/participantIntakeService";

vi.mock("@/hooks/useOrgQuery", () => ({ useOrgQuery: () => ({ data: null }) }));

import { MeetGreetSummaryPanel } from "./MeetGreetSummaryPanel";

afterEach(() => cleanup());

const summary = (over: Partial<MeetGreetSummary> = {}): MeetGreetSummary => ({
  generated_at: "2026-10-05T00:00:00Z",
  sources: [
    { id: "r1-s2", speaker: "Liam Carter", text: "I'd like help with showering three days a week at home." },
    { id: "r1-s3", speaker: "Liam Carter", text: "I want to get back to swimming at the local pool." },
    { id: "n1", speaker: "Coordinator notes", text: "Allergic to penicillin." },
  ],
  topics: { goals: [{ text: "Get back to swimming at the local pool", source_ids: ["r1-s3"] }] },
  supports: [{
    description: "Help with showering", item_code: "01_011_0107_1_1", hours_per_week: null,
    frequency: "weekly", location: "home", source_ids: ["r1-s2"], unverified: ["hours"],
  }],
  uncovered: [{ id: "n1", speaker: "Coordinator notes", text: "Allergic to penicillin.", status: "open" }],
  dropped_points: 1,
  ...over,
});

it("shows each point with what was said, and the supports with what wasn't", () => {
  render(<MeetGreetSummaryPanel summary={summary()} />);
  expect(screen.getByText("Get back to swimming at the local pool")).toBeTruthy();
  expect(screen.getByText(/"I want to get back to swimming at the local pool\."/)).toBeTruthy();
  expect(screen.getByText("Help with showering")).toBeTruthy();
  // Hours weren't said, so they're not filled in.
  expect(screen.getByText("01_011_0107_1_1 · weekly · at home · Not said: hours")).toBeTruthy();
  expect(screen.getByText(/1 suggested point was left out because it didn't match anything said/)).toBeTruthy();
});

it("lists what was said but isn't in the summary, to include or dismiss", () => {
  const onReview = vi.fn();
  render(<MeetGreetSummaryPanel summary={summary()} editable onReview={onReview} onSummarise={vi.fn()} />);
  expect(screen.getByText("Said but not in the summary (1)")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Include" }));
  expect(onReview).toHaveBeenCalledWith("n1", "include");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(onReview).toHaveBeenCalledWith("n1", "dismiss");
});

it("says when everything said is covered", () => {
  render(<MeetGreetSummaryPanel summary={summary({ uncovered: [{ id: "n1", speaker: "Coordinator notes", text: "x", status: "included" }] })} />);
  expect(screen.getByText("Everything said is covered.")).toBeTruthy();
});

it("offers to summarise once the conversation is captured", () => {
  const onSummarise = vi.fn();
  render(<MeetGreetSummaryPanel summary={null} editable onSummarise={onSummarise} />);
  fireEvent.click(screen.getByRole("button", { name: /Summarise conversation/ }));
  expect(onSummarise).toHaveBeenCalled();
});
