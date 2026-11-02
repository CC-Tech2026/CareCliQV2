import { Link } from "wouter";
import { ArrowRight, CalendarDays, Check, FileSignature, NotebookTabs, TriangleAlert } from "lucide-react";
import { getInitials } from "@/components/participant-portal/ProfileAvatar";
import type { ParticipantInvoice, ParticipantShift, PortalOverview } from "@/services/participantPortalService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const PLUM_SOFT = "var(--cc-plum-soft)";
// Purple is the brand's headline-emphasis colour (see --auth-accent on sign-in).
const ACCENT = "var(--cc-brand-purple)";
const GREEN = "var(--cc-green)";
const AMBER = "#9A5B0A";
const AMBER_SOFT = "#FBF2E6";

type TeamMember = PortalOverview["support_team"][number];

const DAY_MS = 86_400_000;

function startOfDay(value: Date | string) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysFromToday(value: string) {
  return Math.round((startOfDay(value).getTime() - startOfDay(new Date()).getTime()) / DAY_MS);
}

function longDay(value: string | Date) {
  return new Date(value).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

/** Compact time for the week grid: "9am", "1:30pm". */
function shortTime(value: string) {
  const d = new Date(value);
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  return `${h}${m ? `:${String(m).padStart(2, "0")}` : ""}${d.getHours() < 12 ? "am" : "pm"}`;
}

function duration(start: string, end: string) {
  const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
  if (minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h ? `${h} ${h === 1 ? "hour" : "hours"}` : "";
  return [hours, m ? `${m} min` : ""].filter(Boolean).join(" ");
}

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] ?? "";
}

/** "today" / "tomorrow" / "on Saturday 31 October", for use inside a sentence. */
function dayPhrase(value: string) {
  const days = daysFromToday(value);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `on ${longDay(value)}`;
}

function memberFor(shift: ParticipantShift, team: TeamMember[]) {
  return team.find((m) => (shift.worker_id && m.id === shift.worker_id) || (shift.worker_name && m.full_name === shift.worker_name));
}

function PersonAvatar({ name, photo, size }: { name: string; photo?: string | null; size: number }) {
  return photo ? (
    <img src={photo} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full font-black"
      style={{ width: size, height: size, background: SOFT, color: TEXT, fontSize: Math.round(size * 0.34) }}
    >
      {getInitials(name || "?")}
    </span>
  );
}

function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="text-[17px] font-black" style={{ color: TEXT }}>{children}</h2>
      {aside}
    </div>
  );
}

// ── Greeting ────────────────────────────────────────────────────────────

export function PortalGreeting({
  viewerName,
  participantName,
  isSelf,
  next,
}: {
  viewerName: string;
  participantName: string;
  isSelf: boolean;
  next?: ParticipantShift;
}) {
  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const who = firstName(next?.worker_name) || "Your support worker";
  const forWhom = isSelf ? "" : ` ${firstName(participantName)}`;

  let summary = isSelf ? "No visits are booked yet." : `No visits are booked for ${firstName(participantName)} yet.`;
  if (next?.status === "in_progress") {
    summary = `${who} is with ${isSelf ? "you" : firstName(participantName)} now, until ${formatTime(next.scheduled_end)}.`;
  } else if (next) {
    summary = `${who} is coming${forWhom ? ` to see${forWhom}` : ""} ${dayPhrase(next.scheduled_start)} at ${formatTime(next.scheduled_start)}.`;
  }

  return (
    <header>
      <h1 className="text-[26px] font-black leading-tight sm:text-[30px]" style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}>
        Good {partOfDay}, <span style={{ color: ACCENT }}>{firstName(viewerName) || "there"}</span>
      </h1>
      <p className="mt-1.5 text-[15px] sm:text-[16px]" style={{ color: MUTED }}>{summary}</p>
    </header>
  );
}

// ── Something that needs a look ─────────────────────────────────────────

export function AttentionRow({ invoices }: { invoices: ParticipantInvoice[] | null }) {
  const overdue = (invoices ?? []).filter((inv) => inv.status === "overdue");
  if (overdue.length === 0) return null;
  const total = overdue.reduce((sum, inv) => sum + (Number(inv.total_amount) || 0), 0);
  const amount = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(total);
  return (
    <Link
      href="/participant-portal/invoices"
      className="flex items-center gap-3 rounded-2xl border px-4 py-3.5 outline-none transition-colors hover:brightness-[0.98] focus-visible:ring-2"
      style={{ borderColor: AMBER, background: AMBER_SOFT, color: AMBER }}
    >
      <TriangleAlert size={18} className="shrink-0" />
      <span className="min-w-0 flex-1 text-[14px] font-bold">
        {overdue.length === 1 ? "1 invoice is overdue" : `${overdue.length} invoices are overdue`} ({amount})
      </span>
      <span className="hidden shrink-0 text-[13px] font-bold sm:inline">View invoices</span>
      <ArrowRight size={16} className="shrink-0" />
    </Link>
  );
}

// ── Next visit ──────────────────────────────────────────────────────────

