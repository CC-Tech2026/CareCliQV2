import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import { useViewingParticipant } from "@/components/participant-portal/ParticipantPortalContext";
import { usePortalDocumentTitle } from "@/components/participant-portal/PortalAuthLayout";
import { ProfileAvatar, displayName } from "@/components/participant-portal/ProfileAvatar";

const BG = "var(--cc-sidebar-bg)";
const TEXT = "#F5F5F7";
const MUTED = "rgba(245, 245, 247, 0.6)";
const HOME = "/participant-portal";

/** Only return to portal pages after choosing — never an arbitrary URL. */
function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get("next") ?? "";
  const isPortalPage = next === HOME || next.startsWith(`${HOME}/`);
  return isPortalPage && !next.startsWith(`${HOME}/choose`) ? next : HOME;
}

/**
 * Full-screen "Who would you like to view?" page for a login that covers
 * several participants (e.g. a parent of two). Choosing a tile opens the
 * portal showing only that person's information; "Switch profile" in the
 * portal sidebar comes back here.
 */
export default function ParticipantChoosePage() {
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();
  const { participants, loadError, select } = useViewingParticipant();
  usePortalDocumentTitle("Choose profile");

  // Nothing to choose between — go straight in.
  useEffect(() => {
    if (participants?.length === 1) {
      select(participants[0].participant_id);
      navigate(safeNext(), { replace: true });
    }
  }, [participants, select, navigate]);

  function choose(participantId: string) {
    select(participantId);
    navigate(safeNext());
  }

  return (
    <div className="flex min-h-screen flex-col px-4 py-6 sm:px-10" style={{ background: BG }}>
      <div className="flex items-center justify-between">
        <CareCliQLogo size={56} />
        <button
          onClick={() => { logout(); navigate("/portal/login"); }}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-bold transition-colors hover:bg-white/10"
          style={{ color: MUTED }}
        >
          <LogOut size={16} /> Log out
        </button>
      </div>

      <main className="flex flex-1 flex-col items-center justify-center py-10 text-center">
        {participants === null && <Loader2 className="animate-spin" size={32} style={{ color: TEXT }} />}

        {participants !== null && (loadError || participants.length === 0) && (
          <div className="max-w-md">
            <h1 className="text-2xl font-black" style={{ color: TEXT }}>
              {loadError ? "Something went wrong" : "No portal access"}
            </h1>
            <p className="mt-2 text-[15px]" style={{ color: MUTED }}>
              {loadError || "Your account doesn't currently have access to anyone's information. Please contact your care provider."}
            </p>
          </div>
        )}

        {participants && participants.length > 1 && (
          <>
            <h1 className="text-3xl font-black sm:text-5xl" style={{ color: TEXT }}>Who would you like to view?</h1>
            <ul className="mt-10 flex max-w-4xl flex-wrap justify-center gap-4 sm:gap-10">
              {participants.map((p, index) => (
                <li key={p.participant_id}>
                  <button
                    onClick={() => choose(p.participant_id)}
                    className="group flex w-[152px] flex-col items-center gap-3 rounded-2xl p-1 outline-none focus-visible:ring-4 focus-visible:ring-white/70"
                  >
                    <ProfileAvatar
                      participant={p}
                      index={index}
                      size={144}
                      className="transition-transform duration-150 group-hover:scale-105 group-hover:ring-4 group-hover:ring-white"
                    />
                    <span className="max-w-full">
                      <span className="block truncate text-[17px] font-bold transition-colors group-hover:text-white" style={{ color: TEXT }}>
                        {displayName(p)}
                      </span>
                      <span className="block truncate text-[13px]" style={{ color: MUTED }}>
                        {p.relationship === "self" ? "You" : p.relationship_label}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>

      <footer className="space-y-1 text-center text-[13px]" style={{ color: MUTED }}>
        <p>Signed in as <strong style={{ color: TEXT }}>{user?.full_name || user?.email}</strong></p>
        <p>Missing someone? Contact your care provider.</p>
      </footer>
    </div>
  );
}
