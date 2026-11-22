import { displayDate } from "@/lib/datetime";
import { AXIS_PROPS, GRID_PROPS, SERIES, TOOLTIP_PROPS, lineProps, referenceProps } from "@/components/charts/figures";
﻿import { format, parseISO } from "date-fns";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PLUM = "var(--cc-plum)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

export type ComplianceTrendPoint = {
  date: string;
  avg_score: number | null;
  session_count: number;
};

function formatDay(value: string) {
  try {
    return format(displayDate(value), "MMM d");
  } catch {
    return value;
  }
}

export function ComplianceTrendChart({
  data,
  days,
  onDaysChange,
}: {
  data: ComplianceTrendPoint[];
  days: 7 | 30;
  onDaysChange?: (days: 7 | 30) => void;
}) {
  const { translate, translateParams } = useAccessibility();
  const chartData = data.map((point) => ({
    ...point,
    score: point.avg_score,
    label: formatDay(point.date),
  }));

  return (
    <section className="rounded-lg border bg-cc-surface p-5 shadow-sm" style={{ borderColor: BORDER }} aria-label={translate("compliance.trend")}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-black" style={{ color: "var(--cc-text)" }}>{translate("compliance.trendChart.title")}</h3>
          <p className="text-xs font-medium" style={{ color: MUTED }}>
            {translateParams("compliance.trendChart.subtitle", { days: String(days) })}
          </p>
        </div>
        {onDaysChange && (
          <div className="flex rounded-full border p-0.5" style={{ borderColor: BORDER }}>
            {([7, 30] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onDaysChange(option)}
                className="rounded-full px-3 py-1 text-xs font-bold transition"
                style={{
                  background: days === option ? PLUM : "transparent",
                  color: days === option ? "#fff" : MUTED,
                }}
              >
                {translate(option === 7 ? "compliance.trendChart.days7" : "compliance.trendChart.days30")}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-52 w-full">
        {chartData.every((point) => point.score == null) ? (
          <div className="flex h-full items-center justify-center rounded-lg bg-cc-soft text-sm font-medium" style={{ color: MUTED }}>
            {translate("compliance.trendChart.empty")}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 16, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="label" {...AXIS_PROPS} />
              <YAxis domain={[0, 100]} {...AXIS_PROPS} tickFormatter={(v) => `${v}%`} />
              <ReferenceLine y={85} {...referenceProps("Compliant from 85")} />
              <Tooltip
                {...TOOLTIP_PROPS}
                formatter={(value: number) => [`${value}%`, translate("compliance.trendChart.avgScore")]}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as ComplianceTrendPoint & { label: string } | undefined;
                  if (!row) return "";
                  return `${row.label} · ${translateParams("compliance.trendChart.sessions", { count: String(row.session_count) })}`;
                }}
              />
              <Line type="monotone" dataKey="score" connectNulls {...lineProps(SERIES[0])} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
