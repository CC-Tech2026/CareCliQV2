import type { ReactNode } from "react";
import { ArrowRight, Mail, MapPin, Pencil, Phone } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/ui/copy-button";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { safeFormat } from "@/lib/participant-format";
import { ageFrom } from "@/lib/person-identity";
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

// Each part is a titled section of label and value rows, separated by a rule:
// read top to bottom like a file, not a grid of boxes.
const SECTION = "space-y-3 border-t border-cc-border pt-6 first:border-t-0 first:pt-0";

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className={SECTION}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-cc-text">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-3 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-cc-muted">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-cc-text">{children}</dd>
    </div>
  );
}

function NotSet({ text }: { text: string }) {
  return <span className="text-cc-muted">{text}</span>;
}

/** A value with a copy icon after it. */
function Copyable({ value, label, children }: { value: string; label: string; children?: ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span className="min-w-0 break-words">{children ?? value}</span>
      <CopyButton value={value} label={label} />
    </span>
  );
}

/** 1992-05-14 as 14/05/1992, the way forms ask for it. */
function dayMonthYear(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Someone to reach: name and role, then tap-to-call and tap-to-email links,
 * so a coordinator can contact them straight from the record. */
function Contact({
  name,
  sub,
  phone,
  email,
  notSet,
  whose,
}: {
  name?: string | null;
  sub?: string | null;
  phone?: string | null;
  email?: string | null;
  notSet: string;
  /** Whose details, for the copy buttons: "GP" gives "Copy GP phone number". */
  whose?: string;
}) {
  const prefix = whose ? `${whose} ` : "";
  if (!name && !sub && !phone && !email) return <NotSet text={notSet} />;
  return (
    <div className="space-y-1">
      {(name || sub) && <p className="font-medium">{[name, sub].filter(Boolean).join(" · ")}</p>}
      {(phone || email) && (
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          {phone && (
            <span className="inline-flex items-center gap-1">
              <a href={`tel:${phone.replace(/[^+\d]/g, "")}`} className="inline-flex items-center gap-1.5 text-cc-plum hover:underline">
                <Phone className="h-3.5 w-3.5" aria-hidden /> {phone}
              </a>
              <CopyButton value={phone} label={`${prefix}phone number`} />
            </span>
          )}
          {email && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <a href={`mailto:${email}`} className="inline-flex min-w-0 items-center gap-1.5 break-all text-cc-plum hover:underline">
                <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden /> {email}
              </a>
              <CopyButton value={email} label={`${prefix}email`} />
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/** "Details & contacts" for a participant: who they are, and who supports them. */
export function ParticipantOverviewTab({
  participant,
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
  const emergencyContact = emergencyContactDisplay(participant.emergency_contact ?? undefined);
  const nextOfKin = emergencyContactDisplay(participant.next_of_kin ?? undefined);

  const { data: coordinators = [] } = useOrgQuery(["org-coordinators", "care-coordinator-picker"], {
    queryFn: () =>
      getCoordinatorWorkerStats().then((list) =>
        list.filter((w) => w.role === "support_coordinator" || w.role === "managing_director"),
      ),
  });
  // A coordinator's own worker-stats list is team-scoped and doesn't include
  // herself, so when she is this participant's care coordinator fall back to
  // her own name instead of showing "Not set".
  const careCoordinator = participant.care_coordinator_id
    ? (coordinators.find((c) => c.id === participant.care_coordinator_id) ??
      (user?.id === participant.care_coordinator_id ? { full_name: user.full_name } : undefined))
    : undefined;

  const age = ageFrom(participant.date_of_birth);
  const address = participant.address?.trim();

  return (
    <div className="space-y-6">
      <Section title={translate("patients.section.personalDetails")} action={editAction}>
        <dl className="divide-y divide-cc-border">
          <Row label={translate("patients.field.dateOfBirth")}>
            {participant.date_of_birth ? (
              <Copyable value={dayMonthYear(participant.date_of_birth)} label="date of birth">
                {safeFormat(participant.date_of_birth)}
                {age != null && <span className="text-cc-muted"> · {age} years</span>}
              </Copyable>
            ) : (
              <NotSet text={notSet} />
            )}
          </Row>
          <Row label={translate("patients.field.biologicalSex")}>
            {participant.biological_sex ? (
              <span className="capitalize">{participant.biological_sex}</span>
            ) : (
              <NotSet text={notSet} />
            )}
          </Row>
          <Row label={translate("patients.field.primaryDisability")}>
            {participant.primary_disability || <NotSet text={notSet} />}
          </Row>
          <Row label="NDIS number">
            {participant.ndis_number ? <Copyable value={participant.ndis_number} label="NDIS number" /> : <NotSet text={notSet} />}
          </Row>
          <Row label={translate("patients.field.phone")}>
            <Contact phone={participant.phone} notSet={notSet} />
          </Row>
          <Row label={translate("patients.field.email")}>
            <Contact email={participant.email} notSet={notSet} />
          </Row>
          <Row label={translate("patients.field.address")}>
            {address ? (
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <Copyable value={address} label="home address" />
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-cc-plum hover:underline"
                >
                  <MapPin className="h-3.5 w-3.5" aria-hidden /> {translate("patients.action.openInMaps")}
                </a>
              </span>
            ) : (
              <NotSet text={notSet} />
            )}
          </Row>
        </dl>
      </Section>

      <Section
        title={translate("patients.section.careTeamContacts")}
        action={
          isCoordinator && onEditContacts ? (
            <button
              type="button"
              onClick={onEditContacts}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-cc-border px-4 text-sm font-medium text-cc-text hover:bg-cc-soft"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit contacts
            </button>
          ) : undefined
        }
      >
        <dl className="divide-y divide-cc-border">
          <Row label={translate("patients.field.careCoordinator")}>
            <Contact name={careCoordinator?.full_name} notSet={notSet} />
          </Row>
          <Row label={translate("patients.field.billingContact")}>
            <Contact name={participant.case_manager_name} phone={participant.case_manager_phone} notSet={notSet} whose="plan manager" />
          </Row>
          <Row label={translate("patients.field.gp")}>
            <Contact name={participant.gp_name} sub={participant.gp_practice} phone={participant.gp_phone} notSet={notSet} whose="GP" />
          </Row>
          <Row label={translate("patients.field.emergencyContact")}>
            <Contact
              name={emergencyContact?.name}
              sub={emergencyContact?.relationship}
              phone={emergencyContact?.phone}
              notSet={notSet}
              whose="emergency contact"
            />
          </Row>
          <Row label={translate("patients.field.nextOfKin")}>
            <Contact name={nextOfKin?.name} sub={nextOfKin?.relationship} phone={nextOfKin?.phone} notSet={notSet} whose="next of kin" />
          </Row>
        </dl>
      </Section>

      {isCoordinator && (
        <Section title={translate("patients.billingPeriod.title")}>
          {billingPeriodCurrentLoading ? (
            <Skeleton className="h-16 w-full rounded-xl" />
          ) : (
            <>
              {billingPeriodCurrent?.type_differs_from_lock && (
                <p
                  className="border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
                  role="status"
                >
                  {billingPeriodCurrent.message ?? translate("patients.billingPeriod.nextPeriodNote")}
                </p>
              )}
              <dl className="divide-y divide-cc-border">
                <Row label={translate("patients.billingPeriod.currentType")}>
                  {planManagementTypeLabel(billingPeriodCurrent?.current_plan_management_type, translate)}
                </Row>
                <Row label={translate("patients.billingPeriod.lockedType")}>
                  {planManagementTypeLabel(billingPeriodCurrent?.open_period?.locked_plan_management_type, translate)}
                </Row>
                <Row label={translate("patients.billingPeriod.periodRange")}>
                  {billingPeriodCurrent?.open_period
                    ? `${safeFormat(billingPeriodCurrent.open_period.period_start)} to ${safeFormat(billingPeriodCurrent.open_period.period_end)}`
                    : <NotSet text={notSet} />}
                </Row>
              </dl>
            </>
          )}

          {billingPeriodHistory && billingPeriodHistory.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-medium text-cc-muted">{translate("patients.billingPeriod.history")}</h4>
              <ul className="max-h-48 divide-y divide-cc-border overflow-y-auto">
                {billingPeriodHistory.map((period: BillingPeriod) => (
                  <li key={period.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
                    <span className="text-cc-text">
                      {safeFormat(period.period_start)} to {safeFormat(period.period_end)}
                    </span>
                    <span className="text-cc-muted">{planManagementTypeLabel(period.locked_plan_management_type, translate)}</span>
                    <span className={period.status === "open" ? "font-medium text-emerald-700 dark:text-emerald-400" : "text-cc-muted"}>
                      {period.status === "open"
                        ? translate("patients.billingPeriod.statusOpen")
                        : translate("patients.billingPeriod.statusClosed")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {invoiceSummary && <div className={SECTION}>{invoiceSummary}</div>}

      {onViewPlan && (
        <div className={SECTION}>
          <button type="button" onClick={onViewPlan} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-cc-plum hover:underline">
            NDIS plan, funding and goals <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
