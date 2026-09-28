import { Receipt } from "lucide-react";
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

/** One-line invoice snapshot for the participant overview. The full list,
 * older years and downloads live in the Records & invoices side panel. */
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
    <section className="rounded-2xl border border-purple-100/70 bg-[#FDFCFF] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Receipt className="h-3.5 w-3.5 text-[#E8457A]" />
          <h4 className="text-[13px] font-black text-[#1A1A2E]">
            Invoices, financial year {fy.label}
          </h4>
        </div>
        <button
          type="button"
          onClick={onViewAll}
          className="min-h-9 text-[11px] font-bold text-[#E8457A] hover:opacity-70"
        >
          View all invoices
        </button>
      </div>
      {isLoading ? (
        <Skeleton className="h-12 w-full rounded-xl" />
      ) : isError || !data ? (
        <p className="text-[12px] text-[#6A6A77]">
          Invoice totals could not be loaded.
        </p>
      ) : data.count === 0 ? (
        <p className="text-[12px] text-[#6A6A77]">
          No invoices issued this financial year.
        </p>
      ) : (
        <dl className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-white p-3">
            <dt className="text-[10px] font-bold uppercase tracking-wide text-[#6A6A77]">
              Invoices
            </dt>
            <dd className="mt-1 text-[15px] font-black tabular-nums text-[#1A1A2E]">
              {data.count}
            </dd>
          </div>
          <div className="rounded-xl bg-white p-3">
            <dt className="text-[10px] font-bold uppercase tracking-wide text-[#6A6A77]">
              Billed
            </dt>
            <dd className="mt-1 text-[15px] font-black tabular-nums text-[#1A1A2E]">
              {amount(data.total_cents, data.currency)}
            </dd>
          </div>
          <div className="rounded-xl bg-white p-3">
            <dt className="text-[10px] font-bold uppercase tracking-wide text-[#6A6A77]">
              Unpaid
            </dt>
            <dd className="mt-1 text-[15px] font-black tabular-nums text-[#1A1A2E]">
              {amount(data.unpaid_cents, data.currency)}
            </dd>
            {data.overdue_count > 0 && (
              <p className="mt-0.5 text-[11px] font-semibold text-red-700">
                {data.overdue_count} overdue
              </p>
            )}
          </div>
        </dl>
      )}
    </section>
  );
}
