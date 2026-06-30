import { cn } from "@/lib/utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type Props = {
  className?: string;
};

/** CARECLIQV2-272 — persistent yellow banner below top nav while offline. */
export function OfflineConnectivityBanner({ className }: Props) {
  const { translate } = useAccessibility();

  return (
    <div
      className={cn(
        "flex min-h-[40px] items-center justify-center bg-amber-400 px-3 py-2 text-center text-xs font-bold text-amber-950",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {translate("offline.connectivity.banner")}
    </div>
  );
}
