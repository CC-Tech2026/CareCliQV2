import { AlertTriangle, StopCircle, X } from "lucide-react";
import { Link } from "wouter";
import { WM } from "@/lib/worker-mobile-tokens";
import type { ComplianceNotification } from "@/lib/worker-compliance-engine";

type Props = {
  notifications: ComplianceNotification[];
  onDismiss?: (id: string) => void;
  onAction?: (notification: ComplianceNotification) => void;
};

const TIER_STYLES = {
  red: {
    bg: WM.alertBg,
    border: WM.alertBorder,
    title: WM.alertText,
    body: "#A32D2D",
    icon: StopCircle,
    iconColor: WM.alertIcon,
    cta: WM.red,
  },
  amber: {
    bg: WM.warnBg,
    border: WM.warnBorder,
    title: WM.warnTitle,
    body: WM.warnText,
    icon: AlertTriangle,
    iconColor: WM.warnText,
    cta: WM.amber,
  },
  purple: {
    bg: WM.infoBg,
    border: WM.infoBorder,
    title: WM.infoTitle,
    body: "#5B52A8",
    icon: AlertTriangle,
    iconColor: WM.infoTitle,
    cta: WM.purple,
  },
};

export function ComplianceNotificationStack({ notifications, onDismiss, onAction }: Props) {
  if (!notifications.length) return null;

  return (
    <div className="space-y-2 px-3 pt-2">
      {notifications.map((n) => {
        const style = TIER_STYLES[n.tier];
        const Icon = style.icon;
        return (
          <div
            key={n.id}
            className="rounded-xl border p-3"
            style={{ background: style.bg, borderColor: style.border, borderWidth: 0.5 }}
            onClick={n.dismissible ? () => onDismiss?.(n.id) : undefined}
            role={n.dismissible ? "button" : undefined}
          >
            <div className="flex items-start gap-2">
              <Icon size={18} style={{ color: style.iconColor, flexShrink: 0 }} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold" style={{ color: style.title }}>
                  {n.title}
                </p>
                <p className="mt-0.5 text-[12px] leading-relaxed" style={{ color: style.body }}>
                  {n.body}
                </p>
                {n.actionLabel && (
                  onAction ? (
                    <button
                      type="button"
                      className="mt-2 h-8 rounded-lg px-3 text-[12px] font-semibold text-white"
                      style={{ background: style.cta }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAction(n);
                      }}
                    >
                      {n.actionLabel}
                    </button>
                  ) : n.actionHref ? (
                    <Link href={n.actionHref}>
                      <button
                        type="button"
                        className="mt-2 h-8 rounded-lg px-3 text-[12px] font-semibold text-white"
                        style={{ background: style.cta }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {n.actionLabel}
                      </button>
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="mt-2 h-8 rounded-lg px-3 text-[12px] font-semibold text-white"
                      style={{ background: style.cta }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {n.actionLabel}
                    </button>
                  )
                )}
              </div>
              {n.dismissible && (
                <button
                  type="button"
                  className="shrink-0 p-1"
                  onClick={() => onDismiss?.(n.id)}
                  aria-label="Dismiss"
                >
                  <X size={14} style={{ color: style.body }} />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
