import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { triggerBlobDownload } from "@/lib/vaultZip";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

/** Shared pieces of the participant Invoices and Export records panels. */

export const INVOICE_STATUSES = [
  "draft",
  "finalized",
  "issued",
  "sent",
  "paid",
  "overdue",
  "void",
  "cancelled",
];

export type LinkedInvoice = {
  id: string;
  invoice_number: string;
  recipient_name: string;
  status: string;
  created_at: string;
  due_date?: string;
  total_cents: number;
  currency: string;
  payment_date?: string;
  pdf_generation_failed?: boolean;
  line_items?: Array<{
    description: string;
    item_code?: string;
    service_date?: string;
    quantity: number;
    line_total_cents: number;
  }>;
};

export type RecordsExportRequest = {
  invoice_ids: string[];
  sections: string[];
  format: "pdf" | "zip";
  all_invoices?: boolean;
  invoice_status?: string;
  include_shifts?: boolean;
  date_from?: string;
  date_to?: string;
};

export const amount = (value: number, currency: string) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(
    value / 100,
  );
export const statusLabel = (value: string) =>
  value === "finalized"
    ? "Finalised"
    : value.charAt(0).toUpperCase() + value.slice(1);
export const monthLabel = (iso: string) =>
  new Date(`${iso.slice(0, 7)}-01T00:00:00`).toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
  });
export const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

// Australian financial years run 1 July to 30 June. NDIS plans, audits and
// tax all work in these, so they lead the period list; calendar years follow.
function periodOptions(today = new Date()) {
  const currentFy =
    today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
  const fy = Array.from({ length: 7 }, (_, i) => {
    const start = currentFy - i;
    const name = `${start}-${String(start + 1).slice(2)}`;
    return {
      value: `fy:${start}`,
      label:
        i === 0
          ? `This financial year (${name})`
          : i === 1
            ? `Last financial year (${name})`
            : `Financial year ${name}`,
    };
  });
  const cy = Array.from({ length: 7 }, (_, i) => {
    const year = today.getFullYear() - i;
    return { value: `cy:${year}`, label: `Calendar year ${year}` };
  });
  return { fy, cy, defaultValue: `fy:${currentFy}` };
}

function periodRange(period: string, customFrom: string, customTo: string) {
  const [kind, raw] = period.split(":");
  const year = Number(raw);
  if (kind === "fy") return { from: `${year}-07-01`, to: `${year + 1}-06-30` };
  if (kind === "cy") return { from: `${year}-01-01`, to: `${year}-12-31` };
  if (kind === "custom") return { from: customFrom, to: customTo };
  return { from: "", to: "" };
}

function describePeriod(from: string, to: string) {
  if (from && to) return `${shortDate(from)} to ${shortDate(to)}`;
  if (from) return `from ${shortDate(from)}`;
  if (to) return `up to ${shortDate(to)}`;
  return "all time";
}

/** Period state: a financial/calendar year, custom dates or all time. */
export function usePeriod() {
  const [{ fy, cy, defaultValue }] = useState(() => periodOptions());
  const [period, setPeriod] = useState(defaultValue);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const { from, to } = periodRange(period, customFrom, customTo);
  return {
    options: { fy, cy },
    period,
    setPeriod,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    from,
    to,
    invalid: Boolean(from && to && from > to),
    text: describePeriod(from, to),
  };
}

export function PeriodPicker({
  id,
  state,
  hint,
  disabled,
  onChange,
}: {
  id: string;
  state: ReturnType<typeof usePeriod>;
  hint: string;
  disabled?: boolean;
  onChange?: () => void;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold" htmlFor={id}>
        Period
      </label>
      <select
        id={id}
        className="mt-2 min-h-11 w-full rounded-md border border-cc-border bg-white px-3 text-sm"
        value={state.period}
        disabled={disabled}
        onChange={(e) => {
          state.setPeriod(e.target.value);
          onChange?.();
        }}
      >
        <optgroup label="Financial years (1 Jul to 30 Jun)">
          {state.options.fy.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Calendar years">
          {state.options.cy.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Other">
          <option value="custom">Custom dates</option>
          <option value="all">All time</option>
        </optgroup>
      </select>
      {state.period === "custom" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            From
            <Input
              type="date"
              className="mt-1 min-h-11"
              value={state.customFrom}
              onChange={(e) => {
                state.setCustomFrom(e.target.value);
                onChange?.();
              }}
            />
          </label>
          <label className="text-sm">
            To
            <Input
              type="date"
              className="mt-1 min-h-11"
              value={state.customTo}
              min={state.customFrom || undefined}
              onChange={(e) => {
                state.setCustomTo(e.target.value);
                onChange?.();
              }}
            />
          </label>
        </div>
      )}
      {state.invalid ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          Choose an end date on or after the start date.
        </p>
      ) : (
        <p className="mt-2 text-xs text-cc-muted">
          Covers {state.text}. {hint}
        </p>
      )}
    </div>
  );
}

/** POSTs to records-export and saves the returned PDF or ZIP. */
export function useRecordsDownload(participantId: string) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  async function download(request: RecordsExportRequest) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await apiFetch(
        `/api/participants/${encodeURIComponent(participantId)}/records-export`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
          typeof error.detail === "string"
            ? error.detail
            : "The download could not be prepared.",
        );
      }
      const filename =
        /filename="([^"]+)"/.exec(
          response.headers.get("content-disposition") || "",
        )?.[1] || `participant-records.${request.format}`;
      triggerBlobDownload(await response.blob(), filename);
      toast({ title: "Download ready", description: filename });
    } catch (error) {
      toast({
        title: "Download unsuccessful",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }
  return { busy, download };
}
