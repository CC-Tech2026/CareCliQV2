import { useEffect, useState } from "react";
import { getPortalOverview, type PortalOverview } from "@/services/participantPortalService";

// The profile panel (every tab) and the Overview page both need the same
// overview data. A short-lived per-participant cache means one request per
// page instead of two, and switching tabs doesn't refetch every time.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; promise: Promise<PortalOverview> }>();

function loadOverview(participantId: string): Promise<PortalOverview> {
  const hit = cache.get(participantId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;
  const promise = getPortalOverview(participantId);
  cache.set(participantId, { at: Date.now(), promise });
  promise.catch(() => cache.delete(participantId));
  return promise;
}

export function usePortalOverview(participantId: string | null) {
  const [data, setData] = useState<PortalOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!participantId) return;
    let cancelled = false;
    setData(null);
    setError(null);
    loadOverview(participantId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load this profile."); });
    return () => { cancelled = true; };
  }, [participantId]);

  return { data, error };
}
