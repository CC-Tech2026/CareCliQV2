import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import {
  appLocalDateKey,
  formatAppDate,
  formatAppTimeWithZone,
} from "@/lib/datetime";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  X,
  AlertTriangle,
  Clock,
  DollarSign,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  getShiftVerificationQueue,
  getShiftPriceItemOptions,
  confirmShiftVerification,
  getShiftMargin,
  type ShiftVerificationQueueItem,
  type ShiftMargin,
} from "@/services/coordinatorService";

const PLUM = "var(--cc-plum)";
const T1 = "#1A1A2E";
const T2 = "#374151";
const T3 = "#6A6A77";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";

function safeDateTime(v?: string | null, tz?: string | null) {
  if (!v) return "N/A";
  try {
    return `${formatAppDate(v, tz)}, ${formatAppTimeWithZone(v, tz)}`;
  } catch {
    return v;
  }
}

function formatMinutes(mins?: number | null) {
  if (mins == null) return "N/A";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function CheckIcon({
  passed,
  warning,
}: {
  passed: boolean;
  warning?: boolean;
}) {
  if (passed)
    return <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />;
  if (warning)
    return <AlertTriangle size={14} className="text-amber-500 shrink-0" />;
  return <X size={14} className="text-red-500 shrink-0" />;
}

function CheckRow({
  passed,
  warning,
  label,
  detail,
}: {
  passed: boolean;
  warning?: boolean;
  label: string;
  detail?: string | null;
}) {
  return (
    <div className="flex items-start gap-2">
      <CheckIcon passed={passed} warning={warning} />
      <div className="min-w-0">
        <span
          className="text-xs font-bold dark:text-white"
          style={{ color: T1 }}
        >
          {label}
        </span>
        {detail && (
          <span
            className="ml-1.5 text-xs font-medium dark:text-white"
            style={{ color: T3 }}
          >
            : {detail}
          </span>
        )}
      </div>
    </div>
  );
}

function ShiftVerificationCard({
  item,
  onVerified,
}: {
  item: ShiftVerificationQueueItem;
  onVerified: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [priceTouched, setPriceTouched] = useState(false);
  const [priceItemCode, setPriceItemCode] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";

  const { data: priceItems = [], isLoading: priceItemsLoading } = useOrgQuery(
    ["shift-price-items", item.shift_id],
    {
      queryFn: () => getShiftPriceItemOptions(item.shift_id),
      enabled: expanded,
      staleTime: 60_000,
    },
  );

  useEffect(() => {
    if (
      !priceTouched &&
      item.expected_price_item_code &&
      priceItems.some(
        (option) => option.item_code === item.expected_price_item_code,
      )
    ) {
      setPriceItemCode(item.expected_price_item_code);
    }
  }, [priceItems, item.expected_price_item_code, priceTouched]);

  const isManagingDirector = user?.role === "managing_director";
  const { data: margin, isLoading: marginLoading } = useOrgQuery<ShiftMargin>(
    ["shift-margin", item.shift_id, priceItemCode],
    {
      queryFn: () => getShiftMargin(item.shift_id, priceItemCode),
      enabled: expanded && isManagingDirector && !!priceItemCode,
      staleTime: 10_000,
    },
  );

  const verifyMutation = useMutation({
    mutationFn: () => confirmShiftVerification(item.shift_id, priceItemCode),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: [orgId, "shift-verification-queue"] });
      const warning = result.expected_item_warning || result.day_type_warning;
      toast(
        warning
          ? {
              title: "Shift verified — check the price item",
              description: warning,
            }
          : {
              title: "Shift verified",
              description: "Find this shift in Ready to invoice.",
            },
      );
      onVerified();
    },
    onError: (err: unknown) => {
      toast({
        title: "Verification failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const { evidence, hours_sanity, force_ended, any_flagged } = item.checks;

  return (
    <div
      className="rounded-xl border bg-white shadow-sm transition-all"
      style={{ borderColor: any_flagged ? "#F59E0B" : BORDER }}
    >
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <div className="flex-1 min-w-[180px]">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="text-[13px] font-semibold dark:text-white"
              style={{ color: T1 }}
            >
              {item.participant_name || "Participant"}
            </span>
            <span className="text-[11px] font-medium" style={{ color: T3 }}>
              worked by {item.worker_name || "Unknown worker"}
            </span>
            {any_flagged && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ background: "rgba(245,158,11,0.1)", color: "#92400E" }}
              >
                <AlertTriangle size={9} /> Needs review
              </span>
            )}
          </div>
          <p className="mt-1 break-all text-xs" style={{ color: T3 }}>
            Participant ID: {item.participant_id || "Not recorded"}
          </p>
          <p className="mt-1 break-all text-xs" style={{ color: T3 }}>
            Shift ID: {item.shift_id}
          </p>
          <div
            className="mt-1 flex items-center gap-1.5 text-[11px] font-medium"
            style={{ color: T3 }}
          >
            <Clock size={11} />
            {safeDateTime(item.scheduled_start, item.timezone)} · scheduled{" "}
            {formatMinutes(hours_sanity.scheduled_minutes)}, actual{" "}
            {formatMinutes(hours_sanity.actual_minutes)}
          </div>
        </div>

        <button
          aria-expanded={expanded}
          aria-controls={`shift-review-${item.shift_id}`}
          aria-label={`${expanded ? "Close" : "Review"} shift ${item.shift_id}`}
          onClick={() => setExpanded((v) => !v)}
          className="flex min-h-11 items-center gap-2 rounded-lg border px-3 transition hover:bg-gray-50 shrink-0"
          style={{ borderColor: BORDER, color: T3 }}
        >
          <span className="text-sm">{expanded ? "Close" : "Review"}</span>
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      <div hidden={!expanded} id={`shift-review-${item.shift_id}`}>
        <div
          className="border-t px-5 py-3 space-y-1.5"
          style={{ borderColor: BORDER, background: SOFT }}
        >
          <CheckRow
            passed={!evidence.flagged}
            label={`Documentation check: ${evidence.compliance_score == null ? "Not scored" : evidence.compliance_score + "%"}`}
            detail={
              evidence.flagged
                ? `${evidence.mandatory_without_evidence ?? 0} mandatory task(s) without evidence`
                : undefined
            }
          />
          <CheckRow
            passed={!hours_sanity.flagged && hours_sanity.status !== "unknown"}
            warning={hours_sanity.flagged || hours_sanity.status === "unknown"}
            label="Recorded hours"
            detail={
              hours_sanity.reason ||
              (hours_sanity.status === "unknown"
                ? "Missing scheduled or actual times."
                : undefined)
            }
          />
          <CheckRow
            passed={!force_ended.force_ended}
            warning={force_ended.force_ended}
            label="Shift ended by the system"
            detail={force_ended.reason}
          />
        </div>

        {expanded && evidence.flagged_tasks.length > 0 && (
          <div className="border-t px-5 py-3" style={{ borderColor: BORDER }}>
            <p
              className="mb-1.5 text-[10px] font-black uppercase tracking-widest"
              style={{ color: T3 }}
            >
              Flagged tasks
            </p>
            <ul
              className="space-y-1 text-xs font-medium dark:text-white"
              style={{ color: T2 }}
            >
              {evidence.flagged_tasks.map((t, i) => (
                <li key={i}>
                  {String((t as Record<string, unknown>).label ?? "Task")}:{" "}
                  {String((t as Record<string, unknown>).flag_type ?? "")}
                </li>
              ))}
            </ul>
          </div>
        )}

        {item.expected_price_item_code &&
          (() => {
            const expectedItem = priceItems.find(
              (p) => p.item_code === item.expected_price_item_code,
            );
            const selectedItem = priceItems.find(
              (p) => p.item_code === priceItemCode,
            );
            const estimate = (p?: typeof expectedItem) => {
              if (!p || p.price_national == null) return null;
              if (p.unit === "E") return p.price_national;
              return hours_sanity.actual_minutes != null
                ? p.price_national * (hours_sanity.actual_minutes / 60)
                : null;
            };
            const expectedCost = estimate(expectedItem);
            const selectedCost = estimate(selectedItem);
            const mismatch =
              priceItemCode && priceItemCode !== item.expected_price_item_code;
            return (
              <div
                className="border-t px-5 py-2 text-[11px] font-medium"
                style={{ borderColor: BORDER, color: T3 }}
              >
                Expected item:{" "}
                <span className="font-bold" style={{ color: T1 }}>
                  {item.expected_price_item_code}
                </span>
                {expectedCost != null && (
                  <span className="font-bold" style={{ color: T1 }}>
                    {" "}
                    (${expectedCost.toFixed(2)})
                  </span>
                )}
                {mismatch && (
                  <>
                    <span
                      className="ml-1.5 inline-flex items-center gap-1 font-bold"
                      style={{ color: "#B45309" }}
                    >
                      <AlertTriangle size={10} /> selected {priceItemCode}
                      {selectedCost != null &&
                        ` ($${selectedCost.toFixed(2)})`}{" "}
                      instead
                    </span>
                  </>
                )}
              </div>
            );
          })()}

        <div
          className="flex flex-wrap items-center gap-2 border-t px-5 py-3"
          style={{ borderColor: BORDER }}
        >
          <DollarSign size={13} style={{ color: T3 }} className="shrink-0" />
          <select
            aria-label="Price item"
            value={priceItemCode}
            onChange={(e) => {
              setPriceTouched(true);
              setPriceItemCode(e.target.value);
            }}
            disabled={priceItemsLoading || verifyMutation.isPending}
            className="flex-1 min-w-0 w-full sm:w-auto rounded-lg border px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 dark:text-white"
            style={
              {
                borderColor: BORDER,
                color: T1,
                "--tw-ring-color": PLUM,
              } as React.CSSProperties
            }
          >
            <option value="">
              {priceItemsLoading
                ? "Loading price items…"
                : "Select a price item…"}
            </option>
            {(() => {
              const sorted = [...priceItems].sort(
                (a, b) =>
                  (a.category_number ?? "").localeCompare(
                    b.category_number ?? "",
                  ) || a.item_code.localeCompare(b.item_code),
              );
              const groups = new Map<string, typeof sorted>();
              for (const p of sorted) {
                const label =
                  p.category_label ??
                  (p.category_number
                    ? `Category ${p.category_number}`
                    : "Other");
                const bucket = groups.get(label);
                if (bucket) bucket.push(p);
                else groups.set(label, [p]);
              }
              return [...groups.entries()].map(([label, items]) => (
                <optgroup key={label} label={label}>
                  {items.map((p) => (
                    <option key={p.item_code} value={p.item_code}>
                      {p.item_code}:{" "}
                      {p.name || p.support_purpose || "Unnamed item"}
                      {p.price_national != null
                        ? p.unit === "E"
                          ? ` ($${p.price_national.toFixed(2)} flat)`
                          : ` ($${p.price_national.toFixed(2)}/hr)`
                        : ""}
                    </option>
                  ))}
                </optgroup>
              ));
            })()}
          </select>
          <button
            onClick={() => verifyMutation.mutate()}
            disabled={!priceItemCode || verifyMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-black text-white transition hover:opacity-90 disabled:opacity-50"
            style={{ background: "#059669" }}
          >
            {verifyMutation.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <CheckCircle2 size={12} />
            )}
            Verify shift
          </button>
        </div>

        {isManagingDirector && priceItemCode && (
          <div
            className="border-t px-5 py-2 text-[11px] font-medium"
            style={{ borderColor: BORDER, color: T3 }}
          >
            {marginLoading ? (
              <span>Loading margin…</span>
            ) : margin?.pay_reason ? (
              <span>
                Margin unavailable ({margin.pay_reason.replace(/_/g, " ")})
              </span>
            ) : margin ? (
              <>
                <span>
                  Billed:{" "}
                  <span className="font-bold" style={{ color: T1 }}>
                    {margin.billed_cents != null
                      ? `$${(margin.billed_cents / 100).toFixed(2)}`
                      : "—"}
                  </span>
                  {margin.billed_day_type && ` (${margin.billed_day_type})`}
                  {" · "}Worker pay:{" "}
                  <span className="font-bold" style={{ color: T1 }}>
                    ${(margin.pay_cents / 100).toFixed(2)}
                  </span>
                  {margin.pay_day_types.length > 0 &&
                    ` (${margin.pay_day_types.join(" + ")})`}
                  {margin.margin_cents != null && (
                    <>
                      {" · "}Margin:{" "}
                      <span
                        className="font-bold"
                        style={{
                          color: margin.margin_cents < 0 ? "#DC2626" : T1,
                        }}
                      >
                        {margin.margin_cents < 0 ? "-" : ""}$
                        {Math.abs(margin.margin_cents / 100).toFixed(2)}
                      </span>
                    </>
                  )}
                </span>
                {margin.billed_day_type &&
                  margin.pay_day_types.length > 0 &&
                  !margin.pay_day_types.includes(margin.billed_day_type) && (
                    <p
                      className="mt-1 flex items-start gap-1 text-[11px] font-medium"
                      style={{ color: "#B45309" }}
                    >
                      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                      Billed as {margin.billed_day_type}, paid as{" "}
                      {margin.pay_day_types.join(" + ")} — not a bug, NDIS and
                      SCHADS classify day-types independently, but the margin
                      above spans two different buckets.
                    </p>
                  )}
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** Completed shifts awaiting verification — lives on the Billing page, right
 * above "Ready to invoice", so verifying a shift and seeing it flow into an
 * invoice happen on one page instead of two disconnected ones. */

export function filterVerificationQueue(
  items: ShiftVerificationQueueItem[],
  search: string,
  from: string,
  to: string,
  review: string,
  worker: string,
) {
  return items
    .filter((item) => {
      const text = [
        item.participant_name,
        item.participant_id,
        item.worker_name,
        item.worker_id,
        item.shift_id,
      ]
        .join(" ")
        .toLowerCase();
      const stamp = item.scheduled_start || item.clocked_in_at;
      const date =
        stamp && Number.isFinite(Date.parse(stamp))
          ? appLocalDateKey(stamp, item.timezone)
          : "";
      return (
        text.includes(search.trim().toLowerCase()) &&
        (!from || (!!date && date >= from)) &&
        (!to || (!!date && date <= to)) &&
        (review !== "review" || item.checks.any_flagged) &&
        (!worker || item.worker_id === worker)
      );
    })
    .sort((a, b) =>
      (a.scheduled_start || a.clocked_in_at || "").localeCompare(
        b.scheduled_start || b.clocked_in_at || "",
      ),
    );
}

export function ShiftVerificationPanel({
  onVerified,
}: {
  onVerified?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [review, setReview] = useState("all");
  const [worker, setWorker] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [search, from, to, review, worker]);
  const {
    data: items = [],
    isLoading,
    isError,
    refetch,
  } = useOrgQuery(["shift-verification-queue"], {
    queryFn: getShiftVerificationQueue,
    staleTime: 30_000,
  });
  const filtered = filterVerificationQueue(
    items,
    search,
    from,
    to,
    review,
    worker,
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pageCount);
  const workers = [
    ...new Map(
      items
        .filter((item) => item.worker_id)
        .map((item) => [item.worker_id!, item.worker_name || item.worker_id!]),
    ).entries(),
  ];
  const field =
    "min-h-11 min-w-0 w-full rounded-lg border border-cc-border bg-white px-3 text-sm";
  return (
    <div className="space-y-4">
      <p className="text-sm text-cc-muted">
        Review completed shifts before invoicing. Oldest shifts appear first.
        Dates follow each participant's branch time zone.
      </p>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        <label className="col-span-2 space-y-1 text-xs font-medium">
          Search shifts
          <input
            className={field}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Participant, worker or ID"
          />
        </label>
        <label className="space-y-1 text-xs font-medium">
          From
          <input
            type="date"
            className={field}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs font-medium">
          To
          <input
            type="date"
            className={field}
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs font-medium">
          Review status
          <select
            className={field}
            value={review}
            onChange={(e) => setReview(e.target.value)}
          >
            <option value="all">All completed shifts</option>
            <option value="review">Needs review</option>
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium">
          Support worker
          <select
            className={field}
            value={worker}
            onChange={(e) => setWorker(e.target.value)}
          >
            <option value="">All workers</option>
            {workers.map(([id, name]) => (
              <option key={id} value={id}>
                {name} ({id})
              </option>
            ))}
          </select>
        </label>
      </div>
      {from && to && from > to && (
        <p role="alert" className="text-sm text-red-700">
          The end date must be on or after the start date.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="text-sm text-cc-muted">
          {isLoading
            ? "Loading completed shifts..."
            : isError
              ? "Completed shifts unavailable"
              : filtered.length + " of " + items.length + " shifts"}
        </p>
        <button
          type="button"
          className="min-h-10 px-3 text-sm text-cc-plum"
          onClick={() => {
            setSearch("");
            setFrom("");
            setTo("");
            setReview("all");
            setWorker("");
          }}
        >
          Clear filters
        </button>
      </div>
      {isError ? (
        <div role="alert" className="rounded-lg border p-4 text-sm">
          Completed shifts could not be loaded.{" "}
          <button
            className="min-h-10 px-3 text-cc-plum"
            onClick={() => void refetch()}
          >
            Retry
          </button>
        </div>
      ) : !isLoading && filtered.length === 0 ? (
        <p className="rounded-lg border border-cc-border p-4 text-sm text-cc-muted">
          {items.length
            ? "No shifts match these filters."
            : "No completed shifts are waiting to be checked."}
        </p>
      ) : (
        filtered.slice((currentPage - 1) * 10, currentPage * 10).map((item) => (
          <ShiftVerificationCard
            key={item.shift_id}
            item={item}
            onVerified={() => {
              void refetch();
              onVerified?.();
            }}
          />
        ))
      )}
      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>
            Page {currentPage} of {pageCount}
          </span>
          <div className="flex gap-3">
            <button
              className="min-h-11 rounded-lg border px-3 disabled:opacity-50"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </button>
            <button
              className="min-h-11 rounded-lg border px-3 disabled:opacity-50"
              disabled={currentPage === pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
