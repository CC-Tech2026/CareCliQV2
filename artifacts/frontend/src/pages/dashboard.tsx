import { useMemo } from "react";
import { Link } from "wouter";
import { format, isBefore, startOfDay, parseISO, startOfWeek, endOfWeek, isWithinInterval } from "date-fns";
import {
  useGetSessions,
  useGetParticipants,
  useGetDashboardStats,
} from "@workspace/api-client-react";
import type { Session, Participant } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  Play,
  Eye,
  RotateCcw,
  FileText,
  ArrowRight,
  Users,
  UploadCloud,
  Package,
  ClipboardList,
  ShieldCheck,
  ChevronRight,
  Calendar,
  Loader2,
  UserCircle2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TODAY_STR = format(new Date(), "yyyy-MM-dd");

// Display time for a session — uses created_at as a proxy until the API exposes
// a dedicated `scheduled_time` field. TODO: swap to scheduled_time when available.
function sessionDisplayTime(session: Session): string {
  if (session.created_at) {
    try {
      return format(new Date(session.created_at), "h:mm a");
    } catch {
      // fall through
    }
  }
  return "--:--";
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function avatarColor(name: string): string {
  const colors = [
    "bg-violet-100 text-violet-700",
    "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700",
    "bg-amber-100 text-amber-700",
    "bg-rose-100 text-rose-700",
    "bg-teal-100 text-teal-700",
    "bg-indigo-100 text-indigo-700",
  ];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) % colors.length;
  return colors[hash];
}

type ComplianceLevel = "compliant" | "at_risk" | "non_compliant" | "pending";

function getComplianceLevel(session: Session): ComplianceLevel {
  if (session.status !== "completed") return "pending";
  const score = session.compliance_score ?? 0;
  if (score >= 85) return "compliant";
  if (score >= 60) return "at_risk";
  return "non_compliant";
}

interface TrafficLight {
  notes: boolean | null;
  goals: boolean | null;
  claim: boolean | null;
}

function getTrafficLight(session: Session): TrafficLight {
  const hasNotes = !!(session.notes && session.notes.trim().length > 10);
  const hasGoals =
    Array.isArray(session.goals_addressed) && session.goals_addressed.length > 0;
  const score = session.compliance_score;
  const claimReady =
    session.status === "completed" && score !== null && score !== undefined
      ? score >= 70
      : session.status === "completed"
      ? false
      : null;
  return { notes: hasNotes, goals: hasGoals, claim: claimReady };
}

