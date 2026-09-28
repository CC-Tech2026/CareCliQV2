import { FileText, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { jsonFetch } from "@/services/http";

type AgreementSupport = {
  id: string;
  support_item_code: string;
  item_name: string | null;
  unit: string | null;
  standard_rate: number | null;
  negotiated_rate: number | null;
  frequency: string | null;
  total_hours_allocated: number | null;
  total_funding: number | null;
  location: string | null;
};

type SignedDocument = {
  name: string | null;
  url: string | null;
  provider_signed_name: string | null;
  provider_signed_at: string | null;
  family_signed_name: string | null;
  family_signed_at: string | null;
};

type ServiceAgreement = {
  id: string;
  status: string;
  plan_management_type: string;
  plan_manager_name: string | null;
  plan_manager_email: string | null;
  start_date: string;
  end_date: string | null;
  includes_price_adjustment_clause: boolean;
  gst_treatment_basis: string | null;
  cancellation_notice_hours: number | null;
  cancellation_fee_percentage: number | null;
  signed_by: string | null;
  signed_date: string | null;
  service_agreement_supports: AgreementSupport[];
  signed_document: SignedDocument | null;
};

const PLAN_MANAGEMENT_LABELS: Record<string, string> = {
  "NDIA-managed": "NDIA-managed",
  "plan-managed": "Plan-managed",
  "self-managed": "Self-managed",
};
const LOCATION_LABELS: Record<string, string> = {
  home: "At home",
  school: "School",
  preschool: "Preschool",
  clinic: "Clinic",
  other: "In the community",
};

const money = (value: number | null | undefined) =>
  value == null
    ? "Not recorded"
    : new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: "AUD",
      }).format(value);

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "5 hours a week" from the agreement's total over its own period, so the
 * line reads the way the signed schedule of supports does. */
function hoursPerPeriod(
  support: AgreementSupport,
  agreement: ServiceAgreement,
) {
  if (!support.total_hours_allocated || !agreement.end_date) return null;
  const days =
    (new Date(`${agreement.end_date}T00:00:00`).getTime() -
      new Date(`${agreement.start_date}T00:00:00`).getTime()) /
    86_400_000;
  const weeks = days / 7;
  if (weeks <= 0) return null;
  if (support.frequency === "monthly") {
    const perMonth = Math.round(support.total_hours_allocated / (weeks / 4.33));
    return `${perMonth} hours a month`;
  }
  if (support.frequency === "fortnightly") {
    return `${Math.round(support.total_hours_allocated / (weeks / 2))} hours a fortnight`;
  }
  if (support.frequency === "weekly") {
    return `${Math.round(support.total_hours_allocated / weeks)} hours a week`;
  }
  return "As scheduled";
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-cc-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-cc-text">{value}</dd>
    </div>
  );
}

/** The participant's signed service agreement on their profile: the schedule
 * of supports (hours, rate, funding), the terms, who signed and when, and the
 * signed PDF. Previously this was only reachable from the MD's onboarding
 * board, so coordinators couldn't see what had been agreed. */
