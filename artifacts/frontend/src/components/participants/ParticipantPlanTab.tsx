import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { money } from "@/lib/participant-format";
import type { BudgetSummary } from "@/pages/patients";

interface ParticipantPlanTabProps {
  editAction?: ReactNode;
  planDetails?: ReactNode;
  budget?: BudgetSummary;
  isLoading: boolean;
  totalBudget: number;
  usedBudget: number;
  remainingBudget: number;
  isOverspent: boolean;
  hasCategoryBudgets: boolean;
  categoryBudgets: NonNullable<BudgetSummary["budgets"]>;
}

function Bar({ percent, over }: { percent: number; over?: boolean }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-cc-soft">
      <div
        className={`h-full rounded-full ${over ? "bg-red-600" : "bg-[var(--cc-plum)]"}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

/** The NDIS plan: its dates and management, the budget and what's been spent,
 * and each support category. Plain figures and rows, no boxes. */
export function ParticipantPlanTab({
  editAction,
  planDetails,
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
  const usedPercent = totalBudget > 0 ? Math.round((usedBudget / totalBudget) * 100) : 0;
  const planFunding = Number(budget?.total_funding ?? 0);
  const unallocated = hasCategoryBudgets && planFunding > totalBudget ? planFunding - totalBudget : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{planDetails}</div>
        {editAction}
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : budget?.has_plan === false ? (
        <p className="border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          {translate("patients.plan.noActive")}
        </p>
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dd className="text-xl font-semibold tabular-nums text-cc-text">{money(totalBudget || budget?.total_funding)}</dd>
              <dt className="text-xs text-cc-muted">{unallocated ? "In support categories" : translate("patients.budget.total")}</dt>
            </div>
            <div>
              <dd className="text-xl font-semibold tabular-nums text-cc-text">{money(usedBudget)}</dd>
              <dt className="text-xs text-cc-muted">{translate("patients.budget.used")}</dt>
            </div>
            <div>
              <dd className={`text-xl font-semibold tabular-nums ${isOverspent ? "text-red-700 dark:text-red-400" : "text-cc-text"}`}>
                {money(remainingBudget)}
              </dd>
              <dt className="text-xs text-cc-muted">{isOverspent ? "Over budget" : translate("patients.budget.remaining")}</dt>
            </div>
            {budget?.plan_number && (
              <div>
                <dd className="text-xl font-semibold tabular-nums text-cc-text">{budget.plan_number}</dd>
                <dt className="text-xs text-cc-muted">{translate("patients.field.planNumber")}</dt>
              </div>
            )}
          </dl>

          {unallocated > 0 && (
            <p className="text-sm text-cc-muted">
              {money(unallocated)} of the {money(planFunding)} plan isn't in a support category yet.
            </p>
          )}

          {isOverspent && (
            <p className="border-l-4 border-red-500 pl-3 text-sm font-medium text-red-700 dark:text-red-400">
              More has been delivered than the budget holds.
            </p>
          )}

          {totalBudget > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-cc-text">{translate("patients.budget.utilisation")}</span>
                <span className="tabular-nums text-cc-muted">{usedPercent}%</span>
              </div>
              <Bar percent={usedPercent} over={isOverspent} />
            </div>
          )}

          {hasCategoryBudgets && categoryBudgets.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-cc-text">{translate("patients.budget.byCategory")}</h4>
              <ul className="mt-1 divide-y divide-cc-border">
                {categoryBudgets.map((item) => (
                  <li key={item.category || item.category_label} className="space-y-1.5 py-3">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-medium text-cc-text">{item.category_label || item.category}</span>
                      <span className={`shrink-0 tabular-nums ${item.overspent ? "font-medium text-red-700 dark:text-red-400" : "text-cc-muted"}`}>
                        {item.overspent ? "Over budget" : `${item.percent_used ?? 0}%`}
                      </span>
                    </div>
                    <Bar percent={item.percent_used ?? 0} over={item.overspent} />
                    <p className="text-xs text-cc-muted">
                      {translateParams("patients.budget.categoryUsage", {
                        used: money(item.used),
                        remaining: money(item.remaining),
                        allocated: money(item.allocated),
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