function TrafficDot({ value }: { value: boolean | null }) {
  if (value === null)
    return <span className="h-2.5 w-2.5 rounded-full bg-slate-200 inline-block" />;
  return (
    <span
      className={cn(
        "h-2.5 w-2.5 rounded-full inline-block",
        value ? "bg-emerald-500" : "bg-red-400",
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Donut chart (pure SVG)
// ---------------------------------------------------------------------------

function DonutChart({
  compliant,
  atRisk,
  nonCompliant,
}: {
  compliant: number;
  atRisk: number;
  nonCompliant: number;
}) {
  const total = compliant + atRisk + nonCompliant || 1;
  const pct = compliant / total;
  const size = 120;
  const r = 44;
  const cx = 60;
  const cy = 60;
  const circ = 2 * Math.PI * r;

  // Three arcs for the donut
  function arc(
    value: number,
    offset: number,
    color: string,
    key: string,
  ) {
    const frac = value / total;
    const dash = frac * circ;
    const gap = circ - dash;
    return (
      <circle
        key={key}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="14"
        strokeDasharray={`${dash} ${gap}`}
        strokeDashoffset={-offset * circ}
        transform={`rotate(-90 ${cx} ${cy})`}
        strokeLinecap="butt"
      />
    );
  }

  return (
    <div className="relative flex items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth="14" />
        {arc(compliant, 0, "#22c55e", "c")}
        {arc(atRisk, compliant / total, "#f59e0b", "a")}
        {arc(nonCompliant, (compliant + atRisk) / total, "#ef4444", "n")}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-slate-800">
          {total > 0 ? Math.round(pct * 100) : "--"}%
        </span>
        <span className="text-[10px] text-slate-500 font-medium">Compliant</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function SessionStatusBadge({
  session,
  isNext = false,
}: {
  session: Session;
  isNext?: boolean;
}) {
  if (session.status === "completed")
    return (
      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-medium text-xs gap-1 border">
        <CheckCircle2 className="h-3 w-3" /> Completed
      </Badge>
    );
  if (session.status === "in_progress")
    return (
      <Badge className="bg-blue-50 text-blue-700 border-blue-200 font-medium text-xs gap-1 border">
        <Clock className="h-3 w-3" /> In Progress
      </Badge>
    );
  if (isNext)
    return (
      <Badge className="bg-primary/10 text-primary border-primary/20 font-medium text-xs gap-1 border">
        <Play className="h-3 w-3" /> Next
      </Badge>
    );
  return (
    <Badge className="bg-slate-100 text-slate-600 border-slate-200 font-medium text-xs gap-1 border">
      <Calendar className="h-3 w-3" /> Upcoming
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const { data: sessions = [], isLoading: sessionsLoading } = useGetSessions(
    { limit: 200 },
  );
  const { data: participants = [] } = useGetParticipants();
  const { data: stats } = useGetDashboardStats();

  // Participant name lookup
  const participantMap = useMemo<Record<string, Participant>>(() => {
    const m: Record<string, Participant> = {};
    for (const p of participants) m[p.id] = p;
    return m;
  }, [participants]);

  function participantName(session: Session): string {
    return (
      session.participants?.full_name ??
      participantMap[session.participant_id]?.full_name ??
      "Unknown Participant"
    );
  }

  function participantNdis(session: Session): string {
    return (
      session.participants?.ndis_number ??
      participantMap[session.participant_id]?.ndis_number ??
      ""
    );
  }

  // Today's sessions, sorted by created_at (best proxy until a scheduled_time field exists)
  const todaySessions = useMemo<Session[]>(() => {
    return [...sessions]
      .filter((s) => s.session_date === TODAY_STR)
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  }, [sessions]);

  // The single "Next" session: earliest (by created_at) draft or in_progress today.
  // NOTE: Uses created_at as sort key — switch to scheduled_time once API supports it.
  const nextSession = useMemo<Session | null>(() => {
    const actionable = todaySessions.filter(
      (s) => s.status === "draft" || s.status === "in_progress",
    );
    return actionable[0] ?? null; // todaySessions is already sorted by created_at asc
  }, [todaySessions]);

  // Past incomplete sessions (not ended before today)
  const pastIncomplete = useMemo<Session[]>(() => {
    const todayStart = startOfDay(new Date());
    return sessions.filter((s) => {
      const d = parseISO(s.session_date);
      return isBefore(d, todayStart) && s.status !== "completed";
    });
  }, [sessions]);

  // Completed sessions with low compliance OR missing notes
  const lowQuality = useMemo<Session[]>(() => {
    return sessions.filter((s) => {
      if (s.status !== "completed") return false;
      const missingNotes = !(s.notes && s.notes.trim().length > 10);
      const lowScore =
        s.compliance_score !== null &&
        s.compliance_score !== undefined &&
        s.compliance_score < 60;
      return missingNotes || lowScore;
    });
  }, [sessions]);

  // Deduplicate by id (a session could satisfy both criteria)
  const atRiskItems = useMemo<Session[]>(() => {
    const seen = new Set<string>();
    const combined: Session[] = [];
    for (const s of [...pastIncomplete, ...lowQuality]) {
      if (!seen.has(s.id)) { seen.add(s.id); combined.push(s); }
    }
    return combined.slice(0, 5);
  }, [pastIncomplete, lowQuality]);

  // Readiness summary
  // "Ready" = completed AND compliance ≥70
  const readyCount = todaySessions.filter(
    (s) => s.status === "completed" && (s.compliance_score ?? 0) >= 70,
  ).length;
  // "Needs attention" = not completed, OR completed but missing/low compliance
  const needsAttentionCount = todaySessions.filter(
    (s) =>
      s.status !== "completed" ||
      s.compliance_score === null ||
      s.compliance_score === undefined ||
      s.compliance_score < 70,
  ).length;

  // Compliance donut data — this week's completed sessions only
  const weekInterval = {
    start: startOfWeek(new Date(), { weekStartsOn: 1 }),
    end: endOfWeek(new Date(), { weekStartsOn: 1 }),
  };
  const weekSessions = sessions.filter((s) =>
    isWithinInterval(parseISO(s.session_date), weekInterval),
  );
  const compliantCount = weekSessions.filter(
    (s) => s.status === "completed" && (s.compliance_score ?? 0) >= 85,
  ).length;
  const atRiskCount = weekSessions.filter(
    (s) =>
      s.status === "completed" &&
      (s.compliance_score ?? 0) >= 60 &&
      (s.compliance_score ?? 0) < 85,
  ).length;
  const nonCompliantCount = weekSessions.filter(
    (s) =>
      s.status === "completed" &&
      (s.compliance_score ?? 0) < 60,
  ).length;

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* ── Page title ── */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{greeting}, Dr. Provider!</h1>
        <p className="text-sm text-slate-500 mt-0.5">Here's what's happening today.</p>
      </div>

      {/* ── Today Readiness Bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ReadinessCard
          label="Sessions today"
          value={todaySessions.length}
          icon={<Calendar className="h-4 w-4 text-primary" />}
          color="bg-primary/5"
        />
        <ReadinessCard
          label="Ready"
          value={readyCount}
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          color="bg-emerald-50"
          textColor="text-emerald-700"
        />
        <ReadinessCard
          label="Need attention"
          value={needsAttentionCount}
          icon={<AlertCircle className="h-4 w-4 text-amber-600" />}
          color="bg-amber-50"
          textColor="text-amber-700"
        />
        <ReadinessCard
          label="Incomplete (prior days)"
          value={pastIncomplete.length}
          icon={<Clock className="h-4 w-4 text-red-500" />}
          color={pastIncomplete.length > 0 ? "bg-red-50" : "bg-slate-50"}
          textColor={pastIncomplete.length > 0 ? "text-red-700" : "text-slate-500"}
        />
      </div>

      {/* ── Two-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: main content ── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Next Patient Focus Panel */}
          {sessionsLoading ? (
            <div className="rounded-2xl border bg-white p-8 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : nextSession ? (
            <NextPatientPanel
              session={nextSession}
              name={participantName(nextSession)}
              ndis={participantNdis(nextSession)}
            />
          ) : todaySessions.length === 0 ? (
            <EmptyToday />
          ) : (
            <AllDonePanel />
          )}

          {/* Session Timeline */}
          {todaySessions.length > 0 && (
            <section className="rounded-2xl border bg-white overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">Today's Sessions</h2>
                <Link href="/sessions">
                  <span className="text-xs text-primary font-medium flex items-center gap-1 hover:underline cursor-pointer">
                    View all <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
              </div>
              <div className="divide-y">
                {sessionsLoading ? (
                  <div className="p-8 flex justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                  </div>
                ) : (
                  todaySessions.map((s) => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      name={participantName(s)}
                      ndis={participantNdis(s)}
                      isNext={nextSession?.id === s.id}
                    />
                  ))
                )}
              </div>
            </section>
          )}

          {/* Incomplete / At Risk Panel */}
          {atRiskItems.length > 0 && (
            <section className="rounded-2xl border border-red-100 bg-red-50/50 overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-red-100 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-500" />
                <h2 className="font-semibold text-red-800">Incomplete / At Risk</h2>
                <span className="ml-auto text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                  {atRiskItems.length} item{atRiskItems.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="divide-y divide-red-100">
                {atRiskItems.map((s) => (
                  <AtRiskRow
                    key={s.id}
                    session={s}
                    name={participantName(s)}
                    isPast={pastIncomplete.includes(s)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>

        {/* ── Right: sidebar ── */}
        <div className="space-y-5">
          {/* Compliance Overview */}
          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-slate-900">Compliance Overview</h2>
              <span className="text-xs text-slate-400">This week</span>
            </div>

            <div className="flex justify-center mb-4">
              <DonutChart
                compliant={compliantCount}
                atRisk={atRiskCount}
                nonCompliant={nonCompliantCount}
              />
            </div>

            <div className="space-y-2">
              <LegendRow
                color="bg-emerald-500"
                label="Compliant"
                count={compliantCount}
              />
              <LegendRow
                color="bg-amber-400"
                label="Needs Attention"
                count={atRiskCount}
              />
              <LegendRow
                color="bg-red-400"
                label="At Risk"
                count={nonCompliantCount}
              />
            </div>

            {stats && (
              <div className="mt-4 pt-4 border-t text-xs text-slate-500">
                <span className="text-slate-700 font-medium">{stats.sessions_this_week}</span> sessions this week
                {stats.notes_missing > 0 && (
                  <span className="ml-2 text-amber-600 font-medium">
                    · {stats.notes_missing} notes missing
                  </span>
                )}
              </div>
            )}

            <Link href="/compliance">
              <button className="mt-4 w-full text-xs text-primary font-medium flex items-center justify-center gap-1 hover:underline">
                View compliance dashboard <ArrowRight className="h-3 w-3" />
              </button>
            </Link>
          </section>

          {/* Quick Actions */}
          <section className="rounded-2xl border bg-white overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b">
              <h2 className="font-semibold text-slate-900">Quick Actions</h2>
            </div>
            <div className="divide-y">
              <QuickAction
                icon={<UploadCloud className="h-4 w-4 text-blue-500" />}
                label="Upload Document / Evidence"
                sub="Add photos, files or signed documents"
                href="/sessions"
              />
              <QuickAction
                icon={<Package className="h-4 w-4 text-emerald-500" />}
                label="Generate Audit Pack"
                sub="Export all records for a participant"
                href="/compliance"
              />
              <QuickAction
                icon={<ClipboardList className="h-4 w-4 text-amber-500" />}
                label="Check Incomplete Records"
                sub="See records that need your attention"
                href="/sessions"
              />
              <QuickAction
                icon={<ShieldCheck className="h-4 w-4 text-violet-500" />}
                label="Provider Payment Assurance"
                sub="Stay compliant and get paid on time"
                href="/compliance"
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ReadinessCard({
  label,
  value,
  icon,
  color,
  textColor = "text-slate-800",
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  textColor?: string;
}) {
  return (
    <div className={cn("rounded-xl border bg-white p-4 shadow-sm flex items-center gap-3")}>
      <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", color)}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className={cn("text-xl font-bold leading-none", textColor)}>{value}</p>
        <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">{label}</p>
      </div>
    </div>
  );
}

function NextPatientPanel({
  session,
  name,
  ndis,
}: {
  session: Session;
  name: string;
  ndis: string;
}) {
  const isResume = session.status === "in_progress";
  const initials = getInitials(name);
  const colorCls = avatarColor(name);
  const light = getTrafficLight(session);

  return (
    <section className="rounded-2xl border bg-gradient-to-br from-primary to-primary/80 text-white p-6 shadow-md">
      <p className="text-xs font-semibold uppercase tracking-wider opacity-70 mb-3">
        {isResume ? "Resume Session" : "Next Patient"}
      </p>

      <div className="flex items-start gap-4">
        <div
          className={cn(
            "h-14 w-14 rounded-full flex items-center justify-center text-lg font-bold shrink-0 border-2 border-white/30",
            "bg-white/20 text-white",
          )}
        >
          {initials}
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold leading-tight">{name}</h2>
          {ndis && (
            <p className="text-sm opacity-70 mt-0.5">NDIS: {ndis}</p>
          )}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <Badge className="bg-white/20 border-white/30 text-white border text-xs">
              {session.session_type}
            </Badge>
            <span className="text-xs opacity-80 font-semibold">
              {sessionDisplayTime(session)}
            </span>
            <span className="text-xs opacity-60">
              {format(parseISO(session.session_date), "d MMM")}
              {" · "}
              {session.duration_minutes} min planned
            </span>
          </div>

          {/* Compliance traffic lights */}
          <div className="flex items-center gap-3 mt-3">
            <TrafficItem label="Notes" value={light.notes} light />
            <TrafficItem label="Goals" value={light.goals} light />
            <TrafficItem label="Claim" value={light.claim} light />
          </div>
        </div>
      </div>

      {(() => {
        const noteText =
          session.compliance_notes?.trim() ||
          session.ai_summary?.trim() ||
          session.notes?.trim();
        const label = session.compliance_notes
          ? "Last session assessment"
          : session.ai_summary
          ? "AI summary"
          : session.notes
          ? "Pre-session note"
          : null;
        return noteText ? (
          <div className="mt-4 p-3 rounded-xl bg-white/10 text-sm opacity-90">
            {label && (
              <span className="font-medium opacity-70 text-xs uppercase tracking-wide block mb-1">
                {label}
              </span>
            )}
            <p className="line-clamp-2">{noteText}</p>
          </div>
        ) : (
          <div className="mt-4 p-3 rounded-xl bg-white/10 text-sm opacity-75 italic">
            No prior session notes for this participant.
          </div>
        );
      })()}

      <div className="flex gap-3 mt-5">
        <Link href={`/sessions/${session.id}/live`}>
          <Button className="gap-2 bg-white text-primary font-semibold hover:bg-white/90 shadow-sm">
            <Play className="h-4 w-4" />
            {isResume ? "Resume Session" : "Start Session"}
          </Button>
        </Link>
        <Link href={`/sessions/${session.id}`}>
          <Button
            variant="outline"
            className="gap-2 border-white/40 bg-white/10 text-white hover:bg-white/20"
          >
            <Eye className="h-4 w-4" /> View Summary
          </Button>
        </Link>
      </div>
    </section>
  );
}

function TrafficItem({
  label,
  value,
  light = false,
}: {
  label: string;
  value: boolean | null;
  light?: boolean;
}) {
  const dot =
    value === null
      ? "bg-white/30"
      : value
      ? "bg-emerald-400"
      : "bg-red-400";
  return (
    <span className="flex items-center gap-1.5 text-xs opacity-90">
      <span className={cn("h-2 w-2 rounded-full", dot)} />
      {label}
    </span>
  );
}

function SessionRow({
  session,
  name,
  ndis,
  isNext = false,
}: {
  session: Session;
  name: string;
  ndis: string;
  isNext?: boolean;
}) {
  const initials = getInitials(name);
  const colorCls = avatarColor(name);
  const light = getTrafficLight(session);
  const isResume = session.status === "in_progress";

  const timeStr = sessionDisplayTime(session);

  return (
    <div className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors">
      {/* Time slot */}
      <div className="w-12 shrink-0 text-right hidden sm:block">
        <p className="text-xs font-semibold text-slate-700">{timeStr}</p>
      </div>

      {/* Avatar */}
      <div
        className={cn(
          "h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
          colorCls,
        )}
      >
        {initials}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-slate-900 text-sm truncate">{name}</p>
          {ndis && (
            <span className="text-xs text-slate-400 hidden sm:inline">
              NDIS: {ndis}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {/* Mobile: show time inline */}
          <span className="text-xs text-slate-600 font-medium sm:hidden">{timeStr}</span>
          <span className="text-xs text-slate-500">{session.session_type}</span>
          <span className="text-slate-300 text-xs">·</span>
          <span className="text-xs text-slate-400">
            {session.duration_minutes} min
          </span>
          {/* Traffic lights */}
          <span className="flex items-center gap-1.5 ml-1">
            <TrafficDot value={light.notes} />
            <TrafficDot value={light.goals} />
            <TrafficDot value={light.claim} />
          </span>
        </div>
      </div>

      {/* Status + action */}
      <div className="flex items-center gap-2 shrink-0">
        <SessionStatusBadge session={session} isNext={isNext} />
        {session.status === "completed" ? (
          <Link href={`/sessions/${session.id}`}>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1 px-3">
              <Eye className="h-3.5 w-3.5" /> View
            </Button>
          </Link>
        ) : (
          <Link href={`/sessions/${session.id}/live`}>
            <Button size="sm" className="h-8 text-xs gap-1 px-3">
              {isResume ? (
                <>
                  <RotateCcw className="h-3.5 w-3.5" /> Resume
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" /> Start
                </>
              )}
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}

function AtRiskRow({
  session,
  name,
  isPast,
}: {
  session: Session;
  name: string;
  isPast: boolean;
}) {
  const issues: string[] = [];
  if (isPast && session.status !== "completed") issues.push("session not ended");
  if (!(session.notes && session.notes.trim().length > 10)) issues.push("notes missing");
  if (
    session.compliance_score !== null &&
    session.compliance_score !== undefined &&
    session.compliance_score < 60
  ) {
    issues.push(`low compliance (${Math.round(session.compliance_score)}%)`);
  }
  const issueText = issues.length > 0 ? issues.join(", ") : "needs attention";
  const fixHref =
    isPast && session.status !== "completed"
      ? `/sessions/${session.id}/live`
      : `/sessions/${session.id}`;

  return (
    <div className="flex items-center gap-4 px-5 py-3.5">
      <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{name}</p>
        <p className="text-xs text-slate-500 mt-0.5">
          <span className="text-slate-400">
            {format(parseISO(session.session_date), "d MMM")} · {session.session_type}
          </span>{" "}
          &mdash; {issueText}
        </p>
      </div>
      <Link href={fixHref}>
        <Button
          size="sm"
          variant="destructive"
          className="h-8 text-xs px-3 gap-1 shrink-0"
        >
          Fix Now <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </Link>
    </div>
  );
}

function LegendRow({
  color,
  label,
  count,
}: {
  color: string;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", color)} />
      <span className="text-sm text-slate-600 flex-1">{label}</span>
      <span className="text-sm font-semibold text-slate-800">{count}</span>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  sub,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  href: string;
}) {
  return (
    <Link href={href}>
      <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors cursor-pointer">
        <div className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800">{label}</p>
          <p className="text-xs text-slate-500 truncate">{sub}</p>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
      </div>
    </Link>
  );
}

function EmptyToday() {
  return (
    <div className="rounded-2xl border bg-white p-8 text-center shadow-sm">
      <Calendar className="h-10 w-10 text-slate-200 mx-auto mb-3" />
      <p className="font-medium text-slate-700">No sessions scheduled for today</p>
      <p className="text-sm text-slate-500 mt-1 mb-4">
        Start by creating a new session for a participant.
      </p>
      <Link href="/sessions/new">
        <Button size="sm" className="gap-2">
          <Play className="h-4 w-4" /> Start New Session
        </Button>
      </Link>
    </div>
  );
}

function AllDonePanel() {
  return (
    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-6 flex items-center gap-4 shadow-sm">
      <CheckCircle2 className="h-10 w-10 text-emerald-500 shrink-0" />
      <div>
        <p className="font-semibold text-emerald-800">All sessions completed!</p>
        <p className="text-sm text-emerald-700 mt-0.5">
          Great work — all of today's sessions are done.
        </p>
      </div>
    </div>
  );
}
