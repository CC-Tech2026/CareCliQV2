import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MeetGreetCapture } from "./MeetGreetCapture";
import type { ParticipantIntake } from "@/services/participantIntakeService";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const intake = {
  id: "i1",
  organization_id: "o1",
  full_name: "Liam Carter",
  ndis_number: "",
  email: "",
  phone: "",
  source: "online_form",
  status: "meet_greet",
} as ParticipantIntake;

function Harness({ onSave, editable = true }: { onSave: (v: string) => Promise<unknown>; editable?: boolean }) {
  const [notes, setNotes] = useState("");
  return (
    <MeetGreetCapture
      intake={intake}
      notes={notes}
      onNotesChange={setNotes}
      onSaveNotes={onSave}
      onRecordingSaved={() => {}}
      editable={editable}
    />
  );
}

it("won't record until consent is confirmed", () => {
  render(<Harness onSave={async () => {}} />);
  const mic = screen.getByRole("button", { name: "Start recording" }) as HTMLButtonElement;
  expect(mic.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/Liam consents to recording/));
  expect(mic.disabled).toBe(false);
  // Consent can be given by someone else on their behalf.
  fireEvent.change(screen.getByLabelText("Consent given by"), { target: { value: "guardian" } });
  expect(screen.getByText(/Liam's guardian consents to recording/)).toBeTruthy();
});

it("autosaves notes shortly after typing stops", async () => {
  vi.useFakeTimers();
  const save = vi.fn().mockResolvedValue({});
  render(<Harness onSave={save} />);
  fireEvent.change(screen.getByLabelText("Meeting notes"), { target: { value: "Prefers morning shifts." } });
  expect(screen.getByText("Editing")).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
  await act(async () => {
    vi.advanceTimersByTime(900);
  });
  expect(save).toHaveBeenCalledWith("Prefers morning shifts.");
  expect(screen.getByText("Saved")).toBeTruthy();
});

it("is read-only once the intake has moved on", () => {
  render(<Harness onSave={async () => {}} editable={false} />);
  expect(screen.queryByRole("button", { name: "Start recording" })).toBeNull();
  expect((screen.getByLabelText("Meeting notes") as HTMLTextAreaElement).readOnly).toBe(true);
});
