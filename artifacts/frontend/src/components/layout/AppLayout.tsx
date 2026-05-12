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
  ArrowRight,
  UploadCloud,
  Package,
  ClipboardList,
  ShieldCheck,
  ChevronRight,
  Calendar,
  Loader2,
} from "lucide-react";

// -----------------------------------------------------------------------------
// Brand
// -----------------------------------------------------------------------------

const LIME = "#D9F103";
const PINK = "#FA879F";
const BLUE = "#5271FF";
const NAVY = "#0D0D55";

const TODAY_STR = format(new Date(), "yyyy-MM-dd");

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function sessionDisplayTime(session: Session): string {
  if (!session.created_at) return "--:--";

  try {
    return format(new Date(session.created_at), "h:mm a");
  } catch {
    return "--:--";
  }
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
    "bg-blue-100 text-blue-700",
    "bg-pink-100 text-pink-700",
    "bg-lime-100 text-lime-700",
    "bg-indigo-100 text-indigo-700",
  ];

  let hash = 0;

  for (const c of name) {
    hash = (hash * 31 + c.charCodeAt(0)) % colors.length;
  }

  return colors[hash];
}

function getTrafficLight(session: Session) {
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

  return {
    notes: hasNotes,
    goals: hasGoals,
    claim: claimReady,
  };
}

// -----------------------------------------------------------------------------
// Dashboard
// -----------------------------------------------------------------------------

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-[#FFF0F8] text-[#0D0D55]">
      {children}
    </div>
  );
}

