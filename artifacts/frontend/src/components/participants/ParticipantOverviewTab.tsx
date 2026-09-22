import { ClipboardList, Lock, Mail, Pencil, Phone, UsersRound } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { safeFormat, money } from "@/lib/participant-format";
import { emergencyContactDisplay } from "@/lib/participant-display";
import {
  planManagementTypeLabel,
  getCoordinatorWorkerStats,
  type BillingPeriod,
  type BillingPeriodCurrent,
} from "@/services/coordinatorService";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import type { ParticipantRecord, BudgetSummary } from "@/pages/patients";

interface ParticipantOverviewTabProps {
  participant: ParticipantRecord;
  budget?: BudgetSummary;
  totalBudget: number;
  isCoordinator: boolean;
  billingPeriodCurrent?: BillingPeriodCurrent;
  billingPeriodCurrentLoading: boolean;
  billingPeriodHistory?: BillingPeriod[];
  /** Jumps to the Care Profile tab's Worker Shift Context section, the only
   * place case manager / GP / emergency contact / next of kin are actually
   * editable — this section otherwise has no edit affordance at all. */
  onEditContacts?: () => void;
}

/** A contact fact rendered as a tap/click-to-act link (tel:/mailto:) rather
 * than plain text — so a coordinator can reach someone directly from this
 * card instead of copying the number into their phone first. */
function ContactCard({
  label,
  name,
  sub,
  phone,
  email,
  notSet,
}: {
  label: string;
  name?: string | null;
  sub?: string | null;
  phone?: string | null;
  email?: string | null;
  notSet: string;
}) {
  const hasAny = Boolean(name || sub || phone || email);
  return (
    <div className="rounded-lg bg-white border border-purple-100/60 px-3 py-2">
      <dt className="text-[9px] font-black uppercase tracking-wider text-[#6A6A77] leading-none mb-1">{label}</dt>
      {hasAny ? (
        <div className="space-y-1">
          {(name || sub) && (
            <dd className="text-[12px] font-bold text-[#1A1A2E] truncate">
              {[name, sub].filter(Boolean).join(" · ")}
            </dd>
          )}
          {(phone || email) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {phone && (
                <a
                  href={`tel:${phone.replace(/[^+\d]/g, "")}`}
                  className="flex items-center gap-1 text-[11px] font-semibold text-[#E8457A] hover:opacity-70"
                >
                  <Phone className="h-3 w-3" /> {phone}
                </a>
              )}
              {email && (
                <a
                  href={`mailto:${email}`}
                  className="flex items-center gap-1 text-[11px] font-semibold text-[#E8457A] hover:opacity-70"
                >
                  <Mail className="h-3 w-3" /> {email}
                </a>
              )}
            </div>
          )}
        </div>
      ) : (
        <dd className="text-[12px] font-bold text-[#1A1A2E]">{notSet}</dd>
      )}
    </div>
  );
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
  onEditContacts,
}: ParticipantOverviewTabProps) {
  const { translate } = useAccessibility();

  const notSet = translate("patients.notSet");
  const emergencyContact = emergencyContactDisplay(participant.emergency_contact ?? undefined);
  const nextOfKin = emergencyContactDisplay(participant.next_of_kin ?? undefined);

  const { data: coordinators = [] } = useOrgQuery(["org-coordinators", "care-coordinator-picker"], {
    queryFn: () =>
      getCoordinatorWorkerStats().then((list) =>
        list.filter((w) => w.role === "support_coordinator" || w.role === "managing_director"),
      ),
  });
  const careCoordinator = participant.care_coordinator_id
    ? coordinators.find((c) => c.id === participant.care_coordinator_id)
    : undefined;

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
          <ContactCard label={translate("patients.field.phone")} phone={participant.phone} notSet={notSet} />
          <ContactCard label={translate("patients.field.email")} email={participant.email} notSet={notSet} />
        </dl>
      </section>

      <section className="rounded-2xl border border-purple-100/70 bg-[#FDFCFF] p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <UsersRound className="h-3.5 w-3.5 text-[#E8457A]" />
            <h4 className="text-[13px] font-black text-[#1A1A2E]">{translate("patients.section.careTeamContacts")}</h4>
          </div>
          {isCoordinator && onEditContacts && (
            <button
              type="button"
              onClick={onEditContacts}
              className="flex items-center gap-1 text-[11px] font-bold text-[#E8457A] hover:opacity-70"
            >
              <Pencil className="h-3 w-3" />
              {translate("common.edit")}
            </button>
          )}
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <ContactCard
            label={translate("patients.field.careCoordinator")}
            name={careCoordinator?.full_name}
            notSet={notSet}
          />
          <ContactCard
            label={translate("patients.field.billingContact")}
            name={participant.case_manager_name}
            phone={participant.case_manager_phone}
            notSet={notSet}
          />
          <ContactCard
            label={translate("patients.field.gp")}
            name={participant.gp_name}
            sub={participant.gp_practice}
            phone={participant.gp_phone}
            notSet={notSet}
          />
          <ContactCard
            label={translate("patients.field.emergencyContact")}
            name={emergencyContact?.name}
            sub={emergencyContact?.relationship}
            phone={emergencyContact?.phone}
            notSet={notSet}
          />
          <ContactCard
            label={translate("patients.field.nextOfKin")}
            name={nextOfKin?.name}
            sub={nextOfKin?.relationship}
            phone={nextOfKin?.phone}
            notSet={notSet}
          />
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
