import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ParticipantProfileCard } from "@/components/shifts/ParticipantProfileCard";
import { ParticipantPreferencesCard } from "@/components/shifts/ParticipantPreferencesCard";

describe("CARECLIQV2-195 ParticipantProfileCard", () => {
  it("renders profile fields with tel links and emergency highlight", () => {
    render(
      <ParticipantProfileCard
        profile={{
          preferred_name: "Jamie",
          date_of_birth: "1990-01-15",
          ndis_number: "430123456",
          phone: "0400111222",
          email: "jamie@example.com",
          emergency_contact: { name: "Sam Lee", phone: "0400999888", relationship: "Brother" },
          case_manager: { name: "Alex Rivera", phone: "0400777666" },
          primary_disability: "Autism",
        }}
      />,
    );

    expect(screen.getByText("Participant Profile")).toBeTruthy();
    expect(screen.getByText("Emergency contact")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Sam Lee/i }).getAttribute("href")).toBe("tel:0400999888");
    expect(screen.getByRole("link", { name: /Alex Rivera/i }).getAttribute("href")).toBe("tel:0400777666");
    expect(screen.getByRole("link", { name: "0400111222" }).getAttribute("href")).toBe("tel:0400111222");
    expect(screen.getByText(/15 Jan 1990/)).toBeTruthy();
    expect(screen.getByText("430123456")).toBeTruthy();
  });

  it("shows Not recorded for missing optional fields", () => {
    render(<ParticipantProfileCard profile={{ preferred_name: "Jamie" }} />);
    const missing = screen.getAllByText("Not recorded");
    expect(missing.length).toBeGreaterThan(0);
  });
});

describe("CARECLIQV2-196 ParticipantPreferencesCard", () => {
  it("renders all preference sections with content", () => {
    render(
      <ParticipantPreferencesCard
        preferences={{
          communication_style: "Short sentences",
          likes_dislikes: "Enjoys puzzles",
          routines: "Shower before 10am",
          sensory_preferences: "Quiet spaces",
          cultural_preferences: "Prefers morning visits",
        }}
      />,
    );

    expect(screen.getByText("Participant Preferences")).toBeTruthy();
    expect(screen.getByText("Short sentences")).toBeTruthy();
    expect(screen.getByText("Enjoys puzzles")).toBeTruthy();
    expect(screen.getByText("Shower before 10am")).toBeTruthy();
    expect(screen.getByText("Quiet spaces")).toBeTruthy();
    expect(screen.getByText("Prefers morning visits")).toBeTruthy();
  });

  it("shows Not recorded for empty sections and exposes collapse control for long text", () => {
    const longText = "Routine detail. ".repeat(20);
    render(
      <ParticipantPreferencesCard
        preferences={{
          communication_style: longText,
        }}
      />,
    );

    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Communication style preferences/i })).toBeTruthy();
  });
});
