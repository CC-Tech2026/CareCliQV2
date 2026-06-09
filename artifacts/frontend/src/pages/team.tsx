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
  type WorkerStats,
} from "@/services/coordinatorService";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { jsonFetch } from "@/services/http";
import { useAuth } from "@/contexts/AuthContext";

const PLUM  = "#5533CC";
const CORAL = "#F03060";
const TEXT  = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT  = "#F5F3FC";

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

  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const stats = useOrgQuery(["coordinator", "worker-stats"], { queryFn: getCoordinatorWorkerStats });
  const participants = useGetParticipants();

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

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>Support Coordinator</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>Team</h1>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>{workers.length} team member{workers.length !== 1 ? "s" : ""}</p>
        </div>
        <Button
          onClick={() => setInviteOpen(true)}
          className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black text-white"
          style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
        >
          <UserPlus size={16} /> Invite Worker
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl p-1" style={{ background: SOFT }}>
        {(["overview", "management"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 rounded-lg py-2 text-sm font-bold capitalize transition-colors"
            style={{
              background: tab === t ? "#fff" : "transparent",
              color: tab === t ? PLUM : MUTED,
              boxShadow: tab === t ? "0 1px 3px rgba(85,51,204,0.12)" : "none",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ─────────────────────────────────── */}
      {tab === "overview" && (
        <>
          {stats.isLoading && (
            <div className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
              <Loader2 className="h-4 w-4 animate-spin" /> Loading worker stats…
            </div>
          )}
          {stats.error && (
            <p className="text-sm text-red-600">Failed to load worker stats.</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workers.map((w) => (
              <div
                key={w.id}
                className="rounded-2xl bg-white p-5 space-y-4"
                style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.08), 0 0 0 1px rgba(232,213,232,0.5)" }}
              >
                {/* Worker identity */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-black text-sm truncate" style={{ color: TEXT }}>{w.full_name}</p>
                    <p className="text-xs flex items-center gap-1 truncate" style={{ color: MUTED }}>
                      <Mail size={11} /> {w.email || "No email"}
                    </p>
                    <span
                      className="mt-1 inline-block text-[10px] font-bold px-2 py-0.5 rounded-full capitalize"
                      style={{ background: SOFT, color: PLUM }}
                    >
                      {roleLabel(w.role)}
                    </span>
                  </div>
                  <span
                    className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{
                      background: w.is_active !== false ? "#DCFCE7" : "#FEE2E2",
                      color: w.is_active !== false ? "#16A34A" : "#DC2626",
                    }}
                  >
                    {w.is_active !== false ? "Active" : "Inactive"}
                  </span>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: "Sessions", value: w.total_sessions },
                    { label: "This week", value: w.sessions_this_week },
                    { label: "Drafts", value: w.draft_count },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-lg p-2" style={{ background: SOFT }}>
                      <p className="text-base font-black" style={{ color: PLUM }}>{value}</p>
                      <p className="text-[10px] font-medium" style={{ color: MUTED }}>{label}</p>
                    </div>
                  ))}
                </div>

                {/* Compliance score */}
                <div className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: complianceBg(w.avg_compliance) }}>
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck size={14} style={{ color: complianceColour(w.avg_compliance) }} />
                    <span className="text-xs font-bold" style={{ color: complianceColour(w.avg_compliance) }}>
                      Avg Compliance
                    </span>
                  </div>
                  <span className="text-sm font-black" style={{ color: complianceColour(w.avg_compliance) }}>
                    {w.avg_compliance != null ? `${w.avg_compliance}%` : "No data"}
                  </span>
                </div>

                {/* Flagged count */}
                {w.flagged_count > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-1.5">
                    <AlertTriangle size={12} />
                    {w.flagged_count} session{w.flagged_count > 1 ? "s" : ""} flagged for review
                  </div>
                )}
              </div>
            ))}
          </div>

          {!stats.isLoading && workers.length === 0 && (
            <div className="rounded-2xl bg-white p-10 text-center" style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
              <Users size={32} className="mx-auto mb-3" style={{ color: MUTED }} />
              <p className="text-sm font-bold" style={{ color: MUTED }}>No team members yet. Invite workers to get started.</p>
            </div>
          )}
        </>
      )}

      {/* ── MANAGEMENT TAB ───────────────────────────────── */}
      {tab === "management" && (
        <div className="space-y-4">
          {stats.isLoading && <p className="text-sm" style={{ color: MUTED }}>Loading…</p>}
          {workers.map((w) => (
            <div
              key={w.id}
              className="rounded-2xl bg-white p-5"
              style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.08), 0 0 0 1px rgba(232,213,232,0.5)" }}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                {/* Identity */}
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="h-10 w-10 rounded-full shrink-0 flex items-center justify-center text-sm font-black text-white"
                    style={{ background: `linear-gradient(135deg, ${PLUM}, ${CORAL})` }}
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
                  status={w.is_active !== false ? "verified" : "inactive"}
                />
                <CredentialChip
                  label="First Aid"
                  status={w.is_active !== false ? "verified" : "inactive"}
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
            <div className="rounded-2xl bg-white p-10 text-center" style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
              <Users size={32} className="mx-auto mb-3" style={{ color: MUTED }} />
              <p className="text-sm font-bold" style={{ color: MUTED }}>No team members yet.</p>
            </div>
          )}
        </div>
      )}

      {/* ── INVITE DIALOG ────────────────────────────────── */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" style={{ color: PLUM }}>
              <UserPlus size={18} /> Invite Team Member
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button
              onClick={handleInvite}
              disabled={!inviteEmail.trim() || inviteSending}
              className="text-white"
              style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
            >
              {inviteSending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending…</> : "Send Invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── DEACTIVATE CONFIRMATION ───────────────────────── */}
      <AlertDialog open={!!deactivateTarget} onOpenChange={(o) => { if (!o) setDeactivateTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {deactivateTarget?.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This worker will lose access to CareCliQ immediately. Their existing session records will be preserved. You can reactivate them at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deactivateTarget && deactivateMut.mutate(deactivateTarget.id)}
              disabled={deactivateMut.isPending}
            >
              {deactivateMut.isPending ? "Deactivating…" : "Yes, Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── ASSIGN CLIENT DIALOG ──────────────────────────── */}
      <Dialog open={!!assignWorker} onOpenChange={(o) => { if (!o) { setAssignWorker(null); setAssignPatientId(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle style={{ color: PLUM }}>
              Assign Client to {assignWorker?.full_name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAssignWorker(null); setAssignPatientId(""); }}>Cancel</Button>
            <Button
              onClick={() => assignWorker && assignPatientId && assignMut.mutate({ workerId: assignWorker.id, patientId: assignPatientId })}
              disabled={!assignPatientId || assignMut.isPending}
              className="text-white"
              style={{ background: PLUM }}
            >
              {assignMut.isPending ? "Assigning…" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CredentialChip({ label, status }: { label: string; status: "verified" | "inactive" | "warn" | "info" }) {
  const config = {
    verified: { bg: "#DCFCE7", color: "#16A34A", Icon: CheckCircle2 },
    inactive: { bg: "#F3F4F6", color: "#9CA3AF", Icon: XCircle },
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
