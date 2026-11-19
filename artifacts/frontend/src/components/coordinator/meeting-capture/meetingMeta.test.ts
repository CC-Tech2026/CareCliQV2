import { describe, expect, it } from "vitest";
import { formatMeetingDate, goalAreaLabel, matchLabel, meetingTypeLabel } from "./meetingMeta";

describe("meeting labels", () => {
  it("names goal areas as the NDIS outcome domains", () => {
    expect(goalAreaLabel("independence_daily_living")).toBe("Daily living");
    expect(goalAreaLabel("community_participation")).toBe("Social and community participation");
    expect(goalAreaLabel("employment")).toBe("Work");
    expect(goalAreaLabel("some_new_area")).toBe("Some new area");
    expect(goalAreaLabel(null)).toBe("");
  });

  it("says how sure the match is in plain words, and flags the weak ones", () => {
    expect(matchLabel(0.92)).toEqual({ label: "Clearly said", check: false });
    expect(matchLabel(0.7)).toEqual({ label: "Probably said", check: false });
    expect(matchLabel(0.4)).toEqual({ label: "Check the transcript", check: true });
  });

  it("uses provider names for meeting types", () => {
    expect(meetingTypeLabel("plan_review")).toBe("Plan review");
    expect(meetingTypeLabel("initial_setup")).toBe("Service start-up");
    expect(meetingTypeLabel("unknown")).toBe("Meeting");
  });

  it("shows a time only when the meeting has one", () => {
    expect(formatMeetingDate("2026-08-02")).toBe("2 Aug 2026");
    expect(formatMeetingDate("2026-11-12T10:30:00")).toMatch(/^12 Nov 2026, 10:30am$/);
  });
});
