import { AlertTriangle, CheckCircle2, HelpCircle, Info, XCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const PLUM = "#5533CC";
const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";

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

function statusLabel(status: string) {
  if (status === "pass") return "Pass";
  if (status === "warning") return "Warning";
  if (status === "pending") return "Pending";
  return "Fail";
}

function scoreRingColor(score: number) {
  if (score >= 85) return PLUM;
  if (score >= 60) return "#D97706";
  return "#F03060";
}

export function ComplianceDetailCard({
  score,
  status,
  rules,
  failedRules,
  title = "Compliance Score",
  compact = false,
}: {
  score: number;
  status: string;
  rules: ComplianceRuleResult[];
  failedRules: ComplianceFailedRule[];
  title?: string;
  compact?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, score || 0));
  const ringColor = scoreRingColor(pct);
  const passedCount = rules.filter((rule) => rule.status === "pass").length;

  return (
    <TooltipProvider delayDuration={200}>
      <section className="rounded-lg border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className={`flex gap-5 ${compact ? "flex-col sm:flex-row" : "flex-col lg:flex-row lg:items-start"}`}>
          <div className="flex items-center gap-4">
            <div
              className="relative grid h-28 w-28 shrink-0 place-items-center rounded-full"
              style={{ background: `conic-gradient(${ringColor} ${pct * 3.6}deg, #EEEAFB 0deg)` }}
            >
              <div className="grid h-20 w-20 place-items-center rounded-full bg-white">
                <span className="text-2xl font-black" style={{ color: ringColor }}>{Math.round(pct)}%</span>
              </div>
            </div>
            <div>
              <h2 className="text-lg font-black" style={{ color: TEXT }}>{title}</h2>
              <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>
                {passedCount}/{rules.length || 12} rules passing
              </p>
              <span className="mt-3 inline-flex rounded-full border border-[#EEEAFB] bg-[#F8F6FE] px-3 py-1 text-xs font-bold capitalize">
                {status.replace("_", " ")}
              </span>
            </div>
          </div>

          {!compact && failedRules.length > 0 && (
            <div className="flex-1 rounded-xl border border-red-100 bg-red-50/70 p-4">
              <p className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-red-700">
                <AlertTriangle className="h-4 w-4" />
                Red flags
              </p>
              <div className="space-y-2">
                {failedRules.map((rule) => (
                  <div key={`${rule.rule}-${rule.label}`} className="rounded-lg border border-red-100 bg-white px-3 py-2">
                    <p className="text-sm font-black text-red-800">{rule.label}</p>
                    {rule.message && <p className="mt-1 text-xs font-medium text-red-700">{rule.message}</p>}
                    {rule.explanation && (
                      <p className="mt-1 text-xs leading-relaxed text-red-600">{rule.explanation}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-6">
          <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>
            12-Rule Engine
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {rules.map((rule) => (
              <div
                key={rule.rule}
                className="flex items-start gap-2 rounded-lg border px-3 py-2"
                style={{ borderColor: "#EEEAFB", background: "#FCFBFF" }}
              >
                {statusIcon(rule.status)}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-bold" style={{ color: TEXT }}>{rule.label}</p>
                    {rule.explanation && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="shrink-0 text-[#9A8DBF] hover:text-[#5533CC]">
                            <HelpCircle className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs bg-[#1E1640] text-white">
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
      </section>
    </TooltipProvider>
  );
}
