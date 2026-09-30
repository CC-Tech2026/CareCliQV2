import { useAuth } from "@/contexts/AuthContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { listMyAccessGrants, type AccessGrant } from "@/services/accessGrantService";

/**
 * A coordinator's own currently-active delegated-access grants. Returns
 * `hasCapability` for gating one specific MD-exclusive feature, and
 * `grants` for surfacing "you have temporary access" banners with expiry.
 *
 * Does nothing for a managing director — they don't need grants, and the
 * query is disabled outright so this never adds an extra request for them.
 */
export function useMyAccessGrants() {
  const { user } = useAuth();
  const isMD = user?.role === "managing_director";
  // Participants Portal logins can't call staff endpoints (the backend
  // refuses them), and never hold staff access grants anyway.
  const skip = isMD || user?.role === "participant";

  const query = useOrgQuery(["me", "access-grants"], {
    queryFn: listMyAccessGrants,
    enabled: !skip,
  });

  const grants = skip ? [] : (query.data ?? []);

  function hasCapability(capability: string): boolean {
    return grants.some((g) => g.capability === capability);
  }

  function grantFor(capability: string): AccessGrant | undefined {
    return grants.find((g) => g.capability === capability);
  }

  return {
    grants,
    isLoading: !skip && query.isLoading,
    hasCapability,
    grantFor,
  };
}