export default function Dashboard() {
  const { data: sessions = [], isLoading: sessionsLoading } = useGetSessions({
    limit: 200,
  });

  const { data: participants = [] } = useGetParticipants();

  const { data: stats } = useGetDashboardStats();

  const participantMap = useMemo<Record<string, Participant>>(() => {
    const map: Record<string, Participant> = {};

    for (const p of participants) {
      map[p.id] = p;
    }

    return map;
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

  const todaySessions = useMemo(() => {
    return [...sessions]
      .filter((s) => s.session_date === TODAY_STR)
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  }, [sessions]);

  const nextSession = useMemo(() => {
    const actionable = todaySessions.filter(
      (s) => s.status === "draft" || s.status === "in_progress",
    );

    return actionable[0] ?? null;
  }, [todaySessions]);

  const pastIncomplete = useMemo(() => {
    const todayStart = startOfDay(new Date());

    return sessions.filter((s) => {
      const d = parseISO(s.session_date);

      return isBefore(d, todayStart) && s.status !== "completed";
    });
  }, [sessions]);

  const lowQuality = useMemo(() => {
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

  const atRiskItems = useMemo(() => {
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
    <div className="space-y-6 pb-8">
      {/* ------------------------------------------------------------------ */}
      {/* Header */}
      {/* ------------------------------------------------------------------ */}

      <section className="rounded-3xl border bg-card px-6 py-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">
              Provider Operations Dashboard
            </p>

            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
              {greeting}
            </h1>

            <p className="mt-2 text-sm text-muted-foreground max-w-xl">
              Monitor participant sessions, incomplete documentation, compliance
              status and provider readiness from one place.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href="/sessions/new">
              <Button
                className="h-11 rounded-xl px-5 font-medium"
                style={{
                  background: NAVY,
                  color: "white",
                }}
              >
                <Play className="mr-2 h-4 w-4" />
                Start Session
              </Button>
            </Link>

            <Link href="/sessions">
              <Button
                variant="outline"
                className="h-11 rounded-xl px-5 font-medium"
              >
                <Eye className="mr-2 h-4 w-4" />
                View Sessions
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Stats */}
      {/* ------------------------------------------------------------------ */}

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Sessions Today" value={todaySessions.length} />

        <StatCard label="Ready for Claim" value={readyCount} />

        <StatCard label="Need Attention" value={needsAttentionCount} />

        <StatCard
          label="Incomplete Records"
          value={pastIncomplete.length}
          danger={pastIncomplete.length > 0}
        />
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Main Layout */}
      {/* ------------------------------------------------------------------ */}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* LEFT */}

        <div className="space-y-6 xl:col-span-2">
          {/* -------------------------------------------------------------- */}
          {/* Next Session */}
          {/* -------------------------------------------------------------- */}

          {sessionsLoading ? (
            <LoadingCard />
          ) : nextSession ? (
            <NextSessionCard
              session={nextSession}
              name={participantName(nextSession)}
              ndis={participantNdis(nextSession)}
              goals={participantMap[nextSession.participant_id]?.goals ?? []}
            />
          ) : todaySessions.length === 0 ? (
            <EmptyToday />
          ) : (
            <CompletedAll />
          )}

          {/* -------------------------------------------------------------- */}
          {/* Sessions */}
          {/* -------------------------------------------------------------- */}

          <section className="rounded-3xl border bg-card shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="font-semibold text-foreground">
                  Today's Sessions
                </h2>

                <p className="text-xs text-muted-foreground mt-1">
                  All scheduled participant sessions for today
                </p>
              </div>

              <Link href="/sessions">
                <button className="text-sm font-medium text-primary hover:underline">
                  View all
                </button>
              </Link>
            </div>

            <div>
              {sessionsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : todaySessions.length === 0 ? (
                <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                  No sessions scheduled today.
                </div>
              ) : (
                todaySessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    name={participantName(session)}
                    ndis={participantNdis(session)}
                    isNext={nextSession?.id === session.id}
                  />
                ))
              )}
            </div>
          </section>

          {/* -------------------------------------------------------------- */}
          {/* At Risk */}
          {/* -------------------------------------------------------------- */}

          {atRiskItems.length > 0 && (
            <section className="rounded-3xl border bg-card shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b px-6 py-4">
                <div>
                  <h2 className="font-semibold text-foreground">
                    Incomplete or At Risk
                  </h2>

                  <p className="text-xs text-muted-foreground mt-1">
                    Sessions requiring action before claim submission
                  </p>
                </div>

                <Badge variant="secondary">{atRiskItems.length}</Badge>
              </div>

              <div>
                {atRiskItems.map((session) => (
                  <AtRiskRow
                    key={session.id}
                    session={session}
                    name={participantName(session)}
                    isPast={pastIncomplete.includes(session)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>

        {/* RIGHT */}

        <div className="space-y-6">
          {/* -------------------------------------------------------------- */}
          {/* Compliance */}
          {/* -------------------------------------------------------------- */}

          <section className="rounded-3xl border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-foreground">
                  Weekly Compliance
                </h2>

                <p className="text-xs text-muted-foreground mt-1">
                  Current week overview
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <ComplianceRow
                label="Compliant"
                count={compliantCount}
                color={LIME}
              />

              <ComplianceRow
                label="Needs Attention"
                count={atRiskCount}
                color={PINK}
              />

              <ComplianceRow
                label="Non-Compliant"
                count={nonCompliantCount}
                color="#ef4444"
              />
            </div>

            {stats && (
              <div className="mt-6 rounded-2xl bg-muted/50 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Sessions this week
                  </span>

                  <span className="font-semibold">
                    {stats.sessions_this_week}
                  </span>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Missing notes
                  </span>

                  <span className="font-semibold">{stats.notes_missing}</span>
                </div>
              </div>
            )}
          </section>

          {/* -------------------------------------------------------------- */}
          {/* Quick Actions */}
          {/* -------------------------------------------------------------- */}

          <section className="rounded-3xl border bg-card shadow-sm overflow-hidden">
            <div className="border-b px-6 py-4">
              <h2 className="font-semibold text-foreground">Quick Actions</h2>
            </div>

            <QuickAction
              icon={<UploadCloud className="h-4 w-4" />}
              label="Upload Evidence"
              sub="Add files, images or supporting documents"
              href="/sessions"
            />

            <QuickAction
              icon={<Package className="h-4 w-4" />}
              label="Generate Audit Pack"
              sub="Export participant documentation"
              href="/compliance"
            />

            <QuickAction
              icon={<ClipboardList className="h-4 w-4" />}
              label="Review Incomplete Records"
              sub="Fix missing compliance information"
              href="/sessions"
            />

            <QuickAction
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Compliance Dashboard"
              sub="Review provider readiness"
              href="/compliance"
            />
          </section>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Components
// -----------------------------------------------------------------------------

function StatCard({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>

      <p
        className={cn(
          "mt-2 text-3xl font-semibold tracking-tight",
          danger ? "text-red-600" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function LoadingCard() {
  return (
    <div className="rounded-3xl border bg-card p-10 shadow-sm flex justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function isNDISGoal(goal: NDISGoal | ParticipantGoal): goal is NDISGoal {
  return "id" in goal && "title" in goal;
}

function NextSessionCard({
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
  const initials = getInitials(name);

  const avatarCls = avatarColor(name);

  const isResume = session.status === "in_progress";

  const topGoals = goals
    .filter(isNDISGoal)
    .filter((g) => g.status === "active")
    .slice(0, 3);

  return (
    <section className="rounded-3xl border bg-card p-6 shadow-sm">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex gap-4">
          <div
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-2xl text-sm font-semibold",
              avatarCls,
            )}
          >
            {initials}
          </div>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-semibold text-foreground">{name}</h2>

              <Badge variant="secondary">{session.session_type}</Badge>
            </div>

            {ndis && (
              <p className="mt-1 text-sm text-muted-foreground">NDIS: {ndis}</p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span>{format(parseISO(session.session_date), "d MMM")}</span>

              <span>{sessionDisplayTime(session)}</span>

              <span>{session.duration_minutes} mins</span>
            </div>

            {topGoals.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Active Goals
                </p>

                <div className="mt-2 flex flex-wrap gap-2">
                  {topGoals.map((goal) => (
                    <div
                      key={goal.id}
                      className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
                    >
                      {goal.title}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <Link href={`/sessions/${session.id}/live`}>
            <Button
              className="rounded-xl"
              style={{
                background: NAVY,
                color: "white",
              }}
            >
              {isResume ? (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Resume
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Start
                </>
              )}
            </Button>
          </Link>

          <Link href={`/sessions/${session.id}`}>
            <Button variant="outline" className="rounded-xl">
              <Eye className="mr-2 h-4 w-4" />
              View
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

function SessionRow({
  session,
  name,
  ndis,
  isNext,
}: {
  session: Session;
  name: string;
  ndis: string;
  isNext?: boolean;
}) {
  const initials = getInitials(name);

  const avatarCls = avatarColor(name);

  const traffic = getTrafficLight(session);

  const isResume = session.status === "in_progress";

  return (
    <div className="flex items-center gap-4 border-b px-6 py-4 last:border-b-0">
      <div
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-xl text-sm font-semibold shrink-0",
          avatarCls,
        )}
      >
        {initials}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="truncate font-medium text-foreground">{name}</p>

          {isNext && (
            <Badge
              style={{
                background: `${LIME}40`,
                color: "#3d4700",
              }}
            >
              Next
            </Badge>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{session.session_type}</span>

          <span>•</span>

          <span>{sessionDisplayTime(session)}</span>

          {ndis && (
            <>
              <span>•</span>
              <span>{ndis}</span>
            </>
          )}
        </div>

        <div className="mt-2 flex items-center gap-2">
          <TrafficDot value={traffic.notes} />
          <TrafficDot value={traffic.goals} />
          <TrafficDot value={traffic.claim} />
        </div>
      </div>

      <div className="shrink-0">
        {session.status === "completed" ? (
          <Link href={`/sessions/${session.id}`}>
            <Button variant="outline" size="sm">
              View
            </Button>
          </Link>
        ) : (
          <Link href={`/sessions/${session.id}/live`}>
            <Button
              size="sm"
              style={{
                background: BLUE,
                color: "white",
              }}
            >
              {isResume ? "Resume" : "Start"}
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}

function TrafficDot({ value }: { value: boolean | null }) {
  return (
    <span
      className="h-2.5 w-2.5 rounded-full"
      style={{
        background: value === null ? "#d4d4d8" : value ? LIME : "#ef4444",
      }}
    />
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

  if (isPast && session.status !== "completed") {
    issues.push("Session not completed");
  }

  if (!(session.notes && session.notes.trim().length > 10)) {
    issues.push("Missing notes");
  }

  if (
    session.compliance_score !== null &&
    session.compliance_score !== undefined &&
    session.compliance_score < 60
  ) {
    issues.push("Low compliance score");
  }

  const href =
    isPast && session.status !== "completed"
      ? `/sessions/${session.id}/live`
      : `/sessions/${session.id}`;

  return (
    <div className="flex items-center gap-4 border-b px-6 py-4 last:border-b-0">
      <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />

      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{name}</p>

        <p className="mt-1 text-xs text-muted-foreground">
          {issues.join(" • ")}
        </p>
      </div>

      <Link href={href}>
        <Button size="sm" variant="outline">
          Fix
        </Button>
      </Link>
    </div>
  );
}

function ComplianceRow({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="h-3 w-3 rounded-full"
        style={{
          background: color,
        }}
      />

      <span className="flex-1 text-sm text-muted-foreground">{label}</span>

      <span className="font-semibold text-foreground">{count}</span>
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
      <div className="flex cursor-pointer items-center gap-4 border-b px-6 py-4 transition-colors hover:bg-muted/40 last:border-b-0">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
          {icon}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{label}</p>

          <p className="truncate text-xs text-muted-foreground">{sub}</p>
        </div>

        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </Link>
  );
}

function EmptyToday() {
  return (
    <div className="rounded-3xl border bg-card px-6 py-12 text-center shadow-sm">
      <Calendar className="mx-auto h-10 w-10 text-muted-foreground" />

      <h2 className="mt-4 text-lg font-semibold text-foreground">
        No sessions scheduled
      </h2>

      <p className="mt-2 text-sm text-muted-foreground">
        Create a new participant session to get started.
      </p>

      <Link href="/sessions/new">
        <Button className="mt-5">
          <Play className="mr-2 h-4 w-4" />
          New Session
        </Button>
      </Link>
    </div>
  );
}

function CompletedAll() {
  return (
    <div className="rounded-3xl border bg-card px-6 py-8 shadow-sm">
      <div className="flex items-center gap-4">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{
            background: `${LIME}35`,
          }}
        >
          <CheckCircle2
            className="h-6 w-6"
            style={{
              color: "#4d5700",
            }}
          />
        </div>

        <div>
          <h2 className="font-semibold text-foreground">
            All sessions completed
          </h2>

          <p className="mt-1 text-sm text-muted-foreground">
            Today's scheduled sessions have been completed successfully.
          </p>
        </div>
      </div>
    </div>
  );
}
