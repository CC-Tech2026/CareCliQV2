import { ChevronDown } from "lucide-react";
import { useViewingParticipant } from "@/components/participant-portal/ParticipantPortalContext";
import { ProfileAvatar } from "@/components/participant-portal/ProfileAvatar";
import { usePortalOverview } from "@/components/participant-portal/usePortalOverview";
import { GENDER_OPTIONS, PRONOUN_OPTIONS, intakeOptionLabel } from "@/services/participantIntakeService";

const SURFACE = "var(--cc-surface)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const CHIP_BG = "var(--cc-soft)";

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
    <div className="grid grid-cols-[104px_1fr] gap-3 text-[14px] leading-relaxed sm:grid-cols-[120px_1fr]">
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
      <div className="rounded-2xl border p-6" style={{ background: SURFACE, borderColor: BORDER }}>
        <p className="text-[14px]" style={{ color: MUTED }}>{error}</p>
      </div>
    );
  }
  if (!data) {
    return <div className="h-[520px] animate-pulse rounded-2xl" style={{ background: CHIP_BG }} />;
  }

  const p = data.profile;
  const intake = p.intake;
  const address =
    p.address ||
    [intake.street_address, intake.suburb, [intake.state, intake.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const funding = FUNDING_LABELS[p.plan_management_type ?? ""] || FUNDING_LABELS[intake.funding_type ?? ""];
  const planDates =
    intake.plan_start || intake.plan_end ? `${formatDate(intake.plan_start) ?? "N/A"} to ${formatDate(intake.plan_end) ?? "N/A"}` : undefined;
  const hasPlanManager = intake.plan_manager_name || intake.plan_manager_org || intake.plan_manager_phone || intake.plan_manager_email;
  const nextOfKin = intake.next_of_kin ?? [];
  const activities = [
    ...(Array.isArray(p.preferred_activities) ? p.preferred_activities : (p.preferred_activities ?? "").split(",")),
    ...(p.favourite_activities ?? "").split(","),
  ]
    .map((a) => a.trim())
    .filter((a, i, all) => a && all.indexOf(a) === i);
  const index = participants && current ? participants.indexOf(current) : 0;

  return (
    <div className="space-y-5 rounded-2xl border p-6" style={{ background: SURFACE, borderColor: BORDER }}>
      <div className="flex items-center gap-4 pb-1">
        {current && (
          <ProfileAvatar
            participant={{ ...current, profile_photo_url: p.profile_photo_url ?? current.profile_photo_url }}
            index={index}
            size={72}
          />
        )}
        <div className="min-w-0">
          <h1 className="text-[24px] font-black leading-tight" style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}>{p.full_name}</h1>
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

      {/* The support team lives on the Overview, beside who's coming next. */}
      {(activities.length > 0 || p.interests || p.daily_routine) && (
        <Section title="Interests & routine">
          <Row label="Interests" value={p.interests} />
          <Row label="Daily routine" value={p.daily_routine} />
          {activities.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {activities.map((a) => (
                <span key={a} className="rounded-lg px-3 py-1.5 text-[13px] font-bold" style={{ background: CHIP_BG, color: TEXT }}>
                  {a}
                </span>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
