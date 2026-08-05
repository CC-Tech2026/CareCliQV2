import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, AlertTriangle, CheckCircle2, XCircle, Clock3,
  GraduationCap, Plus, Check, X as XIcon, FileText, Download, Trash2, Upload,
  Mail, Phone, BadgeCheck, IdCard, Hourglass, AlertCircle,
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

type WorkerDetailTab = "overview" | "documents" | "credentials" | "availability" | "training";

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
  const credentialsComplete = !credentialsQuery.isLoading && isWorkerCredentialsComplete(credentialsQuery.data ?? [], worker.id);
  const onboardingPending = worker.role === "support_worker" && worker.onboarding_completed === false;

  const statCells: { label: string; value: string | number; color?: string }[] = [
    { label: translate("team.col.sessions"), value: worker.total_sessions },
    { label: translate("team.col.thisWeek"), value: worker.sessions_this_week },
    {
      label: translate("team.col.compliance"),
      value: worker.avg_compliance != null ? `${worker.avg_compliance}%` : "N/A",
      color: complianceColour(worker.avg_compliance),
    },
    { label: translate("team.detail.draftCount"), value: worker.draft_count },
    {
      label: translate("team.detail.flaggedCount"),
      value: worker.flagged_count,
      color: worker.flagged_count > 0 ? "var(--cc-status-danger)" : undefined,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Back */}
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-bold transition-colors"
        style={{ color: PLUM }}
      >
        <ArrowLeft size={15} /> {translate("team.detail.back")}
      </button>

      {/* Identity + at-a-glance header */}
      <div className="rounded-2xl overflow-hidden" style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
        <div className="flex flex-col sm:flex-row sm:items-start gap-4 p-5">
          <div
            className="h-16 w-16 rounded-full shrink-0 flex items-center justify-center text-xl font-black"
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
              {onboardingPending && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: "var(--cc-status-warning-bg)", color: "var(--cc-status-warning)" }}
                >
                  <Hourglass size={10} /> {translate("team.detail.onboardingPending")}
                </span>
              )}
              {worker.training_overdue && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: "var(--cc-status-danger-bg)", color: "var(--cc-status-danger)" }}
                >
                  <AlertCircle size={10} /> {translate("team.detail.trainingOverdue")}
                </span>
              )}
            </div>
            <p className="text-xs mt-1 capitalize" style={{ color: MUTED }}>
              {(worker.role || "").replace(/_/g, " ")}
              <span className="mx-1.5">·</span>
              <span className="font-bold" style={{ color: TEXT }}>{worker.employee_id || worker.id.slice(0, 8)}</span>
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 text-xs" style={{ color: MUTED }}>
              {worker.email && (
                <span className="inline-flex items-center gap-1.5"><Mail size={13} /> {worker.email}</span>
              )}
              {worker.phone && (
                <span className="inline-flex items-center gap-1.5"><Phone size={13} /> {worker.phone}</span>
              )}
            </div>
          </div>
          <div
            className="inline-flex items-center gap-1.5 shrink-0 text-[11px] font-bold px-2.5 py-1.5 rounded-full"
            style={{
              background: credentialsComplete ? "var(--cc-status-success-bg)" : "var(--cc-status-warning-bg)",
              color: credentialsComplete ? "var(--cc-status-success)" : "var(--cc-status-warning)",
            }}
          >
            {credentialsComplete ? <BadgeCheck size={13} /> : <IdCard size={13} />}
            {credentialsComplete ? translate("team.detail.credentialsComplete") : translate("team.detail.credentialsIncomplete")}
          </div>
        </div>

        {/* At-a-glance stat strip */}
        <div className="grid grid-cols-3 sm:grid-cols-5 divide-x" style={{ borderTop: `1px solid ${BORDER}`, borderColor: BORDER }}>
          {statCells.map((cell) => (
            <div key={cell.label} className="px-4 py-3" style={{ borderColor: BORDER }}>
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{cell.label}</p>
              <p className="text-base font-black tabular-nums mt-0.5" style={{ color: cell.color ?? TEXT }}>{cell.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl p-1" style={{ background: SOFT }}>
        {(["overview", "documents", "credentials", "availability", "training"] as WorkerDetailTab[]).map((t) => (
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
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5">
      <p className="text-xs font-bold uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
      <p className="text-sm font-semibold text-right" style={{ color: TEXT }}>{value || "N/A"}</p>
    </div>
  );
}

function OverviewTab({ worker, translate }: { worker: WorkerStats; translate: (k: string) => string }) {
  const onboardingPending = worker.role === "support_worker" && worker.onboarding_completed === false;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl divide-y" style={{ background: SURFACE, boxShadow: CARD_SHADOW, borderColor: BORDER }}>
        <DetailRow label={translate("team.detail.joined")} value={safeFormat(worker.joined_at)} />
        <DetailRow
          label={translate("team.detail.lastLogin")}
          value={worker.last_login ? safeFormat(worker.last_login, "MMM d, yyyy h:mm a") : undefined}
        />
        <DetailRow label={translate("team.detail.preferredContact")} value={worker.preferred_contact_method} />
        <DetailRow
          label={translate("team.detail.onboardingStatus")}
          value={onboardingPending ? translate("team.detail.onboardingPending") : translate("team.detail.onboardingComplete")}
        />
      </div>
    </div>
  );
}

function documentTypeLabel(type: WorkerOnboardingDocumentType, translate: (k: string) => string): string {
  return translate(`team.documents.type.${type}` as "team.documents.type.other");
}

function DocumentsTab({ worker, translate }: { worker: WorkerStats; translate: (k: string) => string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const documentsQuery = useOrgQuery(["worker-onboarding-documents", worker.id], {
    queryFn: () => getWorkerOnboardingDocuments(worker.id),
  });
  const documents = documentsQuery.data ?? [];

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteWorkerOnboardingDocument(id),
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("worker-onboarding-documents") });
      toast({ title: translate("team.documents.removed") });
    },
    onError: () => toast({ title: translate("team.documents.saveFailed"), variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={16} style={{ color: PLUM }} />
          <p className="text-sm font-black" style={{ color: TEXT }}>{translate("team.documents.title")}</p>
        </div>
        <Button variant="navy" size="sm" className="gap-1.5 rounded-xl" onClick={() => setAddOpen(true)}>
          <Plus size={13} /> {translate("team.documents.add")}
        </Button>
      </div>

      {documentsQuery.isLoading && <p className="text-sm" style={{ color: MUTED }}>{translate("common.loading")}</p>}

      {!documentsQuery.isLoading && documents.length === 0 && (
        <div className="rounded-2xl p-8 text-center" style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
          <FileText size={28} className="mx-auto mb-2" style={{ color: MUTED }} />
          <p className="text-sm font-bold" style={{ color: MUTED }}>{translate("team.documents.empty")}</p>
        </div>
      )}

      {documents.length > 0 && (
        <div className="rounded-2xl divide-y" style={{ background: SURFACE, boxShadow: CARD_SHADOW, borderColor: BORDER }}>
          {documents.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0 flex items-start gap-3">
                <div className="h-9 w-9 rounded-xl shrink-0 flex items-center justify-center" style={{ background: SOFT }}>
                  <FileText size={15} style={{ color: PLUM }} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold" style={{ color: TEXT }}>{doc.title}</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: SOFT, color: PLUM }}>
                      {documentTypeLabel(doc.document_type, translate)}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                    {translate("team.documents.uploadedOn")} {safeFormat(doc.created_at)}
                    {doc.notes ? ` · ${doc.notes}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {doc.file_url ? (
                  <a
                    href={doc.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg p-1.5 hover:bg-black/5"
                    title={translate("team.documents.download")}
                    aria-label={translate("team.documents.download")}
                  >
                    <Download size={14} style={{ color: PLUM }} />
                  </a>
                ) : null}
                <button
                  onClick={() => {
                    if (window.confirm(translate("team.documents.removeConfirm"))) deleteMut.mutate(doc.id);
                  }}
                  className="rounded-lg p-1.5 hover:bg-black/5"
                  title={translate("team.documents.remove")}
                  aria-label={translate("team.documents.remove")}
                >
                  <Trash2 size={14} style={{ color: MUTED }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddDocumentDialog open={addOpen} onOpenChange={setAddOpen} worker={worker} translate={translate} />
    </div>
  );
}

function AddDocumentDialog({
  open, onOpenChange, worker, translate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worker: WorkerStats;
  translate: (k: string) => string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [docType, setDocType] = useState<WorkerOnboardingDocumentType>("offer_letter");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const saveMut = useMutation({
    mutationFn: () => uploadWorkerOnboardingDocument(worker.id, {
      document_type: docType,
      title: title.trim(),
      notes: notes.trim() || undefined,
      file: file || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("worker-onboarding-documents") });
      toast({ title: translate("team.documents.saved") });
      onOpenChange(false);
      setDocType("offer_letter");
      setTitle("");
      setNotes("");
      setFile(null);
    },
    onError: () => toast({ title: translate("team.documents.saveFailed"), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl" style={{ background: SURFACE }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: TEXT }}>
            <FileText size={18} style={{ color: PLUM }} /> {translate("team.documents.dialogTitle").replace("{name}", worker.full_name)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{translate("team.documents.docType")}</label>
            <Select value={docType} onValueChange={(v) => setDocType(v as WorkerOnboardingDocumentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="offer_letter">{translate("team.documents.type.offer_letter")}</SelectItem>
                <SelectItem value="service_agreement">{translate("team.documents.type.service_agreement")}</SelectItem>
                <SelectItem value="other">{translate("team.documents.type.other")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{translate("team.documents.docTitle")}</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={translate("team.documents.docTitlePlaceholder")} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{translate("team.documents.notes")}</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={translate("team.documents.notesPlaceholder")} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{translate("team.documents.file")}</label>
            <label
              className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs font-semibold cursor-pointer"
              style={{ borderColor: BORDER, color: MUTED }}
            >
              <Upload size={14} />
              {file ? file.name : translate("team.documents.file")}
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{translate("common.cancel")}</Button>
          <Button
            variant="navy"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !title.trim()}
          >
            {saveMut.isPending ? translate("common.saving") : translate("team.documents.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

