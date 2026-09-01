import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  Mail, UserPlus, Users, ShieldCheck, AlertTriangle, Clock,
  UserCheck, UserX, Loader2, ChevronRight, Link2, MoreHorizontal,
  Search, LayoutList, LayoutGrid, GraduationCap, Sparkles, ShieldAlert,
  Settings2, Trash2, Columns3, ArrowUp, ArrowDown, ArrowUpDown,
} from "lucide-react";
import { useGetParticipants } from "@workspace/api-client-react";
import {
  getCoordinatorWorkerStats,
  deactivateWorker, activateWorker,
  assignWorkerToClient,
  getCoordinatorCredentialAlerts, sendBulkReminders,
  getTeamCredentials, getPendingTrainingCompletions,
  createShiftCredentialRequirement, deleteShiftCredentialRequirement, listShiftCredentialRequirements,
  type WorkerStats, type ShiftCredentialRequirement, type DeactivationReason,
} from "@/services/coordinatorService";
import { getTeamOnboarding } from "@/services/onboardingService";
import { useToast } from "@/hooks/use-toast";
import { ShiftAssignmentModal } from "@/components/coordinator/ShiftAssignmentModal";
import { WorkerDetail, isWorkerCredentialsComplete } from "@/components/team/WorkerDetail";
import { DeactivateWorkerPanel } from "@/components/team/DeactivateWorkerPanel";
import { IndexTemplate, IndexHeader } from "@/components/layout/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuCheckboxItem, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { jsonFetch } from "@/services/http";
import { safeFormat } from "@/lib/participant-format";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useReAuth } from "@/hooks/useReAuth";

const PLUM  = "var(--cc-plum)";
const TEXT  = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT  = "var(--cc-soft)";
const SURFACE = "var(--cc-surface)";
const CARD_SHADOW = "var(--cc-card-shadow)";

const PAGE_SIZE = 10;

function complianceColour(score: number | null | undefined): string {
  if (score == null) return MUTED;
  if (score >= 85) return "var(--cc-status-success)";
  if (score >= 60) return "var(--cc-status-warning)";
  return "var(--cc-status-danger)";
}

function roleLabel(role?: string) {
  return (role || "member").replace(/_/g, " ");
}

type ViewMode = "list" | "cards";

/** Columns beyond the structural core (checkbox/name/status/actions) — toggleable so the table
 * can flex to what a coordinator actually wants to scan, instead of a fixed set of hidden-by-
 * breakpoint columns nobody can opt back into on a wide screen. */
type ColumnKey = "email" | "joined" | "sessions" | "readiness";
const ALL_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "joined", label: "Joined" },
  { key: "sessions", label: "Sessions" },
  { key: "readiness", label: "Readiness" },
];

type SortKey = "name" | "joined" | "sessions" | "compliance";
/** Active/Inactive is inherently exclusive (a worker is one or the other) so it stays a
 * single-select segmented control. Attention flags are independent axes — a worker can be
 * both training-overdue AND credentials-incomplete — so those are a combinable (OR'd) set,
 * and both narrow the same underlying list together with search. */
type ActiveFilter = "all" | "active" | "inactive";
type AttentionFilter = "newly_onboarded" | "onboarding_pending" | "credentials_incomplete" | "training_overdue";

const NEWLY_ONBOARDED_WINDOW_DAYS = 30;

const CREDENTIAL_TYPE_LABELS: Record<string, string> = {
  ndis_screening: "NDIS Worker Screening",
  wwcc: "Working with Children Check (WWCC)",
  code_of_conduct: "Code of Conduct acknowledgement",
  first_aid: "First Aid",
  cpr: "CPR",
  manual_handling: "Manual handling",
  infection_control: "Infection control",
  medication_admin: "Medication administration",
  drivers_licence: "Driver Licence",
  vehicle_registration: "Vehicle registration",
  vehicle_insurance: "Vehicle insurance (comprehensive)",
  qualification: "Qualification",
};

function credentialTypeLabel(type: string): string {
  return CREDENTIAL_TYPE_LABELS[type] ?? type;
}

const WORKER_CREDENTIAL_TYPES = [
  "ndis_screening", "wwcc", "code_of_conduct", "Police Check", "first_aid", "cpr",
  "manual_handling", "infection_control", "medication_admin", "drivers_licence",
  "vehicle_registration", "vehicle_insurance", "qualification", "Other",
];

const ALLIED_CREDENTIAL_TYPES = [
  "AHPRA Registration", "Professional Indemnity Insurance", "Police Check",
  "First Aid/CPR", "Discipline-specific Certificate", "Other",
];

const SHIFT_TYPES = ["standard_support", "community_access", "allied_health", "respite_care"];

const INVITE_ROLE_KEYS: Record<string, string> = {
  support_worker: "team.invite.role.supportWorker",
  support_coordinator: "team.invite.role.coordinator",
};

