import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowRight,
  AlertTriangle,
  Briefcase,
  ChevronRight,
  KeyRound,
  Loader2,
  Search,
  Shield,
  Star,
  UserCheck,
  Users,
  UserX,
  TrendingDown,
  X,
} from "lucide-react";

import { apiFetch } from "@/lib/api-fetch";
import { HubLayout } from "@/components/layout/HubLayout";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import {
  getWorkerPipelineOverview,
  deactivateWorker,
  sendWorkerPasswordReset,
  type WorkerPipelineOverview,
} from "@/services/coordinatorService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const CTA = "var(--cc-cta)";

interface StaffMember {
  id: string;
  full_name: string;
  email?: string;
  role?: string;
  compliance_score: number;
  sessions: number;
  participant_count: number;
  last_login?: string;
  joined_at?: string;
}

interface MDData {
  active_staff: number;
  support_workers: number;
  staff_retention_rate: number;
  staff_directory: StaffMember[];
}

type Filter = "all" | "at_risk" | "strong";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function getScoreColor(score: number) {
  if (score >= 90) return "#0F7B57";
  if (score >= 85) return "#2A5C8A";
  if (score >= 70) return "#9A5B0A";
  return "#B3261E";
}

function getScoreLabel(
  score: number,
  translate: (key: string) => string,
) {
  if (score >= 90) return translate("md.staff.strongPerformer");
  if (score >= 85) return translate("md.staff.onTrack");
  if (score >= 70) return translate("md.staff.needsAttention");
  return translate("md.staff.retentionRisk");
}

