import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MeetingRecorderRoot } from "./MeetingRecorderRoot";
import { useMeetingRecorder } from "./MeetingRecorderContext";

const api = vi.hoisted(() => ({
  createMeetingSession: vi.fn(),
  transcribeAndResolveNames: vi.fn(),
  extractGoalsAndTasks: vi.fn(),
  applyPlanMeetingSuggestions: vi.fn(),
  getMeetingVoiceAccess: vi.fn(),
  recordPlanMeeting: vi.fn(),
}));
vi.mock("@/services/coordinatorService", () => api);
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "md-1" } }) }));

class FakeRecorder {
  static isTypeSupported = () => true;
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: MediaStream) {}
  start() { this.state = "recording"; }
  pause() { this.state = "paused"; }
  resume() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["x".repeat(2000)], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

function Opener() {
  const rec = useMeetingRecorder();
  return <button type="button" onClick={() => rec.openRecorder({ participantId: "p1", participantName: "Liam Carter" })}>Open recorder</button>;
}

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
  });
  api.getMeetingVoiceAccess.mockResolvedValue({ enabled: true, message: null });
  api.createMeetingSession.mockResolvedValue({ session_id: "sess-1", created_at: "" });
  api.transcribeAndResolveNames.mockResolvedValue({
    session_id: "sess-1", raw_transcript: [], clean_transcript: [{ segment_id: "s1", speaker_name: "Liam Carter", text: "I want to cook." }],
    resolved_names: {}, segment_ids: [], participant_id: null, flags: [], stage_1_status: "complete",
  });
  api.extractGoalsAndTasks.mockResolvedValue({
    session_id: "sess-1", goals: [{ goal_text: "Cook dinner once a week", support_category: "independence_daily_living", source_segment_ids: ["s1"], confidence: 0.9 }],
    tasks: [], attention_flags: [], extraction_metadata: { completed_at: "" }, stage_2_status: "complete",
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("meeting recorder", () => {
  it("keeps recording with the panel closed, shows a bar, and brings the review back", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MeetingRecorderRoot><Opener /></MeetingRecorderRoot>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open recorder" }));
    expect(((await screen.findByRole("button", { name: "Start recording" })) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start recording" })); });
    expect(await screen.findByRole("button", { name: "Stop and review" })).toBeTruthy();
    expect(api.createMeetingSession).toHaveBeenCalledWith("check_in", expect.any(String), undefined, "p1", "participant", "verbal");

    // Close the panel: no warning, and the bar takes over.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    const bar = await screen.findByRole("region", { name: "Meeting recording" });
    expect(bar.textContent).toMatch(/Recording 00:0\d/);
    expect(bar.textContent).toContain("Check-in with Liam");

    fireEvent.click(screen.getByRole("button", { name: "Pause recording" }));
    expect(screen.getByRole("region", { name: "Meeting recording" }).textContent).toMatch(/Paused/);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Stop" })); });
    await waitFor(() => expect(screen.getByRole("region", { name: "Meeting recording" }).textContent).toContain("Suggestions ready to review"));
    expect(api.transcribeAndResolveNames).toHaveBeenCalledWith("sess-1", expect.any(Blob), "", "Liam Carter", []);

    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByRole("checkbox", { name: /Cook dinner once a week/ })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Meeting recording" })).toBeNull();
  });

  it("keeps the recording to try again when transcription fails", async () => {
    api.transcribeAndResolveNames.mockRejectedValueOnce(new Error("Whisper is down"));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MeetingRecorderRoot><Opener /></MeetingRecorderRoot>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open recorder" }));
    fireEvent.click(await screen.findByRole("checkbox"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start recording" })); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Stop and review" })); });
    expect(await screen.findByText("The transcript couldn't be written")).toBeTruthy();
    expect(screen.getByText("Whisper is down")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download the recording" })).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    expect(await screen.findByRole("checkbox", { name: /Cook dinner once a week/ })).toBeTruthy();
    expect(api.transcribeAndResolveNames).toHaveBeenCalledTimes(2);
    expect(api.createMeetingSession).toHaveBeenCalledTimes(1);
  });

  it("offers a written meeting instead when recording is off for the organisation", async () => {
    api.getMeetingVoiceAccess.mockResolvedValue({ enabled: false, message: "Voice recording is switched off for your organisation for now." });
    api.recordPlanMeeting.mockResolvedValue({ meeting: { id: "w1" } });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MeetingRecorderRoot><Opener /></MeetingRecorderRoot>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open recorder" }));
    expect(await screen.findByText("Write up a meeting")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start recording" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Record it instead" })).toBeNull();
    const save = screen.getByRole("button", { name: "Save the meeting" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("What was agreed"), { target: { value: "Practise the bus app on Tuesdays." } });
    fireEvent.change(screen.getByLabelText("Who was there"), { target: { value: "Liam, Sarah Carter" } });
    await act(async () => { fireEvent.click(save); });
    await waitFor(() => expect(api.recordPlanMeeting).toHaveBeenCalled());
    expect(api.recordPlanMeeting.mock.calls[0][0]).toMatchObject({
      participant_id: "p1", meeting_type: "check_in", attendees: ["Liam", "Sarah Carter"], agreed_outcomes: "Practise the bus app on Tuesdays.",
    });
    expect(api.createMeetingSession).not.toHaveBeenCalled();
  });
});
