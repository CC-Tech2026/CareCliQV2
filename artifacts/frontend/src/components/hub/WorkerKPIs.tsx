import { useAuth } from "@/contexts/AuthContext";
import { CalendarDays, FileText, ShieldCheck, TrendingUp } from "lucide-react";

const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";

interface KPICardProps {
  label: string;
  value: string | number;
  caption: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  valueColor?: string;
}

function KPICard({ label, value, caption, icon: Icon, valueColor = PLUM }: KPICardProps) {
  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border bg-white p-5 shadow-sm"
      style={{ borderColor: BORDER }}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className="text-[10px] font-black uppercase tracking-[0.18em]"
          style={{ color: MUTED }}
        >
          {label}
        </p>
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: SOFT, color: PLUM }}
        >
          <Icon size={16} strokeWidth={2.5} />
        </div>
      </div>
      <p className="text-3xl font-black tracking-tight" style={{ color: valueColor }}>
        {value}
      </p>
      <p className="text-[12px] font-medium" style={{ color: MUTED }}>
        {caption}
      </p>
    </div>
  );
}

export function WorkerKPIs() {
  const { user } = useAuth();
  const firstName = user?.full_name?.split(" ")[0] || "You";

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-black" style={{ color: TEXT }}>
          {firstName}'s Performance
        </h2>
        <p className="mt-0.5 text-[12px] font-medium" style={{ color: MUTED }}>
          Your personal KPIs this month
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPICard
          label="Sessions This Week"
          value={12}
          caption="3 more than last week"
          icon={CalendarDays}
          valueColor={PLUM}
        />
        <KPICard
          label="Notes Completed"
          value={10}
          caption="2 drafts still open"
          icon={FileText}
          valueColor="#0EA5E9"
        />
        <KPICard
          label="Compliance Score"
          value="94%"
          caption="Above org average (88%)"
          icon={ShieldCheck}
          valueColor="#10B981"
        />
        <KPICard
          label="Goal Progress"
          value="87%"
          caption="Participant goals on track"
          icon={TrendingUp}
          valueColor={CORAL}
        />
      </div>
    </section>
  );
}
