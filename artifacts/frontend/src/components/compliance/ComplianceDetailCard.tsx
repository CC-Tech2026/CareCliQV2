import { AlertTriangle, CheckCircle2, HelpCircle, Info, XCircle } from "lucide-react";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const PLUM = "var(--cc-plum)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const RING_TRACK = "var(--cc-ring-track)";
const ACTIVE_BG = "var(--cc-active-bg)";

export type ComplianceRuleResult = {
  rule: string;
  label: string;
  status: "pass" | "fail" | "warning" | "pending" | string;
  message?: string;
  explanation?: string;
  severity?: string;
  enforcement_tier?: string;
};

export type ComplianceFailedRule = {
  rule?: string;
  label?: string;
  message?: string;
  explanation?: string;
  severity?: string;
  enforcement_tier?: string;
};

function statusIcon(status: string) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />;
  if (status === "pending") return <Info className="h-4 w-4 shrink-0" style={{ color: MUTED }} />;
  return <XCircle className="h-4 w-4 shrink-0 text-red-500" />;
}

function scoreRingColor(score: number) {
  if (score >= 85) return PLUM;
  if (score >= 60) return "#D97706";
  return "#7C3AED";
}

export function ComplianceDetailCard({
  score,
  status,
  rules,
  failedRules,
  title,
  compact = false,
}: {
  score: number;
  status: string;
  rules: ComplianceRuleResult[];
  failedRules: ComplianceFailedRule[];
  title?: string;
  compact?: boolean;
}) {
  const { translate } = useAccessibility();
  const pct = Math.max(0, Math.min(100, score || 0));
  const ringColor = scoreRingColor(pct);
  const passedCount = rules.filter((rule) => rule.status === "pass").length;
  const displayTitle = title ?? translate("compliance.detail.score");

  function statusLabel(status: string) {
    if (status === "pass") return translate("compliance.detail.pass");
    if (status === "warning") return translate("compliance.detail.warning");
    if (status === "pending") return translate("compliance.detail.pending");
    return translate("compliance.detail.fail");
  }

  return (
    <TooltipProvider delayDuration={200}>
      <section className="rounded-lg border bg-cc-surface p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className={`flex gap-5 ${compact ? "flex-col sm:flex-row" : "flex-col lg:flex-row lg:items-start"}`}>
          <div className="flex items-center gap-4">
            <div
              className="relative grid h-28 w-28 shrink-0 place-items-center rounded-full"
              style={{ background: `conic-gradient(${ringColor} ${pct * 3.6}deg, ${RING_TRACK} 0deg)` }}
            >
              <div className="grid h-20 w-20 place-items-center rounded-full bg-cc-surface">
                <span className="text-2xl font-black" style={{ color: ringColor }}>{Math.round(pct)}%</span>
              </div>
            </div>
            <div>
              <h2 className="text-lg font-black" style={{ color: TEXT }}>{displayTitle}</h2>
              <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>
                {passedCount}/{rules.length || 12} {translate("compliance.detail.rulesPassing")}
              </p>
              <span
                className="mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-bold capitalize"
                style={{ borderColor: BORDER, background: ACTIVE_BG, color: PLUM }}
              >
                {status.replace("_", " ")}
              </span>
            </div>
          </div>

          {!compact && failedRules.length > 0 && (
            <div
              className="flex-1 rounded-xl border p-4"
              style={{ borderColor: "var(--cc-status-critical)", background: "var(--cc-status-critical-bg)" }}
            >
              <p className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em]" style={{ color: "var(--cc-status-critical)" }}>
                <AlertTriangle className="h-4 w-4" />
                {translate("compliance.detail.redFlags")}
              </p>
              <div className="space-y-2">
                {failedRules.map((rule) => (
                  <div
                    key={`${rule.rule}-${rule.label}`}
                    className="rounded-lg border px-3 py-2 bg-cc-surface"
                    style={{ borderColor: "rgba(244, 114, 182, 0.25)" }}
                  >
                    <p className="text-sm font-black" style={{ color: "var(--cc-status-critical)" }}>{rule.label}</p>
                    {rule.message && <p className="mt-1 text-xs font-medium" style={{ color: "var(--cc-status-critical)" }}>{rule.message}</p>}
                    {rule.explanation && (
                      <p className="mt-1 text-xs leading-relaxed" style={{ color: MUTED }}>{rule.explanation}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-6">
          <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>
            {translate("compliance.detail.engine")}
          </p>
          <div className=" pr-1">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {rules.map((rule) => (
              <div
                key={rule.rule}
                className="flex items-start gap-2 rounded-lg border px-3 py-2"
                style={{ borderColor: BORDER, background: SOFT }}
              >
                {statusIcon(rule.status)}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-bold" style={{ color: TEXT }}>{rule.label}</p>
                    {rule.explanation && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="shrink-0 hover:opacity-80" style={{ color: MUTED }}>
                            <HelpCircle className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs bg-[#1A1A2E] text-white">
                          <p className="text-xs leading-relaxed">{rule.explanation}</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <p className="text-xs font-semibold capitalize" style={{ color: MUTED }}>
                    {statusLabel(rule.status)}
                    {rule.message && rule.status !== "pass" ? ` · ${rule.message}` : ""}
                  </p>
                </div>
              </div>
            ))}
            </div>
          </div>
        </div>
      </section>
    </TooltipProvider>
  );
}
