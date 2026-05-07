import { useMemo } from "react";
import { Link } from "wouter";
import {
  format,
  isBefore,
  startOfDay,
  parseISO,
  startOfWeek,
  endOfWeek,
  isWithinInterval,
} from "date-fns";
import {
  useGetSessions,
  useGetParticipants,
  useGetDashboardStats,
} from "@workspace/api-client-react";
import type {
  Session,
  Participant,
  NDISGoal,
  ParticipantGoal,
} from "@workspace/api-client-react";
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
  Sparkles,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Brand colours  (#D9F103 lime · #FA879F pink · #0D0D55 navy · #5271FF blue)
// ---------------------------------------------------------------------------
const LIME  = "#D9F103";
const PINK  = "#FA879F";
const BLUE  = "#5271FF";
const NAVY  = "#0D0D55";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TODAY_STR = format(new Date(), "yyyy-MM-dd");

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
    "bg-[#5271FF]/15 text-[#0D0D55]",
    "bg-[#D9F103]/25 text-[#3a4800]",
    "bg-[#FA879F]/20 text-[#6b0020]",
    "bg-[#5271FF]/10 text-[#0D0D55]",
    "bg-[#D9F103]/20 text-[#3a4800]",
    "bg-[#FA879F]/15 text-[#6b0020]",
    "bg-[#0D0D55]/10 text-[#0D0D55]",
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
    Array.isArray(session.goals_addressed) &&
    session.goals_addressed.length > 0;
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
    return <span className="h-2.5 w-2.5 rounded-full bg-muted inline-block" />;
  return (
    <span
      className="h-2.5 w-2.5 rounded-full inline-block"
      style={{ background: value ? LIME : "#ef4444" }}
    />
  );
}

