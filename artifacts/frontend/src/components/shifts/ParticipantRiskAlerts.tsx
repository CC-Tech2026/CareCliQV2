import {
  AlertTriangle,
  Brain,
  ChevronDown,
  Droplets,
  EyeOff,
  ShieldAlert,
  UtensilsCrossed,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParticipantRiskAlert, ParticipantRiskType, ShiftHealthAlert } from "@/services/shiftService";
import { MUTED, TEXT } from "@/lib/shift-utils";

const RISK_ICONS: Record<ParticipantRiskType, LucideIcon> = {
  allergy: UtensilsCrossed,
  legal_blindness: EyeOff,
  falls_risk: AlertTriangle,
  seizures: Brain,
  bsp: ShieldAlert,
  swallowing_risk: Droplets,
  other: ShieldAlert,
};

type Props = {
  alerts: ShiftHealthAlert[];
  compact?: boolean;
};

export function ParticipantRiskAlerts({ alerts, compact = false }: Props) {
  return (
    <ul className={cn("space-y-2", compact && "space-y-1.5")}>
      {alerts.map((alert, index) => (
        <ParticipantRiskAlertCard key={`${alert.type}-${alert.title}-${index}`} alert={alert} compact={compact} />
      ))}
    </ul>
  );
}

export function ParticipantRiskAlertCard({
  alert,
  compact = false,
}: {
  alert: ShiftHealthAlert;
  compact?: boolean;
}) {
  const riskType = (alert.type ?? "other") as ParticipantRiskType;
  const Icon = RISK_ICONS[riskType] ?? ShieldAlert;
  const isCritical = alert.severity === "critical";
  const bodyText = (alert.instructions || alert.description || "").trim();
  const showDescription =
    Boolean(alert.description)
    && alert.description !== alert.title
    && alert.description !== alert.instructions;
  const showInstructions =
    Boolean(alert.instructions)
    && alert.instructions !== alert.description;
  const showSingleBody = riskType === "bsp" || (!showDescription && !showInstructions && Boolean(bodyText));

  return (
    <li
      className={cn(
        "rounded-xl border px-3 py-3",
        isCritical
          ? "border-red-300 bg-cc-surface text-red-900"
          : "border-orange-300 bg-cc-surface text-orange-900",
        compact && "px-2.5 py-2",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
            isCritical ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700",
          )}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("font-black leading-snug", compact ? "text-xs" : "text-sm")}>{alert.title}</p>
          {showSingleBody ? (
            <p
              className={cn(
                "mt-1.5 font-medium leading-relaxed whitespace-pre-wrap",
                compact ? "text-[11px]" : "text-xs",
              )}
            >
              {bodyText}
            </p>
          ) : (
            <>
              {showDescription && (
                <p
                  className={cn(
                    "mt-1 font-semibold leading-relaxed whitespace-pre-wrap",
                    compact ? "text-[11px]" : "text-xs",
                  )}
                  style={{ color: MUTED }}
                >
                  {alert.description}
                </p>
              )}
              {showInstructions && (
                <p
                  className={cn(
                    "mt-1.5 font-medium leading-relaxed whitespace-pre-wrap",
                    compact ? "text-[11px]" : "text-xs",
                  )}
                >
                  {alert.instructions}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

type SectionProps = {
  alerts: ShiftHealthAlert[];
  open: boolean;
  onToggle: () => void;
  acknowledged?: boolean;
  acknowledgedAt?: string | null;
  acknowledgedByName?: string | null;
  ackChecked: boolean;
  busy: boolean;
  onRequestAcknowledge: () => void;
  onUncheck: () => void;
  onViewSupportInstructions?: () => void;
};

export function ParticipantRiskAcknowledgementSection({
  alerts,
  open,
  onToggle,
  acknowledged = false,
  acknowledgedAt,
  acknowledgedByName,
  ackChecked,
  busy,
  onRequestAcknowledge,
  onUncheck,
  onViewSupportInstructions,
}: SectionProps) {
  if (acknowledged) {
    return (
      <section
        className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/60 p-4"
        data-tutorial="risk-ack-complete"
      >
        <p className="flex items-center gap-1.5 text-sm font-black text-emerald-800">
          <ShieldAlert size={16} /> Risks acknowledged
        </p>
        {acknowledgedAt && (
          <p className="mt-1 text-xs font-semibold text-emerald-700">
            Logged {new Date(acknowledgedAt).toLocaleString()}
            {acknowledgedByName ? ` by ${acknowledgedByName}` : ""}
          </p>
        )}
        <div className="mt-3">
          <ParticipantRiskAlerts alerts={alerts} compact />
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border-2 border-red-200 bg-red-50/60 p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={onToggle}
      >
        <span className="flex items-center gap-2 text-sm font-black text-red-700">
          <ShieldAlert size={18} /> Safety — acknowledge before clock-in
        </span>
        <ChevronDown size={18} className={cn("transition", open && "rotate-180")} />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <ParticipantRiskAlerts alerts={alerts} />
          {onViewSupportInstructions && (
            <button
              type="button"
              className="text-xs font-bold text-red-700 underline underline-offset-2"
              onClick={onViewSupportInstructions}
            >
              View Support Instructions
            </button>
          )}
        </div>
      )}

      <label
        htmlFor="ack-risks"
        id="tutorial-risk-ack-checkbox"
        data-tutorial="risk-ack-checkbox"
        className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border-2 border-red-300 bg-cc-surface p-3 shadow-sm"
      >
        <input
          id="ack-risks"
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0 rounded border-red-300 text-red-600 focus:ring-red-500"
          checked={ackChecked}
          disabled={busy}
          onChange={(event) => {
            if (event.target.checked) onRequestAcknowledge();
            else onUncheck();
          }}
        />
        <span className="text-sm font-bold leading-snug" style={{ color: TEXT }}>
          I acknowledge the risks and safety alerts for this participant
        </span>
      </label>
    </section>
  );
}
