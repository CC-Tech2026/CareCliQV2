import { ChevronDown, Phone, User, UserCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParticipantProfile } from "@/services/shiftService";
import { emergencyContactDisplay, formatDobWithAge } from "@/lib/participant-display";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type Props = {
  profile?: ParticipantProfile;
  fallbackName?: string;
  open?: boolean;
  onToggle?: () => void;
};

export function ParticipantProfileCard({ profile, fallbackName, open = true, onToggle }: Props) {
  const { translate } = useAccessibility();
  const name = profile?.preferred_name || fallbackName;
  const emergency = emergencyContactDisplay(profile?.emergency_contact);
  const caseManager = profile?.case_manager;
  if (!name && !fallbackName) return null;

  const standardRows: Array<{ label: string; value?: string | null; href?: string }> = [
    { label: translate("shift.participant.preferredName"), value: name },
    { label: translate("shift.participant.dob"), value: formatDobWithAge(profile?.date_of_birth) },
    { label: translate("shift.participant.ndis"), value: profile?.ndis_number },
    { label: translate("shift.participant.phone"), value: profile?.phone, href: profile?.phone ? `tel:${profile.phone}` : undefined },
    { label: translate("shift.participant.email"), value: profile?.email, href: profile?.email ? `mailto:${profile.email}` : undefined },
    { label: translate("shift.participant.disability"), value: profile?.primary_disability },
  ];

  return (
    <section className="overflow-hidden rounded-2xl border bg-cc-surface shadow-sm" style={{ borderColor: BORDER }}>
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-black" style={{ color: TEXT }}>
          <User size={16} style={{ color: PLUM }} aria-hidden />
          {translate("shift.participant.profile")}
        </span>
        <ChevronDown size={18} className={cn("transition", open && "rotate-180")} style={{ color: MUTED }} aria-hidden />
      </button>

      {open && (
        <div className="space-y-2 border-t px-4 py-3" style={{ borderColor: BORDER }}>
          {emergency && (
            <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
              <dt className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-rose-700 dark:text-rose-300">
                <Phone size={12} aria-hidden />
                {translate("shift.participant.emergency")}
              </dt>
              <dd className="mt-1 text-sm font-bold text-rose-900 dark:text-rose-200">
                {emergency.phone ? (
                  <a href={`tel:${emergency.phone}`} className="underline decoration-rose-400 underline-offset-2">
                    {emergency.text}
                  </a>
                ) : (
                  emergency.text
                )}
              </dd>
            </div>
          )}

          {caseManager?.name && (
            <div className="rounded-xl border border-cc-border bg-cc-active-bg p-3">
              <dt className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                <UserCircle size={12} aria-hidden />
                {translate("shift.participant.caseManager")}
              </dt>
              <dd className="mt-1 text-sm font-bold" style={{ color: TEXT }}>
                {caseManager.phone ? (
                  <a
                    href={`tel:${caseManager.phone}`}
                    className="underline decoration-[#E8457A]/30 underline-offset-2"
                  >
                    {caseManager.name} · {caseManager.phone}
                  </a>
                ) : (
                  caseManager.name
                )}
              </dd>
            </div>
          )}

          <dl className="grid gap-2 sm:grid-cols-2">
            {standardRows.map(({ label, value, href }) => (
              <div key={label} className="rounded-xl bg-cc-soft p-3">
                <dt className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                  {label}
                </dt>
                <dd className="mt-1 text-sm font-bold" style={{ color: TEXT }}>
                  {href && value ? (
                    <a href={href} className="underline decoration-[#E8457A]/30 underline-offset-2">
                      {value}
                    </a>
                  ) : (
                    value || translate("shift.participant.notRecorded")
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
