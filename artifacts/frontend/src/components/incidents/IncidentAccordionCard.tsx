import { useState } from "react";
import { format, parseISO } from "date-fns";
import {
  ChevronDown, Flag, Bell, Clock, FileText, MessageSquare,
  CircleCheck, ShieldAlert, Pill, FileX, Bot, ArrowRight, User,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface IncidentCardData {
  id: string;
  reference_number?: string;
  title: string;
  description?: string;
  incident_type: string;
  severity: string;
  status: string;
  incident_date: string;
  location?: string;
  participant_name?: string;
  worker_name?: string;
  ndis_reportable?: boolean;
  ndis_pending?: boolean;
  overdue?: boolean;
  auto_detected?: boolean;
}

type Accent = "rd" | "am" | "gn";

const ACCENT_BORDER: Record<Accent, string> = {
  rd: "border-l-[#E24B4A]",
  am: "border-l-[#EF9F27]",
  gn: "border-l-[#3B9E5A]",
};

const TYPE_BADGE: Record<string, { icon: typeof ShieldAlert; className: string }> = {
  restrictive_practice: { icon: ShieldAlert, className: "bg-[#FCEBEB] text-[#791F1F]" },
  medication_error: { icon: Pill, className: "bg-[#FAEEDA] text-[#633806]" },
  behaviour_of_concern: { icon: ShieldAlert, className: "bg-[#FAEEDA] text-[#633806]" },
  other: { icon: FileX, className: "bg-[#EEEDFE] text-[#534AB7]" },
};

function accentFor(incident: IncidentCardData): Accent {
  if (incident.status === "resolved" || incident.status === "closed") return "gn";
  if (incident.incident_type === "restrictive_practice" || incident.severity === "critical") return "rd";
  return "am";
}

function initials(name?: string) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

interface Props {
  incident: IncidentCardData;
  typeLabel: string;
  statusLabel: string;
  onViewFull: (id: string) => void;
  onAddNote?: (id: string) => void;
  onMarkResolved?: (id: string) => void;
  onCompleteReport?: (id: string) => void;
  onNotifyCommission?: (id: string) => void;
  onEscalate?: (id: string) => void;
  translate: (key: string) => string;
  showFlaggedNote?: boolean;
}

export function IncidentAccordionCard({
  incident,
  typeLabel,
  statusLabel,
  onViewFull,
  onAddNote,
  onMarkResolved,
  onCompleteReport,
  onNotifyCommission,
  onEscalate,
  translate,
  showFlaggedNote,
}: Props) {
  const [open, setOpen] = useState(false);
  const accent = accentFor(incident);
  const typeCfg = TYPE_BADGE[incident.incident_type] ?? TYPE_BADGE.other;
  const TypeIcon = typeCfg.icon;
  const dateStr = incident.incident_date
    ? format(parseISO(incident.incident_date), "d MMM yyyy · h:mm a")
    : "—";

  const statusClass =
    incident.status === "resolved" || incident.status === "closed"
      ? "bg-[#EAF3DE] text-[#27500A]"
      : incident.status === "under_investigation"
        ? "bg-[#FAEEDA] text-[#633806]"
        : "bg-[#FCEBEB] text-[#791F1F]";

  return (
    <div className={cn("rounded-xl border border-[var(--cc-border)] bg-white overflow-hidden border-l-[3px]", ACCENT_BORDER[accent])}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-[var(--cc-soft)] transition-colors border-b border-[var(--cc-border)]"
      >
        <span className="text-[11px] font-semibold text-[var(--cc-muted)] font-mono shrink-0">
          {incident.reference_number || incident.id.slice(0, 8).toUpperCase()}
        </span>
        <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0", typeCfg.className)}>
          <TypeIcon size={11} />
          {typeLabel}
        </span>
        <div className="flex items-center gap-1.5 flex-1 min-w-0 px-1">
          {incident.worker_name && (
            <>
              <span className="w-[22px] h-[22px] rounded-full bg-[#EEEDFE] text-[#534AB7] text-[9px] font-bold flex items-center justify-center shrink-0">
                {initials(incident.worker_name)}
              </span>
              <span className="text-xs font-semibold text-[var(--cc-text)] truncate">{incident.worker_name}</span>
              <ArrowRight size={11} className="text-[var(--cc-muted)] shrink-0" />
            </>
          )}
          <span className="w-[22px] h-[22px] rounded-full bg-[#FBEAF0] text-[#993556] text-[9px] font-bold flex items-center justify-center shrink-0">
            {initials(incident.participant_name)}
          </span>
          <span className="text-xs font-semibold text-[var(--cc-text)] truncate">
            {incident.participant_name || translate("incidents.noParticipant")}
          </span>
          {incident.auto_detected && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#FCEBEB] text-[#791F1F] ml-1 shrink-0">
              <Bot size={10} /> {translate("incidents.register.autoDetected")}
            </span>
          )}
          {incident.ndis_pending && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#FAEEDA] text-[#633806] ml-1 shrink-0">
              <Clock size={10} /> {translate("incidents.register.windowOpen")}
            </span>
          )}
        </div>
        <span className="text-[11px] text-[var(--cc-muted)] whitespace-nowrap hidden lg:block">{dateStr}</span>
        <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0", statusClass)}>
          <Clock size={11} />
          {statusLabel}
        </span>
        <ChevronDown size={16} className={cn("text-[var(--cc-muted)] shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div>
          {showFlaggedNote && incident.description && (
            <div className="bg-[#FCEBEB] px-4 py-3 border-b border-[#F7C1C1]">
              <p className="text-[11px] font-semibold text-[#791F1F] mb-2 flex items-center gap-1">
                <ShieldAlert size={13} /> {translate("incidents.register.flaggedNote")}
              </p>
              <div className="rounded-md border border-[var(--cc-border)] bg-white p-3 text-xs leading-relaxed text-[var(--cc-text)] border-l-[3px] border-l-[#E24B4A]">
                {incident.description}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--cc-border)]">
            <div className="p-4 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--cc-muted)] mb-2">
                {translate("incidents.register.details")}
              </p>
              {[
                [translate("incidents.register.ref"), incident.reference_number || "—"],
                [translate("incidents.detail.type"), typeLabel],
                [translate("incidents.register.participant"), incident.participant_name || "—"],
                [translate("incidents.register.worker"), incident.worker_name || "—"],
                [translate("incidents.detail.incidentDate"), dateStr],
                [translate("incidents.detail.location"), incident.location || "—"],
                [translate("incidents.register.ndisReportable"), incident.ndis_reportable ? translate("common.yes") : translate("common.no")],
              ].map(([label, val]) => (
                <div key={label} className="flex gap-2 text-xs">
                  <span className="text-[var(--cc-muted)] min-w-[100px] shrink-0">{label}</span>
                  <span className="text-[var(--cc-text)] font-medium">{val}</span>
                </div>
              ))}
            </div>

            <div className="p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--cc-muted)] mb-3">
                {translate("incidents.register.timeline")}
              </p>
              <div className="space-y-3">
                <TimelineItem icon={Flag} tone="cr" label={translate("incidents.register.timelineFlagged")} time={dateStr} />
                {incident.auto_detected && (
                  <TimelineItem icon={Bell} tone="no" label={translate("incidents.register.timelineNotified")} time={dateStr} />
                )}
                {!incident.auto_detected && (
                  <TimelineItem icon={User} tone="no" label={translate("incidents.register.timelineReported")} time={dateStr} />
                )}
                {incident.ndis_pending && (
                  <TimelineItem icon={Clock} tone="cr" label={translate("incidents.register.timelineReportPending")} time="—" danger />
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-[var(--cc-border)] bg-[var(--cc-soft)]">
            {onCompleteReport && incident.status === "reported" && (
              <ActionBtn primary icon={FileText} label={translate("incidents.register.completeReport")} onClick={() => onCompleteReport(incident.id)} />
            )}
            {onAddNote && (
              <ActionBtn icon={MessageSquare} label={translate("incidents.register.addNote")} onClick={() => onAddNote(incident.id)} />
            )}
            {onNotifyCommission && incident.ndis_reportable && (
              <ActionBtn icon={Bell} label={translate("incidents.register.notifyCommission")} onClick={() => onNotifyCommission(incident.id)} />
            )}
            {onEscalate && (
              <ActionBtn icon={ShieldAlert} label={translate("incidents.register.escalate")} danger onClick={() => onEscalate(incident.id)} />
            )}
            {onMarkResolved && incident.status !== "closed" && incident.status !== "resolved" && (
              <ActionBtn icon={CircleCheck} label={translate("incidents.detail.markResolved")} success onClick={() => onMarkResolved(incident.id)} />
            )}
            <button
              type="button"
              onClick={() => onViewFull(incident.id)}
              className="ml-auto text-xs font-bold text-[var(--cc-plum)] hover:underline"
            >
              {translate("incidents.register.viewFull")} →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineItem({
  icon: Icon, tone, label, time, danger,
}: {
  icon: typeof Flag;
  tone: "cr" | "no" | "ac";
  label: string;
  time: string;
  danger?: boolean;
}) {
  const dotBg = tone === "cr" ? "bg-[#FCEBEB]" : tone === "ac" ? "bg-[#FAEEDA]" : "bg-[#EEEDFE]";
  const iconColor = tone === "cr" ? "#E24B4A" : tone === "ac" ? "#BA7517" : "#534AB7";
  return (
    <div className="flex gap-2.5">
      <div className={cn("w-5 h-5 rounded-full flex items-center justify-center shrink-0", dotBg)}>
        <Icon size={11} style={{ color: iconColor }} />
      </div>
      <div className="min-w-0">
        <p className={cn("text-xs font-semibold", danger ? "text-[#E24B4A]" : "text-[var(--cc-text)]")}>{label}</p>
        <p className="text-[11px] text-[var(--cc-muted)]">{time}</p>
      </div>
    </div>
  );
}

function ActionBtn({
  icon: Icon, label, onClick, primary, danger, success,
}: {
  icon: typeof FileText;
  label: string;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  success?: boolean;
}) {
  const cls = primary
    ? "bg-[var(--cc-cta)] text-white"
    : danger
      ? "border border-[#F7C1C1] text-[#E24B4A] bg-white"
      : success
        ? "border border-[#C0DD97] text-[#3B9E5A] bg-white"
        : "border border-[var(--cc-border)] text-[var(--cc-text-secondary)] bg-white";
  return (
    <button type="button" onClick={onClick} className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-opacity hover:opacity-90", cls)}>
      <Icon size={12} />
      {label}
    </button>
  );
}
