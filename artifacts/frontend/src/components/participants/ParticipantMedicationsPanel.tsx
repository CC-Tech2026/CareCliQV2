import { useEffect, useState } from "react";
import { CheckCircle2, FileText, Loader2, Paperclip, Pill, Plus, ShieldCheck, Trash2, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  createParticipantMedication,
  getMedicationDocuments,
  getParticipantMedications,
  rejectMedication,
  updateMedication,
  uploadMedicationDocument,
  verifyMedication,
  type Medication,
  type MedicationDocument,
  type MedicationFrequencyType,
  type MedicationRoute,
} from "@/services/medicationService";

const ROUTES: MedicationRoute[] = ["oral", "topical", "injection", "inhaled", "sublingual", "rectal", "other"];

const STATUS_STYLE: Record<Medication["status"], { bg: string; text: string }> = {
  draft: { bg: "#F1F5F9", text: "#64748B" },
  pending_verification: { bg: "#FEF3C7", text: "#92400E" },
  active: { bg: "#DCFCE7", text: "#166534" },
  rejected: { bg: "#FEE2E2", text: "#B91C1C" },
  on_hold: { bg: "#FEF3C7", text: "#92400E" },
  ceased: { bg: "#F1F5F9", text: "#64748B" },
};

type DraftForm = {
  name: string;
  strength: string;
  route: MedicationRoute;
  dosage: string;
  frequency_type: MedicationFrequencyType;
  scheduled_times: string;
  prescriber_name: string;
  prescriber_contact: string;
  start_date: string;
  end_date: string;
  prn_max_per_day: string;
};

const EMPTY_DRAFT: DraftForm = {
  name: "",
  strength: "",
  route: "oral",
  dosage: "",
  frequency_type: "scheduled",
  scheduled_times: "",
  prescriber_name: "",
  prescriber_contact: "",
  start_date: "",
  end_date: "",
  prn_max_per_day: "",
};

type Props = {
  participantId: string;
};

