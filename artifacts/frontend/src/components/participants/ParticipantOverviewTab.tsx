import type { ReactNode } from "react";
import {
  ClipboardList,
  Lock,
  Mail,
  Pencil,
  Phone,
  UsersRound,
} from "lucide-react";
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
import { useAuth } from "@/contexts/AuthContext";
import type { ParticipantRecord, BudgetSummary } from "@/pages/patients";

interface ParticipantOverviewTabProps {
  participant: ParticipantRecord;
  budget?: BudgetSummary;
  totalBudget: number;
  isCoordinator: boolean;
  billingPeriodCurrent?: BillingPeriodCurrent;
  billingPeriodCurrentLoading: boolean;
  billingPeriodHistory?: BillingPeriod[];
  /** Opens the care-contact editor without leaving the overview. */
  onEditContacts?: () => void;
  editAction?: ReactNode;
  onViewPlan?: () => void;
  /** Participant's invoice snapshot, shown after the billing period. */
  invoiceSummary?: ReactNode;
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
    <div className="rounded-lg bg-cc-surface border border-cc-border px-4 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wider text-cc-muted leading-none mb-1">
        {label}
      </dt>
      {hasAny ? (
        <div className="space-y-1">
          {(name || sub) && (
            <dd className="text-sm font-medium text-cc-text break-words">
              {[name, sub].filter(Boolean).join(" · ")}
            </dd>
          )}
          {(phone || email) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {phone && (
                <a
                  href={`tel:${phone.replace(/[^+\d]/g, "")}`}
                  className="flex items-center gap-1 min-h-9 break-all text-xs font-medium text-cc-plum hover:opacity-70"
                >
                  <Phone className="h-3 w-3" /> {phone}
                </a>
              )}
              {email && (
                <a
                  href={`mailto:${email}`}
                  className="flex items-center gap-1 min-h-9 break-all text-xs font-medium text-cc-plum hover:opacity-70"
                >
                  <Mail className="h-3 w-3" /> {email}
                </a>
              )}
            </div>
          )}
        </div>
      ) : (
        <dd className="text-[12px] font-bold text-cc-text">{notSet}</dd>
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
  editAction,
  onViewPlan,
  invoiceSummary,
}: ParticipantOverviewTabProps) {
  const { translate } = useAccessibility();

  const notSet = translate("patients.notSet");
  const { user } = useAuth();
  const emergencyContact = emergencyContactDisplay(
    participant.emergency_contact ?? undefined,
  );
  const nextOfKin = emergencyContactDisplay(
    participant.next_of_kin ?? undefined,
  );

  const { data: coordinators = [] } = useOrgQuery(
    ["org-coordinators", "care-coordinator-picker"],
    {
      queryFn: () =>
        getCoordinatorWorkerStats().then((list) =>
          list.filter(
            (w) =>
              w.role === "support_coordinator" ||
              w.role === "managing_director",
          ),
        ),
    },
  );
  // A coordinator's own worker-stats list is team-scoped and doesn't include
  // herself, so when she is this participant's care coordinator fall back to
  // her own name instead of showing "Not set".
  const careCoordinator = participant.care_coordinator_id
    ? (coordinators.find((c) => c.id === participant.care_coordinator_id) ??
      (user?.id === participant.care_coordinator_id
        ? { full_name: user.full_name }
        : undefined))
    : undefined;

  return (
    <>
      <section className="rounded-2xl border border-cc-border bg-cc-surface p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <ClipboardList className="h-3.5 w-3.5 text-[#E8457A]" />
          <h4 className="text-base font-semibold text-cc-text">
            {translate("patients.section.personalDetails")}
          </h4>
          <div className="ml-auto">{editAction}</div>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            [
              translate("patients.field.dateOfBirth"),
              safeFormat(participant.date_of_birth),
            ],
            [
              translate("patients.field.biologicalSex"),
              participant.biological_sex || translate("patients.notSet"),
            ],
            [
              translate("patients.field.primaryDisability"),
              participant.primary_disability || translate("patients.notSet"),
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg bg-cc-surface border border-cc-border px-4 py-3"
            >
              <dt className="text-xs font-semibold uppercase tracking-wider text-cc-muted leading-none mb-1">
                {label}
              </dt>
              <dd
                className="text-sm font-medium text-cc-text break-words"
                title={String(value)}
              >
                {value}
              </dd>
            </div>
          ))}
          <ContactCard
            label={translate("patients.field.phone")}
            phone={participant.phone}
            notSet={notSet}
          />
          <ContactCard
            label={translate("patients.field.email")}
            email={participant.email}
            notSet={notSet}
          />
        </dl>
      </section>

      {onViewPlan && (
        <button
          type="button"
          onClick={onViewPlan}
          className="min-h-11 rounded-xl border border-cc-border px-4 py-2 text-left text-sm font-medium text-cc-plum"
        >
          View plan details, funding and goals
        </button>
      )}
      <section className="rounded-2xl border border-cc-border bg-cc-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <UsersRound className="h-3.5 w-3.5 text-[#E8457A]" />
            <h4 className="text-base font-semibold text-cc-text">
              {translate("patients.section.careTeamContacts")}
            </h4>
          </div>
          {isCoordinator && onEditContacts && (
            <button
              type="button"
              onClick={onEditContacts}
              className="flex items-center gap-1 text-[11px] font-bold text-[#E8457A] hover:opacity-70"
            >
              <Pencil className="h-3 w-3" />
              Edit care contacts
            </button>
          )}
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        <section className="rounded-2xl border border-cc-border bg-cc-surface p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Lock className="h-3.5 w-3.5 text-[#E8457A]" />
            <h4 className="text-base font-semibold text-cc-text">
              {translate("patients.billingPeriod.title")}
            </h4>
          </div>

          {billingPeriodCurrentLoading ? (
            <Skeleton className="h-16 w-full rounded-xl" />
          ) : (
            <>
              {billingPeriodCurrent?.type_differs_from_lock && (
                <div
                  className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-medium text-amber-900"
                  role="status"
                >
                  {billingPeriodCurrent.message ??
                    translate("patients.billingPeriod.nextPeriodNote")}
                </div>
              )}
              <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  [
                    translate("patients.billingPeriod.currentType"),
                    planManagementTypeLabel(
                      billingPeriodCurrent?.current_plan_management_type,
                      translate,
                    ),
                  ],
                  [
                    translate("patients.billingPeriod.lockedType"),
                    planManagementTypeLabel(
                      billingPeriodCurrent?.open_period
                        ?.locked_plan_management_type,
                      translate,
                    ),
                  ],
                  [
                    translate("patients.billingPeriod.periodRange"),
                    billingPeriodCurrent?.open_period
                      ? `${safeFormat(billingPeriodCurrent.open_period.period_start)} – ${safeFormat(billingPeriodCurrent.open_period.period_end)}`
                      : translate("patients.notSet"),
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-lg bg-cc-surface border border-cc-border px-4 py-3"
                  >
                    <dt className="text-xs font-semibold uppercase tracking-wider text-cc-muted leading-none mb-1">
                      {label}
                    </dt>
                    <dd className="text-[12px] font-bold text-cc-text">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {billingPeriodHistory && billingPeriodHistory.length > 0 && (
            <div className="pt-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-cc-muted mb-2">
                {translate("patients.billingPeriod.history")}
              </p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {billingPeriodHistory.map((period: BillingPeriod) => (
                  <div
                    key={period.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-cc-border bg-cc-surface px-4 py-3 text-[12px]"
                  >
                    <span className="font-semibold text-cc-text">
                      {safeFormat(period.period_start)} –{" "}
                      {safeFormat(period.period_end)}
                    </span>
                    <span className="text-cc-muted">
                      {planManagementTypeLabel(
                        period.locked_plan_management_type,
                        translate,
                      )}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${period.status === "open" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
                    >
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
      {invoiceSummary}
    </>
  );
}
