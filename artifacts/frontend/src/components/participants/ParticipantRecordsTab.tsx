import { useState } from "react";
import {
  CalendarDays,
  FileDown,
  FolderArchive,
  Loader2,
  Receipt,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  INVOICE_STATUSES,
  PeriodPicker,
  statusLabel,
  usePeriod,
  useRecordsDownload,
} from "./participantRecords";

export const PROFILE_EXPORT_SECTIONS = [
  [
    "details",
    "Personal details",
    "NDIS number, date of birth, address and contact details",
  ],
  ["plan", "NDIS plan", "Plan dates, funding and plan management"],
  [
    "support",
    "Support needs",
    "Recorded preferences, communication and support information",
  ],
  ["allergies", "Allergies", "Recorded allergens, severity and notes"],
  ["goals", "Active goals", "Goals, target dates and support categories"],
  ["contacts", "Care contacts", "Emergency contact, case manager and GP"],
] as const;

/** Export records side panel: pick a period once, tick what to include
 * (profile, shift history, invoices) and download it as one PDF or ZIP.
 * Browsing and picking individual invoices lives in ParticipantInvoicesPanel. */
export function ParticipantRecordsTab({
  participantId,
  participantName,
}: {
  participantId: string;
  participantName: string;
}) {
  const period = usePeriod();
  const { busy, download } = useRecordsDownload(participantId);
  const [sections, setSections] = useState<string[]>([]);
  const [includeShifts, setIncludeShifts] = useState(false);
  const [includeInvoices, setIncludeInvoices] = useState(false);
  const [invoiceStatus, setInvoiceStatus] = useState("");

  const fileCount =
    (sections.length ? 1 : 0) +
    (includeShifts ? 1 : 0) +
    (includeInvoices ? 2 : 0);
  const format: "pdf" | "zip" = fileCount === 1 ? "pdf" : "zip";
  const nothingChosen = fileCount === 0;
  const usesPeriod = includeInvoices || includeShifts;
  const exportDisabled =
    busy || nothingChosen || (usesPeriod && period.invalid);

  function downloadSelection() {
    download({
      invoice_ids: [],
      sections,
      format,
      ...(includeInvoices
        ? {
            all_invoices: true,
            ...(invoiceStatus ? { invoice_status: invoiceStatus } : {}),
          }
        : {}),
      ...(includeShifts ? { include_shifts: true } : {}),
      ...(usesPeriod && period.from ? { date_from: period.from } : {}),
      ...(usesPeriod && period.to ? { date_to: period.to } : {}),
    });
  }

  const summary = [
    sections.length > 0 &&
      `Profile (${sections.length} section${sections.length === 1 ? "" : "s"})`,
    includeShifts && `Shift history, ${period.text}`,
    includeInvoices &&
      `All${invoiceStatus ? ` ${statusLabel(invoiceStatus).toLowerCase()}` : ""} invoices, ${period.text}`,
  ].filter(Boolean) as string[];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col text-cc-text">
      <div
        className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
        aria-label={`Records for ${participantName}`}
      >
        <section
          aria-label="Period"
          className="rounded-xl border border-cc-border bg-white p-4"
        >
          <PeriodPicker
            id="records-period"
            state={period}
            hint="Applies to shift history and invoices. Profile sections always use the current record."
            disabled={busy}
          />
        </section>

        <section
          aria-label="Profile"
          className="rounded-xl border border-cc-border bg-white p-4"
        >
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0"
              checked={sections.length > 0}
              disabled={busy}
              onChange={(e) =>
                setSections(
                  e.target.checked
                    ? PROFILE_EXPORT_SECTIONS.map(([key]) => key)
                    : [],
                )
              }
            />
            <UserRound className="h-4 w-4 shrink-0 text-cc-plum" />
            <span>
              <span className="block text-sm font-semibold">
                Profile summary
              </span>
              <span className="block text-xs text-cc-muted">
                One PDF with the sections you choose
              </span>
            </span>
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {PROFILE_EXPORT_SECTIONS.map(([key, label, description]) => (
              <label
                key={key}
                title={description}
                className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-xs font-medium ${
                  sections.includes(key)
                    ? "border-cc-plum bg-cc-soft text-cc-plum"
                    : "border-cc-border text-cc-muted"
                }`}
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={sections.includes(key)}
                  disabled={busy}
                  onChange={(e) =>
                    setSections((current) =>
                      e.target.checked
                        ? [...current, key]
                        : current.filter((value) => value !== key),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </section>

        <section
          aria-label="Shift history"
          className="rounded-xl border border-cc-border bg-white p-4"
        >
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0"
              checked={includeShifts}
              disabled={busy}
              onChange={(e) => setIncludeShifts(e.target.checked)}
            />
            <CalendarDays className="h-4 w-4 shrink-0 text-cc-plum" />
            <span>
              <span className="block text-sm font-semibold">
                Shift history summary
              </span>
              <span className="block text-xs text-cc-muted">
                Dates, shift types, workers, duration and status for{" "}
                {period.text}, grouped by year. Progress notes and clinical
                documents are not included. Up to 500 shifts per export.
              </span>
            </span>
          </label>
        </section>

        <section
          aria-label="Invoices"
          className="rounded-xl border border-cc-border bg-white p-4"
        >
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0"
              checked={includeInvoices}
              disabled={busy}
              onChange={(e) => setIncludeInvoices(e.target.checked)}
            />
            <Receipt className="h-4 w-4 shrink-0 text-cc-plum" />
            <span>
              <span className="block text-sm font-semibold">
                Invoices in this period
              </span>
              <span className="block text-xs text-cc-muted">
                Every invoice created {period.text}, each as its own PDF, up to
                100. Invoices with a failed PDF are skipped and listed in the
                export.
              </span>
            </span>
          </label>
          {includeInvoices && (
            <label className="mt-2 block text-sm sm:max-w-xs">
              Only with status
              <select
                className="mt-1 min-h-11 w-full rounded-md border border-cc-border bg-white px-3"
                value={invoiceStatus}
                disabled={busy}
                onChange={(e) => setInvoiceStatus(e.target.value)}
              >
                <option value="">Any status</option>
                {INVOICE_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {statusLabel(value)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>
      </div>

      <div className="border-t border-cc-border bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <FolderArchive className="h-4 w-4 text-cc-plum" />
              {nothingChosen
                ? "Nothing selected yet"
                : format === "pdf"
                  ? "Single PDF"
                  : "ZIP folder with separate PDFs"}
            </p>
            <p className="mt-0.5 truncate text-xs text-cc-muted">
              {summary.length
                ? summary.join(" | ")
                : "Tick a profile summary, shift history or invoices above."}
            </p>
          </div>
          <Button
            className="min-h-11 w-full sm:w-auto"
            disabled={exportDisabled}
            onClick={downloadSelection}
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="mr-2 h-4 w-4" />
            )}
            {busy ? "Preparing export..." : "Download selected records"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-cc-muted">
          Downloaded records contain personal information.
        </p>
      </div>
    </div>
  );
}
