import type { TranslationKey } from "@/lib/i18n/translations";

export const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const INCIDENT_STATUSES = ["reported", "under_investigation", "resolved", "closed"] as const;

export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

const INCIDENT_TYPE_KEYS: Record<string, TranslationKey> = {
  injury: "incidents.type.injury",
  medication_error: "incidents.type.medicationError",
  behaviour_of_concern: "incidents.type.behaviourOfConcern",
  property_damage: "incidents.type.propertyDamage",
  abuse_neglect: "incidents.type.abuseNeglect",
  restrictive_practice: "incidents.type.restrictivePractice",
  environmental: "incidents.type.environmental",
  elopement: "incidents.type.elopement",
  near_miss: "incidents.type.nearMiss",
  other: "incidents.type.other",
  safety_hazard: "incidents.type.environmental",
  participant_behaviour: "incidents.type.behaviourOfConcern",
  equipment_damage: "incidents.type.propertyDamage",
  travel_accident: "incidents.type.other",
};

const SEVERITY_LABEL_KEYS: Record<string, TranslationKey> = {
  low: "incidents.severity.low",
  medium: "incidents.severity.medium",
  high: "incidents.severity.high",
  critical: "incidents.severity.critical",
  emergency: "incidents.severity.critical",
};

const STATUS_LABEL_KEYS: Record<string, TranslationKey> = {
  reported: "incidents.status.reported",
  under_investigation: "incidents.status.underInvestigation",
  resolved: "incidents.status.resolved",
  closed: "incidents.status.closed",
};

export function incidentTypeLabelKey(type: string): TranslationKey {
  return INCIDENT_TYPE_KEYS[type] ?? "incidents.type.other";
}

export function incidentSeverityLabelKey(severity: string): TranslationKey {
  return SEVERITY_LABEL_KEYS[severity] ?? "incidents.severity.medium";
}

export function incidentStatusLabelKey(status: string): TranslationKey {
  return STATUS_LABEL_KEYS[status] ?? "incidents.status.reported";
}

export function severityMeta(severity: string): {
  color: string;
  bg: string;
  border: string;
  dot: string;
} {
  if (severity === "low") {
    return { color: "#15803D", bg: "#DCFCE7", border: "#BBF7D0", dot: "#16A34A" };
  }
  if (severity === "high") {
    return { color: "#C2410C", bg: "#FFEDD5", border: "#FED7AA", dot: "#EA580C" };
  }
  if (severity === "critical" || severity === "emergency") {
    return { color: "#B91C1C", bg: "#FEE2E2", border: "#FECACA", dot: "#DC2626" };
  }
  return { color: "#B45309", bg: "#FEF3C7", border: "#FDE68A", dot: "#D97706" };
}

export function statusMeta(status: string): { color: string; bg: string; border: string } {
  if (status === "resolved") {
    return { color: "#15803D", bg: "#DCFCE7", border: "#BBF7D0" };
  }
  if (status === "under_investigation") {
    return { color: "#B45309", bg: "#FEF3C7", border: "#FDE68A" };
  }
  if (status === "closed") {
    return { color: "#64748B", bg: "#F1F5F9", border: "#E2E8F0" };
  }
  return { color: "#1D4ED8", bg: "#DBEAFE", border: "#BFDBFE" };
}

export function formatIncidentDate(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export function formatIncidentDateTime(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatIncidentRelativeTime(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}
