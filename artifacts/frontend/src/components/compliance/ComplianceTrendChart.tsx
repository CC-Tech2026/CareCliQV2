import { format, parseISO } from "date-fns";
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
    return format(parseISO(value), "MMM d");
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
  const chartData = data.map((point) => ({
    ...point,
    score: point.avg_score,
    label: formatDay(point.date),
  }));

  return (
    <section className="rounded-lg border bg-cc-surface p-5 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-black" style={{ color: 'var(--cc-text)' }}>Compliance History</h3>
          <p className="text-xs font-medium" style={{ color: MUTED }}>
            Daily average score over the last {days} days
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
                  color: days === option ? 'var(--cc-surface)' : MUTED,
                }}
              >
                {option}d
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-52 w-full">
        {chartData.every((point) => point.score == null) ? (
          <div className="flex h-full items-center justify-center rounded-lg bg-cc-bg text-sm font-medium" style={{ color: MUTED }}>
            No scored sessions in this period yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEEAFB" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: MUTED }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 11, fill: MUTED }}
                axisLine={false}
                tickLine={false}
              />
              <ReferenceLine y={85} stroke="#10B981" strokeDasharray="4 4" />
              <Tooltip
                formatter={(value: number) => [`${value}%`, "Avg score"]}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as ComplianceTrendPoint & { label: string } | undefined;
                  if (!row) return "";
                  return `${row.label} · ${row.session_count} session${row.session_count === 1 ? "" : "s"}`;
                }}
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid var(--cc-border)',
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="score"
                stroke={PLUM}
                strokeWidth={2.5}
                dot={{ r: 3, fill: PLUM }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
