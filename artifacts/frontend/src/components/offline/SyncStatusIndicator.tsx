import { Link } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { Check, CloudOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOfflineSyncOptional } from "@/contexts/OfflineSyncContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { AccessibleStatusBadge } from "@/components/accessibility/AccessibleStatusBadge";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";

type Props = {
  className?: string;
};

export function SyncStatusIndicator({ className }: Props) {
  const sync = useOfflineSyncOptional();
  const { translate } = useAccessibility();
  if (!sync) return null;

  const { visualState, pendingCount } = sync;

  const ariaLabel =
    visualState === "offline"
      ? `${translate("sync.offline")}: ${translate("sync.viewQueue")}`
      : visualState === "syncing"
        ? `${translate("sync.syncing")} (${pendingCount})`
        : translate("sync.synced");

  return (
    <Link href="/worker/sync-status">
      <button
        type="button"
        className={cn(
          "touch-target flex h-11 items-center gap-1.5 rounded-full border bg-[var(--cc-surface)] px-3 text-[12px] font-bold transition-colors hover:bg-[var(--cc-bg)]",
          className,
        )}
        style={{ borderColor: BORDER, color: TEXT }}
        aria-label={ariaLabel}
      >
        <AnimatePresence mode="wait">
          {visualState === "offline" && (
            <AccessibleStatusBadge
              key="offline"
              label={translate("sync.offline")}
              icon={CloudOff}
              tone="warning"
              className="border-0 bg-transparent px-0 py-0 text-[12px] font-bold"
            />
          )}
          {visualState === "syncing" && (
            <motion.span
              key="syncing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5"
              style={{ color: PLUM }}
            >
              <Loader2 size={14} className="animate-spin" aria-hidden />
              <span>
                {translate("sync.syncing")} ({pendingCount})
              </span>
            </motion.span>
          )}
          {visualState === "synced" && (
            <AccessibleStatusBadge
              key="synced"
              label={translate("sync.synced")}
              icon={Check}
              tone="success"
              className="border-0 bg-transparent px-0 py-0 text-[12px] font-bold"
            />
          )}
        </AnimatePresence>
      </button>
    </Link>
  );
}
