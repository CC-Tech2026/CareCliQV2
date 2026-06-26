import { CloudOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EvidenceSyncSnapshot } from "@/lib/evidence-upload-queue";

type Props = {
  online: boolean;
  snapshot: EvidenceSyncSnapshot;
  onRetry?: () => void;
  className?: string;
};

export function EvidenceSyncBanner({ online, snapshot, onRetry, className }: Props) {
  const { syncing, pending, failed, lastSyncedCount, lastError } = snapshot;

  if (online && !syncing && pending === 0 && failed === 0) return null;

  const offline = !online;

  let message = "";
  if (offline) {
    message =
      pending > 0
        ? `Offline — ${pending} evidence item${pending === 1 ? "" : "s"} saved locally`
        : "Offline — changes will sync when reconnected";
  } else if (syncing) {
    message =
      pending > 0
        ? `Syncing evidence…${lastSyncedCount > 0 ? ` (${lastSyncedCount} uploaded)` : ""}`
        : "Syncing evidence…";
  } else if (failed > 0) {
    message = `${failed} upload${failed === 1 ? "" : "s"} failed${lastError ? ` — ${lastError}` : ""}`;
  } else if (pending > 0) {
    message = `${pending} evidence item${pending === 1 ? "" : "s"} pending sync`;
  } else if (lastSyncedCount > 0) {
    message = `✓ Synced ${lastSyncedCount} file${lastSyncedCount === 1 ? "" : "s"}`;
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
          Retry sync
        </Button>
      )}
    </div>
  );
}
