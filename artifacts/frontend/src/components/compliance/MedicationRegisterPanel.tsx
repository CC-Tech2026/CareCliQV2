import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock3, FileText, GitCommitHorizontal, Pill, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiCard, KpiGrid } from "@/components/ui/stat-card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { formatAppTimeWithZone } from "@/lib/datetime";
import { LoadingBlock, EmptyState, StatusBadge } from "@/pages/compliance";
import {
  fileMedicationCorrection,
  getCoordinatorMedications,
  getMedicationAuditTimeline,
  getMedicationReviewItems,
  getParticipantReliabilityFlags,
  type MedicationAdministrationRecord,
  type MedicationErrorSubtype,
  type MedicationStatus,
  type OrgMedication,
} from "@/services/medicationService";

const ERROR_SUBTYPES: MedicationErrorSubtype[] = ["wrong_medication", "wrong_dose", "wrong_participant", "wrong_route", "other"];

const PLUM = "var(--cc-plum)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

const STATUS_TONE: Record<MedicationStatus, "gn" | "am" | "gy"> = {
  draft: "gy",
  pending_verification: "am",
  active: "gn",
  rejected: "gy",
  on_hold: "am",
  ceased: "gy",
};

const ADMIN_STATUS_STYLE: Record<MedicationAdministrationRecord["outcome"], { bg: string; color: string }> = {
  given_on_time: { bg: "var(--cc-status-success-bg)", color: "var(--cc-status-success)" },
  given_late: { bg: "var(--cc-status-warning-bg)", color: "var(--cc-status-warning)" },
  given_early: { bg: "var(--cc-status-warning-bg)", color: "var(--cc-status-warning)" },
  refused: { bg: "var(--cc-status-danger-bg)", color: "#DC2626" },
  missed: { bg: "var(--cc-status-danger-bg)", color: "#DC2626" },
  withheld: { bg: "var(--cc-status-warning-bg)", color: "var(--cc-status-warning)" },
  administration_error: { bg: "var(--cc-status-danger-bg)", color: "#DC2626" },
};

