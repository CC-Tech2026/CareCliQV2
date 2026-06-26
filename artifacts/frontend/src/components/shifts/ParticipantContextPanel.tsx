import { useState } from "react";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  ChevronDown,
  ClipboardList,
  Heart,
  MessageSquare,
  Pill,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParticipantContext } from "@/services/shiftService";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";

type Props = {
  context?: ParticipantContext;
  participantFirstName?: string;
  syncedAt?: string | null;
  open?: boolean;
  onToggle?: () => void;
};

type Tab = "medical" | "behaviour" | "activities" | "visits" | "communication";

const SEVERITY_STYLES: Record<string, string> = {
  anaphylactic: "bg-red-100 text-red-900 border-red-200",
  severe: "bg-orange-100 text-orange-900 border-orange-200",
  moderate: "bg-amber-100 text-amber-900 border-amber-200",
  mild: "bg-slate-100 text-slate-700 border-slate-200",
};

function formatSynced(value?: string | null) {
  if (!value) return null;
  try {
    return format(parseISO(value), "d MMM yyyy, h:mm a");
  } catch {
    return value;
  }
}

function isStale(syncedAt?: string | null) {
  if (!syncedAt) return false;
  try {
    return Date.now() - parseISO(syncedAt).getTime() > 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function ParticipantContextPanel({
  context,
  participantFirstName,
  syncedAt,
  open = true,
  onToggle,
}: Props) {
  const [tab, setTab] = useState<Tab>("medical");
  const firstName = participantFirstName || "participant";
  const stale = isStale(syncedAt);
  const anaphylactic = (context?.medical?.allergies || []).filter((a) => a.severity === "anaphylactic");

  const hasMedical = Boolean(
    context?.medical?.allergies?.length ||
      context?.medical?.conditions ||
      context?.medical?.medications ||
      context?.medical?.alerts,
  );
  const hasBehaviour = Boolean(context?.behavioural_notes?.length);
  const hasActivities = Boolean(context?.preferred_activities?.length);
  const hasVisits = Boolean(context?.previous_visit_notes?.trim());
  const hasComm = Boolean(context?.communication_guidance?.trim());

  const tabs: Array<{ id: Tab; label: string; show: boolean }> = [
    { id: "medical", label: "Medical", show: true },
    { id: "behaviour", label: "Behaviour", show: true },
    { id: "activities", label: "Activities", show: true },
    { id: "visits", label: "Past visits", show: true },
    { id: "communication", label: "Communication", show: true },
  ];

  const activeTab = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id;

  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        onClick={onToggle}
      >
        <span className="flex items-center gap-2 text-sm font-black" style={{ color: TEXT }}>
          <ClipboardList size={16} style={{ color: PLUM }} />
          Participant Context
        </span>
        <ChevronDown size={18} className={cn("transition", open && "rotate-180")} style={{ color: MUTED }} />
      </button>

      {open && (
        <div className="border-t" style={{ borderColor: BORDER }}>
          {stale && (
            <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
              Participant info may be outdated. Sync when connected.
            </div>
          )}

          {anaphylactic.length > 0 && (
            <div className="mx-4 mt-3 rounded-xl border-2 border-red-300 bg-red-50 px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-red-800">
                <AlertTriangle size={14} aria-hidden />
                Anaphylactic allergy
              </p>
              <ul className="mt-1 space-y-0.5 text-sm font-semibold text-red-900">
                {anaphylactic.map((a) => (
                  <li key={a.id || a.allergen}>{a.allergen}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-1 overflow-x-auto px-4 pt-3">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-wide transition",
                  activeTab === t.id ? "bg-[#3730A3] text-white" : "bg-[#F0EDFC] text-[#6D4BDA]",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="space-y-2 px-4 py-3">
            {activeTab === "medical" && (
              <div className="space-y-2">
                {hasMedical ? (
                  <>
                    {context?.medical?.allergies?.map((a) => (
                      <div
                        key={a.id || a.allergen}
                        className={cn(
                          "flex items-start justify-between gap-2 rounded-xl border px-3 py-2",
                          SEVERITY_STYLES[a.severity] || SEVERITY_STYLES.mild,
                        )}
                      >
                        <div>
                          <p className="text-sm font-bold">{a.allergen}</p>
                          {a.notes && <p className="mt-0.5 text-xs opacity-80">{a.notes}</p>}
                        </div>
                        <span className="text-[10px] font-black uppercase">{a.severity}</span>
                      </div>
                    ))}
                    {context?.medical?.conditions && (
                      <InfoBlock icon={Pill} label="Current conditions" body={context.medical.conditions} />
                    )}
                    {context?.medical?.medications && (
                      <InfoBlock icon={Pill} label="Medications" body={context.medical.medications} />
                    )}
                    {context?.medical?.alerts && (
                      <InfoBlock icon={AlertTriangle} label="Medical alerts" body={context.medical.alerts} />
                    )}
                  </>
                ) : (
                  <EmptyNote text="No medical information recorded yet." />
                )}
              </div>
            )}

            {activeTab === "behaviour" && (
              <div className="space-y-2">
                {hasBehaviour ? (
                  context!.behavioural_notes!.map((note, i) => (
                    <div key={i} className="rounded-xl border border-[#E5E7EB] bg-[#F8F6FE] px-3 py-3">
                      <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                        {note.title}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm font-medium leading-relaxed" style={{ color: TEXT }}>
                        {note.body}
                      </p>
                    </div>
                  ))
                ) : (
                  <EmptyNote text="No behavioural notes recorded yet." />
                )}
              </div>
            )}

            {activeTab === "activities" && (
              hasActivities ? (
                <div className="rounded-xl bg-[#F8F6FE] px-3 py-3">
                  <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                    <Sparkles size={12} aria-hidden />
                    Things {firstName} enjoys
                  </p>
                  <ul className="mt-2 space-y-1">
                    {context!.preferred_activities!.map((item) => (
                      <li key={item} className="text-sm font-semibold" style={{ color: TEXT }}>
                        • {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <EmptyNote text={`No preferred activities recorded for ${firstName} yet.`} />
              )
            )}

            {activeTab === "visits" && (
              hasVisits ? (
                <div className="rounded-xl bg-[#F8F6FE] px-3 py-3">
                  <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                    <Heart size={12} aria-hidden />
                    Notes from previous visits
                  </p>
                  {context?.previous_visit_notes_updated_at && (
                    <p className="mt-1 text-[10px] font-semibold" style={{ color: MUTED }}>
                      Updated {formatSynced(context.previous_visit_notes_updated_at)}
                    </p>
                  )}
                  <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-relaxed" style={{ color: TEXT }}>
                    {context?.previous_visit_notes}
                  </p>
                </div>
              ) : (
                <EmptyNote text="No notes from previous visits yet." />
              )
            )}

            {activeTab === "communication" && (
              hasComm ? (
                <InfoBlock icon={MessageSquare} label="How to communicate" body={context!.communication_guidance!} />
              ) : (
                <EmptyNote text="No communication guidance recorded yet." />
              )
            )}
          </div>

          {syncedAt && (
            <p className="border-t px-4 py-2 text-[10px] font-semibold" style={{ borderColor: BORDER, color: MUTED }}>
              Last synced {formatSynced(syncedAt)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <p className="rounded-xl bg-[#F8F6FE] px-3 py-4 text-sm font-medium" style={{ color: MUTED }}>
      {text}
    </p>
  );
}

function InfoBlock({
  icon: Icon,
  label,
  body,
}: {
  icon: typeof Pill;
  label: string;
  body: string;
}) {
  return (
    <div className="rounded-xl bg-[#F8F6FE] px-3 py-3">
      <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
        <Icon size={12} aria-hidden />
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm font-medium leading-relaxed" style={{ color: TEXT }}>
        {body}
      </p>
    </div>
  );
}
