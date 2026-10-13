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
  Search,
  Users,
  X,
} from "lucide-react";

import { apiFetch } from "@/lib/api-fetch";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { MD_DASHBOARD_KEY, WORKER_STATS_KEY } from "@/lib/query-keys";
import { HubLayout } from "@/components/layout/HubLayout";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import {
  getWorkerPipelineOverview,
  getCoordinatorWorkerStats,
  getTeamCredentials,
  getOrgAssignments,
  SUPPORT_ALLOCATION_ROLES,
  deactivateWorker,
  deleteWorkerAccount,
  sendWorkerPasswordReset,
  type WorkerPipelineOverview,
  type WorkerStats,
  type DeactivationReason,
} from "@/services/coordinatorService";
import {
  WorkerDetail,
  type WorkerDetailTab,
} from "@/components/team/WorkerDetail";
import { DeactivateWorkerPanel } from "@/components/team/DeactivateWorkerPanel";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  employmentLabel,
  notesStatus,
  summariseCredentials,
  type CredentialSummary,
  type Tone,
} from "@/lib/directory-insights";
import { SectionInfo } from "@/components/ui/section-info";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const CTA = "var(--cc-cta)";
const GREEN = "var(--cc-green)";
const INFO = "var(--cc-sky)";
const AMBER = "var(--cc-amber)";
const RED = "var(--cc-danger-text)";

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

type Filter = "all" | "at_risk" | "strong" | "credentials";
type SortKey =
  | "name"
  | "compliance"
  | "participants"
  | "sessions"
  | "lastActive"
  | "credentials"
  | "thisWeek"
  | "notes";

/**
 * Desktop columns. lg shows the essentials; xl adds this week and notes.
 * Cells hidden at a breakpoint don't take a grid track, so each template
 * lists only the columns visible at that size.
 */
const STAFF_GRID =
  "lg:grid-cols-[minmax(220px,1.7fr)_minmax(140px,1fr)_88px_120px_minmax(150px,1fr)_20px] " +
  "xl:grid-cols-[minmax(220px,1.7fr)_minmax(140px,1fr)_88px_100px_minmax(120px,1fr)_120px_minmax(160px,1fr)_20px]";

const STAFF_COLUMNS: { label: string; key?: SortKey; className?: string }[] = [
  { label: "Staff member", key: "name" },
  { label: "Credentials", key: "credentials" },
  { label: "Participants", key: "participants" },
  { label: "This week", key: "thisWeek", className: "hidden xl:flex" },
  { label: "Notes", key: "notes", className: "hidden xl:flex" },
  { label: "Compliance", key: "compliance" },
  { label: "Status", key: "lastActive" },
  { label: "" },
];

function formatLastActive(value?: string) {
  if (!value) return "Never signed in";
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true });
  } catch {
    return "Never signed in";
  }
}

function formatRole(role?: string) {
  if (!role) return "Support worker";
  const label = role.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function PersonAvatar({ name, photoUrl }: { name: string; photoUrl?: string | null }) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        className="h-11 w-11 shrink-0 rounded-full object-cover"
        style={{ background: SOFT }}
      />
    );
  }
  return (
    <div
      aria-hidden
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
      style={{ background: SOFT, color: TEXT }}
    >
      {initials(name)}
    </div>
  );
}

/** Rounded filter pill. Selected = solid navy, theme-safe in light and dark. */
function FilterPill({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum"
      style={
        selected
          ? { background: TEXT, color: "var(--cc-bg)" }
          : { color: TEXT, boxShadow: `inset 0 0 0 1px ${BORDER}` }
      }
    >
      {label}
      <span className="tabular-nums" style={{ opacity: 0.7 }}>{count}</span>
    </button>
  );
}

function toneColor(tone: Tone) {
  if (tone === "good") return GREEN;
  if (tone === "info") return INFO;
  if (tone === "warning") return AMBER;
  if (tone === "danger") return RED;
  return MUTED;
}

function getScoreColor(score: number) {
  if (score <= 0) return MUTED;
  if (score >= 90) return GREEN;
  if (score >= 85) return INFO;
  if (score >= 70) return AMBER;
  return RED;
}

function getScoreLabel(score: number, translate: (key: string) => string) {
  if (score <= 0) return translate("md.staff.noData");
  if (score >= 90) return translate("md.staff.strongPerformer");
  if (score >= 85) return translate("md.staff.onTrack");
  if (score >= 70) return translate("md.staff.needsAttention");
  return translate("md.staff.retentionRisk");
}

