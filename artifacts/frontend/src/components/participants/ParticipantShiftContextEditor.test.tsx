import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ParticipantShiftContextEditor } from "@/components/participants/ParticipantShiftContextEditor";

const jsonFetchMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@/services/http", () => ({
  jsonFetch: (...args: unknown[]) => jsonFetchMock(...args),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

describe("CARECLIQV2-49 ParticipantShiftContextEditor", () => {
  beforeEach(() => {
    jsonFetchMock.mockReset();
    toastMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads coordinator shift-context data into form fields", async () => {
    jsonFetchMock.mockResolvedValueOnce({
      profile: {
        preferred_name: "Jamie",
        case_manager: { name: "Alex Rivera", phone: "0400 777 666" },
      },
      preferences: {
        likes_dislikes: "Enjoys puzzles",
        communication_style: "Short prompts",
      },
      context: {
        communication_guidance: "One instruction at a time",
        previous_visit_notes: "Hydration prompts worked well",
        preferred_activities: ["Gardening"],
        medical: {
          conditions: "Type 2 diabetes",
          allergies: [{ allergen: "Peanuts", severity: "anaphylactic", notes: "EpiPen" }],
        },
        behavioural_notes: [{ title: "Transitions", body: "Give warning" }],
      },
    });

    render(<ParticipantShiftContextEditor participantId="p-1" />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Jamie")).toBeTruthy();
    });

    expect(screen.getByDisplayValue("Alex Rivera")).toBeTruthy();
    expect(screen.getByDisplayValue("Enjoys puzzles")).toBeTruthy();
    expect(screen.getByText("Save shift context")).toBeTruthy();
  });

  it("sends PATCH payload and shows success toast on save", async () => {
    jsonFetchMock
      .mockResolvedValueOnce({
        profile: {},
        preferences: {},
        context: { preferred_activities: [], medical: { allergies: [] }, behavioural_notes: [] },
      })
      .mockResolvedValueOnce({
        profile: { preferred_name: "Jamie Updated" },
        preferences: {},
        context: { preferred_activities: [], medical: { allergies: [] }, behavioural_notes: [] },
      });

    render(<ParticipantShiftContextEditor participantId="p-1" />);

    await waitFor(() => {
      expect(screen.getByText("Save shift context")).toBeTruthy();
    });

    const preferredNameInput = screen.getAllByRole("textbox")[0];
    fireEvent.change(preferredNameInput, { target: { value: "Jamie Updated" } });
    fireEvent.click(screen.getByText("Save shift context"));

    await waitFor(() => {
      expect(jsonFetchMock).toHaveBeenCalledTimes(2);
    });

    const patchCall = jsonFetchMock.mock.calls[1];
    expect(patchCall[0]).toBe("/api/participants/p-1/shift-context");
    expect(patchCall[1]?.method).toBe("PATCH");
    expect(String(patchCall[1]?.body)).toContain("Jamie Updated");
    expect(toastMock).toHaveBeenCalledWith({ title: "Shift context saved" });
  });
});
