import { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { WM } from "@/lib/worker-mobile-tokens";
import type { ShiftHealthAlert } from "@/services/shiftService";
import { ParticipantRiskAlerts } from "@/components/shifts/ParticipantRiskAlerts";

type Props = {
  alerts: ShiftHealthAlert[];
};

function shortLabel(alert: ShiftHealthAlert): string {
  const title = alert.title?.trim();
  if (title) return title;

  const desc = (alert.description ?? alert.instructions ?? "").trim();
  if (!desc) return "Safety alert";
  const firstLine = desc.split(/\n/)[0]?.trim() ?? desc;
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine;
}

function hasLongDetails(alerts: ShiftHealthAlert[]): boolean {
  return alerts.some((a) => {
    const body = [a.detail, a.description, a.instructions].filter(Boolean).join(" ");
    return body.length > 80;
  });
}

export function WorkerMobileRiskStrip({ alerts }: Props) {
  const [open, setOpen] = useState(false);
  if (!alerts.length) return null;

  const summary = alerts.map(shortLabel).filter(Boolean).join(" · ");
  if (!summary) return null;

  const expandable = hasLongDetails(alerts);

  return (
    <div className="mx-3 mt-2">
      <div
        className={cn(
          "flex items-start gap-2 rounded-lg border px-3 py-2",
          expandable && "cursor-pointer",
        )}
        style={{
          background: WM.alertBg,
          borderColor: WM.alertBorder,
        }}
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        onClick={expandable ? () => setOpen((v) => !v) : undefined}
        onKeyDown={
          expandable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen((v) => !v);
                }
              }
            : undefined
        }
      >
        <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: WM.alertIcon }} />
        <p
          className="min-w-0 flex-1 text-[12px] font-medium leading-snug line-clamp-2"
          style={{ color: WM.alertText }}
        >
          {summary}
        </p>
        {expandable && (
          <ChevronDown
            size={14}
            className={cn("mt-0.5 shrink-0 transition-transform", open && "rotate-180")}
            style={{ color: WM.alertIcon }}
          />
        )}
      </div>

      {expandable && open && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border p-2" style={{ borderColor: WM.border, background: WM.surface }}>
          <ParticipantRiskAlerts alerts={alerts} compact />
        </div>
      )}
    </div>
  );
}
