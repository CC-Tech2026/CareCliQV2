import { Link } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { Check, CloudOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOfflineSyncOptional } from "@/contexts/OfflineSyncContext";

type Props = {
  className?: string;
};

export function SyncStatusIndicator({ className }: Props) {
  const sync = useOfflineSyncOptional();
  if (!sync) return null;

  const { visualState, pendingCount, syncing } = sync;

  const content = (() => {
    if (visualState === "offline") {
      return (
        <motion.span
          key="offline"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex items-center gap-1.5"
        >
          <CloudOff size={14} aria-hidden />
          <span className="hidden sm:inline">Offline</span>
        </motion.span>
      );
    }
    if (visualState === "syncing") {
      return (
        <motion.span
          key="syncing"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex items-center gap-1.5"
        >
          <Loader2 size={14} className="animate-spin" aria-hidden />
          <span>Syncing ({pendingCount})</span>
        </motion.span>
      );
    }
    return (
      <motion.span
        key="synced"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="flex items-center gap-1.5"
      >
        <Check size={14} className="text-emerald-600" aria-hidden />
        <span className="hidden sm:inline text-emerald-700">All synced</span>
      </motion.span>
    );
  })();

  return (
    <Link href="/worker/sync-status">
      <button
        type="button"
        className={cn(
          "flex h-11 items-center gap-1.5 rounded-full border border-[#E2DEF2] bg-white px-3 text-[12px] font-bold text-[#1E1640] transition-colors hover:bg-[#F5F3FC]",
          syncing && "border-blue-200",
          className,
        )}
        aria-label={
          visualState === "offline"
            ? "Offline — view sync queue"
            : visualState === "syncing"
              ? `Syncing ${pendingCount} items`
              : "All synced"
        }
      >
        <AnimatePresence mode="wait">{content}</AnimatePresence>
      </button>
    </Link>
  );
}
