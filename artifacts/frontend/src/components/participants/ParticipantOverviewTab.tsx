import { ClipboardList, Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { safeFormat, money } from "@/lib/participant-format";
import { planManagementTypeLabel, type BillingPeriod, type BillingPeriodCurrent } from "@/services/coordinatorService";
import type { ParticipantRecord, BudgetSummary } from "@/pages/patients";

interface ParticipantOverviewTabProps {
  participant: ParticipantRecord;
  budget?: BudgetSummary;
  totalBudget: number;
  isCoordinator: boolean;
  billingPeriodCurrent?: BillingPeriodCurrent;
  billingPeriodCurrentLoading: boolean;
  billingPeriodHistory?: BillingPeriod[];
}

/** "Overview" facet of the participant Detail archetype. */
export function ParticipantOverviewTab({
  participant,
  budget,
  totalBudget,
  isCoordinator,
  billingPeriodCurrent,
  billingPeriodCurrentLoading,
  billingPeriodHistory,
}: ParticipantOverviewTabProps) {
  const { translate } = useAccessibility();

  return (
    <>
      <section className="rounded-2xl border border-purple-100/70 bg-[#FDFCFF] p-4">
        <div className="mb-3 flex items-center gap-2">
          <ClipboardList className="h-3.5 w-3.5 text-[#E8457A]" />
          <h4 className="text-[13px] font-black text-[#1A1A2E]">{translate("patients.section.personalDetails")}</h4>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            [translate("patients.field.dateOfBirth"),     safeFormat(participant.date_of_birth)],
            [translate("patients.field.biologicalSex"),    participant.biological_sex || translate("patients.notSet")],
            [translate("patients.field.primaryDisability"), participant.primary_disability || translate("patients.notSet")],
            [translate("patients.field.phone"),             participant.phone || translate("patients.notSet")],
            [translate("patients.field.email"),             participant.email || translate("patients.notSet")],
            [translate("patients.field.planPeriod"),       participant.plan_start_date
              ? `${safeFormat(participant.plan_start_date)} – ${safeFormat(participant.plan_end_date)}`
              : translate("patients.notSet")],
            [translate("patients.field.planStatus"),       participant.plan_status || translate("patients.notSet")],
            [translate("patients.field.planManagementType"), planManagementTypeLabel(participant.plan_management_type, translate)],
            [translate("patients.field.totalBudget"),      money(totalBudget || budget?.total_funding)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-white border border-purple-100/60 px-3 py-2">
              <dt className="text-[9px] font-black uppercase tracking-wider text-[#6A6A77] leading-none mb-1">{label}</dt>
              <dd className="text-[12px] font-bold text-[#1A1A2E] truncate" title={String(value)}>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {isCoordinator && (
        <section className="rounded-2xl border border-purple-100/70 bg-[#FDFCFF] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 text-[#E8457A]" />
            <h4 className="text-[13px] font-black text-[#1A1A2E]">{translate("patients.billingPeriod.title")}</h4>
          </div>

          {billingPeriodCurrentLoading ? (
            <Skeleton className="h-16 w-full rounded-xl" />
          ) : (
            <>
              {billingPeriodCurrent?.type_differs_from_lock && (
                <div
                  className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-900"
                  role="status"
                >
                  {billingPeriodCurrent.message ?? translate("patients.billingPeriod.nextPeriodNote")}
                </div>
              )}
              <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  [translate("patients.billingPeriod.currentType"), planManagementTypeLabel(billingPeriodCurrent?.current_plan_management_type, translate)],
                  [translate("patients.billingPeriod.lockedType"), planManagementTypeLabel(billingPeriodCurrent?.open_period?.locked_plan_management_type, translate)],
                  [
                    translate("patients.billingPeriod.periodRange"),
                    billingPeriodCurrent?.open_period
                      ? `${safeFormat(billingPeriodCurrent.open_period.period_start)} – ${safeFormat(billingPeriodCurrent.open_period.period_end)}`
                      : translate("patients.notSet"),
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-white border border-purple-100/60 px-3 py-2">
                    <dt className="text-[9px] font-black uppercase tracking-wider text-[#6A6A77] leading-none mb-1">{label}</dt>
                    <dd className="text-[12px] font-bold text-[#1A1A2E]">{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {billingPeriodHistory && billingPeriodHistory.length > 0 && (
            <div className="pt-1">
              <p className="text-[10px] font-black uppercase tracking-wider text-[#6A6A77] mb-2">
                {translate("patients.billingPeriod.history")}
              </p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {billingPeriodHistory.map((period: BillingPeriod) => (
                  <div
                    key={period.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-purple-100/60 bg-white px-3 py-2 text-[12px]"
                  >
                    <span className="font-semibold text-[#1A1A2E]">
                      {safeFormat(period.period_start)} – {safeFormat(period.period_end)}
                    </span>
                    <span className="text-[#6A6A77]">
                      {planManagementTypeLabel(period.locked_plan_management_type, translate)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${period.status === "open" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                      {period.status === "open"
                        ? translate("patients.billingPeriod.statusOpen")
                        : translate("patients.billingPeriod.statusClosed")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
