import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
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
      className="flex flex-col gap-3 rounded-2xl border bg-cc-surface p-5 shadow-sm"
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
  const { translate, translateParams } = useAccessibility();
  const firstName = user?.full_name?.split(" ")[0] || translate("hub.workerKpis.you");

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-black" style={{ color: TEXT }}>
          {translateParams("hub.workerKpis.title", { name: firstName })}
        </h2>
        <p className="mt-0.5 text-[12px] font-medium" style={{ color: MUTED }}>
          {translate("hub.workerKpis.subtitle")}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPICard
          label={translate("hub.workerKpis.sessionsWeek")}
          value={12}
          caption={translate("hub.workerKpis.sessionsCaption")}
          icon={CalendarDays}
          valueColor={PLUM}
        />
        <KPICard
          label={translate("hub.workerKpis.notesCompleted")}
          value={10}
          caption={translate("hub.workerKpis.notesCaption")}
          icon={FileText}
          valueColor="#0EA5E9"
        />
        <KPICard
          label={translate("hub.workerKpis.complianceScore")}
          value="94%"
          caption={translate("hub.workerKpis.complianceCaption")}
          icon={ShieldCheck}
          valueColor="#10B981"
        />
        <KPICard
          label={translate("hub.workerKpis.goalProgress")}
          value="87%"
          caption={translate("hub.workerKpis.goalCaption")}
          icon={TrendingUp}
          valueColor={CORAL}
        />
      </div>
    </section>
  );
}
