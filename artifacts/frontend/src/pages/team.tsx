import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  Mail, UserPlus, Users, ShieldCheck, AlertTriangle, Clock,
  UserCheck, UserX, Loader2, ChevronRight, Link2, MoreHorizontal,
  Search, LayoutList, LayoutGrid, GraduationCap, Sparkles, ShieldAlert,
} from "lucide-react";
import { useGetParticipants } from "@workspace/api-client-react";
import {
  getCoordinatorWorkerStats,
  deactivateWorker, activateWorker,
  assignWorkerToClient,
  getCoordinatorCredentialAlerts, sendBulkReminders,
  getTeamCredentials, getPendingTrainingCompletions,
  type WorkerStats,
} from "@/services/coordinatorService";
import { getTeamOnboarding } from "@/services/onboardingService";
import { useToast } from "@/hooks/use-toast";
import { ShiftAssignmentModal } from "@/components/coordinator/ShiftAssignmentModal";
import { WorkerDetail, isWorkerCredentialsComplete } from "@/components/team/WorkerDetail";
import { IndexTemplate, IndexHeader } from "@/components/layout/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { jsonFetch } from "@/services/http";
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
type StatusFilter = "all" | "active" | "inactive";

const INVITE_ROLE_KEYS: Record<string, string> = {
  support_worker: "team.invite.role.supportWorker",
  support_coordinator: "team.invite.role.coordinator",
};

