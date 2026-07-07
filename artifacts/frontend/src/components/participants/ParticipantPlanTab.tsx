import { DollarSign } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { money } from "@/lib/participant-format";
import type { BudgetSummary } from "@/pages/patients";

interface ParticipantPlanTabProps {
  budget?: BudgetSummary;
  isLoading: boolean;
  totalBudget: number;
  usedBudget: number;
  remainingBudget: number;
  isOverspent: boolean;
  hasCategoryBudgets: boolean;
  categoryBudgets: NonNullable<BudgetSummary["budgets"]>;
}

/** "NDIS Plan" facet of the participant Detail archetype. */
export function ParticipantPlanTab({
  budget,
  isLoading,
  totalBudget,
  usedBudget,
  remainingBudget,
  isOverspent,
  hasCategoryBudgets,
  categoryBudgets,
}: ParticipantPlanTabProps) {
  const { translate, translateParams } = useAccessibility();

  return (
    <section className="rounded-2xl border border-purple-100/70 bg-[#FDFCFF] p-4">
      <div className="mb-3 flex items-center gap-2">
        <DollarSign className="h-3.5 w-3.5 text-[#E8457A]" />
        <h4 className="text-[13px] font-black text-[#1A1A2E]">{translate("patients.section.ndisFunding")}</h4>
      </div>
      {isLoading ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : budget?.has_plan === false ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">
          {translate("patients.plan.noActive")}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Plan meta */}
          {budget?.plan_number && (
            <div className="rounded-lg bg-white border border-purple-100/60 px-3 py-2">
              <p className="text-[9px] font-black uppercase tracking-wider text-[#6A6A77] mb-1">{translate("patients.field.planNumber")}</p>
              <p className="text-[12px] font-bold text-[#1A1A2E]">{budget.plan_number}</p>
            </div>
          )}
          {/* Total / Used / Remaining — computed rollup of the category rows below once any exist */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { lbl: translate("patients.budget.total"),     val: money(totalBudget || budget?.total_funding), flagged: false },
              { lbl: translate("patients.budget.used"),      val: money(usedBudget), flagged: false },
              { lbl: translate("patients.budget.remaining"), val: money(remainingBudget), flagged: isOverspent },
            ].map(({ lbl, val, flagged }) => (
              <div
                key={lbl}
                className={`rounded-lg border px-3 py-2 ${flagged ? "bg-red-50 border-red-200" : "bg-white border-purple-100/60"}`}
              >
                <p className="text-[9px] font-black uppercase tracking-wider text-[#6A6A77] leading-none mb-1">{lbl}</p>
                <p className={`text-[12px] font-black truncate ${flagged ? "text-red-700" : "text-[#1A1A2E]"}`}>{val}</p>
              </div>
            ))}
          </div>
          {isOverspent && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700">
              Plan is over budget, spending exceeds total allocated funding.
            </div>
          )}
          {/* Budget utilisation bar */}
          {totalBudget > 0 && (
            <div className="rounded-xl border border-purple-100/60 bg-white p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-bold text-[#1A1A2E]">{translate("patients.budget.utilisation")}</span>
                <span className="text-[11px] font-black text-[#6A6A77]">
                  {Math.round((usedBudget / totalBudget) * 100)}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-[#EDE3FC] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${isOverspent ? "bg-red-500" : "bg-[#E8457A]"}`}
                  style={{ width: `${Math.min(100, Math.round((usedBudget / totalBudget) * 100))}%` }}
                />
              </div>
            </div>
          )}
          {/* Category breakdown */}
          {hasCategoryBudgets && (
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-wider text-[#6A6A77]">{translate("patients.budget.byCategory")}</p>
              {categoryBudgets.map((item) => (
                <div
                  key={item.category || item.category_label}
                  className={`rounded-xl border p-3 ${item.overspent ? "border-red-200 bg-red-50" : "border-purple-100/60 bg-white"}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[12px] font-bold text-[#1A1A2E] truncate">{item.category_label || item.category}</span>
                    <span className={`text-[11px] font-black shrink-0 ${item.overspent ? "text-red-700" : "text-[#6A6A77]"}`}>
                      {item.overspent ? "Over budget" : `${item.percent_used ?? 0}%`}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#EDE3FC] overflow-hidden">
                    <div
                      className={`h-full rounded-full ${item.overspent ? "bg-red-500" : "bg-[#E8457A]"}`}
                      style={{ width: `${Math.min(100, Math.max(0, item.percent_used ?? 0))}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-[10px] font-medium text-[#6A6A77]">
                    {translateParams("patients.budget.categoryUsage", {
                      used: money(item.used),
                      remaining: money(item.remaining),
                      allocated: money(item.allocated),
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
