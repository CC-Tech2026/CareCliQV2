import { useState } from "react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { displayDate } from "@/lib/datetime";
import { CalendarPlus, Clock, Download, ExternalLink, Mail, MapPin, Mic, Pencil, Phone, Trash2, UserRound, Video } from "lucide-react";
import { SidePanel } from "@/components/layout/SidePanel";
import { ctaClass, ghostClass, outlineClass } from "@/components/layout/PageKit";
import { useAuth } from "@/contexts/AuthContext";
import {
  MEETING_CHOICES,
  MEETING_MODES,
  choiceOf,
  eventStartEnd,
  googleCalendarUrl,
  guestEmails,
  icsFile,
  isOnlineMode,
  outlookCalendarUrl,
} from "@/lib/meeting-booking";
import type { OrgEvent } from "@/services/hubService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

function Row({ icon: Icon, label, children }: { icon: typeof Clock; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cc-soft" style={{ color: MUTED }}>
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <dt className="text-xs" style={{ color: MUTED }}>{label}</dt>
        <dd className="break-words text-sm" style={{ color: TEXT }}>{children}</dd>
      </div>
    </div>
  );
}

function initials(name: string) {
  return name.trim().split(/[\s@.]+/).map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

/** "9:00am to 10:00am", the way shift times read in the calendar. */
function timeRange(event: OrgEvent, minutes: number): string {
  const { start, end } = eventStartEnd(event, minutes);
  const t = (d: Date) => format(d, "h:mmaaa").toLowerCase();
  return `${t(start)} to ${t(end)}`;
}

function downloadIcs(event: OrgEvent, minutes: number) {
  const blob = new Blob([icsFile(event, minutes)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${event.title.replace(/[^\w\s-]/g, "").trim() || "meeting"}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

export function MeetingDetailSheet({
  event,
  minutes,
  onOpenChange,
  onEdit,
  onDelete,
}: {
  event: OrgEvent | null;
  minutes: number;
  onOpenChange: (open: boolean) => void;
  onEdit: (event: OrgEvent) => void;
  onDelete: (event: OrgEvent) => void;
}) {
  const { user } = useAuth();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const choice = event ? MEETING_CHOICES[choiceOf(event)] : null;
  const mode = event?.meeting_mode ? MEETING_MODES[event.meeting_mode] : null;
  const video = isOnlineMode(event?.meeting_mode);
  const attendees = event?.attendees ?? [];
  // The organiser's own calendar adds them, so they're not a guest of it.
  const guests = event ? guestEmails(event, user?.email) : [];
  // Someone still in onboarding is recorded on their onboarding page's
  // Meet & Greet step, which is also where they're looked up.
  const inOnboarding = !!event?.intake_id && !event.participant_id;
  const onboardingHref = event?.intake_id ? `/onboard-participant?intake=${encodeURIComponent(event.intake_id)}` : null;
  const captureHref = inOnboarding
    ? onboardingHref
    : event?.participant_id
      ? `/patients?id=${encodeURIComponent(event.participant_id)}&tab=plan_meetings`
      : null;

  return (
    <SidePanel
      open={!!event}
      onOpenChange={(open) => { if (!open) setConfirmingDelete(false); onOpenChange(open); }}
      eyebrow={choice?.label}
      title={event?.title ?? "Meeting"}
      description={event ? format(displayDate(event.event_date), "EEEE d MMMM yyyy") : undefined}
      footer={
        event &&
        (confirmingDelete ? (
          <div className="flex w-full flex-wrap items-center gap-2">
            <span className="mr-auto text-sm" style={{ color: TEXT }}>
              {event.invites_sent_at ? "Cancel it and tell everyone invited?" : "Cancel this meeting?"}
            </span>
            <button type="button" className={outlineClass} onClick={() => setConfirmingDelete(false)}>Keep it</button>
            <button
              type="button"
              className={`${ctaClass} !bg-[var(--cc-status-danger)]`}
              onClick={() => { setConfirmingDelete(false); onDelete(event); }}
            >
              Yes, cancel it
            </button>
          </div>
        ) : (
          <>
            <button type="button" className={`${ghostClass} mr-auto text-cc-muted`} onClick={() => setConfirmingDelete(true)}>
              <Trash2 size={15} /> Cancel meeting
            </button>
            <button type="button" className={outlineClass} onClick={() => onEdit(event)}>
              <Pencil size={15} /> Edit
            </button>
          </>
        ))
      }
    >
      {event && choice && (
        <>
          <dl className="space-y-3">
            <Row icon={Clock} label="When">
              {event.start_time ? `${timeRange(event, minutes)} · ${event.duration}` : `All day · ${event.duration}`}
            </Row>
            {event.participant_id && (
              <Row icon={UserRound} label="Participant">
                <Link href={`/patients?id=${encodeURIComponent(event.participant_id)}`} className="font-medium text-[var(--cc-plum)] hover:underline">
                  {event.participant_name || "Participant"}
                </Link>
              </Row>
            )}
            {inOnboarding && onboardingHref && (
              <Row icon={UserRound} label="Participant">
                <Link href={onboardingHref} className="font-medium text-[var(--cc-plum)] hover:underline">
                  {event.participant_name || "New participant"}
                </Link>
                <span style={{ color: MUTED }}> · in onboarding</span>
              </Row>
            )}
            {mode && (
              <Row icon={video ? Video : event.meeting_mode === "phone" ? Phone : MapPin} label="How">
                {mode.label}
                {event.location ? ` · ${event.location}` : ""}
              </Row>
            )}
            {!mode && event.location && <Row icon={MapPin} label="Where">{event.location}</Row>}
            {event.easy_capture && <Row icon={Mic} label="Recording">Easy Capture, with consent on the day</Row>}
          </dl>

          {event.easy_capture && captureHref && (
            <Link href={captureHref} className={`${ctaClass} w-full`}>
              <Mic size={15} /> Start Easy Capture
            </Link>
          )}

          {video && (
            <section className="rounded-xl border p-4" style={{ borderColor: BORDER }}>
              <h3 className="text-sm font-medium" style={{ color: TEXT }}>Send the video call invite</h3>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: MUTED }}>
                Opens your calendar with the meeting{guests.length ? " and guests" : ""} filled in. Add Google Meet or switch on Teams meeting, then save to send it.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <a href={googleCalendarUrl(event, minutes, guests)} target="_blank" rel="noopener noreferrer" className={ctaClass}>
                  <Video size={15} /> Google Calendar <ExternalLink size={12} />
                </a>
                <a href={outlookCalendarUrl(event, minutes, guests)} target="_blank" rel="noopener noreferrer" className={ctaClass}>
                  <Video size={15} /> Outlook <ExternalLink size={12} />
                </a>
              </div>
            </section>
          )}

          {event.participants_desc && (
            <section>
              <h3 className="mb-2 text-sm font-medium" style={{ color: TEXT }}>Agenda and notes</h3>
              <p className="whitespace-pre-wrap rounded-xl bg-cc-soft p-3 text-sm leading-relaxed" style={{ color: TEXT }}>
                {event.participants_desc}
              </p>
            </section>
          )}

          {attendees.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium" style={{ color: TEXT }}>
                Invited <span className="font-normal" style={{ color: MUTED }}>{attendees.length}</span>
              </h3>
              <ul className="divide-y overflow-hidden rounded-xl border" style={{ borderColor: BORDER }}>
                {attendees.map((a) => (
                  <li key={a.email} className="flex min-h-12 items-center gap-3 px-3 py-2" style={{ borderColor: BORDER }}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cc-soft text-[11px] font-semibold" style={{ color: TEXT }}>
                      {initials(a.name || a.email)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" style={{ color: TEXT }}>{a.name || a.email}</span>
                      <span className="block truncate text-xs" style={{ color: MUTED }}>
                        {[a.role, a.name ? a.email : ""].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {!video && (
                <p className="mt-2 flex items-start gap-1.5 text-xs" style={{ color: MUTED }}>
                  <Mail size={13} className="mt-px shrink-0" />
                  {event.invites_sent_at
                    ? `Calendar invites emailed ${format(displayDate(event.invites_sent_at), "d MMM 'at' h:mmaaa")}. Changes you make update their calendars.`
                    : "No invites sent yet. Edit the meeting and turn on Email calendar invites to send them."}
                </p>
              )}
            </section>
          )}

          {!video && (
            <section>
              <h3 className="mb-2 text-sm font-medium" style={{ color: TEXT }}>Add to your own calendar</h3>
              <div className="flex flex-wrap gap-2">
                <a href={googleCalendarUrl(event, minutes)} target="_blank" rel="noopener noreferrer" className={outlineClass}>
                  <CalendarPlus size={15} /> Google <ExternalLink size={12} />
                </a>
                <a href={outlookCalendarUrl(event, minutes)} target="_blank" rel="noopener noreferrer" className={outlineClass}>
                  <CalendarPlus size={15} /> Outlook <ExternalLink size={12} />
                </a>
                <button type="button" className={outlineClass} onClick={() => downloadIcs(event, minutes)}>
                  <Download size={15} /> Apple or other (.ics)
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </SidePanel>
  );
}