function StatusBadge({
  score,
  translate,
}: {
  score: number;
  translate: (key: string) => string;
}) {
  const color = getScoreColor(score);

  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black"
      style={{
        color,
        borderColor: `${color}30`,
        background: `${color}10`,
      }}
    >
      {getScoreLabel(score, translate)}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = getScoreColor(score);

  return (
    <div className="flex items-center gap-3">
      <div
        className="h-2 flex-1 overflow-hidden rounded-full"
        style={{ background: `${color}12` }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.min(Math.max(score, 0), 100)}%`,
            background: color,
          }}
        />
      </div>

      <span
        className="w-9 text-right text-[11px] font-black"
        style={{ color }}
      >
        {score > 0 ? `${score}%` : "N/A"}
      </span>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="min-w-0">
      <p
        className="text-[9px] font-black uppercase tracking-[0.16em]"
        style={{ color: MUTED }}
      >
        {label}
      </p>

      <div className="mt-1 flex items-baseline gap-2">
        <span
          className="text-xl font-black tracking-tight"
          style={{ color: accent ?? TEXT }}
        >
          {value}
        </span>

        {sub && (
          <span
            className="text-[10px] font-medium"
            style={{ color: MUTED }}
          >
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p
            className="mb-1 text-[9px] font-black uppercase tracking-[0.18em]"
            style={{ color: PLUM }}
          >
            {eyebrow}
          </p>
        )}

        <h2
          className="text-[16px] font-black tracking-tight"
          style={{ color: TEXT }}
        >
          {title}
        </h2>

        {description && (
          <p
            className="mt-1 max-w-xl text-[11px] font-medium leading-relaxed"
            style={{ color: MUTED }}
          >
            {description}
          </p>
        )}
      </div>

      {action}
    </div>
  );
}

export default function MDStaffPage() {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [data, setData] = useState<MDData | null>(null);
  const [pipeline, setPipeline] =
    useState<WorkerPipelineOverview | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selectedWorker, setSelectedWorker] =
    useState<StaffMember | null>(null);
  const [accountActionPending, setAccountActionPending] =
    useState<"reset" | "deactivate" | null>(null);

  async function handleSendPasswordReset(worker: StaffMember) {
    setAccountActionPending("reset");
    try {
      await sendWorkerPasswordReset(worker.id);
      toast({ title: "Password reset email sent", description: `Sent to ${worker.email ?? worker.full_name}.` });
    } catch (err) {
      toast({ title: "Could not send reset email", description: err instanceof Error ? err.message : "Try again shortly.", variant: "destructive" });
    } finally {
      setAccountActionPending(null);
    }
  }

  async function handleDeactivate(worker: StaffMember) {
    if (!window.confirm(`Deactivate ${worker.full_name}'s account? They will lose access immediately.`)) return;
    setAccountActionPending("deactivate");
    try {
      await deactivateWorker(worker.id);
      toast({ title: "Account deactivated", description: `${worker.full_name} can no longer sign in.` });
      setSelectedWorker(null);
      setData((prev) => prev ? { ...prev, staff_directory: prev.staff_directory.filter((w) => w.id !== worker.id) } : prev);
    } catch (err) {
      toast({ title: "Could not deactivate account", description: err instanceof Error ? err.message : "Try again shortly.", variant: "destructive" });
    } finally {
      setAccountActionPending(null);
    }
  }

  useEffect(() => {
    let cancelled = false;

    apiFetch("/api/dashboard/managing-director")
      .then((response) =>
        response.ok ? response.json() : Promise.reject(),
      )
      .then((result) => {
        if (!cancelled) {
          setData(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    getWorkerPipelineOverview()
      .then((result) => {
        if (!cancelled) {
          setPipeline(result);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const allStaff = data?.staff_directory ?? [];

  const stats = useMemo(() => {
    const active = allStaff.filter((worker) => worker.compliance_score > 0);

    const atRisk = allStaff.filter(
      (worker) =>
        worker.compliance_score > 0 &&
        worker.compliance_score < 85,
    );

    const strong = allStaff.filter(
      (worker) => worker.compliance_score >= 90,
    );

    const average =
      active.length > 0
        ? Math.round(
            active.reduce(
              (total, worker) => total + worker.compliance_score,
              0,
            ) / active.length,
          )
        : 0;

    return {
      active,
      atRisk,
      strong,
      average,
    };
  }, [allStaff]);

  const distribution = useMemo(() => {
    const strong = allStaff.filter(
      (worker) => worker.compliance_score >= 90,
    ).length;

    const onTrack = allStaff.filter(
      (worker) =>
        worker.compliance_score >= 85 &&
        worker.compliance_score < 90,
    ).length;

    const attention = allStaff.filter(
      (worker) =>
        worker.compliance_score >= 70 &&
        worker.compliance_score < 85,
    ).length;

    const risk = allStaff.filter(
      (worker) =>
        worker.compliance_score > 0 &&
        worker.compliance_score < 70,
    ).length;

    return {
      strong,
      onTrack,
      attention,
      risk,
    };
  }, [allStaff]);

  const filtered = useMemo(() => {
    const normalized = search.trim().toLowerCase();

    return allStaff.filter((worker) => {
      const matchesSearch =
        !normalized ||
        worker.full_name.toLowerCase().includes(normalized) ||
        worker.email?.toLowerCase().includes(normalized);

      const matchesFilter =
        filter === "all" ||
        (filter === "at_risk" &&
          worker.compliance_score > 0 &&
          worker.compliance_score < 85) ||
        (filter === "strong" &&
          worker.compliance_score >= 90);

      return matchesSearch && matchesFilter;
    });
  }, [allStaff, filter, search]);

  const topPerformers = useMemo(() => {
    return [...allStaff]
      .filter((worker) => worker.compliance_score > 0)
      .sort(
        (a, b) => b.compliance_score - a.compliance_score,
      )
      .slice(0, 3);
  }, [allStaff]);

  const pipelineActive =
    !!pipeline &&
    (pipeline.kpis.in_pipeline > 0 ||
      pipeline.kpis.credentials_overdue > 0 ||
      pipeline.kpis.starting_this_week > 0);

  return (
    <HubLayout>
      <div className="space-y-7 pb-12">
        {/* =========================================================
            HEADER
        ========================================================= */}

        <header>
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: "#0F7B57" }}
                />

                <span
                  className="text-[9px] font-black uppercase tracking-[0.2em]"
                  style={{ color: MUTED }}
                >
                  Workforce command centre
                </span>
              </div>

              <h1
                className="text-3xl font-black tracking-[-0.04em]"
                style={{ color: TEXT }}
              >
                People & Workforce
              </h1>

              <p
                className="mt-1.5 max-w-2xl text-[12px] font-medium leading-relaxed"
                style={{ color: MUTED }}
              >
                Organisation-wide view of workforce health, performance,
                retention risk and hiring activity.
              </p>
            </div>

            <button
              onClick={() => navigate("/md/staff-onboarding")}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[11px] font-black transition hover:opacity-90"
              style={{
                background: CTA,
                color: "#fff",
              }}
            >
              <Briefcase size={13} strokeWidth={2.5} />
              Manage hiring
              <ArrowRight size={12} strokeWidth={2.5} />
            </button>
          </div>
        </header>

        {loading ? (
          <div className="space-y-4">
            <div
              className="h-44 animate-pulse rounded-2xl"
              style={{ background: SOFT }}
            />
            <div
              className="h-72 animate-pulse rounded-2xl"
              style={{ background: SOFT }}
            />
          </div>
        ) : error || !data ? (
          <div
            className="rounded-2xl border bg-white p-10 text-center"
            style={{ borderColor: BORDER }}
          >
            <AlertTriangle
              size={28}
              className="mx-auto mb-3 text-orange-500"
            />

            <p
              className="text-[14px] font-black"
              style={{ color: TEXT }}
            >
              {translate("md.staff.loadFailed")}
            </p>
          </div>
        ) : (
          <>
            {/* =====================================================
                WORKFORCE SNAPSHOT
            ===================================================== */}

            <section
              className="overflow-hidden rounded-2xl border bg-white"
              style={{ borderColor: BORDER }}
            >
              <div
                className="border-b px-5 py-4"
                style={{ borderColor: BORDER }}
              >
                <SectionHeader
                  eyebrow="Workforce snapshot"
                  title="How is the organisation performing?"
                  description="A leadership view of the people layer, without turning this page into another KPI dashboard."
                />
              </div>

              <div className="grid divide-y sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
                <div className="p-5">
                  <Metric
                    label="Active staff"
                    value={data.active_staff}
                    sub="people"
                    accent={PLUM}
                  />

                  <div className="mt-4 flex items-center gap-2">
                    <Users size={12} style={{ color: MUTED }} />

                    <span
                      className="text-[10px] font-medium"
                      style={{ color: MUTED }}
                    >
                      {data.support_workers} support workers
                    </span>
                  </div>
                </div>

                <div className="p-5">
                  <Metric
                    label="Average compliance"
                    value={`${stats.average}%`}
                    sub="across scored staff"
                    accent={getScoreColor(stats.average)}
                  />

                  <div className="mt-4">
                    <ScoreBar score={stats.average} />
                  </div>
                </div>

                <div className="p-5">
                  <Metric
                    label="Retention"
                    value={`${data.staff_retention_rate}%`}
                    sub="staff retained"
                    accent="#0F7B57"
                  />

                  <div className="mt-4 flex items-center gap-2">
                    <UserCheck
                      size={12}
                      style={{ color: "#0F7B57" }}
                    />

                    <span
                      className="text-[10px] font-medium"
                      style={{ color: MUTED }}
                    >
                      Workforce stability
                    </span>
                  </div>
                </div>

                <div className="p-5">
                  <Metric
                    label="Needs attention"
                    value={stats.atRisk.length}
                    sub="below 85%"
                    accent={
                      stats.atRisk.length > 0
                        ? "#B3261E"
                        : "#0F7B57"
                    }
                  />

                  <div className="mt-4 flex items-center gap-2">
                    {stats.atRisk.length > 0 ? (
                      <TrendingDown
                        size={12}
                        className="text-red-600"
                      />
                    ) : (
                      <Shield
                        size={12}
                        className="text-emerald-600"
                      />
                    )}

                    <span
                      className="text-[10px] font-medium"
                      style={{ color: MUTED }}
                    >
                      {stats.atRisk.length > 0
                        ? "Leadership follow-up recommended"
                        : "No immediate workforce risk"}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* =====================================================
                RISK + PERFORMANCE
            ===================================================== */}

            <div className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
              {/* Performance distribution */}
              <section
                className="rounded-2xl border bg-white p-5"
                style={{ borderColor: BORDER }}
              >
                <SectionHeader
                  eyebrow="Performance health"
                  title="Workforce performance distribution"
                  description="See where your workforce sits against the organisation's compliance expectations."
                />

                <div className="mt-6">
                  <div className="flex h-4 overflow-hidden rounded-full bg-slate-100">
                    {distribution.strong > 0 && (
                      <div
                        style={{
                          flex: distribution.strong,
                          background: "#0F7B57",
                        }}
                      />
                    )}

                    {distribution.onTrack > 0 && (
                      <div
                        style={{
                          flex: distribution.onTrack,
                          background: "#2A5C8A",
                        }}
                      />
                    )}

                    {distribution.attention > 0 && (
                      <div
                        style={{
                          flex: distribution.attention,
                          background: "#9A5B0A",
                        }}
                      />
                    )}

                    {distribution.risk > 0 && (
                      <div
                        style={{
                          flex: distribution.risk,
                          background: "#B3261E",
                        }}
                      />
                    )}
                  </div>

                  <div className="mt-5 grid gap-4 sm:grid-cols-4">
                    {[
                      {
                        label: "Strong",
                        count: distribution.strong,
                        color: "#0F7B57",
                      },
                      {
                        label: "On track",
                        count: distribution.onTrack,
                        color: "#2A5C8A",
                      },
                      {
                        label: "Attention",
                        count: distribution.attention,
                        color: "#9A5B0A",
                      },
                      {
                        label: "Risk",
                        count: distribution.risk,
                        color: "#B3261E",
                      },
                    ].map((item) => (
                      <div key={item.label}>
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: item.color }}
                          />

                          <span
                            className="text-[10px] font-black uppercase tracking-[0.12em]"
                            style={{ color: MUTED }}
                          >
                            {item.label}
                          </span>
                        </div>

                        <p
                          className="mt-1 text-xl font-black"
                          style={{ color: TEXT }}
                        >
                          {item.count}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/* Risk panel */}
              <section
                className="rounded-2xl border p-5"
                style={{
                  borderColor:
                    stats.atRisk.length > 0
                      ? "#E4B9B6"
                      : BORDER,
                  background:
                    stats.atRisk.length > 0
                      ? "#FBEAE9"
                      : "#fff",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p
                      className="text-[9px] font-black uppercase tracking-[0.18em]"
                      style={{
                        color:
                          stats.atRisk.length > 0
                            ? "#B3261E"
                            : MUTED,
                      }}
                    >
                      Leadership attention
                    </p>

                    <h2
                      className="mt-1 text-[16px] font-black"
                      style={{ color: TEXT }}
                    >
                      {stats.atRisk.length > 0
                        ? `${stats.atRisk.length} staff need review`
                        : "Workforce is stable"}
                    </h2>
                  </div>

                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-xl"
                    style={{
                      background:
                        stats.atRisk.length > 0
                          ? "#FBEAE9"
                          : "#E9F5F0",
                      color:
                        stats.atRisk.length > 0
                          ? "#B3261E"
                          : "#0F7B57",
                    }}
                  >
                    {stats.atRisk.length > 0 ? (
                      <AlertTriangle
                        size={16}
                        strokeWidth={2.5}
                      />
                    ) : (
                      <Shield
                        size={16}
                        strokeWidth={2.5}
                      />
                    )}
                  </div>
                </div>

                <p
                  className="mt-4 text-[11px] font-medium leading-relaxed"
                  style={{ color: MUTED }}
                >
                  {stats.atRisk.length > 0
                    ? "Workers below the 85% compliance threshold may require coaching, documentation support or a workload review."
                    : "No workers are currently below the 85% compliance threshold."}
                </p>

                {stats.atRisk.length > 0 && (
                  <button
                    onClick={() => {
                      setFilter("at_risk");
                      document
                        .getElementById("staff-directory")
                        ?.scrollIntoView({
                          behavior: "smooth",
                        });
                    }}
                    className="mt-5 inline-flex items-center gap-1.5 text-[10px] font-black"
                    style={{ color: "#B3261E" }}
                  >
                    Review at-risk staff
                    <ArrowRight size={11} strokeWidth={2.5} />
                  </button>
                )}
              </section>
            </div>

            {/* =====================================================
                TOP PERFORMERS
            ===================================================== */}

            {topPerformers.length > 0 && (
              <section>
                <SectionHeader
                  eyebrow="Recognition"
                  title="Leading performers"
                  description="Recognise the workers consistently demonstrating strong compliance performance."
                />

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {topPerformers.map((worker, index) => (
                    <button
                      key={worker.id}
                      onClick={() => setSelectedWorker(worker)}
                      className="group rounded-2xl border bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md"
                      style={{ borderColor: BORDER }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex h-10 w-10 items-center justify-center rounded-full text-[11px] font-black"
                            style={{
                              background:
                                index === 0
                                  ? "#FBF2E6"
                                  : SOFT,
                              color:
                                index === 0
                                  ? "#9A5B0A"
                                  : PLUM,
                            }}
                          >
                            {initials(worker.full_name)}
                          </div>

                          <div>
                            <p
                              className="text-[12px] font-black"
                              style={{ color: TEXT }}
                            >
                              {worker.full_name}
                            </p>

                            <p
                              className="mt-0.5 text-[10px] font-medium"
                              style={{ color: MUTED }}
                            >
                              {worker.sessions} sessions
                            </p>
                          </div>
                        </div>

                        <Star
                          size={14}
                          strokeWidth={2.5}
                          className="text-amber-500"
                        />
                      </div>

                      <div className="mt-4">
                        <ScoreBar
                          score={worker.compliance_score}
                        />
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <StatusBadge
                          score={worker.compliance_score}
                          translate={translate}
                        />

                        <ChevronRight
                          size={13}
                          className="transition group-hover:translate-x-0.5"
                          style={{ color: MUTED }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* =====================================================
                STAFF DIRECTORY
            ===================================================== */}

            <section id="staff-directory">
              <div className="mb-4">
                <SectionHeader
                  eyebrow="People directory"
                  title="Staff workforce"
                  description={`${filtered.length} of ${allStaff.length} staff shown`}
                />
              </div>

              <div
                className="overflow-hidden rounded-2xl border bg-white"
                style={{ borderColor: BORDER }}
              >
                {/* Controls */}
                <div
                  className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between"
                  style={{ borderColor: BORDER }}
                >
                  <div className="relative w-full lg:max-w-sm">
                    <Search
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2"
                      style={{ color: MUTED }}
                    />

                    <input
                      type="text"
                      placeholder="Search staff or email..."
                      value={search}
                      onChange={(event) =>
                        setSearch(event.target.value)
                      }
                      className="h-9 w-full rounded-lg border bg-transparent pl-9 pr-8 text-[11px] font-medium outline-none transition focus:ring-2"
                      style={{
                        borderColor: BORDER,
                        color: TEXT,
                      }}
                    />

                    {search && (
                      <button
                        onClick={() => setSearch("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2"
                        style={{ color: MUTED }}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {(
                      ["all", "at_risk", "strong"] as Filter[]
                    ).map((item) => {
                      const active = filter === item;

                      const label =
                        item === "all"
                          ? `All ${allStaff.length}`
                          : item === "at_risk"
                            ? `At risk ${stats.atRisk.length}`
                            : `Strong ${stats.strong.length}`;

                      return (
                        <button
                          key={item}
                          onClick={() => setFilter(item)}
                          className="rounded-lg px-3 py-1.5 text-[10px] font-black transition"
                          style={{
                            background: active
                              ? CTA
                              : SOFT,
                            color: active
                              ? "#fff"
                              : MUTED,
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {filtered.length === 0 ? (
                  <div className="px-5 py-14 text-center">
                    <Users
                      size={25}
                      className="mx-auto mb-3"
                      style={{ color: MUTED }}
                    />

                    <p
                      className="text-[13px] font-black"
                      style={{ color: TEXT }}
                    >
                      No staff found
                    </p>

                    <p
                      className="mt-1 text-[11px] font-medium"
                      style={{ color: MUTED }}
                    >
                      Try changing your search or filter.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Desktop table */}
                    <div className="hidden md:block">
                      <div
                        className="grid grid-cols-[minmax(240px,1.5fr)_1.2fr_100px_100px_130px_24px] items-center gap-4 border-b px-5 py-3"
                        style={{
                          borderColor: BORDER,
                          background: SOFT,
                        }}
                      >
                        {[
                          "Staff member",
                          "Compliance",
                          "Participants",
                          "Sessions",
                          "Status",
                          "",
                        ].map((heading, index) => (
                          <span
                            key={`${heading}-${index}`}
                            className="text-[9px] font-black uppercase tracking-[0.14em]"
                            style={{ color: MUTED }}
                          >
                            {heading}
                          </span>
                        ))}
                      </div>

                      <div>
                        {filtered.map((worker) => (
                          <button
                            key={worker.id}
                            onClick={() =>
                              setSelectedWorker(worker)
                            }
                            className="group grid w-full grid-cols-[minmax(240px,1.5fr)_1.2fr_100px_100px_130px_24px] items-center gap-4 border-b px-5 py-4 text-left transition last:border-b-0 hover:bg-slate-50"
                            style={{
                              borderColor: BORDER,
                            }}
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <div
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-black"
                                style={{
                                  background: SOFT,
                                  color: PLUM,
                                }}
                              >
                                {initials(
                                  worker.full_name,
                                )}
                              </div>

                              <div className="min-w-0">
                                <p
                                  className="truncate text-[12px] font-black"
                                  style={{ color: TEXT }}
                                >
                                  {worker.full_name}
                                </p>

                                <p
                                  className="truncate text-[10px] font-medium"
                                  style={{ color: MUTED }}
                                >
                                  {worker.role
                                    ?.replace(
                                      /_/g,
                                      " ",
                                    ) ||
                                    "Support worker"}
                                </p>
                              </div>
                            </div>

                            <ScoreBar
                              score={
                                worker.compliance_score
                              }
                            />

                            <span
                              className="text-[12px] font-black"
                              style={{ color: TEXT }}
                            >
                              {worker.participant_count}
                            </span>

                            <span
                              className="text-[12px] font-black"
                              style={{ color: TEXT }}
                            >
                              {worker.sessions}
                            </span>

                            <StatusBadge
                              score={
                                worker.compliance_score
                              }
                              translate={translate}
                            />

                            <ChevronRight
                              size={13}
                              className="transition group-hover:translate-x-0.5"
                              style={{ color: MUTED }}
                            />
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Mobile cards */}
                    <div className="divide-y md:hidden">
                      {filtered.map((worker) => (
                        <button
                          key={worker.id}
                          onClick={() =>
                            setSelectedWorker(worker)
                          }
                          className="w-full p-4 text-left"
                          style={{
                            borderColor: BORDER,
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <div
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-black"
                                style={{
                                  background: SOFT,
                                  color: PLUM,
                                }}
                              >
                                {initials(
                                  worker.full_name,
                                )}
                              </div>

                              <div className="min-w-0">
                                <p
                                  className="truncate text-[12px] font-black"
                                  style={{ color: TEXT }}
                                >
                                  {worker.full_name}
                                </p>

                                <p
                                  className="truncate text-[10px] font-medium"
                                  style={{ color: MUTED }}
                                >
                                  {worker.role?.replace(
                                    /_/g,
                                    " ",
                                  ) ||
                                    "Support worker"}
                                </p>
                              </div>
                            </div>

                            <StatusBadge
                              score={
                                worker.compliance_score
                              }
                              translate={translate}
                            />
                          </div>

                          <div className="mt-4">
                            <ScoreBar
                              score={
                                worker.compliance_score
                              }
                            />
                          </div>

                          <div className="mt-3 flex gap-5">
                            <Metric
                              label="Participants"
                              value={
                                worker.participant_count
                              }
                            />

                            <Metric
                              label="Sessions"
                              value={worker.sessions}
                            />
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </section>

            {/* =====================================================
                HIRING PIPELINE
            ===================================================== */}

            <section
              className="rounded-2xl border bg-white p-5"
              style={{ borderColor: BORDER }}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <SectionHeader
                  eyebrow="Workforce growth"
                  title="Hiring & onboarding"
                  description="Keep recruitment activity connected to the workforce already operating in the organisation."
                />

                <button
                  onClick={() =>
                    navigate("/md/staff-onboarding")
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-black"
                  style={{
                    background: SOFT,
                    color: PLUM,
                  }}
                >
                  Open pipeline
                  <ArrowRight
                    size={11}
                    strokeWidth={2.5}
                  />
                </button>
              </div>

              {pipelineActive && pipeline ? (
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <div
                    className="rounded-xl p-4"
                    style={{ background: SOFT }}
                  >
                    <p
                      className="text-2xl font-black"
                      style={{ color: TEXT }}
                    >
                      {pipeline.kpis.in_pipeline}
                    </p>

                    <p
                      className="mt-1 text-[9px] font-black uppercase tracking-[0.14em]"
                      style={{ color: MUTED }}
                    >
                      Candidates in pipeline
                    </p>
                  </div>

                  <div
                    className="rounded-xl p-4"
                    style={{
                      background:
                        pipeline.kpis.credentials_overdue >
                        0
                          ? "#FFF7ED"
                          : SOFT,
                    }}
                  >
                    <p
                      className="text-2xl font-black"
                      style={{
                        color:
                          pipeline.kpis
                            .credentials_overdue > 0
                            ? "#9A5B0A"
                            : TEXT,
                      }}
                    >
                      {pipeline.kpis.credentials_overdue}
                    </p>

                    <p
                      className="mt-1 text-[9px] font-black uppercase tracking-[0.14em]"
                      style={{ color: MUTED }}
                    >
                      Credentials overdue
                    </p>
                  </div>

                  <div
                    className="rounded-xl p-4"
                    style={{ background: SOFT }}
                  >
                    <p
                      className="text-2xl font-black"
                      style={{ color: TEXT }}
                    >
                      {pipeline.kpis.starting_this_week}
                    </p>

                    <p
                      className="mt-1 text-[9px] font-black uppercase tracking-[0.14em]"
                      style={{ color: MUTED }}
                    >
                      Starting this week
                    </p>
                  </div>
                </div>
              ) : (
                <div
                  className="mt-5 flex flex-col items-center rounded-xl p-8 text-center"
                  style={{ background: SOFT }}
                >
                  <Briefcase
                    size={22}
                    className="mb-2"
                    style={{ color: MUTED }}
                  />

                  <p
                    className="text-[12px] font-black"
                    style={{ color: TEXT }}
                  >
                    No active recruitment activity
                  </p>

                  <p
                    className="mt-1 max-w-md text-[10px] font-medium"
                    style={{ color: MUTED }}
                  >
                    Candidates and onboarding tasks will appear
                    here as your workforce grows.
                  </p>
                </div>
              )}
            </section>
          </>
        )}

        {/* =========================================================
            WORKER DETAIL DRAWER
        ========================================================= */}

        {selectedWorker && (
          <div className="fixed inset-0 z-50">
            <button
              aria-label="Close staff profile"
              onClick={() => setSelectedWorker(null)}
              className="absolute inset-0 cursor-default bg-black/20 backdrop-blur-[1px]"
            />

            <aside
              className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l bg-white shadow-2xl"
              style={{ borderColor: BORDER }}
            >
              <div
                className="flex items-center justify-between border-b px-5 py-4"
                style={{ borderColor: BORDER }}
              >
                <div>
                  <p
                    className="text-[9px] font-black uppercase tracking-[0.16em]"
                    style={{ color: PLUM }}
                  >
                    Staff profile
                  </p>

                  <h2
                    className="mt-1 text-[16px] font-black"
                    style={{ color: TEXT }}
                  >
                    Workforce detail
                  </h2>
                </div>

                <button
                  onClick={() => setSelectedWorker(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{
                    background: SOFT,
                    color: MUTED,
                  }}
                >
                  <X size={15} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5">
                <div className="flex items-center gap-4">
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-full text-[15px] font-black"
                    style={{
                      background: SOFT,
                      color: PLUM,
                    }}
                  >
                    {initials(selectedWorker.full_name)}
                  </div>

                  <div className="min-w-0">
                    <h3
                      className="text-lg font-black"
                      style={{ color: TEXT }}
                    >
                      {selectedWorker.full_name}
                    </h3>

                    <p
                      className="mt-0.5 text-[11px] font-medium capitalize"
                      style={{ color: MUTED }}
                    >
                      {selectedWorker.role?.replace(
                        /_/g,
                        " ",
                      ) || "Support worker"}
                    </p>
                  </div>
                </div>

                <div className="mt-6">
                  <StatusBadge
                    score={selectedWorker.compliance_score}
                    translate={translate}
                  />

                  <div className="mt-3">
                    <ScoreBar
                      score={selectedWorker.compliance_score}
                    />
                  </div>
                </div>

                <div className="mt-7 grid grid-cols-2 gap-3">
                  <div
                    className="rounded-xl p-4"
                    style={{ background: SOFT }}
                  >
                    <p
                      className="text-[9px] font-black uppercase tracking-[0.14em]"
                      style={{ color: MUTED }}
                    >
                      Participants
                    </p>

                    <p
                      className="mt-1 text-xl font-black"
                      style={{ color: TEXT }}
                    >
                      {selectedWorker.participant_count}
                    </p>
                  </div>

                  <div
                    className="rounded-xl p-4"
                    style={{ background: SOFT }}
                  >
                    <p
                      className="text-[9px] font-black uppercase tracking-[0.14em]"
                      style={{ color: MUTED }}
                    >
                      Sessions
                    </p>

                    <p
                      className="mt-1 text-xl font-black"
                      style={{ color: TEXT }}
                    >
                      {selectedWorker.sessions}
                    </p>
                  </div>
                </div>

                <div className="mt-7">
                  <p
                    className="mb-3 text-[9px] font-black uppercase tracking-[0.16em]"
                    style={{ color: MUTED }}
                  >
                    Workforce information
                  </p>

                  <div
                    className="divide-y rounded-xl border"
                    style={{ borderColor: BORDER }}
                  >
                    {selectedWorker.email && (
                      <div className="flex items-center justify-between gap-4 px-4 py-3">
                        <span
                          className="text-[10px] font-medium"
                          style={{ color: MUTED }}
                        >
                          Email
                        </span>

                        <span
                          className="max-w-[220px] truncate text-right text-[10px] font-bold"
                          style={{ color: TEXT }}
                        >
                          {selectedWorker.email}
                        </span>
                      </div>
                    )}

                    {selectedWorker.joined_at && (
                      <div className="flex items-center justify-between gap-4 px-4 py-3">
                        <span
                          className="text-[10px] font-medium"
                          style={{ color: MUTED }}
                        >
                          Joined
                        </span>

                        <span
                          className="text-right text-[10px] font-bold"
                          style={{ color: TEXT }}
                        >
                          {new Date(
                            selectedWorker.joined_at,
                          ).toLocaleDateString()}
                        </span>
                      </div>
                    )}

                    {selectedWorker.last_login && (
                      <div className="flex items-center justify-between gap-4 px-4 py-3">
                        <span
                          className="text-[10px] font-medium"
                          style={{ color: MUTED }}
                        >
                          Last login
                        </span>

                        <span
                          className="text-right text-[10px] font-bold"
                          style={{ color: TEXT }}
                        >
                          {new Date(
                            selectedWorker.last_login,
                          ).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-6">
                  <p
                    className="mb-2 text-[10px] font-black uppercase tracking-wide"
                    style={{ color: MUTED }}
                  >
                    Account management
                  </p>

                  <div className="space-y-2">
                    <button
                      type="button"
                      disabled={accountActionPending !== null}
                      onClick={() => handleSendPasswordReset(selectedWorker)}
                      className="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:bg-cc-soft disabled:opacity-50"
                      style={{ borderColor: BORDER }}
                    >
                      {accountActionPending === "reset" ? (
                        <Loader2 size={15} className="animate-spin shrink-0" style={{ color: MUTED }} />
                      ) : (
                        <KeyRound size={15} className="shrink-0" style={{ color: PLUM }} />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-bold" style={{ color: TEXT }}>Send password reset email</p>
                        <p className="text-[10px]" style={{ color: MUTED }}>Sends a secure link so they set a new password themselves.</p>
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={accountActionPending !== null}
                      onClick={() => handleDeactivate(selectedWorker)}
                      className="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:bg-red-50 disabled:opacity-50"
                      style={{ borderColor: "#E4B9B6" }}
                    >
                      {accountActionPending === "deactivate" ? (
                        <Loader2 size={15} className="animate-spin shrink-0 text-red-600" />
                      ) : (
                        <UserX size={15} className="shrink-0 text-red-600" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-bold text-red-700">Deactivate account</p>
                        <p className="text-[10px] text-red-600">Immediately revokes their access. Can be reversed by a coordinator.</p>
                      </div>
                    </button>
                  </div>
                </div>

                {selectedWorker.compliance_score < 85 &&
                  selectedWorker.compliance_score > 0 && (
                    <div
                      className="mt-6 rounded-xl border p-4"
                      style={{
                        borderColor: "#E4B9B6",
                        background: "#FBEAE9",
                      }}
                    >
                      <div className="flex gap-3">
                        <AlertTriangle
                          size={15}
                          className="mt-0.5 shrink-0 text-red-600"
                        />

                        <div>
                          <p className="text-[11px] font-black text-red-700">
                            Performance review recommended
                          </p>

                          <p className="mt-1 text-[10px] font-medium leading-relaxed text-red-600">
                            This worker is currently below the
                            organisation's 85% compliance
                            threshold. Consider reviewing
                            documentation quality and support
                            needs.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
              </div>
            </aside>
          </div>
        )}
      </div>
    </HubLayout>
  );
}