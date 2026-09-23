import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { SectionInfo } from "@/components/ui/section-info";
import { formatAppDate, formatAppTimeWithZone } from "@/lib/datetime";
import {
  CheckCircle2, ChevronDown, ChevronUp, Loader2,
  X, AlertTriangle, Clock, DollarSign,
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

const PLUM   = "var(--cc-plum)";
const T1     = "#1A1A2E";
const T2     = "#374151";
const T3     = "#6A6A77";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

function safeDateTime(v?: string | null, tz?: string | null) {
  if (!v) return "N/A";
  try { return `${formatAppDate(v, tz)}, ${formatAppTimeWithZone(v, tz)}`; }
  catch { return v; }
}

function formatMinutes(mins?: number | null) {
  if (mins == null) return "N/A";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function CheckIcon({ passed, warning }: { passed: boolean; warning?: boolean }) {
  if (passed) return <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />;
  if (warning) return <AlertTriangle size={14} className="text-amber-500 shrink-0" />;
  return <X size={14} className="text-red-500 shrink-0" />;
}

function CheckRow({ passed, warning, label, detail }: { passed: boolean; warning?: boolean; label: string; detail?: string | null }) {
  return (
    <div className="flex items-start gap-2">
      <CheckIcon passed={passed} warning={warning} />
      <div className="min-w-0">
        <span className="text-xs font-bold dark:text-white" style={{ color: T1 }}>{label}</span>
        {detail && <span className="ml-1.5 text-xs font-medium dark:text-white" style={{ color: T3 }}>: {detail}</span>}
      </div>
    </div>
  );
}

function ShiftVerificationCard({ item, onVerified }: { item: ShiftVerificationQueueItem; onVerified: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [priceItemCode, setPriceItemCode] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";

  const { data: priceItems = [], isLoading: priceItemsLoading } = useOrgQuery(
    ["shift-price-items", item.shift_id],
    {
      queryFn: () => getShiftPriceItemOptions(item.shift_id),
      staleTime: 60_000,
    },
  );

  const isManagingDirector = user?.role === "managing_director";
  const { data: margin, isLoading: marginLoading } = useOrgQuery<ShiftMargin>(
    ["shift-margin", item.shift_id, priceItemCode],
    {
      queryFn: () => getShiftMargin(item.shift_id, priceItemCode),
      enabled: isManagingDirector && !!priceItemCode,
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
          ? { title: "Shift verified — check the price item", description: warning }
          : { title: "Shift verified", description: "Budget deducted from the participant's plan." }
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
      <div className="flex items-start gap-3 px-5 py-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-black dark:text-white" style={{ color: T1 }}>
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
          <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium" style={{ color: T3 }}>
            <Clock size={11} />
            {safeDateTime(item.scheduled_start, item.timezone)} · scheduled {formatMinutes(hours_sanity.scheduled_minutes)}, actual {formatMinutes(hours_sanity.actual_minutes)}
          </div>
        </div>

        <button
          onClick={() => setExpanded((v) => !v)}
          className="rounded-lg border p-1.5 transition hover:bg-gray-50 shrink-0"
          style={{ borderColor: BORDER, color: T3 }}
        >
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      <div className="border-t px-5 py-3 space-y-1.5" style={{ borderColor: BORDER, background: SOFT }}>
        <CheckRow
          passed={!evidence.flagged}
          label={`Evidence & compliance: ${evidence.compliance_score ?? "N/A"}%`}
          detail={
            evidence.flagged
              ? `${evidence.mandatory_without_evidence ?? 0} mandatory task(s) without evidence`
              : undefined
          }
        />
        <CheckRow
          passed={!hours_sanity.flagged && hours_sanity.status !== "unknown"}
          warning={hours_sanity.flagged || hours_sanity.status === "unknown"}
          label="Hours sanity"
          detail={hours_sanity.reason || (hours_sanity.status === "unknown" ? "Missing scheduled or actual times." : undefined)}
        />
        <CheckRow
          passed={!force_ended.force_ended}
          warning={force_ended.force_ended}
          label="Force-ended"
          detail={force_ended.reason}
        />
      </div>

      {expanded && evidence.flagged_tasks.length > 0 && (
        <div className="border-t px-5 py-3" style={{ borderColor: BORDER }}>
          <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest" style={{ color: T3 }}>
            Flagged tasks
          </p>
          <ul className="space-y-1 text-xs font-medium dark:text-white" style={{ color: T2 }}>
            {evidence.flagged_tasks.map((t, i) => (
              <li key={i}>{String((t as Record<string, unknown>).label ?? "Task")}: {String((t as Record<string, unknown>).flag_type ?? "")}</li>
            ))}
          </ul>
        </div>
      )}

      {item.expected_price_item_code && (() => {
        const expectedItem = priceItems.find((p) => p.item_code === item.expected_price_item_code);
        const selectedItem = priceItems.find((p) => p.item_code === priceItemCode);
        const estimate = (p?: typeof expectedItem) => {
          if (!p || p.price_national == null) return null;
          if (p.unit === "E") return p.price_national;
          return hours_sanity.actual_minutes != null
            ? p.price_national * (hours_sanity.actual_minutes / 60)
            : null;
        };
        const expectedCost = estimate(expectedItem);
        const selectedCost = estimate(selectedItem);
        const mismatch = priceItemCode && priceItemCode !== item.expected_price_item_code;
        return (
          <div className="border-t px-5 py-2 text-[11px] font-medium" style={{ borderColor: BORDER, color: T3 }}>
            Expected item: <span className="font-bold" style={{ color: T1 }}>{item.expected_price_item_code}</span>
            {expectedCost != null && <span className="font-bold" style={{ color: T1 }}> (${expectedCost.toFixed(2)})</span>}
            {mismatch && (
              <>
                <span className="ml-1.5 inline-flex items-center gap-1 font-bold" style={{ color: "#B45309" }}>
                  <AlertTriangle size={10} /> selected {priceItemCode}
                  {selectedCost != null && ` ($${selectedCost.toFixed(2)})`} instead
                </span>
              </>
            )}
          </div>
        );
      })()}

      <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3" style={{ borderColor: BORDER }}>
        <DollarSign size={13} style={{ color: T3 }} className="shrink-0" />
        <select
          aria-label="Price item"
          value={priceItemCode}
          onChange={(e) => setPriceItemCode(e.target.value)}
          disabled={priceItemsLoading || verifyMutation.isPending}
          className="flex-1 min-w-[220px] rounded-lg border px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 dark:text-white"
          style={{ borderColor: BORDER, color: T1, "--tw-ring-color": PLUM } as React.CSSProperties}
        >
          <option value="">
            {priceItemsLoading ? "Loading price items…" : "Select a price item…"}
          </option>
          {priceItems.map((p) => (
            <option key={p.item_code} value={p.item_code}>
              {p.item_code}: {p.name || p.support_purpose || "Unnamed item"}
              {p.price_national != null
                ? p.unit === "E"
                  ? ` ($${p.price_national.toFixed(2)} flat)`
                  : ` ($${p.price_national.toFixed(2)}/hr)`
                : ""}
            </option>
          ))}
        </select>
        <button
          onClick={() => verifyMutation.mutate()}
          disabled={!priceItemCode || verifyMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-black text-white transition hover:opacity-90 disabled:opacity-50"
          style={{ background: "#059669" }}
        >
          {verifyMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
          Confirm Verified
        </button>
      </div>

      {isManagingDirector && priceItemCode && (
        <div className="border-t px-5 py-2 text-[11px] font-medium" style={{ borderColor: BORDER, color: T3 }}>
          {marginLoading ? (
            <span>Loading margin…</span>
          ) : margin?.pay_reason ? (
            <span>Margin unavailable ({margin.pay_reason.replace(/_/g, " ")})</span>
          ) : margin ? (
            <>
              <span>
                Billed: <span className="font-bold" style={{ color: T1 }}>{margin.billed_cents != null ? `$${(margin.billed_cents / 100).toFixed(2)}` : "—"}</span>
                {margin.billed_day_type && ` (${margin.billed_day_type})`}
                {" · "}Worker pay: <span className="font-bold" style={{ color: T1 }}>${(margin.pay_cents / 100).toFixed(2)}</span>
                {margin.pay_day_types.length > 0 && ` (${margin.pay_day_types.join(" + ")})`}
                {margin.margin_cents != null && (
                  <>
                    {" · "}Margin:{" "}
                    <span className="font-bold" style={{ color: margin.margin_cents < 0 ? "#DC2626" : T1 }}>
                      {margin.margin_cents < 0 ? "-" : ""}${Math.abs(margin.margin_cents / 100).toFixed(2)}
                    </span>
                  </>
                )}
              </span>
              {margin.billed_day_type && margin.pay_day_types.length > 0 && !margin.pay_day_types.includes(margin.billed_day_type) && (
                <p className="mt-1 flex items-start gap-1 text-[11px] font-medium" style={{ color: "#B45309" }}>
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  Billed as {margin.billed_day_type}, paid as {margin.pay_day_types.join(" + ")} — not a bug, NDIS and SCHADS classify day-types independently, but the margin above spans two different buckets.
                </p>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function CoordinatorShiftVerification() {
  const { data: items = [], isLoading, refetch } = useOrgQuery(["shift-verification-queue"], {
    queryFn: getShiftVerificationQueue,
    staleTime: 30_000,
  });

  return (
    <div className="space-y-6 pb-10">
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: "var(--cc-coral)" }}>
          Schedule
        </p>
        <h1 className="mt-1 flex items-center gap-2 text-xl font-black tracking-tight" style={{ color: "var(--cc-text)" }}>
          Shift Verification
          <SectionInfo text="Review completed shifts before they're finalised: check timing, tasks, and notes are all in order." />
        </h1>
        <p className="mt-1 text-sm font-medium" style={{ color: T3 }}>
          {isLoading
            ? "Loading completed shifts…"
            : `${items.length} completed shift${items.length === 1 ? "" : "s"} awaiting verification`}
        </p>
      </div>

      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border bg-white p-5 shadow-sm animate-pulse" style={{ borderColor: BORDER }}>
              <div className="space-y-2">
                <div className="h-4 w-48 rounded bg-[#E8E8EA]" />
                <div className="h-3 w-32 rounded bg-[#E8E8EA]" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-white py-20 text-center shadow-sm" style={{ borderColor: BORDER }}>
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: SOFT }}>
            <CheckCircle2 size={32} style={{ color: PLUM }} />
          </div>
          <h2 className="text-xl font-black dark:text-white" style={{ color: T1 }}>All caught up</h2>
          <p className="mt-2 max-w-xs text-sm font-medium dark:text-white" style={{ color: T3 }}>
            No completed shifts are waiting on verification right now.
          </p>
        </div>
      )}

      {!isLoading && items.length > 0 && (
        <div className="space-y-4">
          {items.map((item) => (
            <ShiftVerificationCard key={item.shift_id} item={item} onVerified={() => refetch()} />
          ))}
        </div>
      )}
    </div>
  );
}
