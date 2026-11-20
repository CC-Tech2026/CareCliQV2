import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { displayDate } from "@/lib/datetime";
import { CalendarDays, Clock, Mail, MapPin, Mic, Phone, Plus, Users, Video, X } from "lucide-react";
import { useGetParticipants } from "@workspace/api-client-react";
import { SidePanel } from "@/components/layout/SidePanel";
import { ctaClass, outlineClass } from "@/components/layout/PageKit";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { sharedNames, suburbFromAddress } from "@/lib/person-identity";
import {
  MEETING_CHOICES,
  MEETING_MODES,
  choiceOf,
  isOnlineMode,
  isParticipantChoice,
  type MeetingChoice,
} from "@/lib/meeting-booking";
import { getMeetingInvitees, type MeetingAttendee, type MeetingMode, type OrgEvent, type OrgEventPayload } from "@/services/hubService";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const DANGER = "var(--cc-status-danger)";

const MODE_ICONS: Record<MeetingMode, typeof Video> = {
  in_person: Users,
  phone: Phone,
  video: Video,
};

const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;

type ParticipantOption = { id: string; full_name: string; address?: string | null };
type Person = { email: string; name: string; role: string };

export type BookingDraft = { date: Date; start: string; end: string; participantId?: string };

/** Someone in participant onboarding, who has no participant record yet. */
export type BookingIntake = { id: string; name: string; address?: string | null; participantId?: string | null };

/** Invite suggestions left unticked: the MD adds them if they want them. */
const UNTICKED_ROLES = new Set(["Support worker", "Plan manager"]);

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function minutesToHHMM(mins: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, mins));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}
function durationLabel(minutes: number): string {
  const m = Math.max(15, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem} mins`;
  if (rem === 0) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${h}h ${rem}m`;
}

function toPerson(a: MeetingAttendee): Person {
  return { email: a.email, name: a.name ?? "", role: a.role ?? "" };
}

// Matches the shared Input, for fields that carry an icon.
const FIELD_BOX =
  "flex h-10 items-center gap-2 rounded-md border border-cc-border bg-cc-surface px-3 shadow-sm focus-within:ring-1 focus-within:ring-ring";

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium" style={{ color: TEXT }}>{label}</p>
      {children}
      {error ? (
        <p className="text-xs font-medium" style={{ color: DANGER }}>{error}</p>
      ) : hint ? (
        <p className="text-xs" style={{ color: MUTED }}>{hint}</p>
      ) : null}
    </div>
  );
}

/** A setting with an explanation and, usually, a switch. */
function OptionCard({ icon: Icon, title, text, control }: { icon: typeof Video; title: string; text: string; control?: React.ReactNode }) {
  const body = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cc-soft" style={{ color: MUTED }}>
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium" style={{ color: TEXT }}>{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed" style={{ color: MUTED }}>{text}</span>
      </span>
      {control}
    </>
  );
  return control ? (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3" style={{ borderColor: BORDER }}>{body}</label>
  ) : (
    <div className="flex items-start gap-3 rounded-xl border p-3" style={{ borderColor: BORDER }}>{body}</div>
  );
}

/** Book a meeting, or edit one (`editing`). Participant meetings carry the
 *  participant; everyone ticked under "Who to invite" gets a calendar invite
 *  (emailed for in person and phone, sent from the organiser's own calendar
 *  for a video call); in-person ones can be set up for Easy Capture.
 *  With `intake`, it's booked from participant onboarding for that person:
 *  a Meet & Greet unless another type is picked. */
