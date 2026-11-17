import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MeetGreetBooking, nextMeetingOf } from "./MeetGreetBooking";
import type { OrgEvent } from "@/services/hubService";
import type { ParticipantIntake } from "@/services/participantIntakeService";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  getIntakeMeetings: vi.fn(),
  getMeetingInvitees: vi.fn(),
  createOrgEvent: vi.fn(),
  updateOrgEvent: vi.fn(),
  deleteOrgEvent: vi.fn(),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "md-1", organizationId: "org-1", role: "managing_director", email: "olivia@example.com" } }),
}));
vi.mock("@workspace/api-client-react", () => ({ useGetParticipants: () => ({ data: [], isLoading: false }) }));
vi.mock("@/services/hubService", () => ({
  getIntakeMeetings: mocks.getIntakeMeetings,
  getMeetingInvitees: mocks.getMeetingInvitees,
  createOrgEvent: mocks.createOrgEvent,
  updateOrgEvent: mocks.updateOrgEvent,
  deleteOrgEvent: mocks.deleteOrgEvent,
}));

// The panel's switches and checkboxes measure themselves; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const intake = {
  id: "intake-1",
  organization_id: "org-1",
  full_name: "Ava Thompson",
  ndis_number: "",
  email: "ava@example.com",
  phone: "",
  source: "online_form",
  status: "meet_greet",
  created_at: "2026-11-10T00:00:00Z",
  web_intake: { submitted_at: "2026-11-10T00:00:00Z", street_address: "4 Bay Road", suburb: "Glenelg", state: "SA", postcode: "5045" },
} as ParticipantIntake;

const INVITEES = [
  { email: "olivia@example.com", name: "Olivia Bennett", role: "You" },
  { email: "ava@example.com", name: "Ava Thompson", role: "Participant" },
  { email: "mark@example.com", name: "Mark Thompson", role: "Father" },
  { email: "invoices@planpartners.example.com", name: "Plan Partners", role: "Plan manager" },
];

function renderBooking(props: Partial<Parameters<typeof MeetGreetBooking>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MeetGreetBooking intake={intake} editable {...props} />
    </QueryClientProvider>,
  );
}

const BOOKED: OrgEvent = {
  id: "event-1",
  title: "Intake / meet and greet · Ava Thompson",
  event_date: "2099-11-18",
  start_time: "10:00",
  duration: "1 hour",
  event_type: "meeting",
  meeting_kind: "intake",
  meeting_mode: "in_person",
  location: "4 Bay Road, Glenelg, SA 5045",
  intake_id: "intake-1",
  participant_id: null,
  easy_capture: true,
  attendees: INVITEES.slice(0, 3),
  invites_sent_at: "2026-11-17T01:00:00Z",
};

describe("Booking the Meet & Greet from onboarding", () => {
  it("books it for the person in onboarding, with their family invited and Easy Capture on", async () => {
    mocks.getIntakeMeetings.mockResolvedValue([]);
    mocks.getMeetingInvitees.mockResolvedValue(INVITEES);
    mocks.createOrgEvent.mockResolvedValue({ ...BOOKED, invites: { sent: ["ava@example.com", "mark@example.com"], failed: [], email_off: false } });
    const onNext = vi.fn();
    renderBooking({ onNextMeetingChange: onNext });

    fireEvent.click(await screen.findByRole("button", { name: /Book the Meet & Greet/ }));
    // Who it's with is fixed, and their home address is filled in.
    expect(await screen.findByText(/moves to their participant record when they're activated/)).toBeTruthy();
    expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("4 Bay Road, Glenelg, SA 5045");
    expect((screen.getByLabelText("Record with Easy Capture") as HTMLButtonElement).getAttribute("aria-checked")).toBe("true");
    // Suggestions come from the intake form; the plan manager is listed but not ticked.
    expect(await screen.findByText("Mark Thompson")).toBeTruthy();
    expect(mocks.getMeetingInvitees).toHaveBeenCalledWith(null, "intake-1");
    const planManager = screen.getByText("Plan Partners").closest("li")!;
    expect(within(planManager).getByRole("checkbox").getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Book meeting" }));
    await waitFor(() => expect(mocks.createOrgEvent).toHaveBeenCalled());
    const payload = mocks.createOrgEvent.mock.calls[0][0];
    expect(payload).toMatchObject({
      intake_id: "intake-1",
      participant_id: null,
      meeting_kind: "intake",
      event_type: "meeting",
      easy_capture: true,
      title: "Intake / meet and greet · Ava Thompson",
      send_invites: true,
    });
    expect(payload.attendees.map((a: { email: string }) => a.email)).toEqual(["olivia@example.com", "ava@example.com", "mark@example.com"]);
    await waitFor(() => expect(onNext).toHaveBeenCalledWith(expect.objectContaining({ id: "event-1", event_date: "2099-11-18" })));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Meeting booked" }));
  }, 15_000);

  it("opens the booking straight away when they've just moved to Meet & Greet", async () => {
    mocks.getIntakeMeetings.mockResolvedValue([]);
    mocks.getMeetingInvitees.mockResolvedValue(INVITEES);
    const opened = vi.fn();
    renderBooking({ autoOpen: true, onAutoOpened: opened });
    expect(await screen.findByRole("button", { name: "Book meeting" })).toBeTruthy();
    expect(opened).toHaveBeenCalled();
  });

  it("shows the booked meeting, who's invited and that it will be recorded", async () => {
    mocks.getIntakeMeetings.mockResolvedValue([BOOKED]);
    renderBooking();
    expect(await screen.findByText(/3 invited, invites sent/)).toBeTruthy();
    expect(screen.getByText("Easy Capture")).toBeTruthy();
    expect(screen.getByText(/In person: 4 Bay Road/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Book another meeting/ })).toBeTruthy();
  });

  it("can't book once they've moved past Meet & Greet", async () => {
    mocks.getIntakeMeetings.mockResolvedValue([]);
    renderBooking({ editable: false });
    expect(await screen.findByText("No meeting booked yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Book the Meet & Greet/ })).toBeNull();
  });
});

describe("nextMeetingOf", () => {
  const at = (id: string, event_date: string, start_time = "10:00") => ({ ...BOOKED, id, event_date, start_time });
  it("is the soonest from today, else the last one held", () => {
    expect(nextMeetingOf([at("c", "2026-11-20", "14:00"), at("a", "2026-11-10"), at("b", "2026-11-20", "09:00")], "2026-11-17")?.id).toBe("b");
    expect(nextMeetingOf([at("a", "2026-11-10"), at("z", "2026-11-12")], "2026-11-17")?.id).toBe("z");
    expect(nextMeetingOf([], "2026-11-17")).toBeNull();
  });
});
