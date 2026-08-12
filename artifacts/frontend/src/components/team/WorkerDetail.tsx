import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, Clock3,
  GraduationCap, Plus, Check, X as XIcon, FileText, Download, Trash2, Upload,
} from "lucide-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  getTeamCredentials, getTrainingModules, getWorkerTrainingAssignments,
  assignTraining, dismissTrainingAssignment, reviewTrainingCompletion, createTrainingModule,
  getWorkerOnboardingDocuments, uploadWorkerOnboardingDocument, deleteWorkerOnboardingDocument,
  type WorkerStats, type TrainingModule, type WorkerOnboardingDocument, type WorkerOnboardingDocumentType,
} from "@/services/coordinatorService";
import type { Credential } from "@/services/credentialsService";
import { WorkerAvailabilityPanel } from "@/components/coordinator/WorkerAvailabilityPanel";
import { safeFormat } from "@/lib/participant-format";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PLUM = "var(--cc-plum)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const SURFACE = "var(--cc-surface)";
const CARD_SHADOW = "var(--cc-card-shadow)";

type WorkerDetailTab = "overview" | "documents" | "credentials" | "availability" | "training" | "compliance";

/** Mandatory credential types every worker is expected to have on file. */
export const REQUIRED_CREDENTIAL_TYPES = [
  "ndis_screening",
  "wwcc",
  "code_of_conduct",
  "first_aid",
  "cpr",
  "manual_handling",
  "infection_control",
  "medication_admin",
];

const CREDENTIAL_TYPE_LABELS: Record<string, string> = {
  ndis_screening: "NDIS Worker Screening Check",
  wwcc: "Working With Children Check",
  code_of_conduct: "NDIS Code of Conduct",
  first_aid: "First Aid",
  cpr: "CPR",
  manual_handling: "Manual Handling",
  infection_control: "Infection Control",
  medication_admin: "Medication Administration",
  drivers_licence: "Driver's Licence",
  police_check: "Police Check",
};

/** A worker is "verified" once every mandatory credential type is on file and valid/expiring (not missing/expired/rejected). */
export function isWorkerCredentialsComplete(credentials: Credential[], workerId: string): boolean {
  const workerCreds = credentials.filter((c) => c.user_id === workerId);
  const byType = new Map(workerCreds.map((c) => [c.credential_type, c]));
  return REQUIRED_CREDENTIAL_TYPES.every((type) => {
    const cred = byType.get(type);
    return !!cred && (cred.status === "valid" || cred.status === "expiring");
  });
}

