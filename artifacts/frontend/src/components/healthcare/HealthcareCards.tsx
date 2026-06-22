/**
 * Healthcare-Focused Card Components
 * Professional, accessible, semantic design for medical context
 */

import React from "react";
import {
  DESIGN_SYSTEM as DS,
  STATUS,
  TEXT,
  BACKGROUND,
  BORDER,
} from "@/lib/design-system";
import type { ReactNode } from "react";

// ── Primary Status Card (for KPIs, metrics, alerts) ──────────────────────────
interface StatusCardProps {
  label: string;
  value: string | number;
  status?: "success" | "warning" | "critical" | "info";
  caption?: string;
  icon?: ReactNode;
  trend?: {
    direction: "up" | "down" | "stable";
    percentage: number;
  };
  onClick?: () => void;
  className?: string;
}

export function StatusCard({
  label,
  value,
  status = "info",
  caption,
  icon,
  trend,
  onClick,
  className = "",
}: StatusCardProps) {
  const statusColor = STATUS[status];
  const statusBg = DS.STATUS_BG[status];
  
  return (
    <div
      onClick={onClick}
      className={`rounded-lg border bg-white p-4 transition-all ${
        onClick ? "cursor-pointer hover:shadow-md hover:border-slate-300" : ""
      } ${className}`}
      style={{
        borderColor: BORDER.light,
        boxShadow: DS.SHADOWS.card,
      }}
    >
      {/* Label */}
      <div className="flex items-start justify-between">
        <p
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: TEXT.muted }}
        >
          {label}
        </p>
        {icon && (
          <div
            className="flex items-center justify-center h-6 w-6 rounded"
            style={{ background: statusBg, color: statusColor }}
          >
            {icon}
          </div>
        )}
      </div>

      {/* Value */}
      <div className="mt-3 flex items-baseline gap-2">
        <span
          className="text-2xl font-bold"
          style={{ color: TEXT.primary }}
        >
          {value}
        </span>
        {trend && (
          <span
            className="text-xs font-semibold"
            style={{ color: statusColor }}
          >
            {trend.direction === "up" ? "↑" : trend.direction === "down" ? "↓" : "→"}{" "}
            {trend.percentage}%
          </span>
        )}
      </div>

      {/* Caption */}
      {caption && (
        <p
          className="mt-2 text-xs"
          style={{ color: TEXT.secondary }}
        >
          {caption}
        </p>
      )}
    </div>
  );
}

// ── Alert/Status Banner (for critical information) ──────────────────────────
interface AlertBannerProps {
  type: "success" | "warning" | "critical" | "info";
  title: string;
  message: string;
  icon?: ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
  dismissible?: boolean;
  onDismiss?: () => void;
}

