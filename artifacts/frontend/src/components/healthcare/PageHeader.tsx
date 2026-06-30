/**
 * Enhanced Page Header Component
 * Healthcare-focused, professional, consistent header design
 * 
 * Usage:
 * <PageHeader
 *   title="Dashboard"
 *   subtitle="Support Worker"
 *   icon={LayoutDashboard}
 *   description="Today's overview and quick actions"
 *   badge={{ text: "Active", status: "success" }}
 * />
 */

import React from "react";
import { DESIGN_SYSTEM as DS, TEXT } from "@/lib/design-system";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  description?: string;
  icon?: React.ComponentType<{ size?: number }>;
  badge?: {
    text: string;
    status: "success" | "warning" | "critical" | "info";
  };
  action?: {
    label: string;
    icon?: ReactNode;
    onClick: () => void;
    variant?: "primary" | "secondary";
  };
  children?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  description,
  icon: Icon,
  badge,
  action,
  children,
  className = "",
}: PageHeaderProps) {
  return (
    <div className={`mb-8 ${className}`}>
      {/* Top section: Icon, Title, Subtitle */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-4 flex-1">
          {Icon && (
            <div className="mt-1 rounded-lg bg-cc-active p-2.5" style={{ color: DS.BRAND.primary }}>
              <Icon size={24} />
            </div>
          )}
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1
                className="text-3xl font-black tracking-tight"
                style={{ color: TEXT.primary }}
              >
                {title}
              </h1>
              {badge && (
                <span
                  className="text-xs font-bold uppercase px-3 py-1 rounded-full"
                  style={{
                    backgroundColor: DS.STATUS_BG[badge.status],
                    color: DS.STATUS[badge.status],
                  }}
                >
                  {badge.text}
                </span>
              )}
            </div>
            {subtitle && (
              <p
                className="text-xs font-bold uppercase tracking-widest mt-1"
                style={{ color: DS.STATUS.info }}
              >
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Action button on the right */}
        {action && (
          <button
            onClick={action.onClick}
            className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap flex items-center gap-2 ${
              action.variant === "primary"
                ? "text-white hover:opacity-90"
                : "border border-cc-border hover:bg-cc-bg"
            }`}
            style={{
              backgroundColor: action.variant === "primary" ? DS.BRAND.primary : DS.BACKGROUND.card,
              color: action.variant === "secondary" ? TEXT.primary : undefined,
            }}
          >
            {action.icon}
            {action.label}
          </button>
        )}
      </div>

      {/* Description */}
      {description && (
        <p
          className="text-sm max-w-2xl"
          style={{ color: TEXT.secondary }}
        >
          {description}
        </p>
      )}

      {/* Additional content */}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

// ── Breadcrumb Navigation ────────────────────────────────────────────────────
interface BreadcrumbProps {
  items: Array<{
    label: string;
    href?: string;
  }>;
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <div className="flex items-center gap-2 text-sm mb-6">
      {items.map((item, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && (
            <span
              className="mx-1"
              style={{ color: TEXT.muted }}
            >
              /
            </span>
          )}
          {item.href ? (
            <a
              href={item.href}
              style={{ color: DS.BRAND.primary }}
              className="hover:underline"
            >
              {item.label}
            </a>
          ) : (
            <span style={{ color: TEXT.primary }}>{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Info Bar (for contextual information across multiple pages) ──────────────
interface InfoBarProps {
  items: Array<{
    icon: ReactNode;
    label: string;
    value: string | number;
  }>;
}

export function InfoBar({ items }: InfoBarProps) {
  return (
    <div
      className="rounded-lg border px-4 py-3 flex items-center gap-6 overflow-x-auto"
      style={{
        borderColor: DS.BORDER.light,
        backgroundColor: DS.BACKGROUND.section,
      }}
    >
      {items.map((item, idx) => (
        <div key={idx} className="flex items-center gap-2 whitespace-nowrap">
          <div
            className="p-1.5 rounded"
            style={{ color: DS.STATUS.info }}
          >
            {item.icon}
          </div>
          <div className="min-w-0">
            <p
              className="text-xs font-semibold"
              style={{ color: TEXT.muted }}
            >
              {item.label}
            </p>
            <p
              className="font-bold"
              style={{ color: TEXT.primary }}
            >
              {item.value}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