// ---------------------------------------------------------------------------
// Donut chart (pure SVG) — brand colours
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

  function arc(value: number, offset: number, color: string, key: string) {
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
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="14"
        />
        {arc(compliant, 0, LIME, "c")}
        {arc(atRisk, compliant / total, PINK, "a")}
        {arc(nonCompliant, (compliant + atRisk) / total, "#ef4444", "n")}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-foreground">
          {total > 0 ? Math.round(pct * 100) : "--"}%
        </span>
        <span className="text-[10px] text-muted-foreground font-medium">
          Compliant
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge — brand colours
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
      <Badge
        className="font-medium text-xs gap-1 border"
        style={{
          background: `${LIME}30`,
          color: "#3d4700",
          borderColor: `${LIME}60`,
        }}
      >
        <CheckCircle2 className="h-3 w-3" /> Completed
      </Badge>
    );
  if (session.status === "in_progress")
    return (
      <Badge
        className="font-medium text-xs gap-1 border"
        style={{
          background: `${BLUE}20`,
          color: "#2d45b0",
          borderColor: `${BLUE}40`,
        }}
      >
        <Clock className="h-3 w-3" /> In Progress
      </Badge>
    );
  if (isNext)
    return (
      <Badge
        className="font-medium text-xs gap-1 border"
        style={{
          background: `${PINK}25`,
          color: "#7a1850",
          borderColor: `${PINK}50`,
        }}
      >
        <Play className="h-3 w-3" /> Next
      </Badge>
    );
  return (
    <Badge className="bg-muted text-muted-foreground border font-medium text-xs gap-1">
      <Calendar className="h-3 w-3" /> Upcoming
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const { data: sessions = [], isLoading: sessionsLoading } = useGetSessions({
    limit: 200,
  });
  const { data: participants = [] } = useGetParticipants();
  const { data: stats } = useGetDashboardStats();

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

  const todaySessions = useMemo<Session[]>(() => {
    return [...sessions]
      .filter((s) => s.session_date === TODAY_STR)
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  }, [sessions]);

  const nextSession = useMemo<Session | null>(() => {
    const actionable = todaySessions.filter(
      (s) => s.status === "draft" || s.status === "in_progress",
    );
    return actionable[0] ?? null;
  }, [todaySessions]);

  const pastIncomplete = useMemo<Session[]>(() => {
    const todayStart = startOfDay(new Date());
    return sessions.filter((s) => {
      const d = parseISO(s.session_date);
      return isBefore(d, todayStart) && s.status !== "completed";
    });
  }, [sessions]);

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

  const atRiskItems = useMemo<Session[]>(() => {
    const seen = new Set<string>();
    const combined: Session[] = [];
    for (const s of [...pastIncomplete, ...lowQuality]) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        combined.push(s);
      }
    }
    return combined.slice(0, 5);
  }, [pastIncomplete, lowQuality]);

  const readyCount = todaySessions.filter(
    (s) => s.status === "completed" && (s.compliance_score ?? 0) >= 70,
  ).length;
  const needsAttentionCount = todaySessions.filter(
    (s) =>
      s.status !== "completed" ||
      s.compliance_score === null ||
      s.compliance_score === undefined ||
      s.compliance_score < 70,
  ).length;

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
    (s) => s.status === "completed" && (s.compliance_score ?? 0) < 60,
  ).length;

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6">
      {/* ── Animated welcome hero ── */}
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{ background: NAVY, minHeight: 160 }}
      >
        {/* floating blobs */}
        <div
          className="brand-blob-a absolute -top-10 -left-10 h-48 w-48 rounded-full opacity-30 blur-2xl pointer-events-none"
          style={{ background: LIME }}
        />
        <div
          className="brand-blob-b absolute -bottom-12 right-10 h-56 w-56 rounded-full opacity-25 blur-3xl pointer-events-none"
          style={{ background: PINK }}
        />
        <div
          className="brand-blob-c absolute top-4 right-1/3 h-32 w-32 rounded-full opacity-20 blur-2xl pointer-events-none"
          style={{ background: BLUE }}
        />

        {/* decorative half-circle top-right (like palette image) */}
        <div
          className="absolute -top-16 -right-16 h-52 w-52 rounded-full opacity-15 pointer-events-none"
          style={{ background: PINK, border: `3px solid ${PINK}` }}
        />
        <div
          className="absolute top-8 right-4 h-20 w-20 rounded-full opacity-20 pointer-events-none"
          style={{ background: LIME }}
        />

        {/* content */}
        <div className="relative z-10 px-7 py-7 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
          <div>
            <div
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold mb-3 tracking-wide uppercase"
              style={{ background: `${LIME}22`, color: LIME, border: `1px solid ${LIME}40` }}
            >
              <Sparkles className="h-3 w-3" />
              Today's Overview
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white leading-tight">
              {greeting},<br />
              <span style={{ color: LIME }}>Dr. Provider!</span>
            </h1>
            <p className="text-sm mt-2" style={{ color: "rgba(255,255,255,0.55)" }}>
              Here's everything you need to know right now.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 shrink-0">
            <Link href="/sessions/new">
              <button
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-105 active:scale-95"
                style={{ background: LIME, color: NAVY }}
              >
                <Play className="h-4 w-4 fill-current" />
                Start Session
              </button>
            </Link>
            <Link href="/sessions">
              <button
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:bg-white/10 active:scale-95"
                style={{
                  border: `1.5px solid rgba(255,255,255,0.25)`,
                  color: "rgba(255,255,255,0.85)",
                }}
              >
                <Eye className="h-4 w-4" />
                View Sessions
              </button>
            </Link>
          </div>
        </div>
      </div>

      {/* ── Today Readiness Bar — brand colours ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ReadinessCard
          label="Sessions today"
          value={todaySessions.length}
          icon={<Calendar className="h-4 w-4" style={{ color: BLUE }} />}
          iconBg={`${BLUE}18`}
          textColor="text-foreground"
        />
        <ReadinessCard
          label="Ready"
          value={readyCount}
          icon={
            <CheckCircle2 className="h-4 w-4" style={{ color: "#4e5700" }} />
          }
          iconBg={`${LIME}40`}
          textColor="text-foreground"
        />
        <ReadinessCard
          label="Need attention"
          value={needsAttentionCount}
          icon={
            <AlertCircle className="h-4 w-4" style={{ color: "#8f1f61" }} />
          }
          iconBg={`${PINK}35`}
          textColor="text-foreground"
        />
        <ReadinessCard
          label="Incomplete (prior days)"
          value={pastIncomplete.length}
          icon={<Clock className="h-4 w-4 text-destructive" />}
          iconBg="hsl(var(--destructive) / 0.1)"
          textColor={
            pastIncomplete.length > 0
              ? "text-destructive"
              : "text-muted-foreground"
          }
        />
      </div>

      {/* ── Two-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: main content ── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Next Patient Focus Panel */}
          {sessionsLoading ? (
            <div className="rounded-2xl border bg-card p-8 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : nextSession ? (
            <NextPatientPanel
              session={nextSession}
              name={participantName(nextSession)}
              ndis={participantNdis(nextSession)}
              goals={participantMap[nextSession.participant_id]?.goals ?? []}
            />
          ) : todaySessions.length === 0 ? (
            <EmptyToday />
          ) : (
            <AllDonePanel />
          )}

          {/* Session Timeline */}
          {todaySessions.length > 0 && (
            <section className="rounded-2xl border bg-card overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b flex items-center justify-between">
                <h2 className="font-semibold text-foreground">
                  Today's Sessions
                </h2>
                <Link href="/sessions">
                  <span className="text-xs text-primary font-medium flex items-center gap-1 hover:underline cursor-pointer">
                    View all <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
              </div>
              <div className="divide-y divide-border">
                {sessionsLoading ? (
                  <div className="p-8 flex justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
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
            <section
              className="rounded-2xl border overflow-hidden shadow-sm"
              style={{ borderColor: `${PINK}50`, background: `${PINK}0a` }}
            >
              <div
                className="px-5 py-4 border-b flex items-center gap-2"
                style={{ borderColor: `${PINK}40` }}
              >
                <AlertCircle className="h-4 w-4" style={{ color: "#8f1f61" }} />
                <h2 className="font-semibold" style={{ color: "#6b1449" }}>
                  Incomplete / At Risk
                </h2>
                <span
                  className="ml-auto text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: `${PINK}30`, color: "#7a1850" }}
                >
                  {atRiskItems.length} item{atRiskItems.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="divide-y" style={{ borderColor: `${PINK}25` }}>
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
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-foreground">
                Compliance Overview
              </h2>
              <span className="text-xs text-muted-foreground">This week</span>
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
                color={LIME}
                label="Compliant"
                count={compliantCount}
              />
              <LegendRow
                color={PINK}
                label="Needs Attention"
                count={atRiskCount}
              />
              <LegendRow
                color="#ef4444"
                label="At Risk"
                count={nonCompliantCount}
              />
            </div>

            {stats && (
              <div className="mt-4 pt-4 border-t text-xs text-muted-foreground">
                <span className="text-foreground font-medium">
                  {stats.sessions_this_week}
                </span>{" "}
                sessions this week
                {stats.notes_missing > 0 && (
                  <span
                    className="ml-2 font-medium"
                    style={{ color: "#8f1f61" }}
                  >
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
          <section className="rounded-2xl border bg-card overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b">
              <h2 className="font-semibold text-foreground">Quick Actions</h2>
            </div>
            <div className="divide-y divide-border">
              <QuickAction
                iconBg={`${BLUE}18`}
                icon={
                  <UploadCloud className="h-4 w-4" style={{ color: BLUE }} />
                }
                label="Upload Document / Evidence"
                sub="Add photos, files or signed documents"
                href="/sessions"
              />
              <QuickAction
                iconBg={`${LIME}35`}
                icon={
                  <Package className="h-4 w-4" style={{ color: "#4e5700" }} />
                }
                label="Generate Audit Pack"
                sub="Export all records for a participant"
                href="/compliance"
              />
              <QuickAction
                iconBg={`${PINK}25`}
                icon={
                  <ClipboardList
                    className="h-4 w-4"
                    style={{ color: "#8f1f61" }}
                  />
                }
                label="Check Incomplete Records"
                sub="See records that need your attention"
                href="/sessions"
              />
              <QuickAction
                iconBg={`${BLUE}12`}
                icon={
                  <ShieldCheck className="h-4 w-4" style={{ color: BLUE }} />
                }
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
  iconBg,
  textColor = "text-foreground",
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  iconBg: string;
  textColor?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm flex items-center gap-3">
      <div
        className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: iconBg }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className={cn("text-xl font-bold leading-none", textColor)}>
          {value}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
          {label}
        </p>
      </div>
    </div>
  );
}

function isNDISGoal(g: NDISGoal | ParticipantGoal): g is NDISGoal {
  return "id" in g && "title" in g && "status" in g;
}

function NextPatientPanel({
  session,
  name,
  ndis,
  goals = [],
}: {
  session: Session;
  name: string;
  ndis: string;
  goals?: (NDISGoal | ParticipantGoal)[];
}) {
  const isResume = session.status === "in_progress";
  const initials = getInitials(name);
  const colorCls = avatarColor(name);
  const light = getTrafficLight(session);
  const topGoals = (goals ?? [])
    .filter(isNDISGoal)
    .filter((g) => g.status === "active")
    .slice(0, 3);

  return (
    <section
      className="rounded-2xl text-white p-6 shadow-md"
      style={{
        background: `linear-gradient(135deg, ${BLUE} 0%, hsl(229 60% 45%) 100%)`,
      }}
    >
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
          {ndis && <p className="text-sm opacity-70 mt-0.5">NDIS: {ndis}</p>}
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

          <div className="flex items-center gap-3 mt-3">
            <TrafficItem label="Notes" value={light.notes} />
            <TrafficItem label="Goals" value={light.goals} />
            <TrafficItem label="Claim" value={light.claim} />
          </div>
        </div>
      </div>

      {topGoals.length > 0 && (
        <div className="mt-5 p-3 rounded-xl bg-white/10 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70 mb-1">
            Today's Focus
          </p>
          {topGoals.map((goal) => (
            <div key={goal.id} className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-white/60 shrink-0" />
              <span className="text-xs opacity-90 leading-tight line-clamp-1">
                {goal.title}
              </span>
            </div>
          ))}
        </div>
      )}

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
          <Button
            className="gap-2 font-semibold shadow-sm border-0"
            style={{ background: LIME, color: "#2e3500" }}
          >
            <Play className="h-4 w-4" />
            {isResume ? "Resume Session" : "Start Session"}
          </Button>
        </Link>
        <Link href={`/sessions/${session.id}`}>
          <Button
            variant="outline"
            className="gap-2 border-white/40 bg-white/10 text-white hover:bg-white/20 border"
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
}: {
  label: string;
  value: boolean | null;
}) {
  const dotStyle =
    value === null
      ? { background: "rgba(255,255,255,0.3)" }
      : value
        ? { background: LIME }
        : { background: "#ef4444" };
  return (
    <span className="flex items-center gap-1.5 text-xs opacity-90">
      <span className="h-2 w-2 rounded-full" style={dotStyle} />
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
    <div className="flex items-center gap-4 px-5 py-4 hover:bg-muted/40 transition-colors">
      <div className="w-12 shrink-0 text-right hidden sm:block">
        <p className="text-xs font-semibold text-foreground">{timeStr}</p>
      </div>

      <div
        className={cn(
          "h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
          colorCls,
        )}
      >
        {initials}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-foreground text-sm truncate">{name}</p>
          {ndis && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              NDIS: {ndis}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium sm:hidden">
            {timeStr}
          </span>
          <span className="text-xs text-muted-foreground">
            {session.session_type}
          </span>
          <span className="text-muted-foreground/40 text-xs">·</span>
          <span className="text-xs text-muted-foreground">
            {session.duration_minutes} min
          </span>
          <span className="flex items-center gap-1.5 ml-1">
            <TrafficDot value={light.notes} />
            <TrafficDot value={light.goals} />
            <TrafficDot value={light.claim} />
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <SessionStatusBadge session={session} isNext={isNext} />
        {session.status === "completed" ? (
          <Link href={`/sessions/${session.id}`}>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1 px-3"
            >
              <Eye className="h-3.5 w-3.5" /> View
            </Button>
          </Link>
        ) : (
          <Link href={`/sessions/${session.id}/live`}>
            <Button
              size="sm"
              className="h-8 text-xs gap-1 px-3 border-0"
              style={{ background: BLUE, color: "#fff" }}
            >
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
  if (isPast && session.status !== "completed")
    issues.push("session not ended");
  if (!(session.notes && session.notes.trim().length > 10))
    issues.push("notes missing");
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
      <AlertCircle className="h-4 w-4 shrink-0" style={{ color: "#8f1f61" }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          <span>
            {format(parseISO(session.session_date), "d MMM")} ·{" "}
            {session.session_type}
          </span>{" "}
          &mdash; {issueText}
        </p>
      </div>
      <Link href={fixHref}>
        <Button
          size="sm"
          className="h-8 text-xs px-3 gap-1 shrink-0 border-0"
          style={{ background: PINK, color: "#3a0020" }}
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
      <span
        className="h-2.5 w-2.5 rounded-full shrink-0"
        style={{ background: color }}
      />
      <span className="text-sm text-muted-foreground flex-1">{label}</span>
      <span className="text-sm font-semibold text-foreground">{count}</span>
    </div>
  );
}

function QuickAction({
  icon,
  iconBg,
  label,
  sub,
  href,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  sub: string;
  href: string;
}) {
  return (
    <Link href={href}>
      <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/40 transition-colors cursor-pointer">
        <div
          className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: iconBg }}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground truncate">{sub}</p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
      </div>
    </Link>
  );
}

function EmptyToday() {
  return (
    <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
      <div
        className="h-14 w-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
        style={{ background: `${BLUE}18` }}
      >
        <Calendar className="h-7 w-7" style={{ color: BLUE }} />
      </div>
      <p className="font-semibold text-foreground">
        No sessions scheduled for today
      </p>
      <p className="text-sm text-muted-foreground mt-1 mb-4">
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
    <div
      className="rounded-2xl border p-6 flex items-center gap-4 shadow-sm"
      style={{ borderColor: `${LIME}60`, background: `${LIME}18` }}
    >
      <div
        className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${LIME}50` }}
      >
        <CheckCircle2 className="h-6 w-6" style={{ color: "#3d4700" }} />
      </div>
      <div>
        <p className="font-semibold" style={{ color: "#3d4700" }}>
          All sessions completed!
        </p>
        <p className="text-sm mt-0.5" style={{ color: "#4e5900" }}>
          Great work — all of today's sessions are done.
        </p>
      </div>
    </div>
  );
}