export function AlertBanner({
  type,
  title,
  message,
  icon,
  action,
  dismissible,
  onDismiss,
}: AlertBannerProps) {
  const statusColor = STATUS[type];
  const statusBg = DS.STATUS_BG[type];

  return (
    <div
      className="rounded-lg border-l-4 p-4"
      style={{
        borderColor: statusColor,
        backgroundColor: statusBg,
      }}
    >
      <div className="flex gap-3">
        {icon && (
          <div className="mt-1 shrink-0" style={{ color: statusColor }}>
            {icon}
          </div>
        )}
        <div className="flex-1">
          <p
            className="font-semibold"
            style={{ color: statusColor }}
          >
            {title}
          </p>
          <p
            className="mt-1 text-sm"
            style={{ color: TEXT.secondary }}
          >
            {message}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {action && (
            <button
              onClick={action.onClick}
              className="text-sm font-semibold underline transition-opacity hover:opacity-75"
              style={{ color: statusColor }}
            >
              {action.label}
            </button>
          )}
          {dismissible && (
            <button
              onClick={onDismiss}
              className="ml-2 transition-opacity hover:opacity-75"
              style={{ color: TEXT.muted }}
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Patient/Participant Context Card ────────────────────────────────────────
interface ContextCardProps {
  name: string;
  id: string;
  role?: string;
  status?: "active" | "inactive" | "at-risk";
  avatar?: string;
  details?: Array<{ label: string; value: string }>;
  actions?: Array<{ label: string; icon: ReactNode; onClick: () => void }>;
}

export function ContextCard({
  name,
  id,
  role,
  status = "active",
  avatar,
  details,
  actions,
}: ContextCardProps) {
  const statusColor = STATUS[status === "at-risk" ? "warning" : status === "inactive" ? "inactive" : "success"];
  
  return (
    <div
      className="rounded-lg border bg-white p-4"
      style={{
        borderColor: BORDER.light,
        boxShadow: DS.SHADOWS.card,
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3">
          {avatar ? (
            <img
              src={avatar}
              alt={name}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ background: DS.BRAND.primary }}
            >
              {name[0]}
            </div>
          )}
          <div className="min-w-0">
            <h3
              className="font-semibold"
              style={{ color: TEXT.primary }}
            >
              {name}
            </h3>
            <p
              className="text-xs"
              style={{ color: TEXT.muted }}
            >
              {id}
            </p>
            {role && (
              <p
                className="mt-1 text-xs font-medium"
                style={{ color: TEXT.secondary }}
              >
                {role}
              </p>
            )}
          </div>
        </div>
        {status && (
          <div
            className="rounded-full px-2 py-1 text-xs font-semibold"
            style={{
              backgroundColor: DS.STATUS_BG[status === "at-risk" ? "warning" : status === "inactive" ? "inactive" : "success"],
              color: statusColor,
            }}
          >
            {status}
          </div>
        )}
      </div>

      {/* Details */}
      {details && details.length > 0 && (
        <div className="mt-4 space-y-2 border-t pt-4" style={{ borderColor: BORDER.light }}>
          {details.map((detail, idx) => (
            <div key={idx} className="flex justify-between text-sm">
              <span style={{ color: TEXT.muted }}>{detail.label}</span>
              <span className="font-medium" style={{ color: TEXT.primary }}>
                {detail.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      {actions && actions.length > 0 && (
        <div className="mt-4 flex gap-2 border-t pt-4" style={{ borderColor: BORDER.light }}>
          {actions.map((action, idx) => (
            <button
              key={idx}
              onClick={action.onClick}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs font-semibold transition-colors hover:bg-slate-100"
              style={{ color: TEXT.secondary }}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Data Table Row/Card (for list items) ─────────────────────────────────────
interface DataRowProps {
  primary: { label: string; icon?: ReactNode };
  secondary?: string;
  status?: "success" | "warning" | "critical" | "info";
  metadata?: Array<{ label: string; value: string }>;
  actions?: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function DataRow({
  primary,
  secondary,
  status,
  metadata,
  actions,
  onClick,
  className = "",
}: DataRowProps) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between gap-3 rounded-lg border bg-white p-3 transition-all ${
        onClick ? "cursor-pointer hover:bg-slate-50" : ""
      } ${className}`}
      style={{
        borderColor: BORDER.light,
        boxShadow: DS.SHADOWS.xs,
      }}
    >
      {/* Primary info */}
      <div className="flex min-w-0 items-center gap-2 flex-1">
        {primary.icon && (
          <div style={{ color: TEXT.muted }}>{primary.icon}</div>
        )}
        <div className="min-w-0 flex-1">
          <p
            className="font-semibold truncate"
            style={{ color: TEXT.primary }}
          >
            {primary.label}
          </p>
          {secondary && (
            <p
              className="truncate text-xs"
              style={{ color: TEXT.muted }}
            >
              {secondary}
            </p>
          )}
        </div>
      </div>

      {/* Status badge */}
      {status && (
        <div
          className="rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap"
          style={{
            backgroundColor: DS.STATUS_BG[status],
            color: STATUS[status],
          }}
        >
          {status}
        </div>
      )}

      {/* Metadata */}
      {metadata && metadata.length > 0 && (
        <div className="hidden sm:flex gap-4 text-xs">
          {metadata.map((m, idx) => (
            <div key={idx}>
              <p style={{ color: TEXT.muted }}>{m.label}</p>
              <p className="font-semibold" style={{ color: TEXT.primary }}>
                {m.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

// ── Section Divider with title ──────────────────────────────────────────────
interface SectionDividerProps {
  title: string;
  icon?: ReactNode;
}

export function SectionDivider({ title, icon }: SectionDividerProps) {
  return (
    <div className="flex items-center gap-3 py-3">
      {icon && (
        <div style={{ color: DS.BRAND.primary }}>
          {icon}
        </div>
      )}
      <h2
        className="text-sm font-bold uppercase tracking-wider"
        style={{ color: TEXT.muted }}
      >
        {title}
      </h2>
      <div
        className="flex-1 h-px"
        style={{ backgroundColor: BORDER.light }}
      />
    </div>
  );
}

// ── Empty State (for no data scenarios) ─────────────────────────────────────
interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center"
      style={{
        borderColor: BORDER.light,
        backgroundColor: BACKGROUND.section,
      }}
    >
      <div
        className="flex items-center justify-center h-12 w-12 rounded-full"
        style={{
          backgroundColor: DS.STATUS_BG.info,
          color: STATUS.info,
        }}
      >
        {icon}
      </div>
      <h3
        className="mt-3 font-semibold"
        style={{ color: TEXT.primary }}
      >
        {title}
      </h3>
      <p
        className="mt-1 text-sm max-w-xs"
        style={{ color: TEXT.muted }}
      >
        {message}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: DS.BRAND.primary }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
