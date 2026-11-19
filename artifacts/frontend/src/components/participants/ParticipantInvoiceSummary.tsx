import { ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { jsonFetch } from "@/services/http";

type InvoiceSummary = {
  count: number;
  total_cents: number;
  unpaid_cents: number;
  overdue_count: number;
  currency: string;
};

// Australian financial year (1 July to 30 June) containing `today`.
function currentFinancialYear(today = new Date()) {
  const start =
    today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
  return {
    from: `${start}-07-01`,
    to: `${start + 1}-06-30`,
    label: `${start}-${String(start + 1).slice(2)}`,
  };
}

const amount = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(
    cents / 100,
  );

/** This financial year's invoices for the participant, in one line of
 * figures. The full list, older years and downloads open from "All invoices". */
export function ParticipantInvoiceSummary({
  participantId,
  onViewAll,
}: {
  participantId: string;
  onViewAll: () => void;
}) {
  const fy = currentFinancialYear();
  const { data, isLoading, isError } = useOrgQuery<InvoiceSummary>(
    ["participant", participantId, "invoice-summary", fy.from],
    {
      queryFn: () =>
        jsonFetch(
          `/api/participants/${encodeURIComponent(participantId)}/invoices/summary?date_from=${fy.from}&date_to=${fy.to}`,
        ),
    },
  );

  return (
    <section aria-label={`Invoices, financial year ${fy.label}`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-cc-text">
          Invoices, financial year {fy.label}
        </h3>
        <button
          type="button"
          onClick={onViewAll}
          className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-cc-plum hover:underline"
        >
          All invoices <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {isLoading ? (
        <Skeleton className="h-12 w-full rounded-xl" />
      ) : isError || !data ? (
        <p className="text-sm text-cc-muted">Invoice totals could not be loaded.</p>
      ) : data.count === 0 ? (
        <p className="text-sm text-cc-muted">No invoices issued this financial year.</p>
      ) : (
        <dl className="grid grid-cols-3 gap-4">
          <div>
            <dd className="text-xl font-semibold tabular-nums text-cc-text">{data.count}</dd>
            <dt className="text-xs text-cc-muted">invoices</dt>
          </div>
          <div>
            <dd className="text-xl font-semibold tabular-nums text-cc-text">
              {amount(data.total_cents, data.currency)}
            </dd>
            <dt className="text-xs text-cc-muted">billed</dt>
          </div>
          <div>
            <dd className="text-xl font-semibold tabular-nums text-cc-text">
              {amount(data.unpaid_cents, data.currency)}
            </dd>
            <dt className="text-xs text-cc-muted">
              unpaid
              {data.overdue_count > 0 && (
                <span className="font-medium text-red-700 dark:text-red-400"> · {data.overdue_count} overdue</span>
              )}
            </dt>
          </div>
        </dl>
      )}
    </section>
  );
}
