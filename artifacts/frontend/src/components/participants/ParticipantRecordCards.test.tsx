import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ParticipantRecordCards } from "./ParticipantRecordCards";

const state = vi.hoisted(() => ({ contextError: false }));
const DATA: Record<string, unknown> = {
  "shift-context": {
    profile: {
      care_coordinator: { name: "Patience SC" },
      emergency_contact: {
        name: "Linh Nguyen",
        phone: "0491 571 266",
        relationship: "Wife",
      },
      gp: {
        name: "Dr Anthony Ruiz",
        phone: "(08) 5550 1322",
        practice: "Prospect Medical Centre",
      },
      primary_disability: "Acquired Brain Injury",
    },
    preferences: {
      communication_style: "One step at a time.",
      cultural_preferences: "Vietnamese Australian.",
    },
    context: {
      medical: {
        allergies: [{ id: "a1", allergen: "Shellfish", severity: "moderate" }],
        conditions: "Post-traumatic epilepsy.",
        alerts: "Seizure risk.",
      },
      behavioural_notes: [
        { title: "Fatigue", body: "Energy drops after 1 pm." },
      ],
      preferred_activities: ["Gardening"],
      goals: [
        {
          id: "g1",
          title: "Follow a daily routine",
          worker_focus: "Prompt him to check his planner.",
        },
      ],
    },
    background_summary: "Jack is 47 and lives in Prospect.",
    briefing_alerts: ["Seizure risk: call 000 after 5 minutes"],
  },
  medications: {
    medications: [
      {
        id: "m1",
        name: "Levetiracetam",
        strength: "500 mg",
        status: "active",
        scheduled_times: ["08:00", "20:00"],
      },
    ],
  },
  "budget-summary": {
    has_plan: true,
    total_funding: 74000,
    total_used: 0,
    total_remaining: 74000,
    budgets: [],
  },
  "restricted-clinical": {
    behaviour_support_plan: "No restrictive practices.",
  },
};
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: (key: string[]) => ({
    data:
      key[0] === "shift-context" && state.contextError
        ? undefined
        : DATA[key[2]],
    isLoading: false,
    isError: key[2] === "shift-context" && state.contextError,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/services/http", () => ({ jsonFetch: vi.fn() }));
afterEach(() => {
  cleanup();
  state.contextError = false;
});

it("shows the care team, health, medications, briefing, goals and funding", () => {
  render(<ParticipantRecordCards participantId="p-1" />);
  for (const text of [
    "Patience SC",
    "Dr Anthony Ruiz · Prospect Medical Centre",
    "Linh Nguyen · Wife",
    "Seizure risk.",
    "Shellfish · moderate",
    "Levetiracetam · 500 mg",
    "Jack is 47 and lives in Prospect.",
    "Seizure risk: call 000 after 5 minutes",
    "Follow a daily routine",
    "$74,000",
    "No restrictive practices.",
  ]) {
    expect(screen.getAllByText(text).length).toBeGreaterThan(0);
  }
});

it("offers a retry instead of empty cards when the record can't load", () => {
  state.contextError = true;
  render(<ParticipantRecordCards participantId="p-1" />);
  expect(screen.getByRole("alert").textContent).toContain(
    "could not be loaded",
  );
});
