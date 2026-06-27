import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  Mail, UserPlus, Users, ShieldCheck, AlertTriangle, Clock,
  FileText, CheckCircle2, XCircle, ToggleLeft, ToggleRight,
  UserCheck, UserX, Loader2, ChevronRight, Link2,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { jsonFetch } from "@/services/http";
import { useAuth } from "@/contexts/AuthContext";

const PLUM  = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const TEXT  = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT  = "#F8F8FE";

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

type Tab = "overview" | "management";

export default function Team() {
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
  const [shiftAssignmentOpen, setShiftAssignmentOpen] = useState(false);

  const { user, isAuthenticated } = useAuth();

  const orgId = user?.organizationId ?? "__no_org__";

  const stats = useOrgQuery(["coordinator", "worker-stats"], {
    queryFn: getCoordinatorWorkerStats,
  });

  const credentialAlerts = useOrgQuery(["coordinator-credential-alerts"], {
    queryFn: getCoordinatorCredentialAlerts,
  });

  const participants = useGetParticipants({
    query: { enabled: isAuthenticated && !!user?.organizationId },
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => deactivateWorker(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [orgId, "coordinator"] }); toast({ title: "Worker deactivated" }); setDeactivateTarget(null); },
    onError: () => toast({ title: "Failed to deactivate", variant: "destructive" }),
  });

  const activateMut = useMutation({
    mutationFn: (id: string) => activateWorker(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [orgId, "coordinator"] }); toast({ title: "Worker reactivated" }); },
    onError: () => toast({ title: "Failed to reactivate", variant: "destructive" }),
  });

  const assignMut = useMutation({
    mutationFn: ({ workerId, patientId }: { workerId: string; patientId: string }) =>
      assignWorkerToClient(workerId, patientId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [orgId, "coordinator"] }); toast({ title: "Client assigned" }); setAssignWorker(null); setAssignPatientId(""); },
    onError: () => toast({ title: "Assignment failed", variant: "destructive" }),
  });

  const reminderMut = useMutation({
    mutationFn: (workerId: string) => sendBulkReminders([workerId], "Your credential is expiring soon. Please update it before your next shift."),
    onSuccess: (_, workerId) => {
      qc.invalidateQueries({ queryKey: [orgId, "coordinator-credential-alerts"] });
      toast({ title: "Reminder sent", description: `Credential reminder sent to ${workerId}.` });
    },
    onError: () => toast({ title: "Failed to send reminder", variant: "destructive" }),
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
      toast({ title: "Invite sent", description: `${inviteEmail} has been invited as ${roleLabel(inviteRole)}.` });
      setInviteOpen(false);
      setInviteEmail("");
    } catch {
      toast({ title: "Invite failed", description: "Check the email and try again.", variant: "destructive" });
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
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="hidden" style={{ color: CORAL }}>Support Coordinator</p>
          <h1 className="text-xl font-black tracking-tight" style={{ color: PLUM }}>Team</h1>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>{workers.length} team member{workers.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setShiftAssignmentOpen(true)}
            className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black text-white"
            style={{ background: PLUM }}
          >
            <Clock size={16} /> Assign Shift
          </Button>
          <Button
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black text-white"
            style={{ background: PLUM }}
          >
            <UserPlus size={16} /> Invite Worker
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl p-1" style={{ background: SOFT }}>
        {(["overview", "management"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 rounded-lg py-2 text-sm font-bold capitalize transition-colors"
            style={{
              background: tab === t ? "var(--cc-bg)" : "transparent",
              color: tab === t ? PLUM : MUTED,
              boxShadow: tab === t ? "0 1px 3px rgba(55,48,163,0.12)" : "none",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ─────────────────────────────────── */}
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
                <Loader2 className="h-4 w-4 animate-spin" /> Loading worker stats…
              </div>
            )}
            {stats.error && <p className="text-sm text-red-600">Failed to load worker stats.</p>}

            {!stats.isLoading && workers.length > 0 && (
              <div className="grid lg:grid-cols-[1fr_220px] gap-5 items-start">

                {/* LEFT — worker table */}
                <div className="rounded-xl border overflow-x-auto" style={{ borderColor: BORDER, background: "var(--cc-bg)" }}>
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: `2px solid ${BORDER}`, background: SOFT }}>
                        <th className="px-5 py-3.5 text-left text-xs font-bold uppercase" style={{ color: MUTED }}>Name</th>
                        <th className="px-5 py-3.5 text-left text-xs font-bold uppercase hidden md:table-cell" style={{ color: MUTED }}>Email</th>
                        <th className="px-5 py-3.5 text-left text-xs font-bold uppercase hidden sm:table-cell" style={{ color: MUTED }}>Role</th>
                        <th className="px-5 py-3.5 text-center text-xs font-bold uppercase" style={{ color: MUTED }}>Sessions</th>
                        <th className="px-5 py-3.5 text-center text-xs font-bold uppercase hidden sm:table-cell" style={{ color: MUTED }}>This Week</th>
                        <th className="px-5 py-3.5 text-center text-xs font-bold uppercase" style={{ color: MUTED }}>Compliance</th>
                        <th className="px-5 py-3.5 text-center text-xs font-bold uppercase" style={{ color: MUTED }}>Status</th>
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
                                <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: CORAL }}>
                                  <AlertTriangle size={11} />
                                  {summary.expired > 0 ? `${summary.expired} expired` : `${summary.expiring} expiring`}
                                </p>
                              )}
                            </td>
                            <td className="px-5 py-3.5 hidden md:table-cell">
                              <p className="text-sm truncate max-w-[180px]" style={{ color: MUTED }}>{w.email || "—"}</p>
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
                                  {w.avg_compliance != null ? `${w.avg_compliance}%` : "—"}
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
                                {w.is_active !== false ? "Active" : "Inactive"}
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
                  <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>Team snapshot</p>

                  {/* Stat tiles */}
                  {[
                    { label: "Active workers",   value: activeCount,       color: "#16A34A", bg: "rgba(22,163,74,0.06)"  },
                    { label: "Sessions this wk", value: weekSessions,      color: PLUM,      bg: "rgba(55,48,163,0.06)"  },
                    { label: "Avg compliance",   value: avgCompliance != null ? `${avgCompliance}%` : "—",
                      color: avgCompliance != null ? complianceColour(avgCompliance) : MUTED,
                      bg: "rgba(55,48,163,0.04)" },
                  ].map(({ label, value, color, bg }) => (
                    <div key={label} className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: bg }}>
                      <span className="text-[11px] font-medium" style={{ color: MUTED }}>{label}</span>
                      <span className="text-[15px] font-black tabular-nums" style={{ color }}>{value}</span>
                    </div>
                  ))}

                  {/* Credential alert callout */}
                  {credAlertCount > 0 && (
                    <div className="rounded-xl px-4 py-3 space-y-1" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.18)" }}>
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle size={13} style={{ color: "#D97706" }} />
                        <p className="text-[11px] font-black" style={{ color: "#D97706" }}>
                          {credAlertCount} credential{credAlertCount !== 1 ? "s" : ""} expiring
                        </p>
                      </div>
                      <p className="text-[10px] font-medium" style={{ color: MUTED }}>
                        Review in the Credentials page before next shift assignments.
                      </p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setTab("management")}
                    className="w-full rounded-xl px-4 py-2.5 text-[12px] font-black transition hover:opacity-90 text-white"
                    style={{ background: PLUM }}
                  >
                    Manage Team →
                  </button>
                </div>
              </div>
            )}

            {!stats.isLoading && workers.length === 0 && (
              <div className="rounded-2xl bg-white p-10 text-center" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
                <Users size={32} className="mx-auto mb-3" style={{ color: MUTED }} />
                <p className="text-sm font-bold" style={{ color: MUTED }}>No team members yet. Invite workers to get started.</p>
              </div>
            )}
          </>
        );
      })()}

      {/* ── MANAGEMENT TAB ───────────────────────────────── */}
      {tab === "management" && (
        <div className="space-y-4">
          {stats.isLoading && <p className="text-sm" style={{ color: MUTED }}>Loading…</p>}
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
                    style={{ background: PLUM }}
                  >
                    {(w.full_name || "?")[0].toUpperCase()}
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
                    <Link2 size={12} /> Assign Client
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5 border-amber-200 text-amber-700 hover:bg-amber-50"
                    onClick={() => reminderMut.mutate(w.id)}
                    disabled={reminderMut.isPending}
                  >
                    <Mail size={12} /> Reminder
                  </Button>

                  {/* Activate / Deactivate */}
                  {w.is_active !== false ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => setDeactivateTarget(w)}
                    >
                      <UserX size={12} /> Deactivate
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs gap-1.5 text-green-700 border-green-200 hover:bg-green-50"
                      onClick={() => activateMut.mutate(w.id)}
                      disabled={activateMut.isPending}
                    >
                      <UserCheck size={12} /> Reactivate
                    </Button>
                  )}
                </div>
              </div>

              {/* Credential status strip */}
              <div className="mt-3 flex flex-wrap gap-2">
                <CredentialChip
                  label="WWCC"
                  status={getCredentialSummary(w.id).expired > 0 ? "warn" : w.is_active !== false ? "verified" : "inactive"}
                />
                <CredentialChip
                  label="First Aid"
                  status={getCredentialSummary(w.id).expiring > 0 ? "warn" : w.is_active !== false ? "verified" : "inactive"}
                />
                <CredentialChip
                  label={`${w.total_sessions} sessions`}
                  status="info"
                />
                {w.flagged_count > 0 && (
                  <CredentialChip label={`${w.flagged_count} flagged`} status="warn" />
                )}
              </div>
            </div>
          ))}

          {!stats.isLoading && workers.length === 0 && (
            <div className="rounded-2xl bg-white p-10 text-center" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
              <Users size={32} className="mx-auto mb-3" style={{ color: MUTED }} />
              <p className="text-sm font-bold" style={{ color: MUTED }}>No team members yet.</p>
            </div>
          )}
        </div>
      )}

      {inviteOpen && (
        <section className="rounded-2xl bg-white p-5 space-y-4" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.08), 0 0 0 1px rgba(232,213,232,0.5)" }}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-black flex items-center gap-2" style={{ color: PLUM }}>
              <UserPlus size={18} /> Invite Team Member
            </h3>
            <Button variant="outline" size="sm" onClick={() => setInviteOpen(false)}>Close</Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Email Address</label>
              <Input
                type="email"
                placeholder="worker@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Role</label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="support_worker">Support Worker</SelectItem>
                  <SelectItem value="allied_health">Allied Health</SelectItem>
                  <SelectItem value="support_coordinator">Support Coordinator</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button
              onClick={handleInvite}
              disabled={!inviteEmail.trim() || inviteSending}
              className="text-white"
              style={{ background: PLUM }}
            >
              {inviteSending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending…</> : "Send Invite"}
            </Button>
          </div>
        </section>
      )}

      {deactivateTarget && (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5 space-y-3">
          <h3 className="text-base font-black text-red-700">Deactivate {deactivateTarget.full_name}?</h3>
          <p className="text-sm text-red-700">
            This worker will lose access to CareCliQ immediately. Their existing session records will be preserved. You can reactivate them at any time.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeactivateTarget(null)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deactivateMut.mutate(deactivateTarget.id)}
              disabled={deactivateMut.isPending}
            >
              {deactivateMut.isPending ? "Deactivating…" : "Yes, Deactivate"}
            </Button>
          </div>
        </section>
      )}

      {assignWorker && (
        <section className="rounded-2xl bg-white p-5 space-y-4" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.08), 0 0 0 1px rgba(232,213,232,0.5)" }}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-black" style={{ color: PLUM }}>
              Assign Client to {assignWorker.full_name}
            </h3>
            <Button variant="outline" size="sm" onClick={() => { setAssignWorker(null); setAssignPatientId(""); }}>Close</Button>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Select Participant</label>
            <Select value={assignPatientId} onValueChange={setAssignPatientId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a participant…" />
              </SelectTrigger>
              <SelectContent>
                {allParticipants.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setAssignWorker(null); setAssignPatientId(""); }}>Cancel</Button>
            <Button
              onClick={() => assignPatientId && assignMut.mutate({ workerId: assignWorker.id, patientId: assignPatientId })}
              disabled={!assignPatientId || assignMut.isPending}
              className="text-white"
              style={{ background: PLUM }}
            >
              {assignMut.isPending ? "Assigning…" : "Assign"}
            </Button>
          </div>
        </section>
      )}

      {/* Shift Assignment Modal */}
      <ShiftAssignmentModal
        open={shiftAssignmentOpen}
        onOpenChange={setShiftAssignmentOpen}
        workers={workers}
      />
    </div>
  );
}

function CredentialChip({ label, status }: { label: string; status: "verified" | "inactive" | "warn" | "info" }) {
  const config = {
    verified: { bg: "#DCFCE7", color: "#16A34A", Icon: CheckCircle2 },
    inactive: { bg: "#F3F4F6", color: "var(--cc-muted)", Icon: XCircle },
    warn:     { bg: "#FEF3C7", color: "#D97706", Icon: AlertTriangle },
    info:     { bg: "#EEF2FF", color: "#4F46E5", Icon: FileText },
  }[status];
  const { bg, color, Icon } = config;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: bg, color }}>
      <Icon size={10} /> {label}
    </span>
  );
}