export function ParticipantMedicationsPanel({ participantId }: Props) {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [draft, setDraft] = useState<DraftForm>(EMPTY_DRAFT);
  const [pendingDocument, setPendingDocument] = useState<MedicationDocument | null>(null);
  const [docsByMedication, setDocsByMedication] = useState<Record<string, MedicationDocument[]>>({});
  const [expandedDocsFor, setExpandedDocsFor] = useState<string | null>(null);
  const [loadingDocsFor, setLoadingDocsFor] = useState<string | null>(null);
  const [verifyingMedication, setVerifyingMedication] = useState<Medication | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getParticipantMedications(participantId);
      setMedications(data.medications);
    } catch (err) {
      toast({
        title: translate("participants.medications.loadFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantId]);

  const submit = async () => {
    if (!draft.name.trim()) {
      toast({ title: translate("participants.medications.nameRequired"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await createParticipantMedication(participantId, {
        name: draft.name.trim(),
        strength: draft.strength || null,
        route: draft.route,
        dosage: draft.dosage || null,
        frequency_type: draft.frequency_type,
        scheduled_times: draft.scheduled_times
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        prescriber_name: draft.prescriber_name || null,
        prescriber_contact: draft.prescriber_contact || null,
        start_date: draft.start_date || null,
        end_date: draft.end_date || null,
        is_prn: draft.frequency_type === "prn",
        prn_max_per_day: draft.prn_max_per_day ? Number(draft.prn_max_per_day) : null,
        source_document_id: pendingDocument?.id ?? null,
      });
      toast({ title: translate("participants.medications.added") });
      setDraft(EMPTY_DRAFT);
      setPendingDocument(null);
      setFormOpen(false);
      load();
    } catch (err) {
      toast({
        title: translate("common.error"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (file: File) => {
    setExtracting(true);
    try {
      const { document, extracted_fields: fields } = await uploadMedicationDocument(participantId, file, "prescription");
      setPendingDocument(document);
      if (fields) {
        setDraft((d) => ({
          name: fields.name ?? d.name,
          strength: fields.strength ?? d.strength,
          dosage: fields.dosage ?? d.dosage,
          route: fields.route ?? d.route,
          frequency_type: fields.frequency_type ?? d.frequency_type,
          scheduled_times: fields.scheduled_times.length > 0 ? fields.scheduled_times.join(", ") : d.scheduled_times,
          prescriber_name: fields.prescriber_name ?? d.prescriber_name,
          prescriber_contact: fields.prescriber_contact ?? d.prescriber_contact,
          start_date: fields.start_date ?? d.start_date,
          end_date: fields.end_date ?? d.end_date,
          prn_max_per_day: fields.prn_max_per_day != null ? String(fields.prn_max_per_day) : d.prn_max_per_day,
        }));
        toast({ title: translate("participants.medications.extracted") });
      } else {
        toast({
          title: translate("participants.medications.uploadedNoExtract"),
          description: translate("participants.medications.uploadedNoExtractDesc"),
        });
      }
    } catch (err) {
      toast({
        title: translate("participants.medications.extractFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setExtracting(false);
    }
  };

  const toggleDocuments = async (medicationId: string) => {
    if (expandedDocsFor === medicationId) {
      setExpandedDocsFor(null);
      return;
    }
    setExpandedDocsFor(medicationId);
    if (docsByMedication[medicationId]) return;
    setLoadingDocsFor(medicationId);
    try {
      const { documents } = await getMedicationDocuments(medicationId);
      setDocsByMedication((prev) => ({ ...prev, [medicationId]: documents }));
    } catch (err) {
      toast({
        title: translate("common.error"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setLoadingDocsFor(null);
    }
  };

  const changeStatus = async (medication: Medication, status: Medication["status"]) => {
    try {
      await updateMedication(medication.id, { status });
      toast({ title: translate("participants.medications.updated") });
      load();
    } catch (err) {
      toast({
        title: translate("common.error"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const handleReject = async (medication: Medication) => {
    const reason = window.prompt(translate("participants.medications.rejectReasonPrompt"));
    if (!reason || !reason.trim()) return;
    try {
      await rejectMedication(medication.id, reason.trim());
      toast({ title: translate("participants.medications.rejected") });
      load();
    } catch (err) {
      toast({
        title: translate("common.error"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  return (
    <section className="cc-surface-card space-y-4 border border-cc-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Pill className="h-3.5 w-3.5 text-cc-plum" />
          <p className="text-[12px] font-black uppercase tracking-[0.13em] text-cc-plum">
            {translate("participants.medications.title")}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setFormOpen((v) => !v)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> {translate("participants.medications.add")}
        </Button>
      </div>

      {formOpen && (
        <div className="rounded-xl border border-cc-border p-3 space-y-3">
          {pendingDocument ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-cc-border bg-cc-soft p-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-3.5 w-3.5 shrink-0 text-cc-plum" />
                <p className="truncate text-[12px] font-bold text-cc-text">{pendingDocument.file_name}</p>
              </div>
              <button
                type="button"
                onClick={() => setPendingDocument(null)}
                className="shrink-0 rounded-full p-1 hover:bg-black/5"
                title={translate("participants.medications.removeAttachment")}
                aria-label={translate("participants.medications.removeAttachment")}
              >
                <X className="h-3.5 w-3.5 text-cc-muted" />
              </button>
            </div>
          ) : (
            <FileDropzone
              accept="application/pdf,image/jpeg,image/png,image/webp"
              maxSizeBytes={15 * 1024 * 1024}
              busy={extracting}
              onFile={handleUpload}
              onRejected={(reason) => toast({ title: reason, variant: "destructive" })}
              label={translate("participants.medications.uploadScript")}
              hint={translate("participants.medications.uploadHint")}
              busyLabel={translate("participants.medications.extracting")}
            />
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <LabeledInput label={translate("participants.medications.name")} value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
            <LabeledInput label={translate("participants.medications.strength")} value={draft.strength} onChange={(v) => setDraft((d) => ({ ...d, strength: v }))} />
            <LabeledInput label={translate("participants.medications.dosage")} value={draft.dosage} onChange={(v) => setDraft((d) => ({ ...d, dosage: v }))} />
            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-cc-muted">{translate("participants.medications.route")}</p>
              <select
                className="cc-field rounded-md px-2 text-sm h-9 w-full"
                value={draft.route}
                onChange={(e) => setDraft((d) => ({ ...d, route: e.target.value as MedicationRoute }))}
              >
                {ROUTES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-cc-muted">{translate("participants.medications.frequencyType")}</p>
              <select
                className="cc-field rounded-md px-2 text-sm h-9 w-full"
                value={draft.frequency_type}
                onChange={(e) => setDraft((d) => ({ ...d, frequency_type: e.target.value as MedicationFrequencyType }))}
              >
                <option value="scheduled">{translate("participants.medications.scheduled")}</option>
                <option value="prn">{translate("participants.medications.prn")}</option>
              </select>
            </div>
            {draft.frequency_type === "scheduled" ? (
              <LabeledInput
                label={translate("participants.medications.scheduledTimes")}
                placeholder="08:00, 20:00"
                value={draft.scheduled_times}
                onChange={(v) => setDraft((d) => ({ ...d, scheduled_times: v }))}
              />
            ) : (
              <LabeledInput
                label={translate("participants.medications.prnMaxPerDay")}
                value={draft.prn_max_per_day}
                onChange={(v) => setDraft((d) => ({ ...d, prn_max_per_day: v.replace(/[^0-9]/g, "") }))}
              />
            )}
            <LabeledInput label={translate("participants.medications.prescriberName")} value={draft.prescriber_name} onChange={(v) => setDraft((d) => ({ ...d, prescriber_name: v }))} />
            <LabeledInput label={translate("participants.medications.prescriberContact")} value={draft.prescriber_contact} onChange={(v) => setDraft((d) => ({ ...d, prescriber_contact: v }))} />
            <LabeledInput label={translate("participants.medications.startDate")} type="date" value={draft.start_date} onChange={(v) => setDraft((d) => ({ ...d, start_date: v }))} />
            <LabeledInput label={translate("participants.medications.endDate")} type="date" value={draft.end_date} onChange={(v) => setDraft((d) => ({ ...d, end_date: v }))} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setFormOpen(false); setDraft(EMPTY_DRAFT); setPendingDocument(null); }}>
              {translate("common.cancel")}
            </Button>
            <Button type="button" size="sm" disabled={saving} onClick={submit} className="cc-btn-primary">
              {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {translate("participants.medications.save")}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-4 text-sm text-cc-muted">{translate("participants.shiftContext.loading")}</div>
      ) : medications.length === 0 ? (
        <p className="text-[12px] text-cc-muted">{translate("participants.medications.empty")}</p>
      ) : (
        <div className="divide-y divide-cc-border rounded-xl border border-cc-border overflow-hidden">
          {medications.map((m) => {
            const style = STATUS_STYLE[m.status];
            const docs = docsByMedication[m.id];
            const isExpanded = expandedDocsFor === m.id;
            return (
              <div key={m.id}>
                <div className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[13px] font-bold text-cc-text">{m.name}{m.strength ? ` · ${m.strength}` : ""}</p>
                      <span className="rounded-full px-2 py-0.5 text-[9px] font-black uppercase" style={{ background: style.bg, color: style.text }}>
                        {translate(`participants.medications.status.${m.status}`)}
                      </span>
                      {m.is_prn && (
                        <span className="rounded-full px-2 py-0.5 text-[9px] font-black uppercase bg-cc-soft text-cc-plum">
                          {translate("participants.medications.prn")}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-cc-muted">
                      {m.dosage ? `${m.dosage} · ` : ""}{m.route}
                      {m.frequency_type === "scheduled" && m.scheduled_times.length > 0 ? ` · ${m.scheduled_times.join(", ")}` : ""}
                      {m.prescriber_name ? ` · ${translate("participants.medications.prescribedBy")} ${m.prescriber_name}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleDocuments(m.id)}
                      title={translate("participants.medications.viewDocuments")}
                      aria-label={translate("participants.medications.viewDocuments")}
                    >
                      {loadingDocsFor === m.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Paperclip className={`h-3.5 w-3.5 ${isExpanded ? "text-cc-plum" : ""}`} />
                      )}
                    </Button>
                    {m.status === "pending_verification" && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-emerald-700"
                          onClick={() => setVerifyingMedication(m)}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" /> {translate("participants.medications.verify")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleReject(m)}
                          title={translate("participants.medications.reject")}
                          aria-label={translate("participants.medications.reject")}
                        >
                          <XCircle className="h-3.5 w-3.5 text-red-600" />
                        </Button>
                      </>
                    )}
                    {m.status === "on_hold" && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => changeStatus(m, "active")}>
                        {translate("participants.medications.reactivate")}
                      </Button>
                    )}
                    {m.status === "active" && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => changeStatus(m, "on_hold")}>
                        {translate("participants.medications.hold")}
                      </Button>
                    )}
                    {(m.status === "active" || m.status === "on_hold") && (
                      <Button type="button" variant="ghost" size="icon" onClick={() => changeStatus(m, "ceased")} title={translate("participants.medications.cease")}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-cc-border bg-cc-soft/50 px-3 py-2.5">
                    {!docs || docs.length === 0 ? (
                      <p className="text-[11px] text-cc-muted">{translate("participants.medications.noDocuments")}</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {docs.map((doc) => (
                          <li key={doc.id} className="flex items-center justify-between gap-2">
                            <a
                              href={doc.file_url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-cc-plum hover:underline"
                            >
                              <FileText className="h-3 w-3 shrink-0" />
                              <span className="truncate">{doc.file_name}</span>
                            </a>
                            <span className="shrink-0 text-[10px] text-cc-muted">
                              {doc.superseded_at
                                ? translate("participants.medications.superseded")
                                : translate(`participants.medications.docType.${doc.document_type}`)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <VerifyMedicationSheet
        medication={verifyingMedication}
        onOpenChange={(open) => { if (!open) setVerifyingMedication(null); }}
        onVerified={() => { setVerifyingMedication(null); load(); }}
      />
    </section>
  );
}

function VerifyMedicationSheet({
  medication,
  onOpenChange,
  onVerified,
}: {
  medication: Medication | null;
  onOpenChange: (open: boolean) => void;
  onVerified: () => void;
}) {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");
  const [fields, setFields] = useState<DraftForm>(EMPTY_DRAFT);
  const [docs, setDocs] = useState<MedicationDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);

  useEffect(() => {
    if (!medication) return;
    setFields({
      name: medication.name,
      strength: medication.strength ?? "",
      route: medication.route,
      dosage: medication.dosage ?? "",
      frequency_type: medication.frequency_type,
      scheduled_times: medication.scheduled_times.join(", "),
      prescriber_name: medication.prescriber_name ?? "",
      prescriber_contact: medication.prescriber_contact ?? "",
      start_date: medication.start_date ?? "",
      end_date: medication.end_date ?? "",
      prn_max_per_day: medication.prn_max_per_day != null ? String(medication.prn_max_per_day) : "",
    });
    setNotes("");
    setLoadingDocs(true);
    getMedicationDocuments(medication.id)
      .then((res) => setDocs(res.documents))
      .catch(() => setDocs([]))
      .finally(() => setLoadingDocs(false));
  }, [medication]);

  const sourceDoc = medication ? docs.find((d) => d.id === medication.source_document_id) : undefined;

  const confirm = async () => {
    if (!medication) return;
    setSaving(true);
    try {
      await verifyMedication(medication.id, {
        name: fields.name.trim(),
        strength: fields.strength || null,
        route: fields.route,
        dosage: fields.dosage || null,
        frequency_type: fields.frequency_type,
        scheduled_times: fields.scheduled_times.split(",").map((t) => t.trim()).filter(Boolean),
        prescriber_name: fields.prescriber_name || null,
        prescriber_contact: fields.prescriber_contact || null,
        start_date: fields.start_date || null,
        end_date: fields.end_date || null,
        prn_max_per_day: fields.prn_max_per_day ? Number(fields.prn_max_per_day) : null,
        verification_notes: notes || null,
      });
      toast({ title: translate("participants.medications.verified") });
      onVerified();
    } catch (err) {
      toast({
        title: translate("common.error"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={!!medication} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-cc-plum" />
            {translate("participants.medications.verifyTitle")}
          </SheetTitle>
        </SheetHeader>

        {medication && (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-cc-border bg-cc-soft p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-cc-muted">
                {translate("participants.medications.sourceDocument")}
              </p>
              {loadingDocs ? (
                <p className="mt-1 text-[12px] text-cc-muted">{translate("common.loading")}</p>
              ) : sourceDoc ? (
                <a
                  href={sourceDoc.file_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 flex items-center gap-1.5 text-[13px] font-bold text-cc-plum hover:underline"
                >
                  <FileText className="h-3.5 w-3.5" /> {sourceDoc.file_name}
                </a>
              ) : (
                <p className="mt-1 text-[12px] text-cc-muted">{translate("participants.medications.noSourceDocument")}</p>
              )}
            </div>

            <p className="text-[11px] text-cc-muted">{translate("participants.medications.verifyHint")}</p>

            <div className="grid gap-3 sm:grid-cols-2">
              <LabeledInput label={translate("participants.medications.name")} value={fields.name} onChange={(v) => setFields((d) => ({ ...d, name: v }))} />
              <LabeledInput label={translate("participants.medications.strength")} value={fields.strength} onChange={(v) => setFields((d) => ({ ...d, strength: v }))} />
              <LabeledInput label={translate("participants.medications.dosage")} value={fields.dosage} onChange={(v) => setFields((d) => ({ ...d, dosage: v }))} />
              <div className="space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-wide text-cc-muted">{translate("participants.medications.route")}</p>
                <select
                  className="cc-field h-9 w-full rounded-md px-2 text-sm"
                  value={fields.route}
                  onChange={(e) => setFields((d) => ({ ...d, route: e.target.value as MedicationRoute }))}
                >
                  {ROUTES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              {fields.frequency_type === "scheduled" ? (
                <LabeledInput
                  label={translate("participants.medications.scheduledTimes")}
                  placeholder="08:00, 20:00"
                  value={fields.scheduled_times}
                  onChange={(v) => setFields((d) => ({ ...d, scheduled_times: v }))}
                />
              ) : (
                <LabeledInput
                  label={translate("participants.medications.prnMaxPerDay")}
                  value={fields.prn_max_per_day}
                  onChange={(v) => setFields((d) => ({ ...d, prn_max_per_day: v.replace(/[^0-9]/g, "") }))}
                />
              )}
              <LabeledInput label={translate("participants.medications.prescriberName")} value={fields.prescriber_name} onChange={(v) => setFields((d) => ({ ...d, prescriber_name: v }))} />
              <LabeledInput label={translate("participants.medications.prescriberContact")} value={fields.prescriber_contact} onChange={(v) => setFields((d) => ({ ...d, prescriber_contact: v }))} />
              <LabeledInput label={translate("participants.medications.startDate")} type="date" value={fields.start_date} onChange={(v) => setFields((d) => ({ ...d, start_date: v }))} />
              <LabeledInput label={translate("participants.medications.endDate")} type="date" value={fields.end_date} onChange={(v) => setFields((d) => ({ ...d, end_date: v }))} />
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-cc-muted">{translate("participants.medications.verificationNotes")}</p>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={translate("participants.medications.verificationNotesPlaceholder")} />
            </div>
          </div>
        )}

        <SheetFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {translate("common.cancel")}
          </Button>
          <Button type="button" disabled={saving || !fields.name.trim()} onClick={confirm} className="cc-btn-primary gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {translate("participants.medications.confirmAndActivate")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function LabeledInput({
  label, value, onChange, placeholder, type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-bold uppercase tracking-wide text-cc-muted">{label}</p>
      <Input type={type} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
