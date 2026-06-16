import { ChevronDown, User } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import type { ParticipantProfile } from "@/services/shiftService";
import { BORDER, MUTED, PLUM, TEXT, participantAge } from "@/lib/shift-utils";

type Props = {
  profile?: ParticipantProfile;
  fallbackName?: string;
  open?: boolean;
  onToggle?: () => void;
};

function safeDate(value?: string) {
  if (!value) return null;
  try {
    return format(parseISO(value), "d MMM yyyy");
  } catch {
    return value;
  }
}

export function ParticipantProfileCard({ profile, fallbackName, open = true, onToggle }: Props) {
  const name = profile?.preferred_name || fallbackName;
  const age = participantAge(profile?.date_of_birth);
  const hasContent = Boolean(
    name || profile?.ndis_number || profile?.date_of_birth || profile?.emergency_contact || profile?.phone,
  );
  if (!hasContent) return null;

  const rows: Array<{ label: string; value?: string | null; href?: string }> = [
    { label: "Preferred name", value: name },
    { label: "Date of birth", value: profile?.date_of_birth ? `${safeDate(profile.date_of_birth)}${age != null ? ` (${age} yrs)` : ""}` : null },
    { label: "NDIS number", value: profile?.ndis_number },
    { label: "Phone", value: profile?.phone, href: profile?.phone ? `tel:${profile.phone}` : undefined },
    { label: "Email", value: profile?.email, href: profile?.email ? `mailto:${profile.email}` : undefined },
    { label: "Emergency contact", value: profile?.emergency_contact },
    { label: "Primary disability", value: profile?.primary_disability },
  ];

  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        onClick={onToggle}
      >
        <span className="flex items-center gap-2 text-sm font-black" style={{ color: TEXT }}>
          <User size={16} style={{ color: PLUM }} />
          Participant Profile
        </span>
        <ChevronDown size={18} className={cn("transition", open && "rotate-180")} style={{ color: MUTED }} />
      </button>

      {open && (
        <dl className="grid gap-2 border-t px-4 py-3 sm:grid-cols-2" style={{ borderColor: BORDER }}>
          {rows.map(({ label, value, href }) => (
            <div key={label} className="rounded-xl bg-[#F8F6FE] p-3">
              <dt className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                {label}
              </dt>
              <dd className="mt-1 text-sm font-bold" style={{ color: TEXT }}>
                {href && value ? (
                  <a href={href} className="underline decoration-[#5533CC]/30 underline-offset-2">
                    {value}
                  </a>
                ) : (
                  value || "Not recorded"
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
