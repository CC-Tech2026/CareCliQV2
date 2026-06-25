import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

import { useOfflineSyncOptional } from "@/contexts/OfflineSyncContext";

type Props = {
  syncing?: boolean;
  pendingCount?: number;
  className?: string;
};

/** Page-level sync strip — defers to global offline banner when disconnected. */
export function OfflineSyncBanner({ syncing = false, pendingCount = 0, className }: Props) {
  const globalSync = useOfflineSyncOptional();
  const online = globalSync?.online ?? (typeof navigator === "undefined" ? true : navigator.onLine);
  const pending = globalSync?.pendingCount ?? pendingCount;
  const isSyncing = globalSync?.syncing ?? syncing;

  if (!online) return null;
  if (!isSyncing && pending === 0) return null;

  return (
    <div
      className={cn(
        "flex min-h-[40px] items-center justify-center gap-2 px-3 py-2 text-center text-xs font-bold uppercase tracking-wide text-white transition-colors duration-300",
        "bg-blue-600",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <RefreshCw size={14} className={cn(isSyncing && "animate-spin")} aria-hidden />
      <span>
        {isSyncing
          ? "Syncing pending actions…"
          : `${pending} pending action${pending === 1 ? "" : "s"} queued`}
      </span>
    </div>
  );
}