export default function Team() {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { requireReAuth, modal: reauthModal } = useReAuth();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("support_worker");
  const [inviteSending, setInviteSending] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<WorkerStats | null>(null);
  const [assignWorker, setAssignWorker] = useState<WorkerStats | null>(null);
  const [assignPatientId, setAssignPatientId] = useState("");
  const [shiftWorker, setShiftWorker] = useState<WorkerStats | null>(null);
  const [detailWorkerId, setDetailWorkerId] = useState<string | null>(null);

  const { user } = useAuth();

  const orgId = user?.organizationId ?? "__no_org__";

  const stats = useOrgQuery(["coordinator", "worker-stats"], {
    queryFn: getCoordinatorWorkerStats,
  });

  const credentialAlerts = useOrgQuery(["coordinator-credential-alerts"], {
    queryFn: getCoordinatorCredentialAlerts,
  });

  const teamCredentials = useOrgQuery(["team-credentials"], {
    queryFn: getTeamCredentials,
  });

  const teamOnboarding = useOrgQuery(["team-onboarding"], {
    queryFn: getTeamOnboarding,
  });

  const pendingTraining = useOrgQuery(["pending-training-completions"], {
    queryFn: getPendingTrainingCompletions,
  });

  const participants = useGetParticipants();

  const deactivateMut = useMutation({
    mutationFn: (id: string) => deactivateWorker(id),
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
      setInviteOpen(false);
      setInviteEmail("");
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

  const filteredWorkers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return workers
      .filter((w) => {
        const matchesSearch = !q
          || w.full_name?.toLowerCase().includes(q)
          || w.email?.toLowerCase().includes(q)
          || (w.employee_id ?? "").toLowerCase().includes(q);
        const matchesStatus = statusFilter === "all"
          || (statusFilter === "active" ? w.is_active !== false : w.is_active === false);
        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => Number(isWorkerVerified(a.id)) - Number(isWorkerVerified(b.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workers, search, statusFilter, teamOnboarding.data, teamCredentials.data]);

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

  if (detailWorker) {
    return (
      <IndexTemplate>
        <IndexHeader title={translate("team.title")} />
        <WorkerDetail worker={detailWorker} onBack={() => setDetailWorkerId(null)} />
        {reauthModal}
      </IndexTemplate>
    );
  }

  return (
    <IndexTemplate>
      {/* Header */}
      <IndexHeader
        title={translate("team.title")}
        count={workers.length}
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
          style={{ background: "linear-gradient(90deg, var(--cc-status-info-bg), transparent)", border: `1px solid var(--cc-border)` }}
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
          {/* Toolbar: search + status filter + view toggle */}
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
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as StatusFilter); setPage(1); }}>
                <SelectTrigger className="w-[140px] rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{translate("team.filter.status.all")}</SelectItem>
                  <SelectItem value="active">{translate("team.status.active")}</SelectItem>
                  <SelectItem value="inactive">{translate("team.status.inactive")}</SelectItem>
                </SelectContent>
              </Select>
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
            </div>
          </div>

          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between rounded-xl px-4 py-2.5" style={{ background: "var(--cc-status-info-bg)" }}>
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
                    <th className="px-3 py-3.5 text-left text-xs font-bold uppercase" style={{ color: MUTED }}>{translate("team.col.name")}</th>
                    <th className="px-3 py-3.5 text-left text-xs font-bold uppercase hidden md:table-cell" style={{ color: MUTED }}>{translate("team.col.email")}</th>
                    <th className="px-3 py-3.5 text-left text-xs font-bold uppercase hidden sm:table-cell" style={{ color: MUTED }}>{translate("team.col.role")}</th>
                    <th className="px-3 py-3.5 text-center text-xs font-bold uppercase" style={{ color: MUTED }}>{translate("team.col.compliance")}</th>
                    <th className="px-3 py-3.5 text-center text-xs font-bold uppercase" style={{ color: MUTED }}>{translate("team.col.status")}</th>
                    <th className="px-3 py-3.5 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: BORDER }}>
                  {pageAttentionWorkers.length > 0 && (
                    <SectionHeaderRow icon={ShieldAlert} tone="warning" label={translateParams("team.section.needsAttention", { count: String(pageAttentionWorkers.length) })} />
                  )}
                  {pageAttentionWorkers.map((w) => (
                    <WorkerRow
                      key={w.id}
                      worker={w}
                      verified={false}
                      summary={getCredentialSummary(w.id)}
                      translate={translate}
                      translateParams={translateParams}
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
                  {pageVerifiedWorkers.length > 0 && (
                    <SectionHeaderRow icon={ShieldCheck} tone="success" label={translateParams("team.section.verified", { count: String(pageVerifiedWorkers.length) })} />
                  )}
                  {pageVerifiedWorkers.map((w) => (
                    <WorkerRow
                      key={w.id}
                      worker={w}
                      verified
                      summary={getCredentialSummary(w.id)}
                      translate={translate}
                      translateParams={translateParams}
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
          <SheetFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setInviteOpen(false)}>{translate("common.cancel")}</Button>
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
        <section className="rounded-2xl border p-5 space-y-3" style={{ borderColor: "var(--cc-status-danger)", background: "var(--cc-status-danger-bg)" }}>
          <h3 className="text-base font-black" style={{ color: "var(--cc-status-danger)" }}>{translateParams("team.deactivate.title", { name: deactivateTarget.full_name })}</h3>
          <p className="text-sm" style={{ color: "var(--cc-status-danger)" }}>
            {translate("team.deactivate.body")}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeactivateTarget(null)}>{translate("common.cancel")}</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deactivateMut.mutate(deactivateTarget.id)}
              disabled={deactivateMut.isPending}
            >
              {deactivateMut.isPending ? translate("team.deactivate.deactivating") : translate("team.deactivate.confirm")}
            </Button>
          </div>
        </section>
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

      {reauthModal}
    </IndexTemplate>
  );
}

type IconType = typeof ShieldCheck;

function toneColors(tone: "success" | "warning") {
  return tone === "success"
    ? { bg: "var(--cc-status-success-bg)", color: "var(--cc-status-success)" }
    : { bg: "var(--cc-status-warning-bg)", color: "var(--cc-status-warning)" };
}

function SectionHeaderRow({ icon: Icon, tone, label }: { icon: IconType; tone: "success" | "warning"; label: string }) {
  const { bg, color } = toneColors(tone);
  return (
    <tr>
      <td colSpan={7} className="px-3 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center h-6 w-6 rounded-full" style={{ background: bg, color }}>
            <Icon size={13} />
          </span>
          <p className="text-[11px] font-black uppercase tracking-[0.12em]" style={{ color }}>{label}</p>
          <span className="flex-1 h-px" style={{ background: BORDER }} />
        </div>
      </td>
    </tr>
  );
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
  onOpenDetail: () => void;
  onAssignClient: () => void;
  onAssignShift: () => void;
  onReminder: () => void;
  onDeactivate: () => void;
  onActivate: () => void;
};

function WorkerRow({
  worker: w, verified, summary, translate, translateParams, selected, onToggleSelected, onOpenDetail,
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
      <td className="px-3 py-3.5 hidden md:table-cell">
        <p className="text-sm truncate max-w-[180px]" style={{ color: MUTED }}>{w.email || translate("common.emDash")}</p>
      </td>
      <td className="px-3 py-3.5 hidden sm:table-cell">
        <span className="text-xs font-bold px-2 py-1 rounded capitalize" style={{ background: SOFT, color: PLUM }}>
          {roleLabel(w.role)}
        </span>
      </td>
      <td className="px-3 py-3.5 text-center">
        <div className="flex items-center justify-center gap-1">
          <ShieldCheck size={13} style={{ color: complianceColour(w.avg_compliance) }} />
          <p className="font-bold text-sm" style={{ color: complianceColour(w.avg_compliance) }}>
            {w.avg_compliance != null ? `${w.avg_compliance}%` : translate("common.emDash")}
          </p>
        </div>
      </td>
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
