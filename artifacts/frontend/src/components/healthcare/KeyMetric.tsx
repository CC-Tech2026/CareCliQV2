/**
 * Key Metric Component - Modern, minimal stat display
 * Used for dashboard KPIs with less visual clutter
 */

import type { ComponentType } from "react";
import { DESIGN_SYSTEM as DS } from "@/lib/design-system";

interface KeyMetricProps {
  label: string;
  value: number | string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  trend?: "up" | "down" | "neutral";
  href?: string;
}

export function KeyMetric({ label, value, icon: Icon, trend, href }: KeyMetricProps) {
  const isClickable = !!href;
  const TrendIcon = trend === "up" ? require("lucide-react").TrendingUp : trend === "down" ? require("lucide-react").TrendingDown : null;

  const content = (
    <div className={`flex items-center justify-between p-4 rounded-lg border transition-all ${isClickable ? "cursor-pointer hover:bg-black/2 hover:border-opacity-50" : ""}`}
      style={{
        borderColor: DS.BORDER.light,
        background: DS.BACKGROUND.section,
      }}
    >
      <div>
        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: DS.TEXT.muted }}>
          {label}
        </p>
        <p className="mt-1 text-2xl font-black tracking-tight" style={{ color: DS.TEXT.primary }}>
          {value}
        </p>
      </div>
      <div className="flex flex-col items-center gap-2">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{
            background: DS.STATUS_BG.info,
            color: DS.STATUS.info,
          }}
        >
          <Icon size={18} strokeWidth={2} />
        </div>
        {TrendIcon && (
          <TrendIcon size={14} strokeWidth={2.5} style={{ color: trend === "up" ? DS.STATUS.success : DS.STATUS.warning }} />
        )}
      </div>
    </div>
  );

  return href ? (
    <a href={href} className="block">
      {content}
    </a>
  ) : (
    content
  );
}
