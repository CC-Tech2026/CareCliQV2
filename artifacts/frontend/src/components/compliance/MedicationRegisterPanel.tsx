import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock3, Pill } from "lucide-react";
import { KpiCard, KpiGrid } from "@/components/ui/stat-card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { LoadingBlock, EmptyState, StatusBadge } from "@/pages/compliance";
import {
  getCoordinatorMedications,
  getMedicationHistory,
  getMedicationReviewItems,
  type MedicationAdministrationRecord,
  type MedicationStatus,
  type OrgMedication,
} from "@/services/medicationService";

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

const ADMIN_STATUS_STYLE: Record<MedicationAdministrationRecord["status"], { bg: string; color: string }> = {
  given: { bg: "var(--cc-status-success-bg)", color: "var(--cc-status-success)" },
  refused: { bg: "var(--cc-status-danger-bg)", color: "#DC2626" },
  missed: { bg: "var(--cc-status-danger-bg)", color: "#DC2626" },
  withheld: { bg: "var(--cc-status-warning-bg)", color: "var(--cc-status-warning)" },
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

  const medications = data?.medications ?? [];
  const active = medications.filter((m) => m.status === "active");
  const prnCount = active.filter((m) => m.is_prn).length;
  const endingSoonCount = reviewItems?.ending_soon.length ?? 0;
  const atMaxCount = reviewItems?.prn_at_max.length ?? 0;

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

function MedicationHistoryDrawer({ medicationId, onClose }: { medicationId: string | null; onClose: () => void }) {
  const { translate } = useAccessibility();
  const { data, isLoading } = useQuery({
    queryKey: ["compliance-centre", "medication-history", medicationId],
    queryFn: () => getMedicationHistory(medicationId as string),
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

            {data.history.length === 0 ? (
              <EmptyState label={translate("compliance.centre.medications.noHistory")} />
            ) : (
              <div className="space-y-2">
                {data.history.map((admin) => {
                  const style = ADMIN_STATUS_STYLE[admin.status];
                  return (
                    <div key={admin.id} className="rounded-xl border p-3" style={{ borderColor: BORDER }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-black uppercase" style={{ background: style.bg, color: style.color }}>
                          {admin.status}
                        </span>
                        <span className="text-[11px]" style={{ color: MUTED }}>
                          {new Date(admin.administered_time).toLocaleString()}
                        </span>
                      </div>
                      {admin.administered_by_name && (
                        <p className="mt-1.5 text-[11px]" style={{ color: MUTED }}>
                          {translate("compliance.centre.medications.by")} {admin.administered_by_name}
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
                      {admin.notes && (
                        <p className="mt-1 text-[12px]" style={{ color: MUTED }}>{admin.notes}</p>
                      )}
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
