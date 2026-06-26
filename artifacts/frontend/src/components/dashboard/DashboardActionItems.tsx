import { Link } from "wouter";
import { AlertTriangle, ClipboardList } from "lucide-react";
import { MUTED, PLUM, TEXT, WIDGET_SCROLL } from "@/lib/shift-utils";
import type { DashboardActionItem } from "@/services/dashboardService";

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-[var(--cc-status-critical-bg)] text-[var(--cc-status-critical)] border-[var(--cc-border)]",
  high: "bg-[var(--cc-status-warning-bg)] text-[var(--cc-status-warning)] border-[var(--cc-border)]",
  medium: "bg-[var(--cc-status-info-bg)] text-[var(--cc-status-info)] border-[var(--cc-border)]",
  low: "bg-[var(--cc-bg)] text-[var(--cc-muted)] border-[var(--cc-border)]",
};

export function DashboardActionItems({ items }: { items: DashboardActionItem[] }) {
  return (
    <section className="rounded-2xl border border-cc-border bg-cc-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <ClipboardList size={18} style={{ color: PLUM }} />
        <h2 className="text-lg font-black" style={{ color: TEXT }}>
          Action Items
        </h2>
      </div>
      <div className={`space-y-3 ${WIDGET_SCROLL}`}>
        {items.length === 0 && (
          <p className="rounded-xl bg-cc-bg px-4 py-3 text-sm font-medium" style={{ color: MUTED }}>
            No pending tasks right now.
          </p>
        )}
        {items.map((item) => (
          <Link key={item.id} href={item.action_url || "#"}>
            <div className="flex items-start gap-3 rounded-xl border border-transparent p-3 transition hover:border-cc-border hover:bg-cc-bg">
              <div className="mt-0.5 shrink-0">
                <AlertTriangle
                  size={16}
                  style={{ color: item.severity === "critical" ? "var(--cc-status-critical)" : PLUM }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black" style={{ color: TEXT }}>
                  {item.title}
                </p>
                {item.detail && (
                  <p className="mt-0.5 text-xs font-medium" style={{ color: MUTED }}>
                    {item.detail}
                  </p>
                )}
              </div>
              <span
                className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${
                  SEVERITY_STYLES[item.severity] || SEVERITY_STYLES.medium
                }`}
              >
                {item.severity}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