export function MeetingBookingSheet({
  open,
  onOpenChange,
  draft,
  editing,
  editingMinutes,
  saving,
  onSave,
  intake: intakeProp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: BookingDraft | null;
  editing: OrgEvent | null;
  editingMinutes?: number;
  saving: boolean;
  onSave: (payload: OrgEventPayload) => void;
  intake?: BookingIntake | null;
}) {
  // A meeting booked in onboarding, opened from the Calendar, is still theirs.
  const intake = useMemo<BookingIntake | null>(
    () =>
      intakeProp ??
      (editing?.intake_id && !editing.participant_id
        ? { id: editing.intake_id, name: editing.participant_name || "New participant" }
        : null),
    [intakeProp, editing],
  );
  const participantsQuery = useGetParticipants();
  const participants = (participantsQuery.data as ParticipantOption[] | undefined) ?? [];
  const sameNames = useMemo(() => sharedNames(participants.map((p) => p.full_name)), [participants]);

  const [choice, setChoice] = useState<MeetingChoice>("plan_review");
  const [participantId, setParticipantId] = useState("");
  const [title, setTitle] = useState("");
  // A ref, not state: the reset below and the auto-title effect run in the
  // same pass, and the auto-title must see the reset straight away.
  const titleEdited = useRef(false);
  const [date, setDate] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [mode, setMode] = useState<MeetingMode>("in_person");
  const [location, setLocation] = useState("");
  const [capture, setCapture] = useState(true);
  const [notes, setNotes] = useState("");
  const [triedSave, setTriedSave] = useState(false);
  // Who's invited, by lower-cased email. `extra` holds people typed in or
  // carried over from an edit who aren't among the suggestions.
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<Person[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [sendInvites, setSendInvites] = useState(true);
  // Once the MD ticks or unticks anyone, suggestions stop being re-applied.
  const invitesTouched = useRef(false);

  // Reset every time the panel opens, from the event being edited or the
  // slot that was clicked.
  useEffect(() => {
    if (!open) return;
    setTriedSave(false);
    setNewEmail("");
    setSendInvites(true);
    if (editing) {
      const startTime = editing.start_time || "09:00";
      setChoice(choiceOf(editing));
      setParticipantId(editing.participant_id ?? "");
      titleEdited.current = true;
      setTitle(editing.title);
      setDate(editing.event_date.slice(0, 10));
      setStart(startTime);
      setEnd(minutesToHHMM(hhmmToMinutes(startTime) + (editingMinutes ?? 60)));
      setMode(editing.meeting_mode ?? "in_person");
      setLocation(editing.location ?? "");
      setCapture(!!editing.easy_capture);
      setNotes(editing.participants_desc ?? "");
      const people = (editing.attendees ?? []).map(toPerson);
      setExtra(people);
      setInvited(new Set(people.map((p) => p.email.toLowerCase())));
      invitesTouched.current = true;
      return;
    }
    const initial: MeetingChoice = intake ? "intake" : draft?.participantId ? "check_in" : "plan_review";
    setChoice(initial);
    setParticipantId(draft?.participantId ?? "");
    titleEdited.current = false;
    setTitle("");
    setDate(format(draft?.date ?? new Date(), "yyyy-MM-dd"));
    setStart(draft?.start ?? "09:00");
    setEnd(draft?.end ?? minutesToHHMM(hhmmToMinutes(draft?.start ?? "09:00") + MEETING_CHOICES[initial].minutes));
    setMode("in_person");
    setLocation(intake?.address ?? "");
    setCapture(!!MEETING_CHOICES[initial].capture);
    setNotes("");
    setExtra([]);
    setInvited(new Set());
    invitesTouched.current = false;
  }, [open, editing, editingMinutes, draft, intake]);

  const config = MEETING_CHOICES[choice];
  const withParticipant = isParticipantChoice(choice);
  const participant = participants.find((p) => p.id === participantId);
  const withName = intake ? intake.name : participant?.full_name;
  const video = isOnlineMode(mode);

  const inviteesKey = intake && withParticipant
    ? ["meeting-invitees", "intake", intake.id]
    : ["meeting-invitees", withParticipant ? participantId || "none" : "internal"];
  const inviteesQuery = useOrgQuery(inviteesKey, {
    queryFn: () =>
      intake && withParticipant ? getMeetingInvitees(null, intake.id) : getMeetingInvitees(withParticipant ? participantId : null),
    enabled: open && (!withParticipant || !!participantId || !!intake),
    staleTime: 60_000,
  });
  const suggestions = useMemo(() => (inviteesQuery.data ?? []).map(toPerson), [inviteesQuery.data]);

  // A new booking starts with you, the participant and their family or
  // nominee ticked; support workers and the plan manager are listed but
  // left for the MD to add.
  useEffect(() => {
    if (!open || invitesTouched.current || !inviteesQuery.data) return;
    setInvited(new Set(suggestions.filter((p) => !UNTICKED_ROLES.has(p.role)).map((p) => p.email.toLowerCase())));
  }, [open, suggestions, inviteesQuery.data]);

  const people = useMemo(() => {
    const seen = new Set<string>();
    return [...suggestions, ...extra].filter((p) => {
      const key = p.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [suggestions, extra]);
  const attendees = people.filter((p) => invited.has(p.email.toLowerCase()));

  // The title follows the type and participant until the MD types their own.
  useEffect(() => {
    if (!open || titleEdited.current) return;
    setTitle(withParticipant && withName ? `${config.label} · ${withName}` : config.label);
  }, [open, config.label, withParticipant, withName]);

  function pickChoice(next: MeetingChoice) {
    setChoice(next);
    setCapture(!!MEETING_CHOICES[next].capture);
    if (!editing) setEnd(minutesToHHMM(hhmmToMinutes(start) + MEETING_CHOICES[next].minutes));
  }

  function pickParticipant(id: string) {
    setParticipantId(id);
    const address = participants.find((p) => p.id === id)?.address;
    if (mode === "in_person" && !location.trim() && address) setLocation(address);
  }

  function toggle(email: string, on: boolean) {
    invitesTouched.current = true;
    setInvited((prev) => {
      const next = new Set(prev);
      if (on) next.add(email.toLowerCase());
      else next.delete(email.toLowerCase());
      return next;
    });
  }

  const newEmailError = newEmail.trim() && !EMAIL.test(newEmail.trim()) ? "That doesn't look like an email address." : null;
  function addEmail() {
    const email = newEmail.trim();
    if (!email || !EMAIL.test(email)) return;
    if (!people.some((p) => p.email.toLowerCase() === email.toLowerCase())) {
      setExtra((prev) => [...prev, { email, name: "", role: "Added" }]);
    }
    toggle(email, true);
    setNewEmail("");
  }

  const missingParticipant = withParticipant && !participantId && !intake;
  const endBeforeStart = hhmmToMinutes(end) <= hhmmToMinutes(start);
  const canSave = !!title.trim() && !!date && !missingParticipant && !endBeforeStart;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTriedSave(true);
    if (!canSave) return;
    const internal = !withParticipant;
    onSave({
      title: title.trim(),
      event_date: date,
      start_time: start,
      duration: durationLabel(hhmmToMinutes(end) - hhmmToMinutes(start)),
      event_type: internal ? (choice as OrgEvent["event_type"]) : "meeting",
      meeting_kind: internal ? null : (choice as OrgEvent["meeting_kind"]),
      participant_id: !withParticipant ? null : intake ? intake.participantId ?? null : participantId,
      intake_id: withParticipant && intake ? intake.id : null,
      meeting_mode: mode,
      location: mode === "video" ? null : location.trim() || null,
      easy_capture: mode === "in_person" && withParticipant && capture,
      participants_desc: notes.trim() || null,
      attendees: attendees.map(({ email, name, role }) => ({ email, name: name || null, role: role || null })),
      send_invites: !video && sendInvites,
    });
  }

  // From onboarding it's always a meeting with that person.
  const choiceGroups = (intake ? (["participant"] as const) : (["participant", "internal"] as const)).map((group) => ({
    group,
    choices: (Object.keys(MEETING_CHOICES) as MeetingChoice[]).filter((c) => MEETING_CHOICES[c].group === group),
  }));
  const alreadyInvited = !!editing?.invites_sent_at;

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      eyebrow={editing ? "Edit meeting" : "New meeting"}
      title={editing ? editing.title : "Book a meeting"}
      description={
        editing && editing.event_date
          ? `Booked for ${format(displayDate(editing.event_date), "EEEE d MMMM")}.`
          : "Everyone you invite gets it in their own calendar: Google, Outlook or Apple."
      }
      footer={
        <>
          <button type="button" className={`${outlineClass} ml-auto`} onClick={() => onOpenChange(false)}>Cancel</button>
          <button type="submit" form="meeting-booking-form" className={ctaClass} disabled={saving}>
            {saving ? "Saving..." : editing ? "Save changes" : "Book meeting"}
          </button>
        </>
      }
    >
        <form id="meeting-booking-form" onSubmit={handleSubmit} className="space-y-5">
          <Field label="Meeting type" hint={config.hint}>
            <Select value={choice} onValueChange={(v) => pickChoice(v as MeetingChoice)}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {choiceGroups.map(({ group, choices }, i) => (
                  <SelectGroup key={group}>
                    {i > 0 && <SelectSeparator />}
                    <SelectLabel>{group === "participant" ? "With a participant" : "Internal"}</SelectLabel>
                    {choices.map((c) => (
                      <SelectItem key={c} value={c}>{MEETING_CHOICES[c].label}</SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {withParticipant && intake && (
            <Field label="Participant" hint={intake.participantId ? undefined : "In onboarding. The meeting moves to their participant record when they're activated."}>
              <p className="flex h-10 items-center rounded-md border border-cc-border bg-cc-soft px-3 text-sm font-medium" style={{ color: TEXT }}>
                {intake.name}
              </p>
            </Field>
          )}

          {withParticipant && !intake && (
            <Field label="Participant" error={triedSave && missingParticipant ? "Choose who the meeting is with." : null}>
              <SearchableSelect
                value={participantId}
                onValueChange={pickParticipant}
                placeholder={participantsQuery.isLoading ? "Loading participants..." : "Choose a participant"}
                searchPlaceholder="Search participants"
                emptyText="No participants found"
                options={participants.map((p) => {
                  const suburb = sameNames.has(p.full_name.trim().toLowerCase()) ? suburbFromAddress(p.address ?? "") : "";
                  const label = suburb ? `${p.full_name} (${suburb})` : p.full_name;
                  // Keywords replace the label in the search, so the name goes in too.
                  return { value: p.id, label, keywords: [label, p.address].filter(Boolean).join(" ") };
                })}
              />
            </Field>
          )}

          <Field label="Title">
            <Input
              value={title}
              onChange={(e) => { setTitle(e.target.value); titleEdited.current = true; }}
              className="h-10"
              required
            />
          </Field>

          <Field label="When" error={endBeforeStart ? "The meeting has to end after it starts." : null}>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <div className={FIELD_BOX}>
                <CalendarDays size={15} className="shrink-0" style={{ color: MUTED }} />
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required
                  className="w-full min-w-0 bg-transparent text-sm outline-none" style={{ color: TEXT }} aria-label="Date" />
              </div>
              <div className={FIELD_BOX}>
                <Clock size={15} className="shrink-0" style={{ color: MUTED }} />
                <input type="time" value={start} onChange={(e) => setStart(e.target.value)} required
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none" style={{ color: TEXT }} aria-label="Start time" />
                <span className="shrink-0 text-sm" style={{ color: MUTED }}>to</span>
                <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none" style={{ color: TEXT }} aria-label="End time" />
              </div>
            </div>
          </Field>

          <Field label="How">
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Meeting format">
              {(Object.keys(MEETING_MODES) as MeetingMode[]).map((m) => {
                const Icon = MODE_ICONS[m];
                const selected = mode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setMode(m)}
                    className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-2 text-sm font-medium transition-colors ${
                      selected
                        ? "border-[var(--cc-brand-purple)] bg-[var(--cc-brand-purple-soft)] text-[var(--cc-brand-purple)]"
                        : "border-cc-border text-cc-text hover:bg-cc-soft"
                    }`}
                  >
                    <Icon size={15} /> {MEETING_MODES[m].label}
                  </button>
                );
              })}
            </div>
          </Field>

          {mode === "in_person" && (
            <Field label="Where">
              <AddressAutocomplete
                value={location}
                onChange={setLocation}
                placeholder={withParticipant ? "Participant's home, office, community venue..." : "Office, meeting room..."}
                aria-label="Location"
                className="h-11 rounded-xl text-sm"
              />
            </Field>
          )}

          {mode === "phone" && (
            <Field label="Number to call (optional)">
              <div className={FIELD_BOX}>
                <Phone size={15} className="shrink-0" style={{ color: MUTED }} />
                <input value={location} onChange={(e) => setLocation(e.target.value)} inputMode="tel"
                  placeholder="Who calls whom, or a dial-in number"
                  className="w-full bg-transparent text-sm outline-none" style={{ color: TEXT }} aria-label="Number to call" />
              </div>
            </Field>
          )}

          {mode === "in_person" && withParticipant && (
            <OptionCard
              icon={Mic}
              title="Record with Easy Capture"
              text="Record and transcribe the meeting on the day. Goals and tasks from it are suggested on the participant's Meetings tab. Consent is asked before recording starts."
              control={<Switch checked={capture} onCheckedChange={setCapture} aria-label="Record with Easy Capture" />}
            />
          )}

          <Field label="Who to invite" error={newEmailError}>
            {withParticipant && !participantId && !intake ? (
              <p className="rounded-xl border border-dashed px-3 py-3 text-sm" style={{ borderColor: BORDER, color: MUTED }}>
                Choose the participant to see their family, nominee and support workers here.
              </p>
            ) : inviteesQuery.isLoading ? (
              <p role="status" className="text-sm" style={{ color: MUTED }}>Finding who to invite...</p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-xl border" style={{ borderColor: BORDER }}>
                {people.map((p) => {
                  const on = invited.has(p.email.toLowerCase());
                  const id = `invite-${p.email}`;
                  return (
                    <li key={p.email} className="flex min-h-12 items-center gap-3 px-3 py-2" style={{ borderColor: BORDER }}>
                      <Checkbox id={id} checked={on} onCheckedChange={(v) => toggle(p.email, v === true)} />
                      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                        <span className="block truncate text-sm font-medium" style={{ color: TEXT }}>{p.name || p.email}</span>
                        <span className="block truncate text-xs" style={{ color: MUTED }}>
                          {[p.role, p.name ? p.email : ""].filter(Boolean).join(" · ")}
                        </span>
                      </label>
                      {p.role === "Added" && (
                        <button type="button" onClick={() => { toggle(p.email, false); setExtra((prev) => prev.filter((x) => x.email !== p.email)); }}
                          aria-label={`Remove ${p.email}`} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-cc-soft" style={{ color: MUTED }}>
                          <X size={15} />
                        </button>
                      )}
                    </li>
                  );
                })}
                {people.length === 0 && (
                  <li className="px-3 py-3 text-sm" style={{ color: MUTED }}>No one with an email address yet. Add someone below.</li>
                )}
              </ul>
            )}
            <div className="flex gap-2">
              <div className={`${FIELD_BOX} min-w-0 flex-1`}>
                <Mail size={15} className="shrink-0" style={{ color: MUTED }} />
                <input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEmail(); } }}
                  type="email"
                  inputMode="email"
                  placeholder="Add someone else by email"
                  aria-label="Add someone by email"
                  className="w-full min-w-0 bg-transparent text-sm outline-none"
                  style={{ color: TEXT }}
                />
              </div>
              <button type="button" className={outlineClass} onClick={addEmail} disabled={!newEmail.trim() || !!newEmailError}>
                <Plus size={15} /> Add
              </button>
            </div>
          </Field>

          {video ? (
            <OptionCard icon={Video} title="Sent from your own calendar" text={MEETING_MODES.video.hint} />
          ) : (
            <OptionCard
              icon={Mail}
              title={alreadyInvited ? "Email the updated invite" : "Email calendar invites"}
              text={
                attendees.length
                  ? `${attendees.length} ${attendees.length === 1 ? "person gets" : "people get"} an invite they can accept into Google, Outlook or Apple Calendar. If you change or cancel the meeting, their calendars update.`
                  : "Tick who to invite above."
              }
              control={<Switch checked={sendInvites} onCheckedChange={setSendInvites} aria-label="Email calendar invites" />}
            />
          )}

          <Field label="Agenda and notes">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What to cover, what to bring. This goes in the invite."
              className="min-h-[88px] text-sm"
            />
          </Field>
        </form>
    </SidePanel>
  );
}
