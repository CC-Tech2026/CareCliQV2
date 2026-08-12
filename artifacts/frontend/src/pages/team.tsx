import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  Mail, UserPlus, Users, ShieldCheck, AlertTriangle, Clock,
  FileText, CheckCircle2, XCircle, ToggleLeft, ToggleRight,
  UserCheck, UserX, Loader2, ChevronRight, Link2, Plus,
} from "lucide-react";
import { useGetParticipants } from "@workspace/api-client-react";
import {
  getCoordinatorWorkerStats, getCoordinatorTeam,
  deactivateWorker, activateWorker,
  assignWorkerToClient, unassignWorkerFromClient, getWorkerClients,
  getCoordinatorCredentialAlerts, sendBulkReminders,
  type WorkerStats,
} from "@/services/coordinatorService";
import { useToast } from "@/hooks/use-toast";
import { ShiftAssignmentModal } from "@/components/coordinator/ShiftAssignmentModal";
import { IndexTemplate, IndexHeader } from "@/components/layout/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { jsonFetch } from "@/services/http";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
const PLUM  = "var(--cc-plum)";
const TEXT  = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT  = "#F4EDE6";

function complianceColour(score: number | null | undefined): string {
  if (score == null) return MUTED;
  if (score >= 85) return "#16A34A";
  if (score >= 60) return "#D97706";
  return "#DC2626";
}

function complianceBg(score: number | null | undefined): string {
  if (score == null) return "#F5F5F5";
  if (score >= 85) return "#DCFCE7";
  if (score >= 60) return "#FEF3C7";
  return "#FEE2E2";
}

function roleLabel(role?: string) {
  return (role || "member").replace(/_/g, " ");
}

type Tab = "overview" | "management" | "shifts";

const INVITE_ROLE_KEYS: Record<string, string> = {
  support_worker: "team.invite.role.supportWorker",
  support_coordinator: "team.invite.role.coordinator",
};

