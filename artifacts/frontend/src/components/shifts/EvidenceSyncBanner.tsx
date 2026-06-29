import { CloudOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EvidenceSyncSnapshot } from "@/lib/evidence-upload-queue";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type Props = {
  online: boolean;
  snapshot: EvidenceSyncSnapshot;
  onRetry?: () => void;
  className?: string;
};

export function EvidenceSyncBanner({ online, snapshot, onRetry, className }: Props) {
  const { translate, translateParams } = useAccessibility();
  const { syncing, pending, failed, lastSyncedCount, lastError } = snapshot;

  if (online && !syncing && pending === 0 && failed === 0) return null;

  const offline = !online;

  let message = "";
  if (offline) {
    message =
      pending > 0
        ? translateParams(pending === 1 ? "shift.evidence.offlineSaved" : "shift.evidence.offlineSavedPlural", {
            count: String(pending),
          })
        : translate("shift.evidence.offlineReconnect");
  } else if (syncing) {
    message =
      pending > 0 && lastSyncedCount > 0
        ? translateParams("shift.evidence.syncingUploaded", { count: String(lastSyncedCount) })
        : translate("shift.evidence.syncing");
  } else if (failed > 0) {
    const base = translateParams(failed === 1 ? "shift.evidence.uploadFailed" : "shift.evidence.uploadFailedPlural", {
      count: String(failed),
    });
    message = lastError ? `${base} — ${lastError}` : base;
  } else if (pending > 0) {
    message = translateParams(pending === 1 ? "shift.evidence.pending" : "shift.evidence.pendingPlural", {
      count: String(pending),
    });
  } else if (lastSyncedCount > 0) {
    message = translateParams(
      lastSyncedCount === 1 ? "shift.evidence.synced" : "shift.evidence.syncedPlural",
      { count: String(lastSyncedCount) },
    );
  }

  if (!message) return null;

  return (
    <div
      className={cn(
        "flex min-h-[40px] flex-wrap items-center justify-center gap-2 px-3 py-2 text-center text-xs font-bold text-white",
        offline ? "bg-slate-600" : failed > 0 ? "bg-amber-600" : "bg-blue-600",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {offline ? (
        <CloudOff size={14} aria-hidden />
      ) : (
        <RefreshCw size={14} className={cn(syncing && "animate-spin")} aria-hidden />
      )}
      <span>{message}</span>
      {!offline && (failed > 0 || pending > 0) && onRetry && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 rounded-md px-2 text-[10px] font-black uppercase"
          onClick={onRetry}
          disabled={syncing}
        >
          {translate("shift.evidence.retrySync")}
        </Button>
      )}
    </div>
  );
}
