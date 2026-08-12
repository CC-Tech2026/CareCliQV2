import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, MessageSquare } from "lucide-react";
import { Link, useParams } from "wouter";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { PLUM } from "@/lib/shift-utils";
import { getWorkerShift, listShiftMessages, type ShiftOfficeMessage } from "@/services/shiftService";
import { ShiftOfficeMessagePanel } from "@/components/shifts/ShiftOfficeMessagePanel";

export default function MyShiftMessageOffice() {
  const params = useParams<{ id: string }>();
  const shiftId = (params.id || "").trim();
  const { translate } = useAccessibility();
  const [messageHistory, setMessageHistory] = useState<ShiftOfficeMessage[]>([]);

  const { data: shift, isLoading, error } = useOrgQuery(
    ["worker", "shift", shiftId],
    { queryFn: () => getWorkerShift(shiftId), enabled: Boolean(shiftId) },
  );

  const loadHistory = useCallback(async () => {
    if (!shiftId) return;
    try {
      const messages = await listShiftMessages(shiftId);
      setMessageHistory(messages || []);
    } catch {
      /* optional history */
    }
  }, [shiftId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  if (!shiftId) {
    return (
      <div className="p-6 text-sm text-cc-muted">
        Shift not found.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: PLUM }} />
      </div>
    );
  }

  if (error || !shift) {
    return (
      <div className="w-full space-y-4 p-6">
        <Link
          href={`/my-shifts/${shiftId}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ color: PLUM }}
        >
          <ArrowLeft size={16} aria-hidden />
          {translate("shift.during.backToShift")}
        </Link>
        <p className="text-sm font-semibold text-cc-coral">
          {(error as Error)?.message || "Could not load shift."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-cc-bg">
      <header
        className="shrink-0 border-b border-cc-border bg-card"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div className="flex items-center gap-3 px-4 pb-4">
          <Link
            href={`/my-shifts/${shiftId}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cc-border transition-opacity active:opacity-75"
            aria-label={translate("shift.during.backToShift")}
          >
            <ArrowLeft size={17} className="text-cc-text" />
          </Link>

          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow-sm"
            style={{ background: PLUM }}
          >
            <MessageSquare size={18} aria-hidden />
          </span>

          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-black tracking-tight text-cc-text">
              {translate("shift.during.messageOffice")}
            </h1>
            <p className="mt-0.5 truncate text-[13px] font-medium leading-snug text-cc-muted">
              {shift.participant_name}
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="cc-surface-card">
          <div className="cc-card-header">
            <p className="cc-card-title">{translate("shift.during.composeMessage")}</p>
            <p className="mt-0.5 text-xs text-cc-muted">{translate("shift.during.messagePageSubtitle")}</p>
          </div>
          <div className="p-4">
            <ShiftOfficeMessagePanel
              shiftId={shiftId}
              messageHistory={messageHistory}
              showHeader={false}
              variant="page"
              onSent={() => void loadHistory()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