export function MedicationRegisterPanel() {
  const { translate, translateParams } = useAccessibility();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["compliance-centre", "medications"],
    queryFn: () => getCoordinatorMedications(),
  });
  const { data: reviewItems } = useQuery({
    queryKey: ["compliance-centre", "medication-review-items"],
    queryFn: getMedicationReviewItems,
  });
  const { data: reliabilityData } = useQuery({
    queryKey: ["compliance-centre", "medication-reliability-flags"],
    queryFn: () => getParticipantReliabilityFlags(),
  });

  const medications = data?.medications ?? [];
  const active = medications.filter((m) => m.status === "active");
  const prnCount = active.filter((m) => m.is_prn).length;
  const endingSoonCount = reviewItems?.ending_soon.length ?? 0;
  const atMaxCount = reviewItems?.prn_at_max.length ?? 0;
  const triggeredFlags = (reliabilityData?.flags ?? []).filter((f) => f.triggered);
  const participantNameById = new Map(medications.map((m) => [m.participant_id, m.participant_name]));

  if (isLoading) return <LoadingBlock label={translate("common.loading")} />;

  return (
    <div className="space-y-5">
      {(endingSoonCount > 0 || atMaxCount > 0) && (
        <div className="rounded-xl border px-4 py-3 flex gap-3" style={{ borderColor: BORDER, background: "var(--cc-status-warning-bg)" }}>
          <AlertTriangle size={18} className="shrink-0 mt-0.5" style={{ color: "var(--cc-status-warning)" }} />
          <div className="text-xs" style={{ color: "var(--cc-status-warning)" }}>
            {atMaxCount > 0 && (
              <p className="font-bold">{translateParams("compliance.centre.medications.atMax", { count: String(atMaxCount) })}</p>
            )}
            {endingSoonCount > 0 && (
              <p className="font-bold mt-0.5">{translateParams("compliance.centre.medications.endingSoon", { count: String(endingSoonCount) })}</p>
            )}
          </div>
        </div>
      )}

      {triggeredFlags.length > 0 && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--cc-status-danger)" }}>
          <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: "var(--cc-status-danger-bg)" }}>
            <ShieldAlert size={16} style={{ color: "var(--cc-status-danger)" }} />
            <p className="text-xs font-black uppercase tracking-wide" style={{ color: "var(--cc-status-danger)" }}>
              {translate("compliance.centre.medications.reliabilityFlagsTitle")}
            </p>
          </div>
          <div className="divide-y" style={{ borderColor: BORDER }}>
            {triggeredFlags.map((flag) => (
              <div key={flag.id} className="px-4 py-3">
                <p className="text-[13px] font-bold" style={{ color: TEXT }}>
                  {participantNameById.get(flag.scope_id) ?? translate("common.participant")}
                </p>
                <p className="mt-0.5 text-[12px]" style={{ color: MUTED }}>{flag.trigger_reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <KpiGrid>
        <KpiCard flat className="border border-[var(--cc-border)]" label={translate("compliance.centre.medications.statActive")} value={active.length} icon={<Pill />} />
        <KpiCard flat className="border border-[var(--cc-border)]" label={translate("compliance.centre.medications.statPrn")} value={prnCount} tone="brand" icon={<Clock3 />} />
        <KpiCard flat className="border border-[var(--cc-border)]" label={translate("compliance.centre.medications.statReview")} value={endingSoonCount + atMaxCount} tone={endingSoonCount + atMaxCount > 0 ? "warning" : "neutral"} icon={<AlertTriangle />} />
      </KpiGrid>

      {medications.length === 0 ? (
        <EmptyState label={translate("compliance.centre.medications.empty")} />
      ) : (
        <div className="rounded-2xl border overflow-hidden divide-y" style={{ borderColor: BORDER, background: "var(--cc-surface)" }}>
          {medications.map((med) => (
            <button
              key={med.id}
              type="button"
              onClick={() => setSelectedId(med.id)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--cc-soft)] transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[13px] font-bold truncate" style={{ color: TEXT }}>
                    {med.name}{med.strength ? ` · ${med.strength}` : ""}
                  </p>
                  <StatusBadge label={translate(`participants.medications.status.${med.status}`)} tone={STATUS_TONE[med.status]} />
                  {med.is_prn && <StatusBadge label={translate("participants.medications.prn")} tone="pu" />}
                  {med.is_high_risk && <StatusBadge label={translate("compliance.centre.medications.highRiskBadge")} tone="rd" />}
                </div>
                <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
                  {med.participant_name || translate("common.participant")}
                  {med.dosage ? ` · ${med.dosage}` : ""} · {med.route}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      <MedicationHistoryDrawer medicationId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function AdministrationEventCard({ admin, medicationId, tz }: { admin: MedicationAdministrationRecord; medicationId: string; tz?: string | null }) {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const qc = useQueryClient();
  const style = ADMIN_STATUS_STYLE[admin.outcome];
  const [correcting, setCorrecting] = useState(false);
  const [errorSubtype, setErrorSubtype] = useState<MedicationErrorSubtype>("other");
  const [notes, setNotes] = useState("");

  const correctionMutation = useMutation({
    mutationFn: () => fileMedicationCorrection(medicationId, admin.id, { error_subtype: errorSubtype, notes: notes || undefined }),
    onSuccess: () => {
      toast({ title: translate("compliance.centre.medications.correctionSubmitted") });
      void qc.invalidateQueries({ queryKey: ["compliance-centre", "medication-audit-timeline", medicationId] });
      setCorrecting(false);
      setNotes("");
    },
    onError: (err: Error) => toast({ title: translate("common.error"), description: err.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-xl border p-3" style={{ borderColor: BORDER }}>
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full px-2 py-0.5 text-[10px] font-black uppercase" style={{ background: style.bg, color: style.color }}>
          {admin.outcome.replace(/_/g, " ")}
        </span>
        <span className="text-[11px]" style={{ color: MUTED }}>
          {formatAppTimeWithZone(admin.administered_time, tz)}
        </span>
      </div>
      {admin.administered_by_name && (
        <p className="mt-1.5 text-[11px]" style={{ color: MUTED }}>
          {translate("compliance.centre.medications.by")} {admin.administered_by_name}
        </p>
      )}
      {admin.variance_minutes != null && admin.variance_minutes !== 0 && (
        <p className="mt-1 text-[11px]" style={{ color: MUTED }}>
          {admin.variance_minutes > 0
            ? `${admin.variance_minutes} min after scheduled time`
            : `${Math.abs(admin.variance_minutes)} min before scheduled time`}
        </p>
      )}
      {admin.prn_reason && (
        <p className="mt-1 text-[12px]" style={{ color: TEXT }}>
          <span className="font-bold">{translate("participants.medications.prn")}:</span> {admin.prn_reason}
        </p>
      )}
      {admin.prn_effect_observed && (
        <p className="mt-1 text-[12px]" style={{ color: TEXT }}>
          <span className="font-bold">{translate("compliance.centre.medications.effect")}:</span> {admin.prn_effect_observed}
        </p>
      )}
      {admin.outcome === "administration_error" && (
        <div className="mt-1.5 space-y-1 rounded-lg border p-2" style={{ borderColor: "var(--cc-status-danger)", background: "var(--cc-status-danger-bg)" }}>
          {admin.error_subtype && (
            <p className="text-[12px] font-bold" style={{ color: "#DC2626" }}>
              {translate(`compliance.centre.medications.errorSubtype.${admin.error_subtype}`)}
            </p>
          )}
          {admin.corrects_administration_id && (
            <p className="text-[11px]" style={{ color: MUTED }}>
              {translate("compliance.centre.medications.discoveredLate")}
              {admin.error_discovered_at ? ` — ${formatAppTimeWithZone(admin.error_discovered_at, tz)}` : ""}. {translate("compliance.centre.medications.correctsEntry")}.
            </p>
          )}
        </div>
      )}
      {admin.verification_photo_url && (
        <a
          href={admin.verification_photo_url}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 inline-block text-[11px] font-bold underline"
          style={{ color: PLUM }}
        >
          {translate("compliance.centre.medications.viewVerificationPhoto")}
        </a>
      )}
      {admin.notes && <p className="mt-1 text-[12px]" style={{ color: MUTED }}>{admin.notes}</p>}

      {admin.outcome !== "administration_error" && (
        correcting ? (
          <div className="mt-2 space-y-2 rounded-lg border p-2" style={{ borderColor: BORDER }}>
            <p className="text-[11px]" style={{ color: MUTED }}>{translate("compliance.centre.medications.fileCorrectionHint")}</p>
            <select
              className="cc-field h-8 w-full rounded-md px-2 text-xs"
              value={errorSubtype}
              onChange={(e) => setErrorSubtype(e.target.value as MedicationErrorSubtype)}
            >
              {ERROR_SUBTYPES.map((s) => (
                <option key={s} value={s}>{translate(`compliance.centre.medications.errorSubtype.${s}`)}</option>
              ))}
            </select>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={errorSubtype === "other" ? translate("participants.medications.verificationNotesPlaceholder") : undefined}
              className="h-8 text-xs"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={correctionMutation.isPending || (errorSubtype === "other" && !notes.trim())}
                onClick={() => correctionMutation.mutate()}
              >
                {translate("compliance.centre.medications.fileCorrection")}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setCorrecting(false)}>
                {translate("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCorrecting(true)}
            className="mt-1.5 text-[11px] font-bold underline"
            style={{ color: MUTED }}
          >
            {translate("compliance.centre.medications.fileCorrection")}
          </button>
        )
      )}
    </div>
  );
}

function MedicationHistoryDrawer({ medicationId, onClose }: { medicationId: string | null; onClose: () => void }) {
  const { translate } = useAccessibility();
  const { data, isLoading } = useQuery({
    queryKey: ["compliance-centre", "medication-audit-timeline", medicationId],
    queryFn: () => getMedicationAuditTimeline(medicationId as string),
    enabled: !!medicationId,
  });

  return (
    <Sheet open={!!medicationId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{data?.medication.name ?? translate("compliance.centre.medications.title")}</SheetTitle>
          <SheetDescription>{translate("compliance.centre.medications.historyDesc")}</SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <LoadingBlock label={translate("common.loading")} />
        ) : data ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border p-3 space-y-1" style={{ borderColor: BORDER }}>
              <p className="text-[11px]" style={{ color: MUTED }}>
                {data.medication.participant_name} · {data.medication.dosage || ""} {data.medication.route}
              </p>
              {data.medication.prescriber_name && (
                <p className="text-[11px]" style={{ color: MUTED }}>
                  {translate("participants.medications.prescribedBy")} {data.medication.prescriber_name}
                </p>
              )}
            </div>

            {data.timeline.length === 0 ? (
              <EmptyState label={translate("compliance.centre.medications.noHistory")} />
            ) : (
              <div className="space-y-2">
                {data.timeline.map((event, idx) => {
                  if (event.event_type === "administration") {
                    return <AdministrationEventCard key={`admin-${event.administration.id}`} admin={event.administration} medicationId={data.medication.id} tz={data.timezone} />;
                  }
                  if (event.event_type === "document_uploaded") {
                    const doc = event.document;
                    return (
                      <div key={`doc-${doc.id}`} className="rounded-xl border p-3 flex items-start gap-2.5" style={{ borderColor: BORDER }}>
                        <FileText size={16} className="shrink-0 mt-0.5" style={{ color: PLUM }} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[12px] font-bold truncate" style={{ color: TEXT }}>{doc.file_name}</p>
                            <span className="text-[11px] shrink-0" style={{ color: MUTED }}>
                              {formatAppTimeWithZone(event.timestamp, data.timezone)}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
                            {translate(`participants.medications.docType.${doc.document_type}`)}
                            {doc.superseded_at ? ` · ${translate("participants.medications.superseded")}` : ""}
                          </p>
                        </div>
                      </div>
                    );
                  }
                  const change = event.status_change;
                  return (
                    <div key={`status-${change.id}`} className="rounded-xl border p-3 flex items-start gap-2.5" style={{ borderColor: BORDER }}>
                      <GitCommitHorizontal size={16} className="shrink-0 mt-0.5" style={{ color: PLUM }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[12px] font-bold" style={{ color: TEXT }}>
                            {change.from_status
                              ? `${translate(`participants.medications.status.${change.from_status}`)} → ${translate(`participants.medications.status.${change.to_status}`)}`
                              : translate(`participants.medications.status.${change.to_status}`)}
                          </p>
                          <span className="text-[11px] shrink-0" style={{ color: MUTED }}>
                            {formatAppTimeWithZone(event.timestamp, data.timezone)}
                          </span>
                        </div>
                        {change.users?.full_name && (
                          <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
                            {translate("compliance.centre.medications.by")} {change.users.full_name}
                          </p>
                        )}
                        {change.reason && (
                          <p className="mt-1 text-[12px]" style={{ color: MUTED }}>{change.reason}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