export default function Team() {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState<Tab>("overview");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("support_worker");
  const [inviteSending, setInviteSending] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<WorkerStats | null>(null);
  const [assignWorker, setAssignWorker] = useState<WorkerStats | null>(null);
  const [assignPatientId, setAssignPatientId] = useState("");
  const [selectedWorkerForShift, setSelectedWorkerForShift] = useState<WorkerStats | null>(null);
  const [shiftFormOpen, setShiftFormOpen] = useState(false);

  const { user, isAuthenticated } = useAuth();

  const orgId = user?.organizationId ?? "__no_org__";

  const stats = useOrgQuery(["coordinator", "worker-stats"], {
    queryFn: getCoordinatorWorkerStats,
  });

  const credentialAlerts = useOrgQuery(["coordinator-credential-alerts"], {
    queryFn: getCoordinatorCredentialAlerts,
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
    mutationFn: (workerId: string) => sendBulkReminders([workerId], translate("team.reminderMessage")),
    onSuccess: (_, workerId) => {
      qc.invalidateQueries({ queryKey: [orgId, "coordinator-credential-alerts"] });
      toast({ title: translate("team.toast.reminderSent"), description: translateParams("team.toast.reminderSentDesc", { workerId }) });
    },
    onError: () => toast({ title: translate("team.toast.reminderFailed"), variant: "destructive" }),
  });

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteSending(true);
    try {
      await jsonFetch("/api/invitations/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      toast({ title: translate("team.toast.inviteSent"), description: translateParams("team.toast.inviteSentDesc", { email: inviteEmail, role: translate(INVITE_ROLE_KEYS[inviteRole] ?? inviteRole) }) });
      setInviteOpen(false);
      setInviteEmail("");
    } catch {
      toast({ title: translate("team.toast.inviteFailed"), description: translate("team.toast.inviteFailedDesc"), variant: "destructive" });
    } finally {
      setInviteSending(false);
    }
  };

  const workers = stats.data ?? [];
  const allParticipants = (participants.data as Array<{ id: string; full_name: string }> | undefined) ?? [];
  const alertRows = credentialAlerts.data?.alerts ?? [];

  function getCredentialSummary(workerId: string) {
    const workerAlerts = alertRows.filter((alert) => alert.user_id === workerId);
    const expired = workerAlerts.filter((alert) => alert.status === "expired").length;
    const expiring = workerAlerts.filter((alert) => alert.status === "expiring").length;
    return { workerAlerts, expired, expiring };
  }

  return (
    <IndexTemplate>
      {/* Header */}
      <IndexHeader
        title={translate("team.title")}
        count={workers.length}
        primaryAction={
          <div className="flex gap-2">
            {tab !== "shifts" && (
              <Button
                variant="navy"
                onClick={() => setTab("shifts")}
                className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black"
              >
                <Clock size={16} /> {translate("team.assignShift")}
              </Button>
            )}
            <Button
              variant="navy"
              onClick={() => setInviteOpen(true)}
              className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black"
            >
              <UserPlus size={16} /> {translate("team.inviteWorker")}
            </Button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl p-1" style={{ background: SOFT }}>
        {(["overview", "management", "shifts"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setSelectedWorkerForShift(null); setShiftFormOpen(false); }}
            className="flex-1 rounded-lg py-2 text-sm font-bold capitalize transition-colors"
            style={{
              background: tab === t ? "var(--cc-bg)" : "transparent",
              color: tab === t ? PLUM : MUTED,
              boxShadow: tab === t ? "0 1px 3px rgba(55,48,163,0.12)" : "none",
            }}
          >
            {t === "shifts" ? translate("team.tab.shifts") : translate(`team.tab.${t}` as "team.tab.overview")}
          </button>
        ))}
      </div>

      {/* -- OVERVIEW TAB ----------------------------------- */}
      {tab === "overview" && (() => {
        const activeCount      = workers.filter((w) => w.is_active !== false).length;
        const weekSessions     = workers.reduce((s, w) => s + (w.sessions_this_week ?? 0), 0);
        const scored           = workers.filter((w) => w.avg_compliance != null);
        const avgCompliance    = scored.length > 0
          ? Math.round(scored.reduce((s, w) => s + (w.avg_compliance ?? 0), 0) / scored.length)
          : null;
        const credAlertCount   = alertRows.length;

        return (
          <>
            {stats.isLoading && (
              <div className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
                <Loader2 className="h-4 w-4 animate-spin" /> {translate("team.loadingStats")}
              </div>
            )}
            {stats.error && <p className="text-sm text-red-600">{translate("team.loadStatsFailed")}</p>}

            {!stats.isLoading && workers.length > 0 && (
              <div className="grid lg:grid-cols-[1fr_220px] gap-5 items-start">

                {/* LEFT — worker table */}
                <div className="rounded-xl border overflow-x-auto" style={{ borderColor: BORDER, background: "var(--cc-bg)" }}>
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: `2px solid ${BORDER}`, background: SOFT }}>
                        <th className="px-5 py-3.5 text-left text-xs font-bold uppercase" style={{ color: MUTED }}>{translate("team.col.name")}</th>
                        <th className="px-5 py-3.5 text-left text-xs font-bold uppercase hidden md:table-cell" style={{ color: MUTED }}>{translate("team.col.email")}</th>
                        <th className="px-5 py-3.5 text-left text-xs font-bold uppercase hidden sm:table-cell" style={{ color: MUTED }}>{translate("team.col.role")}</th>
                        <th className="px-5 py-3.5 text-center text-xs font-bold uppercase" style={{ color: MUTED }}>{translate("team.col.sessions")}</th>
                        <th className="px-5 py-3.5 text-center text-xs font-bold uppercase hidden sm:table-cell" style={{ color: MUTED }}>{translate("team.col.thisWeek")}</th>
                        <th className="px-5 py-3.5 text-center text-xs font-bold uppercase" style={{ color: MUTED }}>{translate("team.col.compliance")}</th>
                        <th className="px-5 py-3.5 text-center text-xs font-bold uppercase" style={{ color: MUTED }}>{translate("team.col.status")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ borderColor: BORDER }}>
                      {workers.map((w) => {
                        const summary = getCredentialSummary(w.id);
                        return (
                          <tr key={w.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-5 py-3.5">
                              <p className="font-bold text-sm" style={{ color: TEXT }}>{w.full_name}</p>
                              {summary.workerAlerts.length > 0 && (
                                <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: "var(--cc-status-danger)" }}>
                                  <AlertTriangle size={11} />
                                  {summary.expired > 0 ? translateParams("team.expired", { count: String(summary.expired) }) : translateParams("team.expiring", { count: String(summary.expiring) })}
                                </p>
                              )}
                            </td>
                            <td className="px-5 py-3.5 hidden md:table-cell">
                              <p className="text-sm truncate max-w-[180px]" style={{ color: MUTED }}>{w.email || translate("common.emDash")}</p>
                            </td>
                            <td className="px-5 py-3.5 hidden sm:table-cell">
                              <span className="text-xs font-bold px-2 py-1 rounded capitalize" style={{ background: SOFT, color: PLUM }}>
                                {roleLabel(w.role)}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-center">
                              <p className="font-bold text-sm" style={{ color: TEXT }}>{w.total_sessions}</p>
                            </td>
                            <td className="px-5 py-3.5 text-center hidden sm:table-cell">
                              <p className="font-bold text-sm" style={{ color: TEXT }}>{w.sessions_this_week}</p>
                            </td>
                            <td className="px-5 py-3.5 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <ShieldCheck size={13} style={{ color: complianceColour(w.avg_compliance) }} />
                                <p className="font-bold text-sm" style={{ color: complianceColour(w.avg_compliance) }}>
                                  {w.avg_compliance != null ? `${w.avg_compliance}%` : translate("common.emDash")}
                                </p>
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-center">
                              <span
                                className="text-xs font-bold px-2 py-1 rounded-full"
                                style={{
                                  background: w.is_active !== false ? "#DCFCE7" : "#FEE2E2",
                                  color: w.is_active !== false ? "#16A34A" : "#DC2626",
                                }}
                              >
                                {w.is_active !== false ? translate("team.status.active") : translate("team.status.inactive")}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* RIGHT — team stat sidebar */}
                <div className="space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>{translate("team.snapshot")}</p>

                  {/* Stat tiles */}
                  {[
                    { labelKey: "team.stat.activeWorkers",   value: activeCount,       color: "#16A34A", bg: "rgba(22,163,74,0.06)"  },
                    { labelKey: "team.stat.sessionsThisWeek", value: weekSessions,      color: TEXT,      bg: "rgba(26,26,46,0.04)"  },
                    { labelKey: "team.stat.avgCompliance",   value: avgCompliance != null ? `${avgCompliance}%` : translate("common.emDash"),
                      color: avgCompliance != null ? complianceColour(avgCompliance) : MUTED,
                      bg: "rgba(55,48,163,0.04)" },
                  ].map(({ labelKey, value, color, bg }) => (
                    <div key={labelKey} className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: bg }}>
                      <span className="text-[11px] font-medium" style={{ color: MUTED }}>{translate(labelKey)}</span>
                      <span className="text-[15px] font-black tabular-nums" style={{ color }}>{value}</span>
                    </div>
                  ))}

                  {/* Credential alert callout */}
                  {credAlertCount > 0 && (
                    <div className="rounded-xl px-4 py-3 space-y-1" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.18)" }}>
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle size={13} style={{ color: "#D97706" }} />
                        <p className="text-[11px] font-black" style={{ color: "#D97706" }}>
                          {translateParams(credAlertCount === 1 ? "team.credentialsExpiring" : "team.credentialsExpiringPlural", { count: String(credAlertCount) })}
                        </p>
                      </div>
                      <p className="text-[10px] font-medium" style={{ color: MUTED }}>
                        {translate("team.credentialsHint")}
                      </p>
                    </div>
                  )}

                  <Button
                    variant="navy"
                    onClick={() => setTab("management")}
                    className="w-full rounded-xl px-4 py-2.5 text-[12px] font-black"
                  >
                    {translate("team.manageTeam")}
                  </Button>
                </div>
              </div>
            )}

            {!stats.isLoading && workers.length === 0 && (
              <div className="rounded-2xl bg-white p-10 text-center" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
                <Users size={32} className="mx-auto mb-3" style={{ color: MUTED }} />
                <p className="text-sm font-bold" style={{ color: MUTED }}>{translate("team.empty.overview")}</p>
              </div>
            )}
          </>
        );
      })()}

      {/* -- MANAGEMENT TAB --------------------------------- */}
      {tab === "management" && (
        <div className="space-y-4">
          {stats.isLoading && <p className="text-sm" style={{ color: MUTED }}>{translate("common.loading")}</p>}
          {workers.map((w) => (
            <div
              key={w.id}
              className="rounded-2xl bg-white p-5"
              style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.08), 0 0 0 1px rgba(232,213,232,0.5)" }}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                {/* Identity */}
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="h-10 w-10 rounded-full shrink-0 flex items-center justify-center text-sm font-black text-white"
                    style={{ background: "var(--cc-text)" }}
                  >
                    {(w.full_name || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-black text-sm truncate" style={{ color: TEXT }}>{w.full_name}</p>
                    <p className="text-xs truncate" style={{ color: MUTED }}>{w.email}</p>
                    <span className="text-[10px] font-bold capitalize" style={{ color: MUTED }}>{roleLabel(w.role)}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 shrink-0">
                  {/* Assign to client */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5"
                    onClick={() => { setAssignWorker(w); setAssignPatientId(""); }}
                  >
                    <Link2 size={12} /> {translate("team.assignClient")}
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5 border-amber-200 text-amber-700 hover:bg-amber-50"
                    onClick={() => reminderMut.mutate(w.id)}
                    disabled={reminderMut.isPending}
                  >
                    <Mail size={12} /> {translate("team.reminder")}
                  </Button>

                  {/* Activate / Deactivate */}
                  {w.is_active !== false ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => setDeactivateTarget(w)}
                    >
                      <UserX size={12} /> {translate("team.deactivate")}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs gap-1.5 text-green-700 border-green-200 hover:bg-green-50"
                      onClick={() => activateMut.mutate(w.id)}
                      disabled={activateMut.isPending}
                    >
                      <UserCheck size={12} /> {translate("team.reactivate")}
                    </Button>
                  )}
                </div>
              </div>

              {/* Credential status strip */}
              <div className="mt-3 flex flex-wrap gap-2">
                <CredentialChip
                  label={translate("team.credential.wwcc")}
                  status={getCredentialSummary(w.id).expired > 0 ? "warn" : w.is_active !== false ? "verified" : "inactive"}
                />
                <CredentialChip
                  label={translate("team.credential.firstAid")}
                  status={getCredentialSummary(w.id).expiring > 0 ? "warn" : w.is_active !== false ? "verified" : "inactive"}
                />
                <CredentialChip
                  label={translateParams("team.sessionsCount", { count: String(w.total_sessions) })}
                  status="info"
                />
                {w.flagged_count > 0 && (
                  <CredentialChip label={translateParams("team.flaggedCount", { count: String(w.flagged_count) })} status="warn" />
                )}
              </div>
            </div>
          ))}

          {!stats.isLoading && workers.length === 0 && (
            <div className="rounded-2xl bg-white p-10 text-center" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
              <Users size={32} className="mx-auto mb-3" style={{ color: MUTED }} />
              <p className="text-sm font-bold" style={{ color: MUTED }}>{translate("team.empty.management")}</p>
            </div>
          )}
        </div>
      )}

      {inviteOpen && (
        <section className="rounded-2xl bg-white p-5 space-y-4" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.08), 0 0 0 1px rgba(232,213,232,0.5)" }}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-black flex items-center gap-2" style={{ color: PLUM }}>
              <UserPlus size={18} /> {translate("team.invite.title")}
            </h3>
            <Button variant="outline" size="sm" onClick={() => setInviteOpen(false)}>{translate("common.close")}</Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{translate("team.invite.email")}</label>
              <Input
                type="email"
                placeholder={translate("team.invite.emailPlaceholder")}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
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
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setInviteOpen(false)}>{translate("common.cancel")}</Button>
            <Button
              variant="navy"
              onClick={handleInvite}
              disabled={!inviteEmail.trim() || inviteSending}
            >
              {inviteSending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{translate("team.invite.sending")}</> : translate("team.invite.send")}
            </Button>
          </div>
        </section>
      )}

      {deactivateTarget && (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5 space-y-3">
          <h3 className="text-base font-black text-red-700">{translateParams("team.deactivate.title", { name: deactivateTarget.full_name })}</h3>
          <p className="text-sm text-red-700">
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
        <section className="rounded-2xl bg-white p-5 space-y-4" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.08), 0 0 0 1px rgba(232,213,232,0.5)" }}>
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

      {/* -- SHIFT ASSIGNMENTS TAB --------------------------------- */}
      {tab === "shifts" && (
        <div className="rounded-2xl border p-4 gap-4" style={{ borderColor: BORDER, background: SOFT }}>
          <div className="grid gap-4 grid-cols-[1fr_1.2fr] h-[calc(100vh-320px)]">
            {/* LEFT: Worker list */}
            <div className="flex flex-col overflow-hidden">
              <div className="mb-4">
                <label className="text-xs font-semibold uppercase" style={{ color: MUTED }}>{translate("team.shifts.selectWorker")}</label>
                <p className="text-[10px] mt-1" style={{ color: MUTED }}>{translate("team.shifts.selectWorkerHint")}</p>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 border rounded-xl p-3" style={{ borderColor: BORDER, background: "var(--cc-bg)" }}>
                {workers.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => { setSelectedWorkerForShift(w); setShiftFormOpen(false); }}
                    className="w-full text-left rounded-lg p-3 transition-all"
                    style={{
                      background: selectedWorkerForShift?.id === w.id ? "var(--cc-text)" : "transparent",
                      color: selectedWorkerForShift?.id === w.id ? "#fff" : TEXT,
                      border: `1px solid ${selectedWorkerForShift?.id === w.id ? "var(--cc-text)" : BORDER}`,
                    }}
                  >
                    <p className="font-semibold text-[13px]">{w.full_name}</p>
                    <p className="text-[11px] mt-1" style={{ color: selectedWorkerForShift?.id === w.id ? "rgba(255,255,255,0.8)" : MUTED }}>
                      {translateParams("team.sessionsCount", { count: String(w.total_sessions) })}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* RIGHT: Shift assignment form */}
            <div className="flex flex-col overflow-hidden">
              {selectedWorkerForShift ? (
                <div className="rounded-2xl border p-6 space-y-4 h-full overflow-y-auto flex flex-col" style={{ borderColor: BORDER, background: SOFT }}>
                  <div className="flex items-center justify-between shrink-0">
                    <h3 className="font-bold text-[15px]" style={{ color: TEXT }}>
                      {translateParams("team.shifts.assignTitle", { name: selectedWorkerForShift.full_name })}
                    </h3>
                    <button
                      onClick={() => setSelectedWorkerForShift(null)}
                      className="p-1 rounded hover:bg-gray-200 transition"
                      style={{ color: MUTED }}
                    >
                      ?
                    </button>
                  </div>

                  {!shiftFormOpen ? (
                    <div className="text-center flex-1 flex items-center justify-center">
                      <div>
                        <p className="font-bold text-sm" style={{ color: TEXT }}>{translate("team.shifts.createOrManage")}</p>
                        <p className="text-xs mt-1 mb-4" style={{ color: MUTED }}>{translate("team.shifts.createHint")}</p>
                        <Button
                          variant="navy"
                          className="rounded-xl gap-2"
                          onClick={() => setShiftFormOpen(true)}
                        >
                          <Plus size={16} /> {translate("team.shifts.createShift")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => setShiftFormOpen(false)}
                        className="text-xs font-bold mb-2"
                        style={{ color: PLUM }}
                      >
                        {translate("team.shifts.backToOptions")}
                      </button>
                      <ShiftAssignmentModal
                        open={true}
                        onOpenChange={() => setShiftFormOpen(false)}
                        workers={[selectedWorkerForShift]}
                      />
                    </>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border p-6 text-center h-full flex items-center justify-center" style={{ borderColor: BORDER, background: SOFT }}>
                  <div>
                    <Clock size={32} style={{ color: BORDER, margin: "0 auto" }} />
                    <p className="font-bold mt-3" style={{ color: TEXT }}>{translate("team.shifts.empty.title")}</p>
                    <p className="text-sm mt-1" style={{ color: MUTED }}>{translate("team.shifts.empty.hint")}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </IndexTemplate>
  );
}

function CredentialChip({ label, status }: { label: string; status: "verified" | "inactive" | "warn" | "info" }) {
  const config = {
    verified: { bg: "#DCFCE7", color: "#16A34A", Icon: CheckCircle2 },
    inactive: { bg: "#F3F4F6", color: "var(--cc-muted)", Icon: XCircle },
    warn:     { bg: "#FEF3C7", color: "#D97706", Icon: AlertTriangle },
    info:     { bg: "#F2EBFD", color: "#4F46E5", Icon: FileText },
  }[status];
  const { bg, color, Icon } = config;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: bg, color }}>
      <Icon size={10} /> {label}
    </span>
  );
}