function credentialLabel(type: string) {
  return CREDENTIAL_TYPE_LABELS[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusStyle(status: string) {
  switch (status) {
    case "valid":
      return { bg: "var(--cc-status-success-bg)", color: "var(--cc-status-success)", Icon: CheckCircle2, label: "Valid" };
    case "expiring":
      return { bg: "var(--cc-status-warning-bg)", color: "var(--cc-status-warning)", Icon: Clock3, label: "Expiring soon" };
    case "expired":
      return { bg: "var(--cc-status-danger-bg)", color: "var(--cc-status-danger)", Icon: AlertTriangle, label: "Expired" };
    case "pending_review":
      return { bg: "var(--cc-status-info-bg)", color: "var(--cc-status-info)", Icon: Clock3, label: "Pending review" };
    case "rejected":
      return { bg: "var(--cc-status-danger-bg)", color: "var(--cc-status-danger)", Icon: XCircle, label: "Rejected" };
    default:
      return { bg: SOFT, color: MUTED, Icon: XCircle, label: "Not on file" };
  }
}

function complianceColour(score: number | null | undefined): string {
  if (score == null) return MUTED;
  if (score >= 85) return "var(--cc-status-success)";
  if (score >= 60) return "var(--cc-status-warning)";
  return "var(--cc-status-danger)";
}

export function WorkerDetail({ worker, onBack }: { worker: WorkerStats; onBack: () => void }) {
  const { translate } = useAccessibility();
  const [tab, setTab] = useState<WorkerDetailTab>("overview");

  const credentialsQuery = useOrgQuery(["team-credentials"], {
    queryFn: getTeamCredentials,
  });

  const workerCredentials = (credentialsQuery.data ?? []).filter((c: Credential) => c.user_id === worker.id);

  return (
    <div className="space-y-4">
      {/* Back + identity header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-bold transition-colors"
          style={{ color: PLUM }}
        >
          <ArrowLeft size={15} /> {translate("team.detail.back")}
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl p-5" style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
        <div
          className="h-14 w-14 rounded-full shrink-0 flex items-center justify-center text-lg font-black"
          style={{ background: PLUM, color: "#fff" }}
        >
          {(worker.full_name || "?").charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-black truncate" style={{ color: TEXT }}>{worker.full_name}</h2>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{
                background: worker.is_active !== false ? "var(--cc-status-success-bg)" : "var(--cc-status-danger-bg)",
                color: worker.is_active !== false ? "var(--cc-status-success)" : "var(--cc-status-danger)",
              }}
            >
              {worker.is_active !== false ? translate("team.status.active") : translate("team.status.inactive")}
            </span>
          </div>
          <p className="text-xs mt-0.5" style={{ color: MUTED }}>
            {translate("team.detail.workerId")}: <span className="font-bold" style={{ color: TEXT }}>{worker.employee_id || worker.id}</span>
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl p-1" style={{ background: SOFT }}>
        {(["overview", "documents", "credentials", "availability", "training", "compliance"] as WorkerDetailTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 rounded-lg py-2 text-sm font-bold transition-colors"
            style={{
              background: tab === t ? "var(--cc-bg)" : "transparent",
              color: tab === t ? PLUM : MUTED,
              boxShadow: tab === t ? "0 1px 3px rgba(55,48,163,0.12)" : "none",
            }}
          >
            {translate(`team.detail.tab.${t}` as "team.detail.tab.overview")}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab worker={worker} translate={translate} />}
      {tab === "documents" && <DocumentsTab worker={worker} translate={translate} />}
      {tab === "credentials" && (
        <CredentialsTab
          credentials={workerCredentials}
          isLoading={credentialsQuery.isLoading}
          translate={translate}
        />
      )}
      {tab === "availability" && <WorkerAvailabilityPanel worker={worker} />}
      {tab === "training" && <TrainingTab worker={worker} translate={translate} />}
      {tab === "compliance" && <ComplianceTab worker={worker} translate={translate} />}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{label}</dt>
      <dd className="text-sm font-semibold mt-0.5" style={{ color: TEXT }}>{value || "—"}</dd>
    </div>
  );
}

function OverviewTab({ worker, translate }: { worker: WorkerStats; translate: (k: string) => string }) {
  return (
    <div className="rounded-2xl p-5" style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-5">
        <Field label={translate("team.detail.workerId")} value={worker.employee_id || worker.id} />
        <Field label={translate("team.col.email")} value={worker.email} />
        <Field label={translate("team.detail.phone")} value={worker.phone} />
        <Field label={translate("team.col.role")} value={(worker.role || "").replace(/_/g, " ")} />
        <Field label={translate("team.detail.joined")} value={safeFormat(worker.joined_at)} />
        <Field label={translate("team.detail.lastLogin")} value={worker.last_login ? safeFormat(worker.last_login, "MMM d, yyyy h:mm a") : "—"} />
        <Field label={translate("team.detail.preferredContact")} value={worker.preferred_contact_method} />
      </dl>
    </div>
  );
}

function CredentialsTab({
  credentials,
  isLoading,
  translate,
}: {
  credentials: Credential[];
  isLoading: boolean;
  translate: (k: string) => string;
}) {
  const byType = new Map(credentials.map((c) => [c.credential_type, c]));
  const rows = REQUIRED_CREDENTIAL_TYPES.map((type) => ({ type, credential: byType.get(type) ?? null }));
  const extras = credentials.filter((c) => !REQUIRED_CREDENTIAL_TYPES.includes(c.credential_type));

  if (isLoading) {
    return <p className="text-sm" style={{ color: MUTED }}>{translate("common.loading")}</p>;
  }

  return (
    <div className="rounded-2xl divide-y" style={{ background: SURFACE, boxShadow: CARD_SHADOW, borderColor: BORDER }}>
      {[...rows, ...extras.map((c) => ({ type: c.credential_type, credential: c }))].map(({ type, credential }, i) => {
        const style = statusStyle(credential?.status ?? "missing");
        const { Icon } = style;
        return (
          <div key={`${type}-${i}`} className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="min-w-0">
              <p className="text-sm font-bold" style={{ color: TEXT }}>{credentialLabel(type)}</p>
              <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                {credential
                  ? [
                      credential.credential_number ? `#${credential.credential_number}` : null,
                      credential.issuer,
                      credential.expiry_date ? `Expires ${safeFormat(credential.expiry_date)}` : null,
                    ].filter(Boolean).join(" · ") || translate("team.detail.onFile")
                  : translate("team.detail.notOnFile")}
              </p>
            </div>
            <span
              className="inline-flex items-center gap-1.5 shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full"
              style={{ background: style.bg, color: style.color }}
            >
              <Icon size={12} /> {style.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function completionStatusStyle(status: string) {
  switch (status) {
    case "confirmed":
      return { bg: "var(--cc-status-success-bg)", color: "var(--cc-status-success)", label: "Completed" };
    case "awaiting_confirmation":
      return { bg: "var(--cc-status-warning-bg)", color: "var(--cc-status-warning)", label: "Awaiting review" };
    case "rejected":
      return { bg: "var(--cc-status-danger-bg)", color: "var(--cc-status-danger)", label: "Rejected" };
    default:
      return { bg: SOFT, color: MUTED, label: status };
  }
}

function TrainingTab({ worker, translate }: { worker: WorkerStats; translate: (k: string) => string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);

  const assignmentsQuery = useOrgQuery(["worker-training-assignments", worker.id], {
    queryFn: () => getWorkerTrainingAssignments(worker.id),
  });

  const dismissMut = useMutation({
    mutationFn: (id: string) => dismissTrainingAssignment(id),
    onSuccess: () => { qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("worker-training-assignments") }); toast({ title: "Assignment removed" }); },
  });

  const reviewMut = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) => reviewTrainingCompletion(id, approved),
    onSuccess: () => { qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("worker-training-assignments") }); toast({ title: "Training completion reviewed" }); },
  });

  const recommendations = assignmentsQuery.data?.recommendations ?? [];
  const history = assignmentsQuery.data?.history ?? [];
  const completedModuleIds = new Set(history.map((h) => h.module_id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GraduationCap size={16} style={{ color: PLUM }} />
          <p className="text-sm font-black" style={{ color: TEXT }}>{translate("team.training.title")}</p>
        </div>
        <Button variant="navy" size="sm" className="gap-1.5 rounded-xl" onClick={() => setAssignOpen(true)}>
          <Plus size={13} /> {translate("team.training.assign")}
        </Button>
      </div>

      {assignmentsQuery.isLoading && <p className="text-sm" style={{ color: MUTED }}>{translate("common.loading")}</p>}

      {!assignmentsQuery.isLoading && recommendations.length === 0 && history.length === 0 && (
        <div className="rounded-2xl p-8 text-center" style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
          <GraduationCap size={28} className="mx-auto mb-2" style={{ color: MUTED }} />
          <p className="text-sm font-bold" style={{ color: MUTED }}>{translate("team.training.empty")}</p>
        </div>
      )}

      {recommendations.filter((r) => !completedModuleIds.has(r.training_module_id)).length > 0 && (
        <div className="rounded-2xl divide-y" style={{ background: SURFACE, boxShadow: CARD_SHADOW, borderColor: BORDER }}>
          {recommendations.filter((r) => !completedModuleIds.has(r.training_module_id)).map((rec) => (
            <div key={rec.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="text-sm font-bold" style={{ color: TEXT }}>{rec.title}</p>
                <p className="text-xs mt-0.5" style={{ color: MUTED }}>{translate("team.training.assignedOn")} {safeFormat(rec.recommended_at)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: "var(--cc-status-info-bg)", color: "var(--cc-status-info)" }}>
                  {translate("team.training.inProgress")}
                </span>
                <button
                  onClick={() => dismissMut.mutate(rec.id)}
                  className="rounded-lg p-1.5 hover:bg-black/5"
                  title={translate("team.training.remove")}
                  aria-label={translate("team.training.remove")}
                >
                  <XIcon size={13} style={{ color: MUTED }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.14em] mb-2" style={{ color: MUTED }}>{translate("team.training.history")}</p>
          <div className="rounded-2xl divide-y" style={{ background: SURFACE, boxShadow: CARD_SHADOW, borderColor: BORDER }}>
            {history.map((h) => {
              const style = completionStatusStyle(h.status);
              return (
                <div key={h.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-bold" style={{ color: TEXT }}>{h.training_modules?.title ?? translate("team.training.module")}</p>
                    <p className="text-xs mt-0.5" style={{ color: MUTED }}>{translate("team.training.completedOn")} {safeFormat(h.completed_at)}</p>
                    {h.note && <p className="text-xs mt-0.5 italic" style={{ color: MUTED }}>"{h.note}"</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {h.status === "awaiting_confirmation" ? (
                      <>
                        <Button size="sm" variant="outline" className="text-xs gap-1 text-green-700 border-green-200 hover:bg-green-50" onClick={() => reviewMut.mutate({ id: h.id, approved: true })}>
                          <Check size={12} /> {translate("team.training.approve")}
                        </Button>
                        <Button size="sm" variant="outline" className="text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50" onClick={() => reviewMut.mutate({ id: h.id, approved: false })}>
                          <XIcon size={12} /> {translate("team.training.reject")}
                        </Button>
                      </>
                    ) : (
                      <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: style.bg, color: style.color }}>
                        {style.label}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <AssignTrainingDialog open={assignOpen} onOpenChange={setAssignOpen} worker={worker} translate={translate} />
    </div>
  );
}

function AssignTrainingDialog({
  open, onOpenChange, worker, translate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worker: WorkerStats;
  translate: (k: string) => string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const modulesQuery = useOrgQuery(["training-modules"], {
    queryFn: getTrainingModules,
    enabled: open,
  });
  const modules = modulesQuery.data ?? [];

  const createModuleMut = useMutation({
    mutationFn: () => createTrainingModule({ title: newTitle.trim(), description: newDescription.trim() || undefined }),
    onSuccess: (mod: TrainingModule) => {
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("training-modules") });
      assignMut.mutate({ id: mod.id, title: mod.title });
    },
    onError: () => toast({ title: "Failed to create module", variant: "destructive" }),
  });

  const assignMut = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => assignTraining(worker.id, id, title),
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("worker-training-assignments") });
      toast({ title: translate("team.training.assignedToast") });
      onOpenChange(false);
      setSelectedModuleId("");
      setNewTitle("");
      setNewDescription("");
      setMode("existing");
    },
    onError: () => toast({ title: "Failed to assign training", variant: "destructive" }),
  });

  const handleAssign = () => {
    if (mode === "new") {
      if (!newTitle.trim()) return;
      createModuleMut.mutate();
    } else {
      const mod = modules.find((m) => m.id === selectedModuleId);
      if (!mod) return;
      assignMut.mutate({ id: mod.id, title: mod.title });
    }
  };

  const pending = createModuleMut.isPending || assignMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl" style={{ background: SURFACE }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: TEXT }}>
            <GraduationCap size={18} style={{ color: PLUM }} /> {translate("team.training.assignTo").replace("{name}", worker.full_name)}
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 rounded-xl p-1" style={{ background: SOFT }}>
          {(["existing", "new"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors"
              style={{ background: mode === m ? "var(--cc-bg)" : "transparent", color: mode === m ? PLUM : MUTED }}
            >
              {m === "existing" ? translate("team.training.pickExisting") : translate("team.training.createNew")}
            </button>
          ))}
        </div>

        {mode === "existing" ? (
          <div className="space-y-1.5 py-1">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{translate("team.training.module")}</label>
            {modules.length === 0 && !modulesQuery.isLoading ? (
              <p className="text-xs" style={{ color: MUTED }}>{translate("team.training.noModules")}</p>
            ) : (
              <Select value={selectedModuleId} onValueChange={setSelectedModuleId}>
                <SelectTrigger>
                  <SelectValue placeholder={translate("team.training.chooseModule")} />
                </SelectTrigger>
                <SelectContent>
                  {modules.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        ) : (
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{translate("team.training.moduleTitle")}</label>
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={translate("team.training.moduleTitlePlaceholder")} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{translate("team.training.moduleDescription")}</label>
              <Input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder={translate("team.training.moduleDescriptionPlaceholder")} />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{translate("common.cancel")}</Button>
          <Button
            variant="navy"
            onClick={handleAssign}
            disabled={pending || (mode === "existing" ? !selectedModuleId : !newTitle.trim())}
          >
            {pending ? translate("common.saving") : translate("team.training.assign")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ComplianceTab({ worker, translate }: { worker: WorkerStats; translate: (k: string) => string }) {
  const tiles = [
    { label: translate("team.col.sessions"), value: worker.total_sessions, color: TEXT },
    { label: translate("team.col.thisWeek"), value: worker.sessions_this_week, color: TEXT },
    {
      label: translate("team.col.compliance"),
      value: worker.avg_compliance != null ? `${worker.avg_compliance}%` : "—",
      color: complianceColour(worker.avg_compliance),
    },
    { label: translate("team.detail.draftCount"), value: worker.draft_count, color: TEXT },
    { label: translate("team.detail.flaggedCount"), value: worker.flagged_count, color: worker.flagged_count > 0 ? "var(--cc-status-danger)" : TEXT },
  ];
  return (
    <div className="rounded-2xl p-5" style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck size={16} style={{ color: complianceColour(worker.avg_compliance) }} />
        <p className="text-sm font-black" style={{ color: TEXT }}>{translate("team.detail.complianceSummary")}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl px-4 py-3" style={{ background: SOFT }}>
            <p className="text-[11px] font-medium" style={{ color: MUTED }}>{tile.label}</p>
            <p className="text-lg font-black tabular-nums mt-0.5" style={{ color: tile.color }}>{tile.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
