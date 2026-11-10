import { useState } from "react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { CalendarPlus, Clock, Download, ExternalLink, Mail, MapPin, Mic, Pencil, Phone, Trash2, UserRound, Users, Video } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
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

function Row({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-sm" style={{ color: TEXT }}>
      <Icon size={15} className="mt-0.5 shrink-0" style={{ color: MUTED }} />
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
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
  const captureHref = event?.participant_id
    ? `/patients?id=${encodeURIComponent(event.participant_id)}&tab=plan_meetings`
    : null;

  return (
    <Sheet open={!!event} onOpenChange={(open) => { if (!open) setConfirmingDelete(false); onOpenChange(open); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {event && choice && (
          <>
            <SheetHeader>
              <p className="text-xs font-semibold" style={{ color: MUTED }}>{choice.label}</p>
              <SheetTitle>{event.title}</SheetTitle>
              <SheetDescription>
                {format(parseISO(event.event_date), "EEEE d MMMM yyyy")}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-5 space-y-3">
              <Row icon={Clock}>
                {event.start_time ? `${timeRange(event, minutes)} · ${event.duration}` : `All day · ${event.duration}`}
              </Row>
              {event.participant_id && (
                <Row icon={UserRound}>
                  <Link href={`/patients?id=${encodeURIComponent(event.participant_id)}`} className="font-semibold underline" style={{ color: "var(--cc-plum)" }}>
                    {event.participant_name || "Participant"}
                  </Link>
                </Row>
              )}
              {mode && (
                <Row icon={video ? Video : event.meeting_mode === "phone" ? Phone : MapPin}>
                  {mode.label}
                  {event.location ? ` · ${event.location}` : ""}
                </Row>
              )}
              {!mode && event.location && <Row icon={MapPin}>{event.location}</Row>}
              {event.easy_capture && (
                <Row icon={Mic}>Recording with Easy Capture</Row>
              )}
              {event.participants_desc && (
                <p className="whitespace-pre-wrap rounded-lg border p-3 text-sm" style={{ borderColor: BORDER, color: TEXT }}>
                  {event.participants_desc}
                </p>
              )}
            </div>

            {attendees.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold" style={{ color: MUTED }}>
                  <Users size={13} /> Invited
                </p>
                <ul className="divide-y rounded-lg border" style={{ borderColor: BORDER }}>
                  {attendees.map((a) => (
                    <li key={a.email} className="px-3 py-2" style={{ borderColor: BORDER }}>
                      <span className="block truncate text-sm font-medium" style={{ color: TEXT }}>{a.name || a.email}</span>
                      <span className="block truncate text-xs" style={{ color: MUTED }}>
                        {[a.role, a.name ? a.email : ""].filter(Boolean).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
                {!video && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: MUTED }}>
                    <Mail size={12} />
                    {event.invites_sent_at
                      ? `Calendar invites emailed ${format(parseISO(event.invites_sent_at), "d MMM 'at' h:mmaaa")}. Changes you make update their calendars.`
                      : "No invites sent yet. Edit the meeting and turn on Email calendar invites to send them."}
                  </p>
                )}
              </div>
            )}

            {video && (
              <div className="mt-5 rounded-lg border p-3" style={{ borderColor: BORDER }}>
                <p className="text-sm font-semibold" style={{ color: TEXT }}>Send the video call invite</p>
                <p className="mt-0.5 text-xs" style={{ color: MUTED }}>
                  Opens your calendar with the meeting{guests.length ? " and guests" : ""} filled in. Add Google Meet or switch on Teams meeting, then save to send it.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Button asChild variant="navy" className="flex-1 justify-center gap-1.5">
                    <a href={googleCalendarUrl(event, minutes, guests)} target="_blank" rel="noopener noreferrer">
                      <Video size={14} /> Google Calendar <ExternalLink size={11} />
                    </a>
                  </Button>
                  <Button asChild variant="navy" className="flex-1 justify-center gap-1.5">
                    <a href={outlookCalendarUrl(event, minutes, guests)} target="_blank" rel="noopener noreferrer">
                      <Video size={14} /> Outlook <ExternalLink size={11} />
                    </a>
                  </Button>
                </div>
              </div>
            )}

            {event.easy_capture && captureHref && (
              <div className="mt-5">
                <Button asChild variant="navy" className="w-full justify-center gap-2">
                  <Link href={captureHref}>
                    <Mic size={15} /> Start Easy Capture
                  </Link>
                </Button>
              </div>
            )}

            {!video && (
              <div className="mt-5 border-t pt-4" style={{ borderColor: BORDER }}>
                <p className="mb-2 text-xs font-semibold" style={{ color: MUTED }}>Add to your own calendar</p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm" className="gap-1.5">
                    <a href={googleCalendarUrl(event, minutes)} target="_blank" rel="noopener noreferrer">
                      <CalendarPlus size={14} /> Google Calendar <ExternalLink size={11} />
                    </a>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="gap-1.5">
                    <a href={outlookCalendarUrl(event, minutes)} target="_blank" rel="noopener noreferrer">
                      <CalendarPlus size={14} /> Outlook <ExternalLink size={11} />
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => downloadIcs(event, minutes)}>
                    <Download size={14} /> .ics file
                  </Button>
                </div>
              </div>
            )}

            <div className="mt-5 flex items-center justify-between gap-2 border-t pt-4" style={{ borderColor: BORDER }}>
              {confirmingDelete ? (
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  <span className="text-sm" style={{ color: TEXT }}>
                    {event.invites_sent_at ? "Cancel it and tell everyone invited?" : "Cancel this meeting?"}
                  </span>
                  <Button variant="destructive" size="sm" onClick={() => { setConfirmingDelete(false); onDelete(event); }}>
                    Yes, cancel it
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(false)}>Keep</Button>
                </div>
              ) : (
                <>
                  <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setConfirmingDelete(true)} style={{ color: MUTED }}>
                    <Trash2 size={14} /> Cancel meeting
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onEdit(event)}>
                    <Pencil size={14} /> Edit
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