export function NextVisitCard({ next, moreCount, team }: { next?: ParticipantShift; moreCount: number; team: TeamMember[] }) {
  if (!next) {
    return (
      <section className="flex items-center gap-4 rounded-2xl border p-5 sm:p-6" style={{ background: SURFACE, borderColor: BORDER }}>
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ background: SOFT }}>
          <CalendarDays size={22} style={{ color: MUTED }} />
        </span>
        <div>
          <h2 className="text-[17px] font-black" style={{ color: TEXT }}>No visits booked yet</h2>
          <p className="mt-0.5 text-[14px]" style={{ color: MUTED }}>When your provider books support, it will show up here.</p>
        </div>
      </section>
    );
  }

  const now = next.status === "in_progress";
  const days = daysFromToday(next.scheduled_start);
  const when = now ? "Happening now" : days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`;
  const member = memberFor(next, team);
  const length = duration(next.scheduled_start, next.scheduled_end);

  return (
    <section className="rounded-2xl border" style={{ background: SURFACE, borderColor: BORDER }} aria-label="Next visit">
      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-bold" style={{ color: MUTED }}>Next visit</p>
          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-bold" style={{ background: PLUM_SOFT, color: PLUM }}>
            {now && <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: PLUM }} />}
            {when}
          </span>
        </div>

        <div className="mt-4 flex items-start gap-4">
          <PersonAvatar name={next.worker_name ?? ""} photo={member?.profile_photo_url} size={56} />
          <div className="min-w-0">
            <p className="text-[20px] font-black leading-tight sm:text-[22px]" style={{ color: TEXT }}>{longDay(next.scheduled_start)}</p>
            <p className="mt-1 text-[15px] font-semibold" style={{ color: TEXT }}>
              {formatTime(next.scheduled_start)} to {formatTime(next.scheduled_end)}
              {length && <span className="font-normal" style={{ color: MUTED }}> · {length}</span>}
            </p>
            {next.worker_name && (
              <p className="mt-0.5 text-[14px]" style={{ color: MUTED }}>
                with <span className="font-bold" style={{ color: TEXT }}>{next.worker_name}</span>
                {member?.role_label ? `, ${member.role_label.toLowerCase()}` : ""}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3.5 sm:px-6" style={{ borderColor: BORDER }}>
        <p className="text-[13px]" style={{ color: MUTED }}>
          {moreCount > 0 ? `${moreCount} more ${moreCount === 1 ? "visit" : "visits"} booked after this` : "Nothing else booked yet"}
        </p>
        <Link href="/participant-portal/schedule" className="inline-flex min-h-10 items-center gap-1.5 text-[14px] font-bold" style={{ color: PLUM }}>
          Full schedule <ArrowRight size={15} />
        </Link>
      </div>
    </section>
  );
}

// ── This week ───────────────────────────────────────────────────────────

export function WeekStrip({ shifts }: { shifts: ParticipantShift[] | null }) {
  const today = startOfDay(new Date());
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
  const sunday = days[6];
  const range = `${monday.toLocaleDateString("en-AU", { day: "numeric", month: "short" })} to ${sunday.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`;
  const visitsOn = (d: Date) =>
    (shifts ?? [])
      .filter((s) => startOfDay(s.scheduled_start).getTime() === d.getTime())
      .sort((a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime());
  const weekCount = days.reduce((n, d) => n + visitsOn(d).filter((s) => s.status !== "cancelled").length, 0);

  return (
    <section>
      <SectionTitle
        aside={<p className="text-[13px]" style={{ color: MUTED }}>{range} · {shifts === null ? "..." : `${weekCount} ${weekCount === 1 ? "visit" : "visits"}`}</p>}
      >
        This week
      </SectionTitle>
      <ol className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {days.map((d) => {
          const visits = visitsOn(d);
          const isToday = d.getTime() === today.getTime();
          const isPast = d.getTime() < today.getTime();
          const label = `${longDay(d)}: ${
            visits.length === 0
              ? "no visits"
              : visits.map((v) => `${formatTime(v.scheduled_start)} to ${formatTime(v.scheduled_end)}${v.worker_name ? ` with ${v.worker_name}` : ""}${v.status === "cancelled" ? ", cancelled" : ""}`).join("; ")
          }`;
          return (
            <li
              key={d.toISOString()}
              aria-label={label}
              className="flex min-h-[104px] flex-col items-center rounded-xl border px-1 py-2.5 sm:min-h-[116px] sm:px-2"
              style={{
                background: SURFACE,
                borderColor: isToday ? PLUM : BORDER,
                boxShadow: isToday ? `inset 0 0 0 1px ${PLUM}` : undefined,
                opacity: isPast ? 0.75 : 1,
              }}
            >
              <span className="text-[12px] font-bold" style={{ color: isToday ? PLUM : MUTED }}>
                {d.toLocaleDateString("en-AU", { weekday: "short" })}
              </span>
              <span className="text-[19px] font-black leading-tight sm:text-[22px]" style={{ color: TEXT }}>{d.getDate()}</span>
              <span className="mt-auto flex w-full flex-col items-center gap-1 pt-2">
                {visits.slice(0, 2).map((v) => {
                  const done = v.status === "completed";
                  const cancelled = v.status === "cancelled";
                  return (
                    <span
                      key={v.id}
                      className={`flex w-full items-center justify-center gap-0.5 truncate rounded-md px-0.5 py-0.5 text-[11px] font-bold sm:text-[12px] ${cancelled ? "line-through" : ""}`}
                      style={{
                        background: done || cancelled ? SOFT : PLUM_SOFT,
                        color: done ? GREEN : cancelled ? MUTED : PLUM,
                      }}
                    >
                      {done && <Check size={11} className="hidden shrink-0 sm:block" />}
                      {shortTime(v.scheduled_start)}
                    </span>
                  );
                })}
                {visits.length > 2 && (
                  <span className="text-[11px] font-bold" style={{ color: MUTED }}>+{visits.length - 2}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ── Support team ────────────────────────────────────────────────────────

export function SupportTeam({ team, upcoming }: { team: TeamMember[]; upcoming: ParticipantShift[] }) {
  return (
    <section>
      <SectionTitle>Your support team</SectionTitle>
      {team.length === 0 ? (
        <p className="rounded-2xl border p-5 text-[14px]" style={{ background: SURFACE, borderColor: BORDER, color: MUTED }}>
          Your provider will let you know who's supporting you.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--cc-border)] rounded-2xl border" style={{ background: SURFACE, borderColor: BORDER }}>
          {team.map((m) => {
            const next = upcoming.find((s) => memberFor(s, [m]));
            return (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                <PersonAvatar name={m.full_name ?? ""} photo={m.profile_photo_url} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold" style={{ color: TEXT }}>{m.full_name}</p>
                  <p className="text-[13px]" style={{ color: MUTED }}>
                    {m.role_label}
                    {next ? ` · Next visit ${dayPhrase(next.scheduled_start).replace(/^on /, "")}` : ""}
                  </p>
                </div>
                {m.is_assigned && (
                  <span className="hidden shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-bold sm:inline" style={{ background: SOFT, color: TEXT }}>
                    Main support worker
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Plan and paperwork ──────────────────────────────────────────────────

function PaperworkLink({ href, icon: Icon, title, children }: { href: string; icon: typeof NotebookTabs; title: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-start gap-3 px-4 py-4 outline-none transition-colors hover:bg-[var(--cc-soft)] focus-visible:ring-2 sm:px-5"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: SOFT }}>
        <Icon size={19} style={{ color: MUTED }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold" style={{ color: TEXT }}>{title}</span>
        {children}
      </span>
      <ArrowRight size={16} className="mt-1 shrink-0" style={{ color: PLUM }} />
    </Link>
  );
}

export function PlanAndPaperwork({ pinned }: { pinned: PortalOverview["pinned"] }) {
  const plan = pinned.ndis_plan;
  const agreement = pinned.service_agreement;

  let planBody: React.ReactNode = (
    <span className="block text-[13px]" style={{ color: MUTED }}>Not on file yet. Your provider will add it.</span>
  );
  if (plan.available && plan.plan_start && plan.plan_end) {
    const start = new Date(plan.plan_start).getTime();
    const end = new Date(plan.plan_end).getTime();
    const pct = Math.min(100, Math.max(0, Math.round(((Date.now() - start) / (end - start)) * 100)));
    const daysLeft = Math.max(0, Math.ceil((end - Date.now()) / DAY_MS));
    const left = daysLeft > 60 ? `about ${Math.round(daysLeft / 30.4)} months left` : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`;
    planBody = (
      <>
        <span className="block text-[13px]" style={{ color: MUTED }}>Ends {formatDate(plan.plan_end)} · {left}</span>
        <span
          className="mt-2.5 block h-2 overflow-hidden rounded-full"
          style={{ background: SOFT }}
          role="progressbar"
          aria-label="How far through the plan"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: TEXT }} />
        </span>
        {daysLeft <= 90 && (
          <span className="mt-2 block text-[13px] font-semibold" style={{ color: AMBER }}>
            Plan review is coming up. Your provider can help you get ready.
          </span>
        )}
      </>
    );
  }

  return (
    <section>
      <SectionTitle>Your plan and paperwork</SectionTitle>
      <div className="divide-y divide-[var(--cc-border)] overflow-hidden rounded-2xl border" style={{ background: SURFACE, borderColor: BORDER }}>
        <PaperworkLink href="/participant-portal/plan" icon={NotebookTabs} title="NDIS plan, budgets and goals">
          {planBody}
        </PaperworkLink>
        <PaperworkLink href="/participant-portal/documents" icon={FileSignature} title="Service agreement">
          <span className="block text-[13px]" style={{ color: MUTED }}>
            {agreement.available && agreement.updated_at ? `Signed ${formatDate(agreement.updated_at)}` : "Not available yet"}
          </span>
        </PaperworkLink>
      </div>
    </section>
  );
}