type PendingInvite = {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

export default function Team() {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { requireReAuth, modal: reauthModal } = useReAuth();
  const [, navigate] = useLocation();

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [attentionFilters, setAttentionFilters] = useState<Set<AttentionFilter>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(
    new Set(["email", "joined", "sessions", "readiness"]),
  );
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("support_worker");
  const [inviteSending, setInviteSending] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<WorkerStats | null>(null);
  const [assignWorker, setAssignWorker] = useState<WorkerStats | null>(null);
  const [assignPatientId, setAssignPatientId] = useState("");
  const [shiftWorker, setShiftWorker] = useState<WorkerStats | null>(null);
  const [detailWorkerId, setDetailWorkerId] = useState<string | null>(null);
  const [detailInitialTab, setDetailInitialTab] = useState<"overview" | "documents" | "credentials" | "availability" | "training" | undefined>(undefined);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ruleShiftType, setRuleShiftType] = useState<string>(SHIFT_TYPES[0]);
  const [ruleCredentialType, setRuleCredentialType] = useState<string>(WORKER_CREDENTIAL_TYPES[0]);

  // Deep link from /credentials ("Review in Team"): ?workerId=<id>&tab=credentials.
  // One-shot: consumed into state then stripped from the URL immediately, so it can't
  // become a "sticky" link that reopens this same worker on every future refresh.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const workerId = params.get("workerId");
    if (!workerId) return;
    setDetailWorkerId(workerId);
    const tab = params.get("tab");
    if (tab === "credentials" || tab === "documents" || tab === "availability" || tab === "training") {
      setDetailInitialTab(tab);
    }
    window.history.replaceState(null, "", "/team");
  }, []);

  const { user } = useAuth();

  const orgId = user?.organizationId ?? "__no_org__";

  const stats = useOrgQuery(["coordinator", "worker-stats"], {
    queryFn: getCoordinatorWorkerStats,
  });

  const credentialAlerts = useOrgQuery(["coordinator-credential-alerts"], {
    queryFn: getCoordinatorCredentialAlerts,
  });

  const shiftRules = useOrgQuery(["coordinator", "shift-credential-requirements"], {
    queryFn: () => listShiftCredentialRequirements(),
    enabled: rulesOpen,
  });

  const teamCredentials = useOrgQuery(["team-credentials"], {
    queryFn: getTeamCredentials,
  });

  const teamOnboarding = useOrgQuery(["team-onboarding"], {
    queryFn: getTeamOnboarding,
  });

  const pendingInvites = useOrgQuery<PendingInvite[]>(["pending-invites"], {
    queryFn: () => jsonFetch<PendingInvite[]>("/api/invitations/list"),
    enabled: inviteOpen,
  });

  const revokeInviteMut = useMutation({
    mutationFn: (inviteId: string) => jsonFetch(`/api/invitations/revoke/${inviteId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [orgId, "pending-invites"] }),
    onError: () => toast({ title: translate("team.toast.inviteRevokeFailed"), variant: "destructive" }),
  });

  const pendingTraining = useOrgQuery(["pending-training-completions"], {
    queryFn: getPendingTrainingCompletions,
  });

  const participants = useGetParticipants();

  const deactivateMut = useMutation({
    mutationFn: ({ id, reason, note }: { id: string; reason: DeactivationReason; note: string }) =>
      deactivateWorker(id, reason, note),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [orgId, "coordinator"] }); toast({ title: translate("team.toast.deactivated") }); setDeactivateTarget(null); },
    onError: () => toast({ title: translate("team.toast.deactivateFailed"), variant: "destructive" }),
  });

  const activateMut = useMutation({
    mutationFn: (id: string) => activateWorker(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [orgId, "coordinator"] }); toast({ title: translate("team.toast.reactivated") }); },
    onError: () => toast({ title: translate("team.toast.reactivateFailed"), variant: "destructive" }),
  });

  const assignMut = useMutation({
    mutationFn: ({ workerId, patientId }: { workerId: string; patientId: string }) =>
      assignWorkerToClient(workerId, patientId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [orgId, "coordinator"] }); toast({ title: translate("team.toast.assigned") }); setAssignWorker(null); setAssignPatientId(""); },
    onError: () => toast({ title: translate("team.toast.assignFailed"), variant: "destructive" }),
  });

  const createRuleMut = useMutation({
    mutationFn: () => createShiftCredentialRequirement({
      shift_type: ruleShiftType,
      required_credential_type: ruleCredentialType,
      minimum_status: "valid",
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [orgId, "coordinator", "shift-credential-requirements"] });
      toast({ title: "Shift credential rule added" });
    },
    onError: (err) => toast({ title: "Could not add rule", description: (err as Error).message, variant: "destructive" }),
  });

  const deleteRuleMut = useMutation({
    mutationFn: (rule: ShiftCredentialRequirement) => deleteShiftCredentialRequirement(rule.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [orgId, "coordinator", "shift-credential-requirements"] });
      toast({ title: "Shift credential rule removed" });
    },
    onError: (err) => toast({ title: "Could not remove rule", description: (err as Error).message, variant: "destructive" }),
  });

  const reminderMut = useMutation({
    mutationFn: (workerIds: string[]) => sendBulkReminders(workerIds, translate("team.reminderMessage")),
    onSuccess: (_, workerIds) => {
      qc.invalidateQueries({ queryKey: [orgId, "coordinator-credential-alerts"] });
      toast({
        title: translate("team.toast.reminderSent"),
        description: workerIds.length === 1
          ? translateParams("team.toast.reminderSentDesc", { workerId: workerIds[0] })
          : translateParams("team.toast.reminderSentBulkDesc", { count: String(workerIds.length) }),
      });
      setSelectedIds(new Set());
    },
    onError: () => toast({ title: translate("team.toast.reminderFailed"), variant: "destructive" }),
  });

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteSending(true);
    try {
      const result = await requireReAuth(() =>
        jsonFetch<{
          email: string;
          short_code?: string;
          email_delivery?: { status?: string };
        }>("/api/invitations/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
        }),
      );
      if (!result) return;
      const codeHint = result.short_code
        ? ` Mobile code: ${result.short_code}.`
        : "";
      toast({
        title: translate("team.toast.inviteSent"),
        description:
          translateParams("team.toast.inviteSentDesc", {
            email: inviteEmail,
            role: translate(INVITE_ROLE_KEYS[inviteRole] ?? inviteRole),
          }) + codeHint,
      });
      setInviteEmail("");
      qc.invalidateQueries({ queryKey: [orgId, "pending-invites"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast({
        title: translate("team.toast.inviteFailed"),
        description: msg || translate("team.toast.inviteFailedDesc"),
        variant: "destructive",
      });
    } finally {
      setInviteSending(false);
    }
  };

  const workers = stats.data ?? [];
  const allParticipants = (participants.data as Array<{ id: string; full_name: string }> | undefined) ?? [];
  const alertRows = credentialAlerts.data?.alerts ?? [];
  const detailWorker = detailWorkerId ? workers.find((w) => w.id === detailWorkerId) ?? null : null;

  function getCredentialSummary(workerId: string) {
    const workerAlerts = alertRows.filter((alert) => alert.user_id === workerId);
    const expired = workerAlerts.filter((alert) => alert.status === "expired").length;
    const expiring = workerAlerts.filter((alert) => alert.status === "expiring").length;
    return { workerAlerts, expired, expiring };
  }

  const onboardingById = new Map(
    (teamOnboarding.data ?? []).map((row) => [String(row.id), Boolean(row.onboarding_completed)])
  );
  const credentials = teamCredentials.data ?? [];

  function isWorkerVerified(workerId: string): boolean {
    const onboardingDone = onboardingById.get(workerId) ?? true; // don't penalize if data hasn't loaded
    return onboardingDone && isWorkerCredentialsComplete(credentials, workerId);
  }

  // Pure credentials check, deliberately not conflated with onboarding status — the Readiness
  // column and the "Credentials incomplete" filter both need to name credentials specifically,
  // distinct from "Onboarding pending", so the two reasons never overlap by construction.
  function hasIncompleteCredentials(workerId: string): boolean {
    return !isWorkerCredentialsComplete(credentials, workerId);
  }

  // Single indicator + single named reason, mirroring the profile page's readiness ring —
  // never two signals fighting for attention in the same cell. Priority when more than one
  // attention category applies: training overdue (blocks rostering outright) outranks
  // onboarding pending, which outranks credentials incomplete.
  function workerReadiness(w: WorkerStats): { level: "success" | "warning" | "danger"; label: string } {
    let reason: string | null = null;
    let reasonLevel: "warning" | "danger" | null = null;
    if (w.training_overdue) {
      reason = "Training overdue";
      reasonLevel = "danger";
    } else if (w.onboarding_completed === false) {
      reason = "Onboarding pending";
      reasonLevel = "warning";
    } else if (hasIncompleteCredentials(w.id)) {
      reason = "Credentials incomplete";
      reasonLevel = "warning";
    }

    const hasScore = w.avg_compliance != null && w.total_sessions > 0;
    if (hasScore) {
      const pct = Math.round(w.avg_compliance!);
      const level = reasonLevel ?? (pct >= 85 ? "success" : pct >= 60 ? "warning" : "danger");
      return { level, label: reason ? `${pct}% · ${reason}` : `${pct}%` };
    }

    if (reason) return { level: reasonLevel!, label: reason };
    return { level: "success", label: "On track" };
  }

  function isNewlyOnboarded(w: WorkerStats): boolean {
    if (!w.joined_at) return false;
    const days = (Date.now() - new Date(w.joined_at).getTime()) / 86_400_000;
    return days >= 0 && days <= NEWLY_ONBOARDED_WINDOW_DAYS;
  }

  function matchesActiveFilter(w: WorkerStats, filter: ActiveFilter): boolean {
    switch (filter) {
      case "all": return true;
      case "active": return w.is_active !== false;
      case "inactive": return w.is_active === false;
      default: return true;
    }
  }

  function checkAttentionFilter(w: WorkerStats, filter: AttentionFilter): boolean {
    switch (filter) {
      case "newly_onboarded": return isNewlyOnboarded(w);
      case "onboarding_pending": return w.onboarding_completed === false;
      case "credentials_incomplete": return hasIncompleteCredentials(w.id);
      case "training_overdue": return !!w.training_overdue;
      default: return false;
    }
  }

  // A worker matches if they trip ANY selected attention flag — coordinators are triaging
  // "who has a problem", not looking for the intersection of every flag at once.
  function matchesAttentionFilters(w: WorkerStats, filters: Set<AttentionFilter>): boolean {
    if (filters.size === 0) return true;
    for (const f of filters) if (checkAttentionFilter(w, f)) return true;
    return false;
  }

  function toggleAttentionFilter(filter: AttentionFilter) {
    setAttentionFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) next.delete(filter); else next.add(filter);
      return next;
    });
    setPage(1);
  }

  const filterCounts = useMemo(() => ({
    all: workers.length,
    active: workers.filter((w) => w.is_active !== false).length,
    inactive: workers.filter((w) => w.is_active === false).length,
    newly_onboarded: workers.filter(isNewlyOnboarded).length,
    onboarding_pending: workers.filter((w) => w.onboarding_completed === false).length,
    credentials_incomplete: workers.filter((w) => hasIncompleteCredentials(w.id)).length,
    training_overdue: workers.filter((w) => !!w.training_overdue).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [workers, teamOnboarding.data, teamCredentials.data]);

  function toggleColumn(key: ColumnKey) {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function sortValue(w: WorkerStats, key: SortKey): string | number {
    switch (key) {
      case "name": return (w.full_name || "").toLowerCase();
      case "joined": return w.joined_at ? new Date(w.joined_at).getTime() : 0;
      case "sessions": return w.total_sessions ?? 0;
      case "compliance": return w.avg_compliance ?? -1;
      default: return 0;
    }
  }

  const filteredWorkers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = workers.filter((w) => {
      const matchesSearch = !q
        || w.full_name?.toLowerCase().includes(q)
        || w.email?.toLowerCase().includes(q)
        || (w.employee_id ?? "").toLowerCase().includes(q);
      return matchesSearch && matchesActiveFilter(w, activeFilter) && matchesAttentionFilters(w, attentionFilters);
    });
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      return [...matched].sort((a, b) => {
        const av = sortValue(a, sortKey);
        const bv = sortValue(b, sortKey);
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    }
    return [...matched].sort((a, b) => Number(isWorkerVerified(a.id)) - Number(isWorkerVerified(b.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workers, search, activeFilter, attentionFilters, sortKey, sortDir, teamOnboarding.data, teamCredentials.data]);

  const totalPages = Math.max(1, Math.ceil(filteredWorkers.length / PAGE_SIZE));
  const pageWorkers = filteredWorkers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageAttentionWorkers = pageWorkers.filter((w) => !isWorkerVerified(w.id));
  const pageVerifiedWorkers = pageWorkers.filter((w) => isWorkerVerified(w.id));
  const pendingTrainingCount = pendingTraining.data?.length ?? 0;

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    setSelectedIds((prev) => {
      const allSelected = pageWorkers.every((w) => prev.has(w.id));
      const next = new Set(prev);
      pageWorkers.forEach((w) => (allSelected ? next.delete(w.id) : next.add(w.id)));
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedIds(new Set(filteredWorkers.map((w) => w.id)));
  }

  const allPageSelected = pageWorkers.length > 0 && pageWorkers.every((w) => selectedIds.has(w.id));
  const allFilteredSelected = filteredWorkers.length > 0 && filteredWorkers.every((w) => selectedIds.has(w.id));

  return (
    <IndexTemplate>
      {detailWorker ? (
        <>
          <IndexHeader title={translate("team.title")} />
          <WorkerDetail
            worker={detailWorker}
            onBack={() => {
              setDetailWorkerId(null);
              setDetailInitialTab(undefined);
              // Clear ?workerId= so it isn't a "sticky" deep link that reopens this
              // worker on every future refresh of /team.
              navigate("/team");
            }}
            initialTab={detailInitialTab}
            onAssignShift={() => setShiftWorker(detailWorker)}
            onAssignClient={() => { setAssignWorker(detailWorker); setAssignPatientId(""); }}
            onReminder={() => reminderMut.mutate([detailWorker.id])}
            onDeactivate={() => setDeactivateTarget(detailWorker)}
            onActivate={() => activateMut.mutate(detailWorker.id)}
          />
        </>
      ) : (
      <>
      {/* Header */}
      <IndexHeader
        title={translate("team.title")}
        count={workers.length}
        info="Your support workers: compliance, credentials, availability, and shift history, all in one place."
        primaryAction={
          <Button
            variant="navy"
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black"
          >
            <UserPlus size={16} /> {translate("team.inviteWorker")}
          </Button>
        }
      />

      {stats.isLoading && (
        <div className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
          <Loader2 className="h-4 w-4 animate-spin" /> {translate("team.loadingStats")}
        </div>
      )}
      {stats.error && <p className="text-sm text-red-600">{translate("team.loadStatsFailed")}</p>}

      {pendingTrainingCount > 0 && (
        <div
          className="flex items-center gap-3 rounded-2xl px-4 py-3"
          style={{ background: "var(--cc-status-info-bg)", border: `1px solid var(--cc-border)` }}
        >
          <span className="flex items-center justify-center h-9 w-9 rounded-full shrink-0" style={{ background: "var(--cc-status-info-bg)", color: "var(--cc-status-info)" }}>
            <GraduationCap size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black" style={{ color: TEXT }}>
              {translateParams(pendingTrainingCount === 1 ? "team.training.pendingReview" : "team.training.pendingReviewPlural", { count: String(pendingTrainingCount) })}
            </p>
            <p className="text-xs" style={{ color: MUTED }}>{translate("team.training.pendingReviewHint")}</p>
          </div>
          <Sparkles size={14} style={{ color: "var(--cc-status-info)" }} />
        </div>
      )}

      {!stats.isLoading && workers.length === 0 && (
        <div className="rounded-2xl p-10 text-center" style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
          <Users size={32} className="mx-auto mb-3" style={{ color: MUTED }} />
          <p className="text-sm font-bold" style={{ color: MUTED }}>{translate("team.empty.overview")}</p>
        </div>
      )}

      {!stats.isLoading && workers.length > 0 && (
        <>
          {/* Toolbar: search + view toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder={translate("team.search.placeholder")}
                className="pl-9 rounded-xl"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Status — mutually exclusive, low cardinality: a segmented control reads as one choice, not a scrolling list */}
              <div className="flex rounded-xl p-1 gap-0.5" style={{ background: SOFT }}>
                {([
                  ["all", translate("team.filter.status.all")],
                  ["active", translate("team.status.active")],
                  ["inactive", translate("team.status.inactive")],
                ] as [ActiveFilter, string][]).map(([value, label]) => {
                  const active = activeFilter === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => { setActiveFilter(value); setPage(1); }}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors"
                      style={{ background: active ? "var(--cc-bg)" : "transparent", color: active ? PLUM : MUTED, boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06)" : "none" }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {/* Filtering (status) vs. display settings (view/columns/rules) are different
                  kinds of controls, so they get a visual break instead of sitting in one
                  undivided row where they read as a single group. */}
              <div className="h-6 w-px shrink-0" style={{ background: BORDER }} aria-hidden="true" />
              <div className="flex rounded-xl p-1 gap-1" style={{ background: SOFT }}>
                <button
                  onClick={() => setViewMode("list")}
                  className="rounded-lg p-2 transition-colors"
                  style={{ background: viewMode === "list" ? "var(--cc-bg)" : "transparent", color: viewMode === "list" ? PLUM : MUTED }}
                  title={translate("team.view.list")}
                  aria-label={translate("team.view.list")}
                >
                  <LayoutList size={16} />
                </button>
                <button
                  onClick={() => setViewMode("cards")}
                  className="rounded-lg p-2 transition-colors"
                  style={{ background: viewMode === "cards" ? "var(--cc-bg)" : "transparent", color: viewMode === "cards" ? PLUM : MUTED }}
                  title={translate("team.view.cards")}
                  aria-label={translate("team.view.cards")}
                >
                  <LayoutGrid size={16} />
                </button>
              </div>
              {viewMode === "list" && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5 rounded-xl text-xs" title="Show or hide columns">
                      <Columns3 size={14} /> Columns
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">Show columns</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {ALL_COLUMNS.map((col) => (
                      <DropdownMenuCheckboxItem
                        key={col.key}
                        checked={visibleColumns.has(col.key)}
                        onCheckedChange={() => toggleColumn(col.key)}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {col.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRulesOpen(true)}
                className="gap-1.5 rounded-xl text-xs"
                title="Configure required credentials per shift type"
              >
                <Settings2 size={14} /> Rules
              </Button>
            </div>
          </div>

          {/* Attention filters — independently combinable (OR'd together): a coordinator can
              stack "Credentials incomplete" + "Training overdue" to triage everyone with either
              problem at once, not just one axis at a time. Each chip's count/colour is also the
              at-a-glance alert, so no separate summary banner is needed. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-wider mr-0.5" style={{ color: MUTED }}>Needs attention</span>
            {([
              ["newly_onboarded", "Newly onboarded", GraduationCap],
              ["onboarding_pending", "Onboarding pending", Clock],
              ["credentials_incomplete", "Credentials incomplete", ShieldAlert],
              ["training_overdue", "Training overdue", AlertTriangle],
            ] as [AttentionFilter, string, typeof GraduationCap][]).map(([value, label, Icon]) => {
              const active = attentionFilters.has(value);
              const count = filterCounts[value];
              const flagged = count > 0;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleAttentionFilter(value)}
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold whitespace-nowrap transition-colors"
                  style={{
                    borderColor: active ? PLUM : flagged ? "var(--cc-status-warning)" : BORDER,
                    background: active ? PLUM : flagged ? "var(--cc-status-warning-bg)" : "var(--cc-bg)",
                    color: active ? "#fff" : flagged ? "var(--cc-status-warning)" : MUTED,
                  }}
                >
                  <Icon size={12} />
                  {label}
                  <span
                    className="inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] rounded-full px-1 text-[10px] font-black"
                    style={{
                      background: active ? "rgba(255,255,255,0.25)" : flagged ? "rgba(0,0,0,0.08)" : SOFT,
                      color: "inherit",
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
            {attentionFilters.size > 0 && (
              <button
                type="button"
                onClick={() => { setAttentionFilters(new Set()); setPage(1); }}
                className="text-[11px] font-bold underline ml-1"
                style={{ color: MUTED }}
              >
                Clear
              </button>
            )}
          </div>

          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ background: "var(--cc-status-info-bg)" }}>
              <div className="flex items-center justify-between px-4 py-2.5">
                <p className="text-[12px] font-bold" style={{ color: "var(--cc-status-info)" }}>
                  {translateParams("team.bulk.selectedCount", { count: String(selectedIds.size) })}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5"
                    onClick={() => reminderMut.mutate(Array.from(selectedIds))}
                    disabled={reminderMut.isPending}
                  >
                    <Mail size={12} /> {translate("team.bulk.sendReminder")}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelectedIds(new Set())}>
                    {translate("team.bulk.clearSelection")}
                  </Button>
                </div>
              </div>
              {/* Gmail-style "select all N matching" — only surfaces when the page is fully
                  selected but more matching workers exist beyond it, so bulk actions (like
                  reminders) can reach everyone the current filters turned up, not just page 1. */}
              {allPageSelected && !allFilteredSelected && filteredWorkers.length > pageWorkers.length && (
                <div className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold" style={{ background: "rgba(0,0,0,0.03)", color: "var(--cc-status-info)" }}>
                  All {pageWorkers.length} on this page are selected.
                  <button type="button" className="underline" onClick={selectAllFiltered}>
                    Select all {filteredWorkers.length} matching workers
                  </button>
                </div>
              )}
            </div>
          )}

          {/* LIST VIEW */}
          {viewMode === "list" && (
            <div className="rounded-xl border overflow-x-auto" style={{ borderColor: BORDER, background: SURFACE }}>
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: `2px solid ${BORDER}`, background: SOFT }}>
                    <th className="px-4 py-3.5 w-10">
                      <Checkbox
                        checked={pageWorkers.length > 0 && pageWorkers.every((w) => selectedIds.has(w.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        aria-label={translate("team.selectAll")}
                      />
                    </th>
                    <Th label={translate("team.col.name")} sortKey="name" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    {visibleColumns.has("email") && (
                      <Th label={translate("team.col.email")} className="hidden md:table-cell" />
                    )}
                    {visibleColumns.has("joined") && (
                      <Th label="Joined" sortKey="joined" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="hidden sm:table-cell" />
                    )}
                    {visibleColumns.has("sessions") && (
                      <Th label="Sessions" sortKey="sessions" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="hidden md:table-cell" />
                    )}
                    {visibleColumns.has("readiness") && (
                      <Th label="Readiness" sortKey="compliance" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    )}
                    <Th label={translate("team.col.status")} align="center" />
                    <th className="px-3 py-3.5 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: BORDER }}>
                  {/* Flat, in whatever order the coordinator sorted/filtered — the old
                      "Needs Attention" / "Verified" section split re-grouped rows underneath
                      any column sort, silently undoing it. The attention pills above already
                      do the "show me who's flagged" job; this table just respects the sort. */}
                  {pageWorkers.map((w) => (
                    <WorkerRow
                      key={w.id}
                      worker={w}
                      verified={isWorkerVerified(w.id)}
                      summary={getCredentialSummary(w.id)}
                      readiness={workerReadiness(w)}
                      translate={translate}
                      translateParams={translateParams}
                      visibleColumns={visibleColumns}
                      selected={selectedIds.has(w.id)}
                      onToggleSelected={() => toggleSelected(w.id)}
                      onOpenDetail={() => setDetailWorkerId(w.id)}
                      onAssignClient={() => { setAssignWorker(w); setAssignPatientId(""); }}
                      onAssignShift={() => setShiftWorker(w)}
                      onReminder={() => reminderMut.mutate([w.id])}
                      onDeactivate={() => setDeactivateTarget(w)}
                      onActivate={() => activateMut.mutate(w.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* CARDS VIEW */}
          {viewMode === "cards" && (
            <div className="space-y-5">
              {pageAttentionWorkers.length > 0 && (
                <div>
                  <SectionHeaderInline icon={ShieldAlert} tone="warning" label={translateParams("team.section.needsAttention", { count: String(pageAttentionWorkers.length) })} />
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
                    {pageAttentionWorkers.map((w) => (
                      <WorkerCard
                        key={w.id}
                        worker={w}
                        verified={false}
                        summary={getCredentialSummary(w.id)}
                        translate={translate}
                        translateParams={translateParams}
                        onOpenDetail={() => setDetailWorkerId(w.id)}
                        onAssignClient={() => { setAssignWorker(w); setAssignPatientId(""); }}
                        onAssignShift={() => setShiftWorker(w)}
                        onReminder={() => reminderMut.mutate([w.id])}
                        onDeactivate={() => setDeactivateTarget(w)}
                        onActivate={() => activateMut.mutate(w.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {pageVerifiedWorkers.length > 0 && (
                <div>
                  <SectionHeaderInline icon={ShieldCheck} tone="success" label={translateParams("team.section.verified", { count: String(pageVerifiedWorkers.length) })} />
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
                    {pageVerifiedWorkers.map((w) => (
                      <WorkerCard
                        key={w.id}
                        worker={w}
                        verified
                        summary={getCredentialSummary(w.id)}
                        translate={translate}
                        translateParams={translateParams}
                        onOpenDetail={() => setDetailWorkerId(w.id)}
                        onAssignClient={() => { setAssignWorker(w); setAssignPatientId(""); }}
                        onAssignShift={() => setShiftWorker(w)}
                        onReminder={() => reminderMut.mutate([w.id])}
                        onDeactivate={() => setDeactivateTarget(w)}
                        onActivate={() => activateMut.mutate(w.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {filteredWorkers.length === 0 && (
            <div className="rounded-2xl p-10 text-center" style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
              <Search size={28} className="mx-auto mb-3" style={{ color: MUTED }} />
              <p className="text-sm font-bold" style={{ color: MUTED }}>{translate("team.empty.filtered")}</p>
            </div>
          )}

          {/* Pagination */}
          {filteredWorkers.length > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                {translate("team.pagination.previous")}
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className="h-8 w-8 rounded-full text-xs font-bold"
                  style={{ background: p === page ? PLUM : "transparent", color: p === page ? "#fff" : MUTED }}
                >
                  {p}
                </button>
              ))}
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                {translate("team.pagination.next")}
              </Button>
            </div>
          )}
        </>
      )}
      </>
      )}

      <Sheet
        open={inviteOpen}
        onOpenChange={(open) => {
          setInviteOpen(open);
          if (!open) {
            setInviteEmail("");
            setInviteRole("support_worker");
          }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" style={{ background: SURFACE }}>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2" style={{ color: TEXT }}>
              <UserPlus size={18} style={{ color: PLUM }} /> {translate("team.invite.title")}
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{translate("team.invite.email")}</label>
              <Input
                type="email"
                placeholder={translate("team.invite.emailPlaceholder")}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && inviteEmail.trim() && !inviteSending) handleInvite();
                }}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{translate("team.invite.role")}</label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="support_worker">{translate("team.invite.role.supportWorker")}</SelectItem>
                  <SelectItem value="support_coordinator">{translate("team.invite.role.coordinator")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t space-y-2" style={{ borderColor: BORDER }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>
              {translate("team.invite.pendingTitle")}
            </p>
            {pendingInvites.isLoading ? (
              <p className="text-xs" style={{ color: MUTED }}>{translate("common.loading")}</p>
            ) : (pendingInvites.data ?? []).filter((inv) => !inv.accepted_at).length === 0 ? (
              <p className="text-xs" style={{ color: MUTED }}>{translate("team.invite.pendingEmpty")}</p>
            ) : (
              <ul className="space-y-1.5">
                {(pendingInvites.data ?? []).filter((inv) => !inv.accepted_at).map((inv) => {
                  const expired = new Date(inv.expires_at).getTime() < Date.now();
                  return (
                    <li
                      key={inv.id}
                      className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2"
                      style={{ borderColor: BORDER, background: SOFT }}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate" style={{ color: TEXT }}>{inv.email}</p>
                        <p className="text-[11px]" style={{ color: expired ? "var(--cc-status-danger)" : MUTED }}>
                          {translate(INVITE_ROLE_KEYS[inv.role] ?? inv.role)}
                          {" · "}
                          {expired ? translate("team.invite.expired") : translate("team.invite.pending")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => revokeInviteMut.mutate(inv.id)}
                        disabled={revokeInviteMut.isPending}
                        className="shrink-0 rounded-full p-1 hover:bg-black/5"
                        title={translate("team.invite.revoke")}
                        aria-label={translate("team.invite.revoke")}
                      >
                        <UserX className="h-3.5 w-3.5" style={{ color: MUTED }} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <SheetFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setInviteOpen(false)}>{translate("common.close")}</Button>
            <Button
              variant="navy"
              onClick={handleInvite}
              disabled={!inviteEmail.trim() || inviteSending}
            >
              {inviteSending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{translate("team.invite.sending")}</> : translate("team.invite.send")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {deactivateTarget && (
        <DeactivateWorkerPanel
          workerName={deactivateTarget.full_name}
          pending={deactivateMut.isPending}
          onCancel={() => setDeactivateTarget(null)}
          onConfirm={(reason, note) => deactivateMut.mutate({ id: deactivateTarget.id, reason, note })}
        />
      )}

      {assignWorker && (
        <section className="rounded-2xl p-5 space-y-4" style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-black" style={{ color: PLUM }}>
              {translateParams("team.assign.title", { name: assignWorker.full_name })}
            </h3>
            <Button variant="outline" size="sm" onClick={() => { setAssignWorker(null); setAssignPatientId(""); }}>{translate("common.close")}</Button>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{translate("team.assign.selectParticipant")}</label>
            <Select value={assignPatientId} onValueChange={setAssignPatientId}>
              <SelectTrigger>
                <SelectValue placeholder={translate("team.assign.chooseParticipant")} />
              </SelectTrigger>
              <SelectContent>
                {allParticipants.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setAssignWorker(null); setAssignPatientId(""); }}>{translate("common.cancel")}</Button>
            <Button
              variant="navy"
              onClick={() => assignPatientId && assignMut.mutate({ workerId: assignWorker.id, patientId: assignPatientId })}
              disabled={!assignPatientId || assignMut.isPending}
            >
              {assignMut.isPending ? translate("team.assign.assigning") : translate("team.assign.assign")}
            </Button>
          </div>
        </section>
      )}

      <ShiftAssignmentModal
        open={!!shiftWorker}
        onOpenChange={(open) => { if (!open) setShiftWorker(null); }}
        workers={shiftWorker ? [shiftWorker] : []}
      />

      <Sheet open={rulesOpen} onOpenChange={setRulesOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto" style={{ background: SURFACE }}>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2" style={{ color: TEXT }}>
              <Settings2 size={18} style={{ color: PLUM }} /> Credential Rules
            </SheetTitle>
          </SheetHeader>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>
            Configure which credential types are required per shift type. Shift assignment blocks when a required credential is missing or invalid.
          </p>

          <div className="mt-4 grid gap-3">
            <div>
              <Label>Shift type</Label>
              <select
                title="Shift type"
                value={ruleShiftType}
                onChange={(event) => setRuleShiftType(event.target.value)}
                className="mt-1 h-10 w-full rounded-xl border px-3 text-sm"
                style={{ borderColor: BORDER, background: "var(--cc-bg)" }}
              >
                {SHIFT_TYPES.map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div>
              <Label>Required credential</Label>
              <select
                title="Required credential"
                value={ruleCredentialType}
                onChange={(event) => setRuleCredentialType(event.target.value)}
                className="mt-1 h-10 w-full rounded-xl border px-3 text-sm"
                style={{ borderColor: BORDER, background: "var(--cc-bg)" }}
              >
                {[...new Set([...WORKER_CREDENTIAL_TYPES, ...ALLIED_CREDENTIAL_TYPES])].sort((a, b) => a.localeCompare(b)).map((type) => (
                  <option key={type} value={type}>{credentialTypeLabel(type)}</option>
                ))}
              </select>
            </div>
            <Button
              className="gap-2 rounded-xl"
              style={{ background: "var(--cc-cta)" }}
              disabled={createRuleMut.isPending}
              onClick={() => createRuleMut.mutate()}
            >
              {createRuleMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Add rule
            </Button>
          </div>

          <div className="mt-5 pt-4 border-t space-y-2" style={{ borderColor: BORDER }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Current rules</p>
            {shiftRules.isLoading && <p className="text-sm" style={{ color: MUTED }}>Loading…</p>}
            {!shiftRules.isLoading && (shiftRules.data ?? []).length === 0 && (
              <p className="text-sm" style={{ color: MUTED }}>No shift credential rules configured yet.</p>
            )}
            {(shiftRules.data ?? []).map((rule) => (
              <div key={rule.id} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2" style={{ borderColor: BORDER, background: SOFT }}>
                <p className="text-sm font-semibold" style={{ color: TEXT }}>
                  <span className="capitalize">{rule.shift_type.replace(/_/g, " ")}</span>
                  <span style={{ color: MUTED }}> requires </span>
                  {credentialTypeLabel(rule.required_credential_type)}
                </p>
                <button
                  onClick={() => deleteRuleMut.mutate(rule)}
                  disabled={deleteRuleMut.isPending}
                  className="shrink-0 rounded-lg p-1.5 hover:bg-black/5"
                  aria-label="Remove rule"
                >
                  <Trash2 className="h-3.5 w-3.5" style={{ color: MUTED }} />
                </button>
              </div>
            ))}
          </div>

          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setRulesOpen(false)}>{translate("common.close")}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {reauthModal}
    </IndexTemplate>
  );
}

/** Single header-cell renderer for every column, sortable or not, so padding/casing/alignment
 * can never drift between them — a <button>'s UA stylesheet resets text-transform to none
 * regardless of what its ancestor <th> specifies, which is exactly what caused sortable headers
 * to silently lose their uppercase styling before: the uppercase class now lives on a <span>
 * inside the button (and on the plain path too), never relying on inheritance through a button. */
function Th({
  label, align = "left", className, sortKey, activeSortKey, sortDir, onSort,
}: {
  label: string;
  align?: "left" | "center";
  className?: string;
  sortKey?: SortKey;
  activeSortKey?: SortKey | null;
  sortDir?: "asc" | "desc";
  onSort?: (key: SortKey) => void;
}) {
  const sortable = !!sortKey && !!onSort;
  const active = sortable && activeSortKey === sortKey;
  const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  // flex + justify-start/-center (not text-align) controls the alignment here on purpose:
  // <button> gets `text-align: center` from the browser's own UA stylesheet regardless of
  // what the parent <th> specifies, the same class of inheritance-break that hit uppercase
  // earlier. justify-content is a flex property, not a text property, so it isn't affected.
  const content = (
    <span className={`flex items-center gap-1 uppercase w-full ${align === "center" ? "justify-center" : "justify-start"}`}>
      {label}
      {sortable && <Icon size={11} style={{ opacity: active ? 1 : 0.4 }} />}
    </span>
  );

  return (
    <th
      className={`px-3 py-3.5 text-xs font-bold ${align === "center" ? "text-center" : "text-left"} ${className ?? ""}`}
      style={{ color: active ? PLUM : MUTED }}
    >
      {sortable ? (
        <button type="button" onClick={() => onSort!(sortKey!)} className="w-full">
          {content}
        </button>
      ) : content}
    </th>
  );
}

type IconType = typeof ShieldCheck;

function toneColors(tone: "success" | "warning") {
  return tone === "success"
    ? { bg: "var(--cc-status-success-bg)", color: "var(--cc-status-success)" }
    : { bg: "var(--cc-status-warning-bg)", color: "var(--cc-status-warning)" };
}

function SectionHeaderInline({ icon: Icon, tone, label }: { icon: IconType; tone: "success" | "warning"; label: string }) {
  const { bg, color } = toneColors(tone);
  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center justify-center h-6 w-6 rounded-full" style={{ background: bg, color }}>
        <Icon size={13} />
      </span>
      <p className="text-[11px] font-black uppercase tracking-[0.12em]" style={{ color }}>{label}</p>
      <span className="flex-1 h-px" style={{ background: BORDER }} />
    </div>
  );
}

function Avatar({ worker, verified, size }: { worker: WorkerStats; verified: boolean; size: "sm" | "md" }) {
  const dims = size === "sm" ? "h-9 w-9 text-xs" : "h-11 w-11 text-sm";
  const ring = verified ? "var(--cc-status-success)" : "var(--cc-status-warning)";
  return (
    <div
      className={`${dims} rounded-full shrink-0 flex items-center justify-center font-black`}
      style={{ background: PLUM, color: "#fff", boxShadow: `0 0 0 2px var(--cc-surface), 0 0 0 3.5px ${ring}` }}
    >
      {(worker.full_name || "?").charAt(0).toUpperCase()}
    </div>
  );
}

type WorkerRowHandlers = {
  worker: WorkerStats;
  verified: boolean;
  summary: { workerAlerts: unknown[]; expired: number; expiring: number };
  translate: (k: string) => string;
  translateParams: (k: string, params: Record<string, string>) => string;
  /** Only meaningful for WorkerRow (list view) — WorkerCard shows every field regardless. */
  visibleColumns?: Set<ColumnKey>;
  /** Only used by WorkerRow's Readiness column. */
  readiness?: { level: "success" | "warning" | "danger"; label: string };
  onOpenDetail: () => void;
  onAssignClient: () => void;
  onAssignShift: () => void;
  onReminder: () => void;
  onDeactivate: () => void;
  onActivate: () => void;
};

const ALL_COLUMN_KEYS = new Set<ColumnKey>(["email", "joined", "sessions", "readiness"]);

function WorkerRow({
  worker: w, verified, summary, translate, translateParams, visibleColumns = ALL_COLUMN_KEYS, readiness, selected, onToggleSelected, onOpenDetail,
  onAssignClient, onAssignShift, onReminder, onDeactivate, onActivate,
}: WorkerRowHandlers & { selected: boolean; onToggleSelected: () => void }) {
  return (
    <tr
      className="transition-colors cursor-pointer"
      style={{ background: "transparent" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = SOFT; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      onClick={onOpenDetail}
    >
      <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onCheckedChange={onToggleSelected} aria-label={w.full_name} />
      </td>
      <td className="px-3 py-3.5">
        <div className="flex items-center gap-3">
          <Avatar worker={w} verified={verified} size="sm" />
          <div className="min-w-0">
            <p className="font-bold text-sm truncate" style={{ color: TEXT }}>{w.full_name}</p>
            <p className="text-[10px] mt-0.5" style={{ color: MUTED }}>{translate("team.detail.workerId")}: {w.employee_id || w.id.slice(0, 8)}</p>
            {summary.workerAlerts.length > 0 && (
              <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: "var(--cc-status-danger)" }}>
                <AlertTriangle size={11} />
                {summary.expired > 0 ? translateParams("team.expired", { count: String(summary.expired) }) : translateParams("team.expiring", { count: String(summary.expiring) })}
              </p>
            )}
          </div>
        </div>
      </td>
      {visibleColumns.has("email") && (
        <td className="px-3 py-3.5 hidden md:table-cell">
          <p className="text-sm truncate max-w-[180px]" style={{ color: MUTED }}>{w.email || translate("common.emDash")}</p>
        </td>
      )}
      {visibleColumns.has("joined") && (
        <td className="px-3 py-3.5 hidden sm:table-cell">
          <p className="text-xs" style={{ color: MUTED }}>{w.joined_at ? safeFormat(w.joined_at) : translate("common.emDash")}</p>
        </td>
      )}
      {visibleColumns.has("sessions") && (
        <td className="px-3 py-3.5 hidden md:table-cell">
          <p className="text-xs" style={{ color: TEXT }}>
            {w.total_sessions}
            <span style={{ color: MUTED }}> total</span>
            {w.sessions_this_week > 0 && <span style={{ color: PLUM }}> · {w.sessions_this_week} this wk</span>}
          </p>
        </td>
      )}
      {visibleColumns.has("readiness") && readiness && (
        <td className="px-3 py-3.5">
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: `var(--cc-status-${readiness.level})` }}
              aria-hidden="true"
            />
            <p className="text-xs font-bold truncate" style={{ color: `var(--cc-status-${readiness.level})` }}>
              {readiness.label}
            </p>
          </div>
        </td>
      )}
      <td className="px-3 py-3.5 text-center">
        <span
          className="text-xs font-bold px-2 py-1 rounded-full"
          style={{
            background: w.is_active !== false ? "var(--cc-status-success-bg)" : "var(--cc-status-danger-bg)",
            color: w.is_active !== false ? "var(--cc-status-success)" : "var(--cc-status-danger)",
          }}
        >
          {w.is_active !== false ? translate("team.status.active") : translate("team.status.inactive")}
        </span>
      </td>
      <td className="px-3 py-3.5" onClick={(e) => e.stopPropagation()}>
        <WorkerActionsMenu
          worker={w}
          translate={translate}
          onViewProfile={onOpenDetail}
          onAssignClient={onAssignClient}
          onAssignShift={onAssignShift}
          onReminder={onReminder}
          onDeactivate={onDeactivate}
          onActivate={onActivate}
        />
      </td>
    </tr>
  );
}

function WorkerCard({
  worker: w, verified, summary, translate, translateParams, onOpenDetail,
  onAssignClient, onAssignShift, onReminder, onDeactivate, onActivate,
}: WorkerRowHandlers) {
  return (
    <div
      className="rounded-2xl p-5 cursor-pointer transition-shadow hover:shadow-md"
      style={{ background: SURFACE, boxShadow: CARD_SHADOW }}
      onClick={onOpenDetail}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar worker={w} verified={verified} size="md" />
          <div className="min-w-0">
            <p className="font-black text-sm truncate" style={{ color: TEXT }}>{w.full_name}</p>
            <p className="text-xs truncate" style={{ color: MUTED }}>{w.email}</p>
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <WorkerActionsMenu
            worker={w}
            translate={translate}
            onViewProfile={onOpenDetail}
            onAssignClient={onAssignClient}
            onAssignShift={onAssignShift}
            onReminder={onReminder}
            onDeactivate={onDeactivate}
            onActivate={onActivate}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] font-bold px-2 py-1 rounded capitalize" style={{ background: SOFT, color: PLUM }}>
          {roleLabel(w.role)}
        </span>
        <span
          className="text-[10px] font-bold px-2 py-1 rounded-full"
          style={{
            background: w.is_active !== false ? "var(--cc-status-success-bg)" : "var(--cc-status-danger-bg)",
            color: w.is_active !== false ? "var(--cc-status-success)" : "var(--cc-status-danger)",
          }}
        >
          {w.is_active !== false ? translate("team.status.active") : translate("team.status.inactive")}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs" style={{ color: MUTED }}>
        <span>{translateParams("team.sessionsCount", { count: String(w.total_sessions) })}</span>
        <div className="flex items-center gap-1">
          <ShieldCheck size={12} style={{ color: complianceColour(w.avg_compliance) }} />
          <span className="font-bold" style={{ color: complianceColour(w.avg_compliance) }}>
            {w.avg_compliance != null ? `${w.avg_compliance}%` : translate("common.emDash")}
          </span>
        </div>
      </div>

      {summary.workerAlerts.length > 0 && (
        <p className="mt-2 text-xs flex items-center gap-1" style={{ color: "var(--cc-status-danger)" }}>
          <AlertTriangle size={11} />
          {summary.expired > 0 ? translateParams("team.expired", { count: String(summary.expired) }) : translateParams("team.expiring", { count: String(summary.expiring) })}
        </p>
      )}
    </div>
  );
}

function WorkerActionsMenu({
  worker, translate, onViewProfile, onAssignClient, onAssignShift, onReminder, onDeactivate, onActivate,
}: {
  worker: WorkerStats;
  translate: (k: string) => string;
  onViewProfile: () => void;
  onAssignClient: () => void;
  onAssignShift: () => void;
  onReminder: () => void;
  onDeactivate: () => void;
  onActivate: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="rounded-lg p-1.5 transition-colors hover:bg-black/5"
          style={{ color: MUTED }}
          aria-label={translate("team.actionsFor").replace("{name}", worker.full_name)}
        >
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onViewProfile}>
          <ChevronRight size={13} className="mr-1.5" /> {translate("team.detail.viewProfile")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAssignShift}>
          <Clock size={13} className="mr-1.5" /> {translate("team.assignShift")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAssignClient}>
          <Link2 size={13} className="mr-1.5" /> {translate("team.assignClient")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onReminder}>
          <Mail size={13} className="mr-1.5" /> {translate("team.reminder")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {worker.is_active !== false ? (
          <DropdownMenuItem onClick={onDeactivate} className="text-red-600 focus:text-red-600">
            <UserX size={13} className="mr-1.5" /> {translate("team.deactivate")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={onActivate} className="text-green-700 focus:text-green-700">
            <UserCheck size={13} className="mr-1.5" /> {translate("team.reactivate")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
