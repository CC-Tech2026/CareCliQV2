import { cn } from "@/lib/utils";

interface PageShellProps {
  children: React.ReactNode;
  rail?: React.ReactNode;
  railWidth?: number;
  className?: string;
}

/**
 * Reusable full-width page layout with an optional sticky right-hand context rail.
 *
 * Usage:
 *   <PageShell rail={<MyRail />}>
 *     <PageHeader ... />
 *     <ContentSection ... />
 *   </PageShell>
 *
 * The rail appears only at xl (1280px+) breakpoint.
 * Children are spaced by space-y-6 automatically.
 *
 * Apply to any page that currently has mx-auto max-w-* to break the fixed-width cap.
 */
export function PageShell({
  children,
  rail,
  railWidth = 272,
  className,
}: PageShellProps) {
  return (
    <div className={cn("flex gap-phi-5 items-start pb-phi-6", className)}>
      <div className="flex-1 min-w-0 space-y-phi-5">
        {children}
      </div>

      {rail && (
        <aside
          className="shrink-0 sticky overflow-y-auto hidden xl:block"
          style={{
            width: railWidth,
            top: 0,
            maxHeight: "calc(100dvh - 80px)",
          }}
        >
          {rail}
        </aside>
      )}
    </div>
  );
}
