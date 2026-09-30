import { ChevronDown } from "lucide-react";
import { useViewingParticipant } from "@/components/participant-portal/ParticipantPortalContext";
import { ProfileAvatar, getInitials } from "@/components/participant-portal/ProfileAvatar";
import { usePortalOverview } from "@/components/participant-portal/usePortalOverview";
import { GENDER_OPTIONS, PRONOUN_OPTIONS, intakeOptionLabel } from "@/services/participantIntakeService";

// The profile sits on a bold brand card (deep plum → CareCliQ pink). The
// gradient is darkened from the brand pink so white text keeps at least
// 4.5:1 contrast everywhere on it, in both themes.
const CARD_GRADIENT = "linear-gradient(160deg, #6E1B45 0%, #A62A60 55%, #BC356B 100%)";
const TEXT = "#FFFFFF";
const MUTED = "rgba(255, 255, 255, 0.85)";
const BORDER = "rgba(255, 255, 255, 0.22)";
const CHIP_BG = "rgba(255, 255, 255, 0.16)";

const FUNDING_LABELS: Record<string, string> = {
  ndia_managed: "NDIA-managed",
  plan_managed: "Plan-managed",
  self_managed: "Self-managed",
  "NDIA-managed": "NDIA-managed",
  "plan-managed": "Plan-managed",
  "self-managed": "Self-managed",
};
const SERVICE_LABELS: Record<string, string> = { disability: "Disability support (NDIS)", aged_care: "Aged care" };

function formatDate(value?: string | null) {
  if (!value) return undefined;
  return new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group border-t pt-5" style={{ borderColor: BORDER }}>
      <summary
        className="flex cursor-pointer list-none items-center gap-2 text-[15px] font-black [&::-webkit-details-marker]:hidden"
        style={{ color: TEXT }}
      >
        <ChevronDown size={16} className="-rotate-90 transition-transform group-open:rotate-0" style={{ color: MUTED }} />
        {title}
      </summary>
      <div className="mt-4 space-y-3.5 pb-1">{children}</div>
    </details>
  );
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="grid grid-cols-[132px_1fr] gap-4 text-[14px] leading-relaxed">
      <span style={{ color: MUTED }}>{label}</span>
      <span className="min-w-0 break-words font-semibold" style={{ color: TEXT }}>{value}</span>
    </div>
  );
}

/**
 * The participant's full profile from intake — the left column of every
 * portal tab. Reads the same allowlisted overview data as the Overview page.
 */
export function ProfilePanel() {
  const { participantId, participants, current } = useViewingParticipant();
  const { data, error } = usePortalOverview(participantId);

  if (error) {
    return (
      <div className="rounded-[24px] p-6" style={{ background: CARD_GRADIENT }}>
        <p className="text-[13px]" style={{ color: MUTED }}>{error}</p>
      </div>
    );
  }
  if (!data) {
    return <div className="h-[520px] animate-pulse rounded-[24px]" style={{ background: CARD_GRADIENT, opacity: 0.6 }} />;
  }

  const p = data.profile;
  const intake = p.intake;
  const address =
    p.address ||
    [intake.street_address, intake.suburb, [intake.state, intake.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const funding = FUNDING_LABELS[p.plan_management_type ?? ""] || FUNDING_LABELS[intake.funding_type ?? ""];
  const planDates =
    intake.plan_start || intake.plan_end ? `${formatDate(intake.plan_start) ?? "—"} – ${formatDate(intake.plan_end) ?? "—"}` : undefined;
  const hasPlanManager = intake.plan_manager_name || intake.plan_manager_org || intake.plan_manager_phone || intake.plan_manager_email;
  const nextOfKin = intake.next_of_kin ?? [];
  const index = participants && current ? participants.indexOf(current) : 0;

  return (
    <div className="space-y-5 rounded-[24px] p-6 shadow-lg sm:p-7" style={{ background: CARD_GRADIENT }}>
      <div className="space-y-4 pb-1">
        {current && (
          <ProfileAvatar
            participant={{ ...current, profile_photo_url: p.profile_photo_url ?? current.profile_photo_url }}
            index={index}
            size={96}
            className="ring-4 ring-white/30"
          />
        )}
        <div>
          <h1 className="text-[28px] font-black leading-tight" style={{ color: TEXT }}>{p.full_name}</h1>
          {p.active_since && (
            <p className="mt-1 text-[13px]" style={{ color: MUTED }}>Supported since {formatDate(p.active_since)}</p>
          )}
        </div>
      </div>

      <Section title="Personal details">
        <Row label="Preferred name" value={p.preferred_name || intake.preferred_name} />
        <Row label="Pronouns" value={intakeOptionLabel(PRONOUN_OPTIONS, intake.pronouns)} />
        <Row label="Gender" value={intakeOptionLabel(GENDER_OPTIONS, intake.gender)} />
        <Row label="Date of birth" value={formatDate(p.date_of_birth)} />
        <Row label="Language" value={intake.preferred_language} />
      </Section>

      <Section title="Contact & address">
        <Row label="Email" value={p.email} />
        <Row label="Phone" value={p.phone} />
        <Row label="Address" value={address || undefined} />
      </Section>

      <Section title="NDIS & plan">
        <Row label="NDIS number" value={p.ndis_number} />
        <Row label="Service" value={SERVICE_LABELS[p.service_category ?? ""]} />
        <Row label="Funding" value={funding} />
        <Row label="Plan dates" value={planDates} />
        <Row label="Support hours" value={p.service_hours_required ? `${p.service_hours_required} hours` : undefined} />
      </Section>

      {hasPlanManager && (
        <Section title="Plan manager" defaultOpen={false}>
          <Row label="Name" value={intake.plan_manager_name} />
          <Row label="Organisation" value={intake.plan_manager_org} />
          <Row label="Phone" value={intake.plan_manager_phone} />
          <Row label="Email" value={intake.plan_manager_email} />
        </Section>
      )}

      {(nextOfKin.length > 0 || p.emergency_contact_name) && (
        <Section title="Next of kin & emergency contact" defaultOpen={false}>
          {nextOfKin.map((k, i) => (
            <Row key={i} label={k.relationship || "Next of kin"} value={[k.name, k.phone, k.email].filter(Boolean).join(" · ")} />
          ))}
          {p.emergency_contact_name && (
            <Row
              label={p.emergency_contact_relationship || "Emergency"}
              value={[p.emergency_contact_name, p.emergency_contact_number].filter(Boolean).join(" · ")}
            />
          )}
        </Section>
      )}

      {(intake.presenting_needs?.length ?? 0) > 0 && (
        <Section title="Support needs">
          <div className="flex flex-wrap gap-2">
            {intake.presenting_needs!.map((need) => (
              <span key={need} className="rounded-lg px-3 py-1.5 text-[13px] font-bold" style={{ background: CHIP_BG, color: TEXT }}>
                {need}
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section title="Your support team">
        {data.support_team.length === 0 ? (
          <p className="text-[14px] leading-relaxed" style={{ color: MUTED }}>Your provider will let you know who's supporting you.</p>
        ) : (
          <ul className="space-y-3">
            {data.support_team.map((w) => (
              <li key={w.id} className="flex items-center gap-3">
                {w.profile_photo_url ? (
                  <img src={w.profile_photo_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-black" style={{ background: CHIP_BG, color: TEXT }}>
                    {getInitials(w.full_name || "?")}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold" style={{ color: TEXT }}>{w.full_name}</span>
                  <span className="block text-[12px]" style={{ color: MUTED }}>
                    {w.role_label}{w.is_assigned ? " · Main support worker" : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
