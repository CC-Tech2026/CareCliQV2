import { CheckCircle2, Home, X } from "lucide-react";
import { WM } from "@/lib/worker-mobile-tokens";
import type { ComplianceRuleResult } from "@/lib/worker-compliance-engine";
import { scoreColor } from "@/lib/worker-compliance-engine";

type Props = {
  score: number;
  rules: ComplianceRuleResult[];
  onClose: () => void;
  onOpenIncidentReport?: () => void;
};

function RuleIcon({ status }: { status: ComplianceRuleResult["status"] }) {
  const base = "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold";
  if (status === "pass") {
    return (
      <span className={base} style={{ background: WM.clockedInBg, color: WM.clockedInIcon }}>
        ✓
      </span>
    );
  }
  if (status === "warn" || status === "info") {
    return (
      <span className={base} style={{ background: WM.warnBg, color: WM.warnText }}>
        !
      </span>
    );
  }
  return (
    <span className={base} style={{ background: WM.alertBg, color: WM.alertIcon }}>
      <X size={14} />
    </span>
  );
}

export function WorkerMobileComplianceReport({ score, rules, onClose, onOpenIncidentReport }: Props) {
  const attention = rules.filter((r) => r.status !== "pass").length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: WM.bg }}>
      <header
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: WM.border, background: WM.surface }}
      >
        <h2 className="text-[15px] font-semibold" style={{ color: WM.text }}>
          Compliance report
        </h2>
        <button type="button" onClick={onClose} className="text-[13px] font-semibold" style={{ color: WM.purple }}>
          Close
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col items-center py-4">
          <div
            className="flex h-[72px] w-[72px] flex-col items-center justify-center rounded-full"
            style={{ background: WM.infoBg }}
          >
            <span className="text-[22px] font-semibold" style={{ color: WM.purple }}>
              {score}
            </span>
            <span className="text-[11px]" style={{ color: WM.muted }}>/100</span>
          </div>
          <p className="mt-2 text-[12px]" style={{ color: WM.muted }}>
            Compliance score · {attention} of {rules.length} rules need attention
          </p>
          <div className="mt-3 h-1.5 w-full max-w-xs overflow-hidden rounded-full" style={{ background: WM.border }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${score}%`, background: scoreColor(score) }}
            />
          </div>
        </div>

        <div
          className="overflow-hidden rounded-[14px] border"
          style={{ borderColor: WM.border, background: WM.surface }}
        >
          {rules.map((rule, i) => (
            <div
              key={rule.id}
              className="flex gap-3 px-3 py-3"
              style={{ borderTop: i > 0 ? `0.5px solid ${WM.border}` : undefined }}
            >
              <RuleIcon status={rule.status} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium" style={{ color: WM.text }}>
                  {rule.name}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: WM.muted }}>
                  {rule.message}
                </p>
                {rule.actionLabel && (rule.actionHref || onOpenIncidentReport) && (
                  onOpenIncidentReport && rule.actionHref === "/incidents/new" ? (
                    <button
                      type="button"
                      onClick={onOpenIncidentReport}
                      className="mt-1 inline-block text-[11px] font-semibold"
                      style={{ color: WM.pink }}
                    >
                      {rule.actionLabel}
                    </button>
                  ) : rule.actionHref ? (
                    <a
                      href={rule.actionHref}
                      className="mt-1 inline-block text-[11px] font-semibold"
                      style={{ color: WM.pink }}
                    >
                      {rule.actionLabel}
                    </a>
                  ) : null
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function WorkerMobileSubmitSuccess({
  participantName,
  duration,
  tasksCompleted,
  tasksTotal,
  score,
  submittedAt,
  onBack,
}: {
  participantName: string;
  duration: string;
  tasksCompleted: number;
  tasksTotal: number;
  score: number;
  submittedAt: string;
  onBack: () => void;
}) {
  const scoreClr = scoreColor(score);
  const allDone = tasksCompleted === tasksTotal;
  const firstName = participantName.split(" ")[0] || "Participant";

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ background: WM.bg }}>
      <header
        className="shrink-0 border-b px-4 py-4 text-center"
        style={{ borderColor: WM.border, background: WM.surface }}
      >
        <h2 className="text-[17px] font-bold" style={{ color: WM.text }}>
          Shift complete
        </h2>
        <p className="mt-0.5 text-[13px] font-medium" style={{ color: WM.muted }}>
          Notes submitted
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-1 flex-col items-center px-6 py-8 text-center">
          <div
            className="mb-4 flex h-[68px] w-[68px] items-center justify-center rounded-full"
            style={{ background: WM.clockedInBg }}
          >
            <CheckCircle2 size={36} style={{ color: WM.green }} />
          </div>
          <h3 className="text-[20px] font-bold" style={{ color: WM.text }}>
            Notes submitted!
          </h3>
          <p className="mt-2 max-w-xs text-[14px] leading-relaxed" style={{ color: WM.muted }}>
            {firstName}&apos;s session has been recorded and sent for coordinator review.
          </p>

          <div
            className="mt-6 w-full max-w-sm rounded-xl border p-4 text-left"
            style={{ borderColor: WM.border, background: WM.surface }}
          >
            <Row label="Participant" value={participantName} />
            <Row label="Duration" value={duration} />
            <Row
              label="Tasks completed"
              value={`${tasksCompleted} of ${tasksTotal}`}
              valueColor={allDone ? WM.green : undefined}
            />
            <Row label="Note quality" value={`${score} / 100`} valueColor={scoreClr} />
            <Row label="Submitted" value={submittedAt} />
          </div>

          <button
            type="button"
            onClick={onBack}
            className="mt-8 flex h-[50px] w-full max-w-sm items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-white"
            style={{ background: WM.purple }}
          >
            <Home size={18} />
            Back to my shifts
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b py-2.5 last:border-0" style={{ borderColor: WM.border }}>
      <span className="text-[12px]" style={{ color: WM.muted }}>{label}</span>
      <span className="text-[13px] font-semibold" style={{ color: valueColor ?? WM.text }}>{value}</span>
    </div>
  );
}
