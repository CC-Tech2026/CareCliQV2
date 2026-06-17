import { useEffect, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  syncing?: boolean;
  pendingCount?: number;
  className?: string;
};

export function OfflineSyncBanner({ syncing = false, pendingCount = 0, className }: Props) {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (online && !syncing && pendingCount === 0) return null;

  const offline = !online;

  return (
    <div
      className={cn(
        "flex min-h-[40px] items-center justify-center gap-2 px-3 py-2 text-center text-xs font-bold uppercase tracking-wide text-white transition-colors duration-300",
        offline ? "bg-slate-600" : "bg-blue-600",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {offline ? (
        <>
          <CloudOff size={14} aria-hidden />
          <span>Offline — changes will sync when reconnected</span>
        </>
      ) : (
        <>
          <RefreshCw size={14} className={cn(syncing && "animate-spin")} aria-hidden />
          <span>
            {syncing
              ? "Syncing pending actions…"
              : `${pendingCount} pending action${pendingCount === 1 ? "" : "s"} queued`}
          </span>
        </>
      )}
    </div>
  );
}
