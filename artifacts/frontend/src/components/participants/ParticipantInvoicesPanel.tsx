import { Fragment, useState } from "react";
import { FileDown, Loader2, Search } from "lucide-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { jsonFetch } from "@/services/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  INVOICE_STATUSES,
  PeriodPicker,
  amount,
  monthLabel,
  shortDate,
  statusLabel,
  usePeriod,
  useRecordsDownload,
  type LinkedInvoice,
} from "./participantRecords";

const MAX_SELECTED = 25;

/** Invoices side panel for one participant: browse by financial year or any
 * period, open a single PDF, or tick several and download them together. */
export function ParticipantInvoicesPanel({
  participantId,
}: {
  participantId: string;
}) {
  const period = usePeriod();
  const { busy, download } = useRecordsDownload(participantId);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);

  const params = new URLSearchParams({ page: String(page), search });
  if (status) params.set("invoice_status", status);
  if (period.from) params.set("date_from", period.from);
  if (period.to) params.set("date_to", period.to);
  const { data, isLoading, isError, refetch } = useOrgQuery<{
    invoices: LinkedInvoice[];
    has_more: boolean;
  }>(
    [
      "participant",
      participantId,
      "invoices",
      page,
      search,
      status,
      period.from,
      period.to,
    ],
    {
      queryFn: () =>
        jsonFetch(
          `/api/participants/${encodeURIComponent(participantId)}/invoices?${params}`,
        ),
      enabled: !period.invalid,
      staleTime: 0,
    },
  );
  const invoices = data?.invoices ?? [];
  const selectable = invoices.filter((i) => !i.pdf_generation_failed);

  function resetList() {
    setPage(1);
    setSelected([]);
  }
  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }
  const tooMany = selected.length > MAX_SELECTED;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col text-cc-text">
      <div className="space-y-3 border-b border-cc-border p-4">
        <PeriodPicker
          id="invoices-period"
          state={period}
          hint="Filters by the date each invoice was created."
          disabled={busy}
          onChange={resetList}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Invoice number
            <div className="relative mt-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-cc-muted" />
              <Input
                aria-label="Search linked invoices"
                className="min-h-11 pl-9"
                placeholder="Search invoice number"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  resetList();
                }}
              />
            </div>
          </label>
          <label className="text-sm">
            Status
            <select
              className="mt-1 min-h-11 w-full rounded-md border border-cc-border bg-white px-3"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                resetList();
              }}
            >
              <option value="">All statuses</option>
              {INVOICE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {statusLabel(value)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {period.invalid ? null : isLoading ? (
          <p role="status" className="p-4 text-sm">
            Loading invoices...
          </p>
        ) : isError ? (
          <div role="alert" className="p-4 text-sm">
            Invoices could not be loaded.{" "}
            <Button variant="link" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : !invoices.length ? (
          <p className="p-6 text-sm text-cc-muted">
            No linked invoices match these filters.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 bg-cc-soft px-4 py-2">
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  disabled={busy}
                  checked={
                    selectable.length > 0 &&
                    selectable.every((i) => selected.includes(i.id))
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? selectable.map((i) => i.id) : [],
                    )
                  }
                />
                Select this page
              </label>
              <span className="text-xs text-cc-muted">
                {selected.length} selected
              </span>
            </div>
            {invoices.map((invoice, index) => {
              const month = invoice.created_at.slice(0, 7);
              const newMonth =
                index === 0 ||
                invoices[index - 1].created_at.slice(0, 7) !== month;
              return (
                <Fragment key={invoice.id}>
                  {newMonth && (
                    <h4 className="border-t border-cc-border bg-cc-soft/60 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-cc-muted">
                      {monthLabel(invoice.created_at)}
                    </h4>
                  )}
                  <InvoiceRow
                    invoice={invoice}
                    checked={selected.includes(invoice.id)}
                    disabled={busy}
                    onToggle={() => toggle(invoice.id)}
                    onDownload={() =>
                      download({
                        invoice_ids: [invoice.id],
                        sections: [],
                        format: "pdf",
                      })
                    }
                  />
                </Fragment>
              );
            })}
            {(page > 1 || data?.has_more) && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-cc-border p-3">
                <p className="text-sm text-cc-muted">Page {page}</p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={page === 1 || busy}
                    onClick={() => {
                      setPage((p) => p - 1);
                      setSelected([]);
                    }}
                  >
                    Newer
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!data?.has_more || busy}
                    onClick={() => {
                      setPage((p) => p + 1);
                      setSelected([]);
                    }}
                  >
                    Older
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {selected.length > 0 && (
        <div className="border-t border-cc-border bg-white p-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm font-medium">
              {selected.length} invoice{selected.length === 1 ? "" : "s"}{" "}
              selected
            </p>
            <Button variant="outline" onClick={() => setSelected([])}>
              Clear
            </Button>
            <Button
              className="min-h-11"
              disabled={busy || tooMany}
              onClick={() =>
                download({
                  invoice_ids: selected,
                  sections: [],
                  format: selected.length === 1 ? "pdf" : "zip",
                })
              }
            >
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileDown className="mr-2 h-4 w-4" />
              )}
              {busy ? "Preparing..." : "Download selected"}
            </Button>
          </div>
          {tooMany && (
            <p role="alert" className="mt-2 text-sm text-amber-800">
              Choose up to {MAX_SELECTED} invoices at a time, or use Export
              records to download every invoice in a period.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function InvoiceRow({
  invoice,
  checked,
  disabled,
  onToggle,
  onDownload,
}: {
  invoice: LinkedInvoice;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  onDownload: () => void;
}) {
  const failed = Boolean(invoice.pdf_generation_failed);
  return (
    <article className="flex items-start gap-3 border-t border-cc-border px-4 py-3">
      <input
        type="checkbox"
        aria-label={`Select ${invoice.invoice_number}`}
        className="mt-1 h-5 w-5 shrink-0"
        checked={checked}
        disabled={disabled || failed}
        onChange={onToggle}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="break-words text-sm font-semibold">
            {invoice.invoice_number}
          </p>
          <strong className="text-sm tabular-nums">
            {amount(invoice.total_cents, invoice.currency)}
          </strong>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-cc-muted">
          <span className="rounded bg-cc-soft px-2 py-0.5 text-cc-plum">
            {statusLabel(invoice.status)}
          </span>
          <span>Created {shortDate(invoice.created_at.slice(0, 10))}</span>
          {invoice.payment_date && (
            <span>Paid {shortDate(invoice.payment_date.slice(0, 10))}</span>
          )}
          <span className="break-words">{invoice.recipient_name}</span>
        </div>
        {!!invoice.line_items?.length && (
          <details className="mt-1 text-sm">
            <summary className="min-h-8 cursor-pointer py-1 text-xs text-cc-plum">
              {invoice.line_items.length} service item
              {invoice.line_items.length === 1 ? "" : "s"}
            </summary>
            <div className="mt-1 space-y-2">
              {invoice.line_items.map((item, index) => (
                <div
                  key={index}
                  className="flex flex-wrap justify-between gap-2 border-t border-cc-border pt-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words">{item.description}</p>
                    <p className="break-all text-xs text-cc-muted">
                      {item.item_code || "No item code"} |{" "}
                      {item.service_date || "Service date not recorded"} |
                      Quantity {item.quantity}
                    </p>
                  </div>
                  <span>{amount(item.line_total_cents, invoice.currency)}</span>
                </div>
              ))}
            </div>
          </details>
        )}
        {failed && (
          <p className="mt-1 text-xs text-red-700">
            PDF failed. Regenerate it in Invoicing before downloading.
          </p>
        )}
      </div>
      {!failed && (
        <Button
          variant="outline"
          size="sm"
          className="min-h-9 shrink-0"
          disabled={disabled}
          aria-label={`Download PDF ${invoice.invoice_number}`}
          onClick={onDownload}
        >
          <FileDown className="h-4 w-4 sm:mr-1.5" />
          <span className="hidden sm:inline">PDF</span>
        </Button>
      )}
    </article>
  );
}
