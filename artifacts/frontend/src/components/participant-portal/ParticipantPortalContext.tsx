import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { listMyParticipants, type PortalParticipant } from "@/services/participantPortalService";

type PortalContextValue = {
  /** Everyone this login may view — from active participant_portal_access rows. */
  participants: PortalParticipant[] | null;
  loadError: string | null;
  /** The participant currently being viewed; null until one is chosen. */
  participantId: string | null;
  current: PortalParticipant | null;
  select: (participantId: string | null) => void;
};

const PortalContext = createContext<PortalContextValue | null>(null);

function storageKey(userId: string) {
  return `cc.participantPortal.viewing.${userId}`;
}

// Each portal route mounts its own provider, so the choice has to outlive a
// page change. Browser storage can be unavailable (private windows, blocked
// site data), so this in-memory copy covers the current tab either way.
const memorySelection = new Map<string, string | null>();

function readStored(userId: string): string | null {
  if (memorySelection.has(userId)) return memorySelection.get(userId) ?? null;
  try {
    return window.localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

function writeStored(userId: string, participantId: string | null) {
  memorySelection.set(userId, participantId);
  try {
    if (participantId) window.localStorage.setItem(storageKey(userId), participantId);
    else window.localStorage.removeItem(storageKey(userId));
  } catch {
    // Remembering the last choice is a convenience only.
  }
}

/** Forget who was being viewed, so the profile picker shows again — called
 * on each sign-in, like a streaming service's "Who's watching?". */
export function clearViewingParticipant(userId: string) {
  writeStored(userId, null);
}

/**
 * A portal login can cover several participants (e.g. a parent of two
 * children). This loads who the login may view and which one is selected.
 * One participant is selected automatically; several show the picker
 * (ParticipantPortalShell) until one is chosen. The backend re-checks the
 * chosen participant on every request — this is only the UI's view of it.
 */
export function ParticipantPortalProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [participants, setParticipants] = useState<PortalParticipant[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMyParticipants()
      .then((list) => {
        if (cancelled) return;
        setParticipants(list);
        const stored = userId ? readStored(userId) : null;
        if (stored && list.some((p) => p.participant_id === stored)) setParticipantId(stored);
        else if (list.length === 1) setParticipantId(list[0].participant_id);
        else setParticipantId(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Could not load your portal access.");
        setParticipants([]);
      });
    return () => { cancelled = true; };
  }, [userId]);

  const select = useCallback(
    (next: string | null) => {
      setParticipantId(next);
      if (userId) writeStored(userId, next);
    },
    [userId],
  );

  const value = useMemo<PortalContextValue>(
    () => ({
      participants,
      loadError,
      participantId,
      current: participants?.find((p) => p.participant_id === participantId) ?? null,
      select,
    }),
    [participants, loadError, participantId, select],
  );

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function useViewingParticipant(): PortalContextValue {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error("useViewingParticipant must be used inside ParticipantPortalProvider");
  return ctx;
}