export function ParticipantServiceAgreementSection({
  participantId,
}: {
  participantId: string;
}) {
  const { data, isLoading, isError, refetch } = useOrgQuery<ServiceAgreement[]>(
    ["participant", participantId, "service-agreements"],
    {
      queryFn: () =>
        jsonFetch(
          `/api/participants/${encodeURIComponent(participantId)}/service-agreements`,
        ),
    },
  );

  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (isError) {
    return (
      <div role="alert" className="text-sm text-cc-text">
        The service agreement could not be loaded.{" "}
        <Button variant="link" className="px-1" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  const agreements = data ?? [];
  const agreement =
    agreements.find((a) => a.status === "active") ?? agreements[0];
  if (!agreement) {
    return (
      <p className="text-sm text-cc-muted">
        No service agreement recorded yet. Agreements signed through participant
        onboarding appear here.
      </p>
    );
  }

  const supports = agreement.service_agreement_supports ?? [];
  const totalFunding = supports.reduce(
    (sum, s) => sum + (Number(s.total_funding) || 0),
    0,
  );
  const doc = agreement.signed_document;
  const active = agreement.status === "active";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-cc-text">
            {formatDate(agreement.start_date)} to{" "}
            {formatDate(agreement.end_date) ?? "ongoing"}
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize"
              style={{
                background: active
                  ? "var(--cc-status-success-bg)"
                  : "var(--cc-soft)",
                color: active ? "var(--cc-status-success)" : "var(--cc-muted)",
              }}
            >
              {agreement.status.replace(/_/g, " ")}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-cc-muted">
            Signed{" "}
            {formatDate(agreement.signed_date) ??
              formatDate(doc?.family_signed_at) ??
              "date not recorded"}
            {agreement.signed_by ? ` by ${agreement.signed_by}` : ""}
          </p>
        </div>
        {doc?.url && (
          <Button asChild variant="outline" className="min-h-10 gap-1.5">
            <a href={doc.url} target="_blank" rel="noreferrer">
              <FileText size={15} /> View signed agreement
              <ExternalLink size={13} className="text-cc-muted" />
            </a>
          </Button>
        )}
      </div>

      <dl className="grid gap-3 rounded-lg border border-cc-border p-3 sm:grid-cols-3">
        <Fact
          label="Plan management"
          value={
            PLAN_MANAGEMENT_LABELS[agreement.plan_management_type] ??
            agreement.plan_management_type
          }
        />
        {agreement.plan_management_type === "plan-managed" && (
          <Fact
            label="Plan manager"
            value={
              agreement.plan_manager_name ? (
                <>
                  {agreement.plan_manager_name}
                  {agreement.plan_manager_email && (
                    <span className="block text-xs font-normal text-cc-muted">
                      {agreement.plan_manager_email}
                    </span>
                  )}
                </>
              ) : (
                "Not recorded"
              )
            }
          />
        )}
        {doc && (
          <Fact
            label="Signatories"
            value={
              <>
                {doc.provider_signed_name ?? "Provider"} (provider)
                <span className="block">{doc.family_signed_name}</span>
              </>
            }
          />
        )}
      </dl>

      <section aria-label="Schedule of supports">
        <h4 className="mb-2 text-sm font-semibold text-cc-text">
          Schedule of supports
        </h4>
        {supports.length === 0 ? (
          <p className="text-sm text-cc-muted">No support lines recorded.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-cc-border">
            {supports.map((s) => {
              const rate = s.negotiated_rate ?? s.standard_rate;
              return (
                <div
                  key={s.id}
                  className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-cc-border px-3 py-2.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-cc-text">
                      {s.item_name ?? s.support_item_code}
                    </p>
                    <p className="text-xs text-cc-muted">
                      {[
                        hoursPerPeriod(s, agreement),
                        s.location ? LOCATION_LABELS[s.location] : null,
                        rate != null
                          ? `${money(rate)} per hour${s.negotiated_rate != null ? " (negotiated)" : ""}`
                          : null,
                        s.support_item_code,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-cc-text">
                      {money(s.total_funding)}
                    </p>
                    {s.total_hours_allocated != null && (
                      <p className="text-xs tabular-nums text-cc-muted">
                        {Number(s.total_hours_allocated).toLocaleString(
                          "en-AU",
                        )}{" "}
                        hours
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="flex items-center justify-between bg-cc-soft px-3 py-2 text-sm">
              <span className="font-medium text-cc-text">
                Total agreed funding
              </span>
              <span className="font-semibold tabular-nums text-cc-text">
                {money(totalFunding)}
              </span>
            </div>
          </div>
        )}
      </section>

      <dl className="grid gap-3 sm:grid-cols-2">
        <Fact
          label="Cancellations"
          value={
            agreement.cancellation_notice_hours != null
              ? `${agreement.cancellation_notice_hours} hours' notice. Later cancellations are charged at ${agreement.cancellation_fee_percentage ?? 100}% of the agreed rate.`
              : "Not recorded"
          }
        />
        <Fact
          label="Price changes"
          value={
            agreement.includes_price_adjustment_clause
              ? "Prices follow NDIS Pricing Arrangements updates."
              : "Prices fixed for the agreement period."
          }
        />
        {agreement.gst_treatment_basis && (
          <div className="sm:col-span-2">
            <Fact label="GST" value={agreement.gst_treatment_basis} />
          </div>
        )}
      </dl>
    </div>
  );
}
