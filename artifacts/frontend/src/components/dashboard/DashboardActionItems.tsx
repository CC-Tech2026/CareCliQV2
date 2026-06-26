import { Link } from "wouter";
import { AlertTriangle, ClipboardList } from "lucide-react";
import { BORDER, MUTED, PLUM, TEXT, WIDGET_SCROLL } from "@/lib/shift-utils";
import type { DashboardActionItem } from "@/services/dashboardService";

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  high: "bg-amber-50 text-amber-700 border-amber-200",
  medium: "bg-blue-50 text-blue-700 border-blue-200",
  low: "bg-slate-50 text-slate-600 border-slate-200",
};

export function DashboardActionItems({ items }: { items: DashboardActionItem[] }) {
  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-4 flex items-center gap-2">
        <ClipboardList size={18} style={{ color: PLUM }} />
        <h2 className="text-lg font-black" style={{ color: TEXT }}>
          Action Items
        </h2>
      </div>
      <div className={`space-y-3 ${WIDGET_SCROLL}`}>
        {items.length === 0 && (
          <p className="rounded-xl bg-[#F8F6FE] px-4 py-3 text-sm font-medium" style={{ color: MUTED }}>
            No pending tasks right now.
          </p>
        )}
        {items.map((item) => (
          <Link key={item.id} href={item.action_url || "#"}>
            <div className="flex items-start gap-3 rounded-xl border border-transparent p-3 transition hover:border-[#C7D2FE] hover:bg-[#F8F6FE]">
              <div className="mt-0.5 shrink-0">
                <AlertTriangle size={16} style={{ color: item.severity === "critical" ? "#DC2626" : PLUM }} />
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
