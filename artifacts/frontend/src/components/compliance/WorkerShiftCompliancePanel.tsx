import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ComplianceEvaluation, ComplianceNotification, ComplianceRuleResult } from "@/lib/worker-compliance-engine";
import { scoreColor } from "@/lib/worker-compliance-engine";
import { ComplianceNotificationStack } from "@/components/worker-mobile/ComplianceNotificationStack";
import { PLUM, MUTED, TEXT, BORDER } from "@/lib/shift-utils";

type Props = {
  compliance: ComplianceEvaluation;
  notifications: ComplianceEvaluation["notifications"];
  onDismissNotification?: (id: string) => void;
  onNotificationAction?: (notification: ComplianceNotification) => void;
  compact?: boolean;
  className?: string;
};

function RuleRow({ rule }: { rule: ComplianceRuleResult }) {
  const icon =
    rule.status === "pass" ? (
      <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
    ) : rule.status === "fail" ? (
      <X size={14} className="text-red-500 shrink-0" />
    ) : (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700">!</span>
    );

  return (
    <li className="flex gap-2 py-1.5">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold" style={{ color: TEXT }}>{rule.name}</p>
        <p className="text-[11px] leading-snug" style={{ color: MUTED }}>{rule.message}</p>
      </div>
    </li>
  );
}

export function WorkerShiftCompliancePanel({
  compliance,
  notifications,
  onDismissNotification,
  onNotificationAction,
  compact,
  className,
}: Props) {
  const [rulesOpen, setRulesOpen] = useState(!compact);
  const color = scoreColor(compliance.score);
  const attention = compliance.rules.filter((r) => r.status !== "pass").length;

  return (
    <div className={cn("space-y-2", className)}>
      {notifications.length > 0 && (
        <ComplianceNotificationStack
          notifications={notifications}
          onDismiss={onDismissNotification}
          onAction={onNotificationAction}
        />
      )}

      <div
        className="rounded-xl border px-3 py-2.5"
        style={{ borderColor: BORDER, background: "var(--cc-surface)" }}
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
              Compliance score
            </p>
            <p className="text-lg font-black" style={{ color }}>
              {compliance.score}/100
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRulesOpen((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-bold"
            style={{ color: PLUM }}
          >
            {attention} rule{attention === 1 ? "" : "s"} need attention
            {rulesOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cc-soft">
          <div className="h-full rounded-full transition-all" style={{ width: `${compliance.score}%`, background: color }} />
        </div>
        {rulesOpen && (
          <ul className="mt-3 max-h-48 space-y-0.5 overflow-y-auto border-t pt-2" style={{ borderColor: BORDER }}>
            {compliance.rules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
