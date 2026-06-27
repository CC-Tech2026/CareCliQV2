import { Redirect, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import type { UserRole } from "@/contexts/AuthContext";
import { saveAuthRestoreContext } from "@/lib/auth-session";

interface ProtectedRouteProps {
  children: React.ReactNode;

  /**
   * Only users with one of these roles
   * can access the route.
   */
  allowedRoles?: UserRole[];

  /**
   * Optional redirect path instead
   * of showing restricted message.
   */
  redirectTo?: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  support_coordinator: "Support Coordinator (CareCliQ Parent)",
  support_worker: "Support Worker (CareCliQ Child)",
  allied_health: "Allied Health Professional (CareCliQ Pro)",
  managing_director: "Managing Director (CareCliQ Executive)",
};

/**
 * Route protection layer
 *
 * Handles:
 * - Authentication
 * - Role-based access
 * - Restricted access UX
 */
export function ProtectedRoute({
  children,
  allowedRoles,
  redirectTo,
}: ProtectedRouteProps) {
  const { isAuthenticated, user } = useAuth();
  const [location] = useLocation();

  /**
   * Not logged in
   */
  if (!isAuthenticated || !user) {
    saveAuthRestoreContext(`${location}${window.location.search || ""}`);
    return <Redirect to="/login" />;
  }

  if (user.email_verified === false && location !== "/verify-email") {
    return <Redirect to="/verify-email" />;
  }

  const profileGatePaths = ["/verify-email", "/profile-completion", "/worker-onboarding", "/worker/profile", "/settings"];
  const isProfileGatePath = profileGatePaths.some((path) => location === path || location.startsWith(path + "/"));
  const needsRoleProfile =
    (user.role === "support_worker" || user.role === "allied_health") &&
    (user.profile_completed === false || user.role_specific_profile_completed === false);

  if (needsRoleProfile && !isProfileGatePath) {
    return <Redirect to="/profile-completion" />;
  }

  if (user.role === "support_worker" && user.onboarding_completed === false && location === "/dashboard") {
    return <Redirect to="/worker-onboarding" />;
  }

  /**
   * Role restriction
   */
  const hasRequiredRole = !allowedRoles || allowedRoles.includes(user.role);

  if (!hasRequiredRole) {
    /**
     * Optional redirect
     */
    if (redirectTo) {
      return <Redirect to={redirectTo} />;
    }

    /**
     * Restricted access UI
     */
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-cc-surface p-8 shadow-sm text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-3xl">
            🔒
          </div>

          <h1 className="text-2xl font-bold text-gray-900">
            Restricted Access
          </h1>

          <p className="mt-3 text-sm leading-6 text-gray-500">
            Your account role (
            <span className="font-medium text-gray-700">
              {ROLE_LABELS[user.role]}
            </span>
            ) does not have permission to access this section.
          </p>

          <div className="mt-6 rounded-xl bg-amber-50 border border-amber-100 p-4 text-left">
            <h2 className="text-sm font-semibold text-amber-900">
              Why am I seeing this?
            </h2>

            <p className="mt-2 text-sm text-amber-800 leading-6">
              CareCliQ uses role-based access controls to protect participant
              privacy, compliance records, and sensitive organisational
              information.
            </p>
          </div>

          <button
            onClick={() => window.history.back()}
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  /**
   * Allowed
   */
  return <>{children}</>;
}
