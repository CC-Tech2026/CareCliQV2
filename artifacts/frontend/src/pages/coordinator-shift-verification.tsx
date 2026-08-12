import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { format, parseISO } from "date-fns";
import {
  CheckCircle2, ChevronDown, ChevronUp, Loader2,
  X, AlertTriangle, Clock, DollarSign,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  getShiftVerificationQueue,
  getShiftPriceItemOptions,
  confirmShiftVerification,
  type ShiftVerificationQueueItem,
} from "@/services/coordinatorService";

const PLUM   = "var(--cc-plum)";
const T1     = "#1A1A2E";
const T2     = "#374151";
const T3     = "#6A6A77";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

function safeDateTime(v?: string | null) {
  if (!v) return "N/A";
  try { return format(parseISO(v), "d MMM yyyy, h:mm a"); }
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

  const verifyMutation = useMutation({
    mutationFn: () => confirmShiftVerification(item.shift_id, priceItemCode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [orgId, "shift-verification-queue"] });
      toast({ title: "Shift verified", description: "Budget deducted from the participant's plan." });
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
            {safeDateTime(item.scheduled_start)} · scheduled {formatMinutes(hours_sanity.scheduled_minutes)}, actual {formatMinutes(hours_sanity.actual_minutes)}
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
              {p.price_national != null ? ` ($${(p.price_national / 100).toFixed(2)}/hr)` : ""}
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
        <h1 className="mt-1 text-xl font-black tracking-tight" style={{ color: "var(--cc-text)" }}>
          Shift Verification
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