export default function MDStaffPage() {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const queryClient = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";

  // Cached queries (not one-off fetches) so a change saved anywhere — the
  // worker panel, the team page, another tab — refreshes these numbers too.
  const dashboardQuery = useOrgQuery<MDData>([...MD_DASHBOARD_KEY, "all"], {
    queryFn: async () => {
      const response = await apiFetch("/api/dashboard/managing-director");
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      return response.json();
    },
  });
  const pipelineQuery = useOrgQuery<WorkerPipelineOverview>(["md", "worker-pipeline"], {
    queryFn: getWorkerPipelineOverview,
  });
  // Richer per-worker record (credentials, training, availability, shift
  // history, participants...) than the dashboard's summary directory rows -
  // fetched once for the whole org so opening a profile is instant. Shares
  // its key with the team and rostering pages.
  const workerStatsQuery = useOrgQuery<WorkerStats[]>(WORKER_STATS_KEY, {
    queryFn: getCoordinatorWorkerStats,
  });

  // Same key and fetcher as the worker panel and team page, so it's one request.
  const credentialsQuery = useOrgQuery(["team-credentials"], {
    queryFn: getTeamCredentials,
  });

  // Who supports whom. The same source as the worker profile's participants
  // tab, so the count here matches what opens when you click through.
  const assignmentsQuery = useOrgQuery(["worker-assignments", "org"], {
    queryFn: getOrgAssignments,
  });

  const data = dashboardQuery.data ?? null;
  const pipeline = pipelineQuery.data ?? null;
  const workerStats = workerStatsQuery.data ?? null;
  const loading = dashboardQuery.isLoading;
  const error = dashboardQuery.isError;
  const detailsLoading = workerStatsQuery.isLoading;
  const detailsError = workerStatsQuery.isError;

  const refreshStaff = () => {
    void queryClient.invalidateQueries({ queryKey: [orgId, ...MD_DASHBOARD_KEY] });
    void queryClient.invalidateQueries({ queryKey: [orgId, ...WORKER_STATS_KEY] });
    void queryClient.invalidateQueries({ queryKey: [orgId, "md", "worker-pipeline"] });
  };

  const [filter, setFilter] = useState<Filter>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedWorker, setSelectedWorker] = useState<StaffMember | null>(
    null,
  );
  const [workerFullScreen, setWorkerFullScreen] = useState(true);
  const [detailInitialTab, setDetailInitialTab] = useState<
    WorkerDetailTab | undefined
  >(undefined);
  const [pendingWorkerId, setPendingWorkerId] = useState<string | null>(null);
  const [accountActionPending, setAccountActionPending] = useState<
    "reset" | "deactivate" | "delete" | null
  >(null);
  const [deactivateTarget, setDeactivateTarget] = useState<StaffMember | null>(
    null,
  );

  /** Stat tiles jump to the staff directory with the matching filter/sort. */
  function showDirectory(nextFilter: Filter, sort?: "compliance") {
    setFilter(nextFilter);
    setSearch("");
    setRoleFilter("all");
    setUnassignedOnly(false);
    if (sort) {
      setSortKey(sort);
      setSortAsc(true);
    }
    document.getElementById("staff-directory")?.scrollIntoView({ behavior: "smooth" });
  }

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
    if (
      tab === "shifts" ||
      tab === "credentials" ||
      tab === "documents" ||
      tab === "availability" ||
      tab === "training"
    ) {
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
      toast({
        title: "Password reset email sent",
        description: `Sent to ${worker.email ?? worker.full_name}.`,
      });
    } catch (err) {
      toast({
        title: "Could not send reset email",
        description: err instanceof Error ? err.message : "Try again shortly.",
        variant: "destructive",
      });
    } finally {
      setAccountActionPending(null);
    }
  }

  function handleDeactivate(worker: StaffMember) {
    setDeactivateTarget(worker);
  }

  async function confirmDeactivate(reason: DeactivationReason, note: string) {
    const worker = deactivateTarget;
    if (!worker) return;
    setAccountActionPending("deactivate");
    try {
      await deactivateWorker(worker.id, reason, note);
      toast({
        title: "Account deactivated",
        description: `${worker.full_name} can still sign in, but their portal is now locked down.`,
      });
      setSelectedWorker(null);
      setDeactivateTarget(null);
      // Remove the row immediately, then refetch so the counts update too.
      queryClient.setQueryData<MDData>([orgId, ...MD_DASHBOARD_KEY, "all"], (prev) =>
        prev
          ? { ...prev, staff_directory: prev.staff_directory.filter((w) => w.id !== worker.id) }
          : prev,
      );
      refreshStaff();
    } catch (err) {
      toast({
        title: "Could not deactivate account",
        description: err instanceof Error ? err.message : "Try again shortly.",
        variant: "destructive",
      });
    } finally {
      setAccountActionPending(null);
    }
  }

  async function handleDeleteAccount(worker: StaffMember) {
    if (
      !window.confirm(
        `Remove ${worker.full_name}'s account? This queues it for removal and can't be undone once processed.`,
      )
    )
      return;
    setAccountActionPending("delete");
    try {
      await deleteWorkerAccount(worker.id);
      toast({
        title: "Account removal requested",
        description: `${worker.full_name}'s account has been queued for removal.`,
      });
      setSelectedWorker(null);
      refreshStaff();
    } catch (err) {
      toast({
        title: "Could not queue account removal",
        description: err instanceof Error ? err.message : "Try again shortly.",
        variant: "destructive",
      });
    } finally {
      setAccountActionPending(null);
    }
  }

  const allStaff = data?.staff_directory ?? [];
  const selectedWorkerStats = selectedWorker
    ? (workerStats?.find((w) => w.id === selectedWorker.id) ?? null)
    : null;

  const stats = useMemo(() => {
    const active = allStaff.filter((worker) => worker.compliance_score > 0);

    const atRisk = allStaff.filter(
      (worker) => worker.compliance_score > 0 && worker.compliance_score < 85,
    );

    const strong = allStaff.filter((worker) => worker.compliance_score >= 90);

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
      (worker) => worker.compliance_score >= 85 && worker.compliance_score < 90,
    ).length;

    const attention = allStaff.filter(
      (worker) => worker.compliance_score >= 70 && worker.compliance_score < 85,
    ).length;

    const risk = allStaff.filter(
      (worker) => worker.compliance_score > 0 && worker.compliance_score < 70,
    ).length;

    return {
      strong,
      onTrack,
      attention,
      risk,
    };
  }, [allStaff]);

  const statsById = useMemo(
    () => new Map((workerStats ?? []).map((worker) => [worker.id, worker])),
    [workerStats],
  );
  const credentialsByUser = useMemo(
    () => summariseCredentials(credentialsQuery.data ?? []),
    [credentialsQuery.data],
  );
  const credentialsLoading = credentialsQuery.isLoading;

  const participantsByWorker = useMemo(() => {
    if (!assignmentsQuery.data) return null;
    const map = new Map<string, Set<string>>();
    for (const assignment of assignmentsQuery.data) {
      if (!SUPPORT_ALLOCATION_ROLES.has(assignment.allocated_role)) continue;
      const set = map.get(assignment.user_id) ?? new Set<string>();
      set.add(assignment.patient_id);
      map.set(assignment.user_id, set);
    }
    return map;
  }, [assignmentsQuery.data]);

  /** Participants this person is assigned to support (dashboard count until assignments load). */
  function participantsFor(worker: StaffMember) {
    return participantsByWorker
      ? (participantsByWorker.get(worker.id)?.size ?? 0)
      : worker.participant_count;
  }

  /** Expired or soon-expiring credentials, or overdue training/induction. */
  function hasCredentialIssue(worker: StaffMember) {
    const summary = credentialsByUser.get(worker.id);
    const extra = statsById.get(worker.id);
    return (
      (summary?.expired ?? 0) > 0 ||
      (summary?.expiring ?? 0) > 0 ||
      !!extra?.training_overdue ||
      !!extra?.induction_overdue
    );
  }
  const credentialIssueCount = allStaff.filter(hasCredentialIssue).length;

  const distinctRoles = useMemo(() => {
    const roles = new Set(
      allStaff.map((worker) => worker.role || "support_worker"),
    );
    return Array.from(roles).sort();
  }, [allStaff]);

  // coordinator_id lives on the richer workerStats record (fetched separately
  // for the org), not on the dashboard's staff_directory summary row — see
  // Phase 2 of the onboarding/matching plan: coordinator_id assignment is a
  // gradual rollout, and a worker no one has claimed yet needs to stay findable
  // rather than silently drop out of the directory.
  function isUnassigned(worker: StaffMember) {
    return (
      (worker.role || "support_worker") === "support_worker" &&
      !workerStats?.find((w) => w.id === worker.id)?.coordinator_id
    );
  }

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
        (filter === "strong" && worker.compliance_score >= 90) ||
        (filter === "credentials" && hasCredentialIssue(worker));

      const matchesRole =
        roleFilter === "all" ||
        (worker.role || "support_worker") === roleFilter;

      const matchesUnassigned = !unassignedOnly || isUnassigned(worker);

      return matchesSearch && matchesFilter && matchesRole && matchesUnassigned;
    });
  }, [allStaff, filter, roleFilter, search, unassignedOnly, workerStats, credentialsByUser]);

  // Counted from the directory itself (not the wider workerStats list, which
  // also holds inactive accounts) so the chip matches what the filter shows.
  const unassignedCount = allStaff.filter(isUnassigned).length;
  const filtersActive =
    !!search || filter !== "all" || roleFilter !== "all" || unassignedOnly;

  function resetFilters() {
    setSearch("");
    setFilter("all");
    setRoleFilter("all");
    setUnassignedOnly(false);
  }

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
          return (participantsFor(a) - participantsFor(b)) * dir;
        case "sessions":
          return (a.sessions - b.sessions) * dir;
        case "lastActive":
          return (
            ((a.last_login ? new Date(a.last_login).getTime() : 0) -
              (b.last_login ? new Date(b.last_login).getTime() : 0)) *
            dir
          );
        case "credentials": {
          // Most urgent first when descending: expired outweighs expiring.
          const weight = (id: string) => {
            const summary = credentialsByUser.get(id);
            return (summary?.expired ?? 0) * 100 + (summary?.expiring ?? 0) * 10 + (summary?.awaitingReview ?? 0);
          };
          return (weight(a.id) - weight(b.id)) * dir;
        }
        case "thisWeek":
          return ((statsById.get(a.id)?.sessions_this_week ?? 0) - (statsById.get(b.id)?.sessions_this_week ?? 0)) * dir;
        case "notes": {
          const weight = (id: string) => {
            const extra = statsById.get(id);
            return (extra?.flagged_count ?? 0) * 100 + (extra?.draft_count ?? 0);
          };
          return (weight(a.id) - weight(b.id)) * dir;
        }
        default:
          return (a.compliance_score - b.compliance_score) * dir;
      }
    });
  }, [filtered, sortKey, sortAsc, credentialsByUser, statsById, participantsByWorker]);

  function handleSort(key: typeof sortKey) {
    if (key === sortKey) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(key === "name");
    }
  }

  const pipelineActive =
    !!pipeline &&
    (pipeline.kpis.in_pipeline > 0 ||
      pipeline.kpis.credentials_overdue > 0 ||
      pipeline.kpis.starting_this_week > 0);

  return (
    <HubLayout>
      <div className="space-y-8 pb-12">
        {/* =========================================================
            HEADER: sits on the page, not in a card, so the team list
            below is the first thing that reads as content.
        ========================================================= */}

        <header className="flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold" style={{ color: MUTED }}>
              Staff directory
            </p>
            <h1
              className="mt-1 flex items-center gap-2 text-3xl font-semibold tracking-tight"
              style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}
            >
              Your team
              <SectionInfo text="Your organisation's staff: who's active, how they're performing, credentials due, and who's coming through hiring." />
            </h1>
            <p className="mt-2 text-sm leading-6" style={{ color: MUTED }}>
              The people delivering support to your participants. Open anyone to
              see their shifts, credentials and training.
            </p>
          </div>

          <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto sm:gap-2">
            <button
              type="button"
              onClick={() => navigate("/md/vault")}
              className="min-h-11 rounded-full px-4 text-sm font-medium transition hover:bg-cc-soft"
              style={{ color: TEXT }}
            >
              Document vault
            </button>
            <button
              type="button"
              onClick={() => navigate("/billing")}
              className="min-h-11 rounded-full px-4 text-sm font-medium transition hover:bg-cc-soft"
              style={{ color: TEXT }}
            >
              NDIS invoices
            </button>
            <button
              type="button"
              onClick={() => navigate("/md/staff-onboarding")}
              className="order-first inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum sm:order-none sm:w-auto"
              style={{ background: CTA, color: "#fff" }}
            >
              <Briefcase size={15} />
              Manage hiring
            </button>
          </div>
        </header>

        {loading ? (
          <div className="space-y-5" role="status" aria-label="Loading your team">
            <div className="h-11 w-full max-w-xl animate-pulse rounded-full" style={{ background: SOFT }} />
            <div className="h-11 w-full max-w-sm animate-pulse rounded-full" style={{ background: SOFT }} />
            <div className="overflow-hidden rounded-3xl bg-cc-surface">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="flex items-center gap-4 border-b px-4 py-4 last:border-b-0 sm:px-6" style={{ borderColor: BORDER }}>
                  <div className="h-11 w-11 shrink-0 animate-pulse rounded-full" style={{ background: SOFT }} />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-40 animate-pulse rounded-full" style={{ background: SOFT }} />
                    <div className="h-3 w-64 max-w-full animate-pulse rounded-full" style={{ background: SOFT }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : error || !data ? (
          <div className="rounded-3xl bg-cc-surface px-6 py-12 text-center">
            <AlertTriangle size={26} className="mx-auto mb-3" style={{ color: AMBER }} />
            <p className="text-sm font-semibold" style={{ color: TEXT }}>
              {translate("md.staff.loadFailed")}
            </p>
            <button
              type="button"
              onClick={refreshStaff}
              className="mt-4 min-h-11 rounded-full border border-cc-border px-5 text-sm font-semibold"
              style={{ color: TEXT }}
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            {/* =====================================================
                AT A GLANCE: one line of numbers instead of a row of
                tinted tiles. Each figure still jumps to the list.
            ===================================================== */}

            <div className="flex flex-wrap items-stretch gap-x-2 gap-y-3">
              {[
                {
                  label: "active staff",
                  value: data.active_staff,
                  color: TEXT,
                  onClick: () => showDirectory("all"),
                },
                {
                  label: "average compliance",
                  value: `${stats.average}%`,
                  color: getScoreColor(stats.average),
                  onClick: () => showDirectory("all", "compliance"),
                },
                {
                  label: "retention",
                  value: `${data.staff_retention_rate}%`,
                  color: TEXT,
                  onClick: undefined,
                },
                {
                  label: stats.atRisk.length === 1 ? "needs attention" : "need attention",
                  value: stats.atRisk.length,
                  color: stats.atRisk.length > 0 ? AMBER : GREEN,
                  onClick: stats.atRisk.length > 0 ? () => showDirectory("at_risk") : undefined,
                },
                {
                  label: "with credential issues",
                  value: credentialsLoading ? "…" : credentialIssueCount,
                  color: credentialIssueCount > 0 ? RED : GREEN,
                  onClick: credentialIssueCount > 0 ? () => showDirectory("credentials") : undefined,
                },
              ].map((item, index) => {
                const body = (
                  <>
                    <span
                      className="text-2xl font-semibold tabular-nums tracking-tight"
                      style={{ color: item.color }}
                    >
                      {item.value}
                    </span>
                    <span className="text-sm" style={{ color: MUTED }}>
                      {item.label}
                    </span>
                  </>
                );
                return (
                  <div key={item.label} className="flex items-center gap-2">
                    {index > 0 && (
                      <span aria-hidden className="mr-2 hidden h-6 w-px sm:block" style={{ background: BORDER }} />
                    )}
                    {item.onClick ? (
                      <button
                        type="button"
                        onClick={item.onClick}
                        className="flex min-h-11 items-center rounded-full px-3 transition hover:bg-cc-soft"
                      >
                        <span className="flex items-baseline gap-2">{body}</span>
                      </button>
                    ) : (
                      <div className="flex min-h-11 items-center px-3">
                        <span className="flex items-baseline gap-2">{body}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* =====================================================
                THE TEAM: leads the page, it's what people come here for.
            ===================================================== */}

            <section id="staff-directory" className="space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative w-full lg:max-w-sm">
                  <Search
                    size={16}
                    className="absolute left-4 top-1/2 -translate-y-1/2"
                    style={{ color: MUTED }}
                  />
                  <input
                    type="text"
                    placeholder="Search by name or email"
                    aria-label="Search staff by name or email"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="h-11 w-full rounded-full border bg-cc-surface pl-11 pr-11 text-sm outline-none transition focus:ring-2 focus:ring-cc-plum"
                    style={{ borderColor: BORDER, color: TEXT }}
                  />
                  {search && (
                    <button
                      onClick={() => setSearch("")}
                      aria-label="Clear staff search"
                      className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full hover:bg-cc-soft"
                      style={{ color: MUTED }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                  {distinctRoles.length > 1 && (
                    <Select value={roleFilter} onValueChange={setRoleFilter}>
                      <SelectTrigger
                        aria-label="Filter staff by role"
                        className="h-11 w-full rounded-full border bg-cc-surface px-4 text-sm sm:w-[160px]"
                        style={{ borderColor: BORDER, color: TEXT }}
                      >
                        <SelectValue placeholder="All roles" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All roles</SelectItem>
                        {distinctRoles.map((role) => (
                          <SelectItem key={role} value={role}>
                            {formatRole(role)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  <label className="sr-only" htmlFor="staff-sort">Sort staff</label>
                  <div className="flex h-11 min-w-0 items-center rounded-full border bg-cc-surface pl-4 focus-within:ring-2 focus-within:ring-cc-plum lg:hidden" style={{ borderColor: BORDER }}>
                    <select
                      id="staff-sort"
                      value={sortKey}
                      onChange={(event) => {
                        const key = event.target.value as typeof sortKey;
                        setSortKey(key);
                        setSortAsc(key === "name");
                      }}
                      className="h-full min-w-0 flex-1 bg-transparent pr-1 text-sm outline-none"
                      style={{ color: TEXT }}
                    >
                      <option value="name">Sort by name</option>
                      <option value="compliance">Sort by compliance</option>
                      <option value="participants">Sort by participants</option>
                      <option value="sessions">Sort by sessions</option>
                      <option value="lastActive">Sort by last active</option>
                      <option value="credentials">Sort by credentials</option>
                      <option value="thisWeek">Sort by sessions this week</option>
                      <option value="notes">Sort by notes to finish</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setSortAsc((value) => !value)}
                      aria-label={sortAsc ? "Sort descending" : "Sort ascending"}
                      className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-cc-soft"
                      style={{ color: TEXT }}
                    >
                      {sortAsc ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2" aria-label="Filter staff">
                {(
                  [
                    ["all", "Everyone", allStaff.length],
                    ["at_risk", "Needs attention", stats.atRisk.length],
                    ["strong", "Strong performers", stats.strong.length],
                    ["credentials", "Credential issues", credentialIssueCount],
                  ] as [Filter, string, number][]
                ).map(([item, label, count]) => (
                  <FilterPill
                    key={item}
                    label={label}
                    count={count}
                    selected={filter === item && !unassignedOnly}
                    onClick={() => {
                      setFilter(item);
                      setUnassignedOnly(false);
                    }}
                  />
                ))}

                {workerStats && (
                  <FilterPill
                    label="No coordinator yet"
                    count={unassignedCount}
                    selected={unassignedOnly}
                    onClick={() => {
                      setUnassignedOnly((v) => !v);
                      setFilter("all");
                    }}
                  />
                )}

                {filtersActive && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="min-h-10 px-3 text-sm font-medium underline-offset-4 hover:underline"
                    style={{ color: PLUM }}
                  >
                    Clear
                  </button>
                )}
              </div>

              <p role="status" className="text-sm" style={{ color: MUTED }}>
                {filtered.length === allStaff.length
                  ? `${allStaff.length} ${allStaff.length === 1 ? "person" : "people"} on your team`
                  : `Showing ${filtered.length} of ${allStaff.length} people`}
              </p>

              {filtered.length === 0 ? (
                <div className="rounded-3xl bg-cc-surface px-6 py-14 text-center">
                  <Users size={26} className="mx-auto mb-3" style={{ color: MUTED }} />
                  <p className="text-base font-semibold" style={{ color: TEXT }}>
                    {allStaff.length === 0 ? "No one on your team yet" : "No one matches that"}
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-sm" style={{ color: MUTED }}>
                    {allStaff.length === 0
                      ? "Staff will appear here once their accounts are set up. Open onboarding to see who is on the way."
                      : "Try another name or clear the filters to see everyone."}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (allStaff.length === 0) navigate("/md/staff-onboarding");
                      else resetFilters();
                    }}
                    className="mt-5 min-h-11 rounded-full border border-cc-border px-5 text-sm font-semibold"
                    style={{ color: TEXT }}
                  >
                    {allStaff.length === 0 ? "Open staff onboarding" : "Clear filters"}
                  </button>
                </div>
              ) : (
                <div className="overflow-hidden rounded-3xl bg-cc-surface">
                  {/* Column headers (desktop). Click to sort; phones use the select above. */}
                  <div
                    className={`hidden items-center gap-4 border-b px-6 py-3 lg:grid ${STAFF_GRID}`}
                    style={{ borderColor: BORDER }}
                  >
                    {STAFF_COLUMNS.map((column) =>
                      column.key ? (
                        <button
                          key={column.label}
                          type="button"
                          onClick={() => handleSort(column.key!)}
                          aria-label={`Sort by ${column.label.toLowerCase()}`}
                          className={`flex items-center gap-1 text-left text-xs font-medium transition hover:text-cc-text ${column.className ?? ""}`}
                          style={{ color: sortKey === column.key ? TEXT : MUTED }}
                        >
                          {column.label}
                          {sortKey === column.key &&
                            (sortAsc ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                        </button>
                      ) : (
                        <span key={column.label || "chevron"} className={`text-xs font-medium ${column.className ?? ""}`} style={{ color: MUTED }}>
                          {column.label}
                        </span>
                      ),
                    )}
                  </div>

                  <ul>
                    {sortedFiltered.map((worker) => {
                      const scoreColor = getScoreColor(worker.compliance_score);
                      const scored = worker.compliance_score > 0;
                      const extra = statsById.get(worker.id);
                      const credentials = credentialsByUser.get(worker.id);
                      const trainingOverdue = !!extra?.training_overdue || !!extra?.induction_overdue;
                      const notes = extra ? notesStatus(extra.draft_count ?? 0, extra.flagged_count ?? 0) : null;
                      const employment = employmentLabel(extra?.employment_type);
                      const statusDot = scored
                        ? { background: scoreColor }
                        : { boxShadow: `inset 0 0 0 1.5px ${MUTED}` };

                      return (
                        <li key={worker.id} className="border-b last:border-b-0" style={{ borderColor: BORDER }}>
                          <button
                            type="button"
                            onClick={() => openWorker(worker)}
                            className={`group flex w-full items-center gap-4 px-4 py-4 text-left transition hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cc-plum sm:px-6 lg:grid ${STAFF_GRID}`}
                          >
                            {/* Person */}
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                              <PersonAvatar name={worker.full_name} photoUrl={extra?.profile_photo_url} />
                              <div className="min-w-0">
                                <p className="truncate text-[15px] font-semibold" style={{ color: TEXT }}>
                                  {worker.full_name}
                                </p>
                                <p className="mt-0.5 truncate text-sm" style={{ color: MUTED }}>
                                  {formatRole(worker.role)}
                                  {employment && ` · ${employment}`}
                                  {extra?.suburb && <span className="hidden xl:inline">{` · ${extra.suburb}`}</span>}
                                </p>
                                {/* Phones and tablets: the column facts, condensed. */}
                                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs lg:hidden" style={{ color: MUTED }}>
                                  <span className="flex items-center gap-1.5 font-medium" style={{ color: scored ? scoreColor : MUTED }}>
                                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={statusDot} />
                                    {getScoreLabel(worker.compliance_score, translate)}
                                    {scored && ` · ${worker.compliance_score}%`}
                                  </span>
                                  {credentials && credentials.tone !== "good" && (
                                    <span className="font-medium" style={{ color: toneColor(credentials.tone) }}>
                                      Credentials: {credentials.label}
                                    </span>
                                  )}
                                  {trainingOverdue && (
                                    <span className="font-medium" style={{ color: RED }}>Training overdue</span>
                                  )}
                                  <span>
                                    {participantsFor(worker)} {participantsFor(worker) === 1 ? "participant" : "participants"}
                                  </span>
                                  {notes && notes.tone !== "neutral" && (
                                    <span className="font-medium" style={{ color: toneColor(notes.tone) }}>Notes: {notes.label}</span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Credentials & training */}
                            <div className="hidden min-w-0 lg:block">
                              {credentialsLoading ? (
                                <span className="block h-3 w-24 animate-pulse rounded-full" style={{ background: SOFT }} />
                              ) : credentials ? (
                                <p className="truncate text-sm font-medium" style={{ color: toneColor(credentials.tone) }}>
                                  {credentials.label}
                                </p>
                              ) : (
                                <p className="text-sm" style={{ color: MUTED }}>None on file</p>
                              )}
                              {trainingOverdue && (
                                <p className="mt-0.5 text-xs font-medium" style={{ color: RED }}>
                                  {extra?.induction_overdue ? "Induction overdue" : "Training overdue"}
                                </p>
                              )}
                            </div>

                            {/* Participants */}
                            <p className="hidden text-sm tabular-nums lg:block" style={{ color: TEXT }}>
                              {participantsFor(worker)}
                            </p>

                            {/* This week */}
                            <p className="hidden text-sm tabular-nums xl:block" style={{ color: TEXT }}>
                              {extra ? extra.sessions_this_week : <span style={{ color: MUTED }}>N/A</span>}
                              {extra && (
                                <span style={{ color: MUTED }}> {extra.sessions_this_week === 1 ? "session" : "sessions"}</span>
                              )}
                            </p>

                            {/* Notes */}
                            <p
                              className="hidden truncate text-sm xl:block"
                              style={{ color: notes ? toneColor(notes.tone) : MUTED, fontWeight: notes && notes.tone !== "neutral" ? 500 : 400 }}
                            >
                              {notes ? notes.label : "N/A"}
                            </p>

                            {/* Compliance */}
                            <div className="hidden lg:block">
                              {scored ? (
                                <>
                                  <p className="text-sm font-semibold tabular-nums" style={{ color: scoreColor }}>
                                    {worker.compliance_score}%
                                  </p>
                                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: SOFT }}>
                                    <div
                                      className="h-full rounded-full"
                                      style={{ width: `${Math.min(worker.compliance_score, 100)}%`, background: scoreColor }}
                                    />
                                  </div>
                                </>
                              ) : (
                                <p className="text-sm" style={{ color: MUTED }}>Not scored</p>
                              )}
                            </div>

                            {/* Status + last active */}
                            <div className="hidden min-w-0 lg:block">
                              <p className="flex items-center gap-2 text-sm font-medium" style={{ color: scored ? scoreColor : MUTED }}>
                                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={statusDot} />
                                <span className="truncate">{getScoreLabel(worker.compliance_score, translate)}</span>
                              </p>
                              <p className="mt-0.5 truncate pl-4 text-xs" style={{ color: MUTED }}>
                                {worker.last_login ? `Active ${formatLastActive(worker.last_login)}` : "Never signed in"}
                              </p>
                            </div>

                            <ChevronRight
                              size={18}
                              className="shrink-0 justify-self-end transition group-hover:translate-x-0.5"
                              style={{ color: MUTED }}
                            />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </section>

            {/* =====================================================
                HOW THE TEAM IS TRACKING + HIRING: open sections on the
                page, split by a rule rather than boxed in cards.
            ===================================================== */}

            <div className="grid gap-10 border-t pt-8 lg:grid-cols-2" style={{ borderColor: BORDER }}>
              <section>
                <h2 className="flex items-center gap-1.5 text-lg font-semibold" style={{ color: TEXT }}>
                  How the team is tracking
                  <SectionInfo text="How compliance scores are spread across your team, from strong performers to staff who need support. Staff with no sessions yet aren't counted." />
                </h2>

                <div className="mt-4 flex h-2.5 overflow-hidden rounded-full" style={{ background: SOFT }}>
                  {distribution.strong > 0 && <div style={{ flex: distribution.strong, background: GREEN }} />}
                  {distribution.onTrack > 0 && <div style={{ flex: distribution.onTrack, background: INFO }} />}
                  {distribution.attention > 0 && <div style={{ flex: distribution.attention, background: AMBER }} />}
                  {distribution.risk > 0 && <div style={{ flex: distribution.risk, background: RED }} />}
                </div>

                <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm" style={{ color: TEXT }}>
                  {[
                    { label: "strong", count: distribution.strong, color: GREEN },
                    { label: "on track", count: distribution.onTrack, color: INFO },
                    { label: "need attention", count: distribution.attention, color: AMBER },
                    { label: "at risk", count: distribution.risk, color: RED },
                  ].map((item) => (
                    <li key={item.label} className="flex items-center gap-2">
                      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                      <span className="font-semibold tabular-nums">{item.count}</span>
                      <span style={{ color: MUTED }}>{item.label}</span>
                    </li>
                  ))}
                </ul>

                {stats.atRisk.length > 0 && (
                  <button
                    type="button"
                    onClick={() => showDirectory("at_risk")}
                    className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline-offset-4 hover:underline"
                    style={{ color: PLUM }}
                  >
                    See who needs a hand
                    <ArrowRight size={14} />
                  </button>
                )}
              </section>

              <section>
                <h2 className="text-lg font-semibold" style={{ color: TEXT }}>
                  Hiring
                </h2>

                {pipelineActive && pipeline ? (
                  <ul className="mt-4 space-y-2 text-sm" style={{ color: TEXT }}>
                    <li>
                      <span className="font-semibold tabular-nums">{pipeline.kpis.in_pipeline}</span>{" "}
                      <span style={{ color: MUTED }}>
                        {pipeline.kpis.in_pipeline === 1 ? "candidate" : "candidates"} in the pipeline
                      </span>
                    </li>
                    <li>
                      <span
                        className="font-semibold tabular-nums"
                        style={{ color: pipeline.kpis.credentials_overdue > 0 ? AMBER : TEXT }}
                      >
                        {pipeline.kpis.credentials_overdue}
                      </span>{" "}
                      <span style={{ color: MUTED }}>
                        {pipeline.kpis.credentials_overdue === 1 ? "credential" : "credentials"} overdue
                      </span>
                    </li>
                    <li>
                      <span className="font-semibold tabular-nums">{pipeline.kpis.starting_this_week}</span>{" "}
                      <span style={{ color: MUTED }}>starting this week</span>
                    </li>
                  </ul>
                ) : (
                  <p className="mt-4 max-w-md text-sm" style={{ color: MUTED }}>
                    No one is in recruitment right now. Candidates and onboarding
                    tasks will show here as your team grows.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => navigate("/md/staff-onboarding")}
                  className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline-offset-4 hover:underline"
                  style={{ color: PLUM }}
                >
                  Open hiring pipeline
                  <ArrowRight size={14} />
                </button>
              </section>
            </div>
          </>
        )}

        {/* =========================================================
            WORKER DETAIL DRAWER
        ========================================================= */}

        <Sheet
          open={!!selectedWorker}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedWorker(null);
              setWorkerFullScreen(true);
              setDeactivateTarget(null);
            }
          }}
        >
          <SheetContent
            side="right"
            className={`w-full overflow-y-auto p-3 pt-10 sm:p-6 ${workerFullScreen ? "sm:max-w-full" : "sm:max-w-4xl"}`}
            style={{ background: "var(--cc-bg)" }}
          >
            <SheetHeader className="sr-only">
              <SheetTitle>
                {selectedWorker
                  ? `${selectedWorker.full_name} · staff profile`
                  : "Staff profile"}
              </SheetTitle>
            </SheetHeader>
            {selectedWorker && deactivateTarget && (
              <DeactivateWorkerPanel
                workerName={deactivateTarget.full_name}
                pending={accountActionPending === "deactivate"}
                onCancel={() => setDeactivateTarget(null)}
                onConfirm={confirmDeactivate}
              />
            )}
            {selectedWorker &&
              !deactivateTarget &&
              (selectedWorkerStats ? (
                <WorkerDetail
                  worker={selectedWorkerStats}
                  initialTab={detailInitialTab}
                  onBack={() => setSelectedWorker(null)}
                  onSendPasswordReset={() =>
                    handleSendPasswordReset(selectedWorker)
                  }
                  onDeactivate={() => handleDeactivate(selectedWorker)}
                  onDeleteAccount={() => handleDeleteAccount(selectedWorker)}
                  fullScreen={workerFullScreen}
                  onToggleFullScreen={() => setWorkerFullScreen((v) => !v)}
                />
              ) : !detailsLoading ? (
                <div role="status" className="space-y-3 py-6">
                  <h2 className="text-lg font-semibold">
                    {selectedWorker.full_name}
                  </h2>
                  <p className="text-sm text-cc-muted">
                    {detailsError
                      ? "Staff details could not be loaded."
                      : "A detailed staff record is not available for this account."}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => void workerStatsQuery.refetch()}
                  >
                    Retry staff details
                  </Button>
                </div>
              ) : (
                <div
                  aria-label="Loading staff details"
                  className="space-y-4 pt-2"
                >
                  <div
                    className="h-16 animate-pulse rounded-2xl"
                    style={{ background: SOFT }}
                  />
                  <div
                    className="h-40 animate-pulse rounded-2xl"
                    style={{ background: SOFT }}
                  />
                  <div
                    className="h-40 animate-pulse rounded-2xl"
                    style={{ background: SOFT }}
                  />
                </div>
              ))}
          </SheetContent>
        </Sheet>
      </div>
    </HubLayout>
  );
}
