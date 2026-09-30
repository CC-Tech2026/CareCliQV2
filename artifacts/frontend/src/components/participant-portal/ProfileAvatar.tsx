import type { PortalParticipant } from "@/services/participantPortalService";

// Tile colours for the profile picker — each dark enough for white initials
// to stay readable. Assigned by position in the (server-sorted) list, so the
// same person keeps the same colour on the picker and in the sidebar.
const PROFILE_COLORS = ["#B8336A", "#C0392B", "#B45309", "#2E7D6B", "#4338CA", "#7C3AED"];

export function profileColor(index: number): string {
  return PROFILE_COLORS[((index % PROFILE_COLORS.length) + PROFILE_COLORS.length) % PROFILE_COLORS.length];
}

export function displayName(p: PortalParticipant): string {
  return p.preferred_name?.trim() || p.full_name || "Participant";
}

export function getInitials(name: string): string {
  return name.trim().split(/\s+/).map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

/** Square profile tile: the person's photo if there is one, else initials on their colour. */
export function ProfileAvatar({
  participant,
  index,
  size,
  className = "",
}: {
  participant: PortalParticipant;
  index: number;
  size: number;
  className?: string;
}) {
  const name = displayName(participant);
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden font-black text-white ${className}`}
      style={{ width: size, height: size, background: profileColor(index), fontSize: Math.round(size * 0.32), borderRadius: Math.round(size * 0.14) }}
      aria-hidden="true"
    >
      {participant.profile_photo_url ? (
        <img src={participant.profile_photo_url} alt="" className="h-full w-full object-cover" />
      ) : (
        getInitials(name)
      )}
    </span>
  );
}
