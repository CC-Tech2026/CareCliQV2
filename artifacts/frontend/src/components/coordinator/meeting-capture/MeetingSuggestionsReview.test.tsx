import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MeetingSuggestionsReview } from "./MeetingSuggestionsReview";

const apply = vi.hoisted(() => vi.fn());
vi.mock("@/services/coordinatorService", () => ({ applyPlanMeetingSuggestions: apply }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const transcript = [
  { segment_id: "s2", speaker_name: "Liam Carter", text: "I want to get the bus to the library on my own." },
  { segment_id: "s4", speaker_name: "Morgan Hayes", text: "Practise the timetable app before leaving home." },
];

function setup(onApplied = vi.fn()) {
  apply.mockResolvedValue({ goals_created: 1, tasks_created: 1, meeting_id: "m1" });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MeetingSuggestionsReview
        sessionId="m1"
        participantId="p1"
        participantName="Liam Carter"
        meetingLabel="Plan review"
        goals={[
          { goal_text: "Catch the bus to the library on my own", support_category: "transport", source_segment_ids: ["s2"], confidence: 0.9 },
          { goal_text: "Cook one dinner a week", support_category: "independence_daily_living", source_segment_ids: [], confidence: 0.5 },
        ]}
        tasks={[
          { task_text: "Practise the bus timetable app", linked_goal_index: 0, requirement_level: "mandatory", source_segment_ids: ["s4"], confidence: 0.88 },
        ]}
        cleanTranscript={transcript}
        rawTranscript={[]}
        notes={["Check the goals are in Liam's words."]}
        onApplied={onApplied}
      />
    </QueryClientProvider>,
  );
  return { onApplied };
}

afterEach(() => { cleanup(); apply.mockReset(); });

describe("MeetingSuggestionsReview", () => {
  it("adds nothing until items are ticked, and counts what will be added", () => {
    setup();
    expect((screen.getByRole("button", { name: "Tick items to add" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Catch the bus/ }));
    expect((screen.getByRole("button", { name: "Add 1 to Liam's plan" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("Check before adding")).toBeTruthy();
    expect(document.body.textContent).toContain("Transport · Clearly said");
    expect(screen.getByText("Check the transcript")).toBeTruthy();
  });

  it("sends the edited wording and links a task to its ticked goal", async () => {
    const { onApplied } = setup();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit wording" })[0]);
    fireEvent.change(screen.getByLabelText("Goal wording"), { target: { value: "Get the bus to the library by myself" } });
    fireEvent.click(screen.getByRole("button", { name: "Save wording" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Practise the bus timetable/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add 2 to Liam's plan" }));
    await waitFor(() => expect(apply).toHaveBeenCalled());
    const [id, goals, tasks] = apply.mock.calls[0];
    expect(id).toBe("m1");
    expect(goals).toEqual([{ goal_text: "Get the bus to the library by myself", support_category: "transport" }]);
    expect(tasks).toEqual([{ task_text: "Practise the bus timetable app", requirement_level: "mandatory", linked_goal_text: "Get the bus to the library by myself" }]);
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
  });

  it("says when a task's goal isn't ticked, and sends it without a goal", async () => {
    setup();
    fireEvent.click(screen.getByRole("checkbox", { name: /Practise the bus timetable/ }));
    expect(screen.getByText(/Its goal isn't ticked/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add 1 to Liam's plan" }));
    await waitFor(() => expect(apply).toHaveBeenCalled());
    expect(apply.mock.calls[0][2][0].linked_goal_text).toBeNull();
  });

  it("removes an item with undo", () => {
    setup();
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]);
    expect(screen.queryByRole("checkbox", { name: /Cook one dinner/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("checkbox", { name: /Cook one dinner/ })).toBeTruthy();
  });

  it("shows where a suggestion was said in the transcript", () => {
    setup();
    fireEvent.click(screen.getAllByRole("button", { name: "See where this was said" })[0]);
    expect(screen.getByRole("tab", { name: "Transcript" })?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("I want to get the bus to the library on my own.").closest("li")?.getAttribute("data-segment")).toBe("s2");
  });
});
