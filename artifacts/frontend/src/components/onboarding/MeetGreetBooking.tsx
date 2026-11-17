import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CalendarPlus, MapPin, Mic, Phone, Users, Video } from "lucide-react";
import { MeetingBookingSheet, type BookingDraft, type BookingIntake } from "@/components/calendar/MeetingBookingSheet";
import { MeetingDetailSheet } from "@/components/calendar/MeetingDetailSheet";
import { ctaClass, outlineClass } from "@/components/layout/PageKit";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { MEETING_CHOICES, MEETING_MODES, choiceOf, inviteSummary, isOnlineMode, meetingWhen, parseDurationMinutes } from "@/lib/meeting-booking";
import {
  createOrgEvent, deleteOrgEvent, getIntakeMeetings, updateOrgEvent,
  type OrgEvent, type OrgEventPayload,
} from "@/services/hubService";
import type { IntakeMeeting, ParticipantIntake } from "@/services/participantIntakeService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

const MODE_ICONS = { in_person: MapPin, phone: Phone, video: Video } as const;

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** One-line home address from the intake form. */
function intakeAddress(intake: ParticipantIntake): string | null {
  const form = intake.web_intake;
  if (!form) return null;
  const statePostcode = [form.state, form.postcode].map((p) => (p ?? "").trim()).filter(Boolean).join(" ");
  const parts = [form.street_address, form.suburb, statePostcode].map((p) => (p ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** The meeting the board card shows: the soonest from today, or the last one held. */
export function nextMeetingOf(events: OrgEvent[], today = localToday()): IntakeMeeting | null {
  const key = (e: OrgEvent) => `${e.event_date.slice(0, 10)} ${e.start_time ?? ""}`;
  const sorted = [...events].sort((a, b) => key(a).localeCompare(key(b)));
  const next = sorted.find((e) => e.event_date.slice(0, 10) >= today) ?? sorted[sorted.length - 1];
  if (!next) return null;
  const { id, title, event_date, start_time, duration, meeting_kind, meeting_mode, location } = next;
  return { id, title, event_date, start_time, duration, meeting_kind, meeting_mode, location };
}

/** Book the Meet & Greet (or another meeting) with someone in onboarding,
 *  straight from their onboarding page. It goes on the Calendar and out as a
 *  calendar invite to them and their family; on the day it's recorded with
 *  Easy Capture just below. `autoOpen` opens the booking panel on arrival,
 *  for when they've just been moved to Meet & Greet. */
export function MeetGreetBooking({
  intake,
  editable,
  autoOpen,
  onAutoOpened,
  onNextMeetingChange,
}: {
  intake: ParticipantIntake;
  editable: boolean;
  autoOpen?: boolean;
  onAutoOpened?: () => void;
  onNextMeetingChange?: (meeting: IntakeMeeting | null) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryKey = ["intake-meetings", intake.id] as const;
  const meetingsQuery = useOrgQuery(queryKey, { queryFn: () => getIntakeMeetings(intake.id), staleTime: 30_000 });
  const meetings = useMemo(
    () => [...(meetingsQuery.data ?? [])].sort((a, b) => `${a.event_date}${a.start_time ?? ""}`.localeCompare(`${b.event_date}${b.start_time ?? ""}`)),
    [meetingsQuery.data],
  );

  const [bookingOpen, setBookingOpen] = useState(false);
  const [editing, setEditing] = useState<OrgEvent | null>(null);
  const [viewing, setViewing] = useState<OrgEvent | null>(null);
  const [saving, setSaving] = useState(false);

  const bookingIntake = useMemo<BookingIntake>(
    () => ({ id: intake.id, name: intake.full_name, address: intakeAddress(intake), participantId: intake.participant_id ?? null }),
    // The address only matters when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intake.id, intake.full_name, intake.participant_id],
  );

  // A new booking starts tomorrow at 10am, the usual time for a home visit.
  const draft = useMemo<BookingDraft>(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { date: tomorrow, start: "10:00", end: "11:00" };
  }, []);

  useEffect(() => {
    if (!autoOpen || !editable) return;
    setEditing(null);
    setBookingOpen(true);
    onAutoOpened?.();
  }, [autoOpen, editable, onAutoOpened]);

  function store(next: OrgEvent[]) {
    queryClient.setQueryData([user?.organizationId ?? "__no_org__", ...queryKey], next);
    onNextMeetingChange?.(nextMeetingOf(next));
  }

  async function save(payload: OrgEventPayload) {
    setSaving(true);
    try {
      const { invites, ...saved } = editing ? await updateOrgEvent(editing.id, payload) : await createOrgEvent(payload);
      store([...meetings.filter((m) => m.id !== saved.id), saved]);
      setBookingOpen(false);
      const update = !!editing;
      setEditing(null);
      toast({
        title: update ? "Meeting updated" : "Meeting booked",
        description: [`${saved.title}, ${meetingWhen(saved)}. It's on the Calendar.`, inviteSummary(invites, update)].filter(Boolean).join(" "),
        variant: invites?.failed.length ? "destructive" : undefined,
      });
      // A video call's invite is sent from Google Calendar or Outlook.
      if (isOnlineMode(saved.meeting_mode) && (saved.attendees?.length ?? 0) > 0) setViewing(saved);
    } catch (err) {
      toast({ title: "Couldn't save the meeting", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function cancel(event: OrgEvent) {
    try {
      await deleteOrgEvent(event.id);
      store(meetings.filter((m) => m.id !== event.id));
      setViewing(null);
      toast({
        title: "Meeting cancelled",
        description: event.invites_sent_at ? "Everyone invited has been sent a cancellation, which takes it off their calendar." : undefined,
      });
    } catch (err) {
      toast({ title: "Couldn't cancel the meeting", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    }
  }

  const today = localToday();
  const first = intake.full_name.split(" ")[0] || intake.full_name;

  return (
    <section className="rounded-xl border" style={{ borderColor: BORDER }} aria-label="Meet and greet booking">
      {meetingsQuery.isLoading ? (
        <p role="status" className="px-4 py-3 text-sm" style={{ color: MUTED }}>Checking for a booked meeting...</p>
      ) : meetings.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cc-soft" style={{ color: MUTED }}>
            <CalendarPlus size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium" style={{ color: TEXT }}>No meeting booked yet</p>
            <p className="text-xs" style={{ color: MUTED }}>
              Book it here and {first} and their family get a calendar invite. It's set up to record with Easy Capture.
            </p>
          </div>
          {editable && (
            <button type="button" className={ctaClass} onClick={() => { setEditing(null); setBookingOpen(true); }}>
              <CalendarPlus size={15} /> Book the Meet &amp; Greet
            </button>
          )}
        </div>
      ) : (
        <>
          <ul className="divide-y" style={{ borderColor: BORDER }}>
            {meetings.map((m) => {
              const day = m.event_date.slice(0, 10);
              const isToday = day === today;
              const past = day < today;
              const Icon = m.meeting_mode ? MODE_ICONS[m.meeting_mode] : CalendarCheck;
              const how = m.meeting_mode ? MEETING_MODES[m.meeting_mode].label : null;
              const invited = m.attendees?.length ?? 0;
              return (
                <li key={m.id} style={{ borderColor: BORDER }}>
                  <button
                    type="button"
                    onClick={() => setViewing(m)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-cc-soft"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cc-soft" style={{ color: MUTED }}>
                      <CalendarCheck size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium" style={{ color: TEXT }}>
                        {meetingWhen(m)}
                        {isToday && (
                          <span className="rounded-full bg-[var(--cc-brand-purple-soft)] px-2 py-0.5 text-xs font-medium text-[var(--cc-brand-purple)]">Today</span>
                        )}
                        {past && <span className="text-xs font-normal" style={{ color: MUTED }}>Held</span>}
                      </span>
                      <span className="mt-0.5 block truncate text-xs" style={{ color: MUTED }}>
                        {[MEETING_CHOICES[choiceOf(m)].label, m.duration].filter(Boolean).join(" · ")}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: MUTED }}>
                        {how && (
                          <span className="inline-flex items-center gap-1"><Icon size={12} /> {how}{m.location ? `: ${m.location}` : ""}</span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Users size={12} /> {invited ? `${invited} invited${m.invites_sent_at ? ", invites sent" : ""}` : "No one invited"}
                        </span>
                        {m.easy_capture && <span className="inline-flex items-center gap-1"><Mic size={12} /> Easy Capture</span>}
                      </span>
                      {isToday && m.easy_capture && (
                        <span className="mt-1.5 block text-xs font-medium" style={{ color: TEXT }}>
                          Record it below when you're with {first}. Ask for consent first.
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {editable && (
            <div className="border-t px-4 py-2.5" style={{ borderColor: BORDER }}>
              <button type="button" className={outlineClass} onClick={() => { setEditing(null); setBookingOpen(true); }}>
                <CalendarPlus size={15} /> Book another meeting
              </button>
            </div>
          )}
        </>
      )}

      <MeetingBookingSheet
        open={bookingOpen}
        onOpenChange={(open) => { setBookingOpen(open); if (!open) setEditing(null); }}
        draft={draft}
        editing={editing}
        editingMinutes={editing ? parseDurationMinutes(editing.duration) : undefined}
        saving={saving}
        onSave={(payload) => void save(payload)}
        intake={bookingIntake}
      />
      <MeetingDetailSheet
        event={viewing}
        minutes={viewing ? parseDurationMinutes(viewing.duration) : 60}
        onOpenChange={(open) => { if (!open) setViewing(null); }}
        onEdit={(event) => { setViewing(null); setEditing(event); setBookingOpen(true); }}
        onDelete={(event) => void cancel(event)}
      />
    </section>
  );
}
