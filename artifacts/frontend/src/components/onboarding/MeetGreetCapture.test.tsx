import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MeetGreetCapture } from "./MeetGreetCapture";
import type { ParticipantIntake } from "@/services/participantIntakeService";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  createMeetingSession: vi.fn(),
  transcribeAndResolveNames: vi.fn(),
  transcribePlanMeetingAudio: vi.fn(),
  uploadMeetGreetRecording: vi.fn(),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/services/coordinatorService", () => ({
  createMeetingSession: mocks.createMeetingSession,
  transcribeAndResolveNames: mocks.transcribeAndResolveNames,
  transcribePlanMeetingAudio: mocks.transcribePlanMeetingAudio,
}));
vi.mock("@/services/participantIntakeService", () => ({ uploadMeetGreetRecording: mocks.uploadMeetGreetRecording }));

afterEach(() => {
  FakeRecorder.payload = "audio";
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
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

it("won't record until consent is confirmed, and says so when the mic is tapped", () => {
  const getUserMedia = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  render(<Harness onSave={async () => {}} />);
  const mic = screen.getByRole("button", { name: "Start recording" }) as HTMLButtonElement;
  // Tapping without consent points at the consent box instead of doing nothing.
  fireEvent.click(mic);
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(screen.getByText("Tick consent above first")).toBeTruthy();
  fireEvent.click(screen.getByLabelText(/Liam consents to recording/));
  expect(screen.getByText("Tap to record")).toBeTruthy();
  // Consent can be given by someone else on their behalf.
  fireEvent.change(screen.getByLabelText("Consent given by"), { target: { value: "guardian" } });
  expect(screen.getByText(/Liam's guardian consents to recording/)).toBeTruthy();
});

class FakeRecorder {
  static isTypeSupported = () => true;
  /** What each recorder hands back on stop; big enough to count as speech when needed. */
  static payload = "audio";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state = "inactive";
  stream: MediaStream;
  constructor(stream: MediaStream) {
    this.stream = stream;
  }
  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([FakeRecorder.payload], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

async function startRecording() {
  const track = { stop: vi.fn() };
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) },
    configurable: true,
  });
  (globalThis as any).MediaRecorder = FakeRecorder;
  mocks.createMeetingSession.mockResolvedValue({ session_id: "s1" });
  render(<Harness onSave={async () => {}} />);
  fireEvent.click(screen.getByLabelText(/Liam consents to recording/));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  });
}

async function stopRecording() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
  });
}

async function recordOnce() {
  await startRecording();
  await stopRecording();
}

it("says the server needs redeploying when Easy Capture's endpoint is missing", async () => {
  mocks.uploadMeetGreetRecording.mockRejectedValue(Object.assign(new Error("Not Found"), { status: 404 }));
  await recordOnce();
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
    title: "Recording not saved",
    description: expect.stringMatching(/needs redeploying/),
  }));
  expect(mocks.transcribeAndResolveNames).not.toHaveBeenCalled();
});

it("keeps the recording and gives the reason when transcription fails", async () => {
  mocks.uploadMeetGreetRecording.mockResolvedValue({ meet_greet_recording_url: "https://x/a.webm", meet_greet_session_id: "s1" });
  mocks.transcribeAndResolveNames.mockRejectedValue(new Error("Could not transcribe audio: Invalid API key"));
  await recordOnce();
  expect(mocks.transcribeAndResolveNames).toHaveBeenCalledWith("s1", expect.any(Blob), undefined, "Liam Carter", []);
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
    title: "Recording saved — not transcribed",
    description: expect.stringMatching(/Transcription failed: Invalid API key/),
  }));
});

it("shows the conversation transcribed while recording", async () => {
  vi.useFakeTimers();
  FakeRecorder.payload = "x".repeat(2000);
  mocks.transcribePlanMeetingAudio
    .mockResolvedValueOnce({ transcript: "Hi Liam, thanks for meeting." })
    .mockResolvedValueOnce({ transcript: "Thank you." });
  await startRecording();
  expect(screen.getByText("Recording")).toBeTruthy();
  expect(screen.getByText(/Listening/)).toBeTruthy();
  await act(async () => {
    vi.advanceTimersByTime(8000);
  });
  expect(screen.getByLabelText("Live transcript").textContent).toContain("Hi Liam, thanks for meeting.");
  // Whisper's usual "Thank you." on a silent segment is left out.
  await act(async () => {
    vi.advanceTimersByTime(8000);
  });
  expect(screen.getByLabelText("Live transcript").textContent).not.toContain("Thank you.");
  // Pausing stops the clock and the segments.
  fireEvent.click(screen.getByRole("button", { name: /Pause/ }));
  expect(screen.getByText("Paused")).toBeTruthy();
  const calls = mocks.transcribePlanMeetingAudio.mock.calls.length;
  await act(async () => {
    vi.advanceTimersByTime(16000);
  });
  expect(mocks.transcribePlanMeetingAudio.mock.calls.length).toBe(calls);
});

it("puts the live transcript in the notes when the full one fails", async () => {
  vi.useFakeTimers();
  FakeRecorder.payload = "x".repeat(2000);
  mocks.transcribePlanMeetingAudio
    .mockResolvedValueOnce({ transcript: "Liam likes swimming." })
    // Stopping sends the last part-segment too.
    .mockResolvedValueOnce({ transcript: "Mondays suit him." });
  mocks.uploadMeetGreetRecording.mockResolvedValue({ meet_greet_recording_url: "https://x/a.webm", meet_greet_session_id: "s1" });
  mocks.transcribeAndResolveNames.mockRejectedValue(new Error("Could not transcribe audio: timeout"));
  await startRecording();
  await act(async () => {
    vi.advanceTimersByTime(8000);
  });
  await stopRecording();
  expect((screen.getByLabelText("Meeting notes") as HTMLTextAreaElement).value).toBe("Transcript (live):\nLiam likes swimming. Mondays suit him.");
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
    description: expect.stringMatching(/live transcript was added/),
  }));
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
