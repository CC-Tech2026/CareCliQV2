import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Target } from "lucide-react";
import type { GoalDetail } from "@/services/workerService";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const PLUM = "var(--cc-plum)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number }>;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-4 flex items-center gap-2">
        <Icon size={18} />
        <h2 className="text-lg font-black" style={{ color: TEXT }}>
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function GoalCard({ goal, index, translate, translateParams }: { goal: GoalDetail; index: number; translate: (k: string) => string; translateParams: (k: string, p: Record<string, string>) => string }) {
  const title = goal.title || goal.description || translateParams("goals.fallbackTitle", { n: String(index + 1) });
  const workerFocus = Array.isArray(goal.worker_focus) ? goal.worker_focus : [];

  return (
    <div
      className="rounded-lg border p-4 space-y-3"
      style={{ borderColor: "#EDE3FC", background: SOFT }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-black leading-snug" style={{ color: TEXT }}>
          {title}
        </p>
        {goal.priority < 99 && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black"
            style={{ background: PLUM, color: "#fff" }}
          >
{translateParams("goals.priority", { n: String(goal.priority) })}
          </span>
        )}
      </div>

      {goal.why_it_matters && (
        <div>
          <p
            className="text-[11px] font-black uppercase tracking-wider mb-1"
            style={{ color: MUTED }}
          >
{translate("goals.whyMatters")}
          </p>
          <p className="text-sm font-medium leading-6" style={{ color: TEXT }}>
            {goal.why_it_matters}
          </p>
        </div>
      )}

      {workerFocus.length > 0 && (
        <div>
          <p
            className="text-[11px] font-black uppercase tracking-wider mb-2"
            style={{ color: MUTED }}
          >
{translate("goals.workerFocus")}
          </p>
          <ul className="space-y-1">
            {workerFocus.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm font-medium" style={{ color: TEXT }}>
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-500" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type Props = {
  goals?: GoalDetail[];
  showCompletedToggle?: boolean;
  compact?: boolean;
};

export function ActiveGoalsPanel({ goals = [], showCompletedToggle = true, compact = false }: Props) {
  const { translate, translateParams } = useAccessibility();
  const [showCompleted, setShowCompleted] = useState(false);

  const activeGoals = goals.filter((g) => {
    const s = String(g.status || "active").toLowerCase();
    return s !== "completed" && s !== "achieved" && s !== "archived";
  });

  const completedGoals = goals.filter((g) => {
    const s = String(g.status || "active").toLowerCase();
    return s === "completed" || s === "achieved";
  });

  const visibleGoals = [...activeGoals, ...(showCompleted ? completedGoals : [])];

  if (goals.length === 0) {
    return (
      <Section title={translate("goals.title")} icon={Target}>
        <p className="text-sm font-medium" style={{ color: MUTED }}>
          {translate("goals.none")}
        </p>
      </Section>
    );
  }

  return (
    <Section title={translate("goals.title")} icon={Target}>
      {activeGoals.length === 0 ? (
        <p className="text-sm font-medium mb-3" style={{ color: MUTED }}>
          {translate("goals.noneActive")}
        </p>
      ) : (
        <div className={compact ? "space-y-3" : "grid gap-3 sm:grid-cols-1 lg:grid-cols-1"}>
          {visibleGoals.map((goal, index) => (
            <GoalCard key={String(goal.id || index)} goal={goal} index={index} translate={translate} translateParams={translateParams} />
          ))}
        </div>
      )}

      {showCompletedToggle && completedGoals.length > 0 && (
        <button
          type="button"
          onClick={() => setShowCompleted((v) => !v)}
          className="mt-4 flex items-center gap-1.5 text-xs font-black transition"
          style={{ color: MUTED }}
        >
          {showCompleted ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {showCompleted
            ? translate("goals.hideCompleted")
            : translateParams(completedGoals.length === 1 ? "goals.showCompleted" : "goals.showCompletedPlural", { count: String(completedGoals.length) })}
        </button>
      )}
    </Section>
  );
}
