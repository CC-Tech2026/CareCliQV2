import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  Briefcase,
  ChevronRight,
  HeartHandshake,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";

import { apiFetch } from "@/lib/api-fetch";
import { HubLayout } from "@/components/layout/HubLayout";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import {
  getWorkerPipelineOverview,
  getCoordinatorWorkerStats,
  deactivateWorker,
  deleteWorkerAccount,
  sendWorkerPasswordReset,
  type WorkerPipelineOverview,
  type WorkerStats,
} from "@/services/coordinatorService";
import { WorkerDetail, type WorkerDetailTab } from "@/components/team/WorkerDetail";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const CTA = "var(--cc-cta)";
const PLUM_SOFT = "var(--cc-plum-soft)";
const GREEN = "#0F7B57";
const INFO = "#2A5C8A";
const AMBER = "#9A5B0A";
const RED = "#B3261E";
const SUCCESS_BG = "var(--cc-status-success-bg)";
const INFO_BG = "var(--cc-status-info-bg)";
const WARNING_BG = "var(--cc-status-warning-bg)";
const DANGER_BG = "var(--cc-status-danger-bg)";

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

function formatLastActive(value?: string) {
  if (!value) return "Never signed in";
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true });
  } catch {
    return "Never signed in";
  }
}

function formatRole(role?: string) {
  return role ? role.replace(/_/g, " ") : "Support worker";
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function getScoreColor(score: number) {
  if (score <= 0) return MUTED;
  if (score >= 90) return GREEN;
  if (score >= 85) return INFO;
  if (score >= 70) return AMBER;
  return RED;
}

function getScoreLabel(
  score: number,
  translate: (key: string) => string,
) {
  if (score <= 0) return translate("md.staff.noData");
  if (score >= 90) return translate("md.staff.strongPerformer");
  if (score >= 85) return translate("md.staff.onTrack");
  if (score >= 70) return translate("md.staff.needsAttention");
  return translate("md.staff.retentionRisk");
}

function bgForScore(score: number) {
  if (score <= 0) return SOFT;
  if (score >= 90) return SUCCESS_BG;
  if (score >= 85) return INFO_BG;
  if (score >= 70) return WARNING_BG;
  return DANGER_BG;
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

function KpiTile({
  label,
  value,
  color,
  bg,
  icon: Icon,
  onClick,
}: {
  label: string;
  value: string | number;
  color: string;
  bg: string;
  icon?: typeof Users;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[30px] font-black leading-none" style={{ color }}>{value}</p>
        {Icon && (
          <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: "rgba(255,255,255,0.65)", color }}>
            <Icon size={15} />
          </div>
        )}
      </div>
      <p className="mt-2 text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>{label}</p>
    </>
  );
  if (!onClick) return <div className="rounded-[1.25rem] px-5 py-4.5" style={{ background: bg }}>{content}</div>;
  return (
    <button
      onClick={onClick}
      className="w-full rounded-[1.25rem] px-5 py-4.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm"
      style={{ background: bg }}
    >
      {content}
    </button>
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
  const [workerStats, setWorkerStats] = useState<WorkerStats[] | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [filter, setFilter] = useState<Filter>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"name" | "compliance" | "participants" | "sessions" | "lastActive">("compliance");
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedWorker, setSelectedWorker] =
    useState<StaffMember | null>(null);
  const [detailInitialTab, setDetailInitialTab] = useState<WorkerDetailTab | undefined>(undefined);
  const [pendingWorkerId, setPendingWorkerId] = useState<string | null>(null);
  const [accountActionPending, setAccountActionPending] =
    useState<"reset" | "deactivate" | "delete" | null>(null);

  function openWorker(worker: StaffMember, tab?: WorkerDetailTab) {
    setDetailInitialTab(tab);
    setSelectedWorker(worker);
  }

  // Deep link from other MD pages (e.g. Staff Onboarding): ?workerId=<id>&tab=credentials.
  // One-shot: consumed into state then stripped from the URL immediately, so it can't
  // become a "sticky" link that reopens this same worker on every future refresh.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const workerId = params.get("workerId");
    if (!workerId) return;
    setPendingWorkerId(workerId);
    const tab = params.get("tab");
    if (tab === "credentials" || tab === "documents" || tab === "availability" || tab === "training") {
      setDetailInitialTab(tab);
    }
    window.history.replaceState(null, "", "/md/staff");
  }, []);

  useEffect(() => {
    if (!pendingWorkerId || !data) return;
    const match = data.staff_directory.find((w) => w.id === pendingWorkerId);
    if (match) setSelectedWorker(match);
    setPendingWorkerId(null);
  }, [pendingWorkerId, data]);

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

  async function handleDeleteAccount(worker: StaffMember) {
    if (!window.confirm(`Remove ${worker.full_name}'s account? This queues it for removal and can't be undone once processed.`)) return;
    setAccountActionPending("delete");
    try {
      await deleteWorkerAccount(worker.id);
      toast({ title: "Account removal requested", description: `${worker.full_name}'s account has been queued for removal.` });
      setSelectedWorker(null);
    } catch (err) {
      toast({ title: "Could not queue account removal", description: err instanceof Error ? err.message : "Try again shortly.", variant: "destructive" });
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

  useEffect(() => {
    let cancelled = false;

    // Richer per-worker record (credentials, training, availability, shift
    // history, participants...) than the dashboard's summary directory rows -
    // fetched once for the whole org so opening a profile is instant, not a
    // second round-trip per click.
    getCoordinatorWorkerStats()
      .then((result) => {
        if (!cancelled) setWorkerStats(result);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const allStaff = data?.staff_directory ?? [];
  const selectedWorkerStats = selectedWorker
    ? workerStats?.find((w) => w.id === selectedWorker.id) ?? null
    : null;

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

  const distinctRoles = useMemo(() => {
    const roles = new Set(allStaff.map((worker) => worker.role || "support_worker"));
    return Array.from(roles).sort();
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

      const matchesRole =
        roleFilter === "all" || (worker.role || "support_worker") === roleFilter;

      return matchesSearch && matchesFilter && matchesRole;
    });
  }, [allStaff, filter, roleFilter, search]);

  // Sortable by clicking a column header - the old separate "Leading performers"
  // cards duplicated exactly this (top-3 by compliance) as its own section;
  // sorting the real list in place does the same job without a second,
  // redundant block above the directory the page is actually named after.
  const sortedFiltered = useMemo(() => {
    const dir = sortAsc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.full_name.localeCompare(b.full_name) * dir;
        case "participants":
          return (a.participant_count - b.participant_count) * dir;
        case "sessions":
          return (a.sessions - b.sessions) * dir;
        case "lastActive":
          return (
            (a.last_login ? new Date(a.last_login).getTime() : 0) -
            (b.last_login ? new Date(b.last_login).getTime() : 0)
          ) * dir;
        default:
          return (a.compliance_score - b.compliance_score) * dir;
      }
    });
  }, [filtered, sortKey, sortAsc]);

  function handleSort(key: typeof sortKey) {
    if (key === sortKey) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(key === "name"); }
  }

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

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiTile label="Active staff" value={data.active_staff} color={PLUM} bg={PLUM_SOFT} icon={Users} />

              <KpiTile
                label="Average compliance"
                value={`${stats.average}%`}
                color={getScoreColor(stats.average)}
                bg={bgForScore(stats.average)}
                icon={ShieldCheck}
              />

              <KpiTile
                label="Retention"
                value={`${data.staff_retention_rate}%`}
                color={getScoreColor(data.staff_retention_rate)}
                bg={bgForScore(data.staff_retention_rate)}
                icon={HeartHandshake}
              />

              <KpiTile
                label="Needs attention"
                value={stats.atRisk.length}
                color={stats.atRisk.length > 0 ? RED : GREEN}
                bg={stats.atRisk.length > 0 ? DANGER_BG : SUCCESS_BG}
                icon={AlertTriangle}
                onClick={stats.atRisk.length > 0 ? () => {
                  setFilter("at_risk");
                  document.getElementById("staff-directory")?.scrollIntoView({ behavior: "smooth" });
                } : undefined}
              />
            </div>

            {/* =====================================================
                STAFF DIRECTORY - leads the page, right after the KPI
                snapshot: this is the "directory" page, so the actual list
                of staff shouldn't be buried below analytics sections.
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

                  <div className="flex items-center gap-2">
                    {distinctRoles.length > 1 && (
                      <Select value={roleFilter} onValueChange={setRoleFilter}>
                        <SelectTrigger className="h-8 w-[150px] rounded-lg border text-[10px] font-black" style={{ borderColor: BORDER, color: MUTED }}>
                          <SelectValue placeholder="All roles" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All roles</SelectItem>
                          {distinctRoles.map((role) => (
                            <SelectItem key={role} value={role} className="capitalize">
                              {formatRole(role)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

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
                        className="grid grid-cols-[minmax(240px,1.5fr)_1.2fr_100px_100px_120px_130px_24px] items-center gap-4 border-b px-5 py-3"
                        style={{
                          borderColor: BORDER,
                          background: SOFT,
                        }}
                      >
                        {([
                          ["Staff member", "name"],
                          ["Compliance", "compliance"],
                          ["Participants", "participants"],
                          ["Sessions", "sessions"],
                          ["Last active", "lastActive"],
                          ["Status", null],
                          ["", null],
                        ] as [string, typeof sortKey | null][]).map(([heading, key]) => (
                          <button
                            key={heading}
                            type="button"
                            disabled={!key}
                            onClick={() => key && handleSort(key)}
                            className="flex items-center gap-1 text-left text-[9px] font-black uppercase tracking-[0.14em] disabled:cursor-default"
                            style={{ color: key && sortKey === key ? PLUM : MUTED }}
                          >
                            {heading}
                            {key && sortKey === key && (sortAsc ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                          </button>
                        ))}
                      </div>

                      <div>
                        {sortedFiltered.map((worker) => (
                          <button
                            key={worker.id}
                            onClick={() =>
                              openWorker(worker)
                            }
                            className="group grid w-full grid-cols-[minmax(240px,1.5fr)_1.2fr_100px_100px_120px_130px_24px] items-center gap-4 border-b px-5 py-4 text-left transition last:border-b-0 hover:bg-slate-50"
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
                                  {formatRole(worker.role)}
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

                            <span
                              className="text-[11px] font-medium"
                              style={{ color: MUTED }}
                            >
                              {formatLastActive(worker.last_login)}
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
                      {sortedFiltered.map((worker) => (
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
                                  {formatRole(worker.role)}
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

                          <p
                            className="mt-3 text-[10px] font-medium"
                            style={{ color: MUTED }}
                          >
                            Last active: {formatLastActive(worker.last_login)}
                          </p>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </section>

            {/* =====================================================
                PERFORMANCE DISTRIBUTION - secondary analytics, now below
                the actual directory rather than blocking access to it.
            ===================================================== */}

            <section className="rounded-2xl border bg-white p-5" style={{ borderColor: BORDER }}>
              <SectionHeader
                eyebrow="Performance health"
                title="Workforce performance distribution"
              />

              <div className="mt-5">
                <div className="flex h-4 overflow-hidden rounded-full bg-slate-100">
                  {distribution.strong > 0 && <div style={{ flex: distribution.strong, background: "#0F7B57" }} />}
                  {distribution.onTrack > 0 && <div style={{ flex: distribution.onTrack, background: "#2A5C8A" }} />}
                  {distribution.attention > 0 && <div style={{ flex: distribution.attention, background: "#9A5B0A" }} />}
                  {distribution.risk > 0 && <div style={{ flex: distribution.risk, background: "#B3261E" }} />}
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-4">
                  {[
                    { label: "Strong", count: distribution.strong, color: "#0F7B57" },
                    { label: "On track", count: distribution.onTrack, color: "#2A5C8A" },
                    { label: "Attention", count: distribution.attention, color: "#9A5B0A" },
                    { label: "Risk", count: distribution.risk, color: "#B3261E" },
                  ].map((item) => (
                    <div key={item.label}>
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                        <span className="text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>{item.label}</span>
                      </div>
                      <p className="mt-1 text-xl font-black" style={{ color: TEXT }}>{item.count}</p>
                    </div>
                  ))}
                </div>

                {stats.atRisk.length > 0 && (
                  <button
                    onClick={() => {
                      setFilter("at_risk");
                      document.getElementById("staff-directory")?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className="mt-5 inline-flex items-center gap-1.5 text-[10px] font-black"
                    style={{ color: "#B3261E" }}
                  >
                    Review at-risk staff
                    <ArrowRight size={11} strokeWidth={2.5} />
                  </button>
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
                  <div className="rounded-xl border p-4" style={{ borderColor: BORDER }}>
                    <p className="text-2xl font-black" style={{ color: TEXT }}>{pipeline.kpis.in_pipeline}</p>
                    <p className="mt-1 text-[9px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>Candidates in pipeline</p>
                  </div>

                  <div className="rounded-xl border p-4" style={{ borderColor: BORDER }}>
                    <p className="text-2xl font-black" style={{ color: pipeline.kpis.credentials_overdue > 0 ? "#9A5B0A" : TEXT }}>
                      {pipeline.kpis.credentials_overdue}
                    </p>
                    <p className="mt-1 text-[9px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>Credentials overdue</p>
                  </div>

                  <div className="rounded-xl border p-4" style={{ borderColor: BORDER }}>
                    <p className="text-2xl font-black" style={{ color: TEXT }}>{pipeline.kpis.starting_this_week}</p>
                    <p className="mt-1 text-[9px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>Starting this week</p>
                  </div>
                </div>
              ) : (
                <div className="mt-5 flex flex-col items-center rounded-xl border p-8 text-center" style={{ borderColor: BORDER }}>
                  <Briefcase size={22} className="mb-2" style={{ color: MUTED }} />
                  <p className="text-[12px] font-black" style={{ color: TEXT }}>No active recruitment activity</p>
                  <p className="mt-1 max-w-md text-[10px] font-medium" style={{ color: MUTED }}>
                    Candidates and onboarding tasks will appear here as your workforce grows.
                  </p>
                </div>
              )}
            </section>
          </>
        )}

        {/* =========================================================
            WORKER DETAIL DRAWER
        ========================================================= */}

        <Sheet open={!!selectedWorker} onOpenChange={(open) => { if (!open) setSelectedWorker(null); }}>
          <SheetContent side="right" className="w-full overflow-y-auto p-6 sm:max-w-4xl" style={{ background: "var(--cc-bg)" }}>
            <SheetHeader className="sr-only">
              <SheetTitle>{selectedWorker ? `${selectedWorker.full_name} · staff profile` : "Staff profile"}</SheetTitle>
            </SheetHeader>
            {selectedWorker && (
              selectedWorkerStats ? (
                <WorkerDetail
                  worker={selectedWorkerStats}
                  initialTab={detailInitialTab}
                  onBack={() => setSelectedWorker(null)}
                  onSendPasswordReset={() => handleSendPasswordReset(selectedWorker)}
                  onDeactivate={() => handleDeactivate(selectedWorker)}
                  onDeleteAccount={() => handleDeleteAccount(selectedWorker)}
                />
              ) : (
                <div className="space-y-4 pt-2">
                  <div className="h-16 animate-pulse rounded-2xl" style={{ background: SOFT }} />
                  <div className="h-40 animate-pulse rounded-2xl" style={{ background: SOFT }} />
                  <div className="h-40 animate-pulse rounded-2xl" style={{ background: SOFT }} />
                </div>
              )
            )}
          </SheetContent>
        </Sheet>
      </div>
    </HubLayout>
  );
}