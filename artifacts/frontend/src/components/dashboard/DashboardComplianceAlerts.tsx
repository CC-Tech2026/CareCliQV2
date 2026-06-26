import { Link } from "wouter";
import { ShieldAlert } from "lucide-react";
import { BORDER, MUTED, PLUM, TEXT, WIDGET_SCROLL } from "@/lib/shift-utils";
import type { DashboardComplianceAlert } from "@/services/dashboardService";

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  high: "bg-amber-50 text-amber-700 border-amber-200",
  medium: "bg-blue-50 text-blue-700 border-blue-200",
  info: "bg-slate-50 text-slate-600 border-slate-200",
};

export function DashboardComplianceAlerts({ alerts }: { alerts: DashboardComplianceAlert[] }) {
  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-4 flex items-center gap-2">
        <ShieldAlert size={18} style={{ color: PLUM }} />
        <h2 className="text-lg font-black" style={{ color: TEXT }}>
          Compliance Alerts
        </h2>
      </div>
      <div className={`space-y-3 ${WIDGET_SCROLL}`}>
        {alerts.length === 0 && (
          <p className="rounded-xl bg-[#F8F6FE] px-4 py-3 text-sm font-medium" style={{ color: MUTED }}>
            No compliance alerts at this time.
          </p>
        )}
        {alerts.map((alert) => (
          <Link key={alert.id} href={alert.action_url || "/credentials"}>
            <div className="rounded-xl border p-3 transition hover:border-[#C7D2FE] hover:bg-[#F8F6FE]" style={{ borderColor: "#EEEAFB" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-black" style={{ color: TEXT }}>
                    {alert.title}
                  </p>
                  {alert.detail && (
                    <p className="mt-1 text-xs font-medium" style={{ color: MUTED }}>
                      {alert.detail}
                    </p>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${
                    SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.info
                  }`}
                >
                  {alert.severity}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
