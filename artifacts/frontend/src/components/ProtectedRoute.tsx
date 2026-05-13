import { Redirect } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import type { UserRole } from "@/contexts/AuthContext";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** When provided, only users with one of these roles can view the route. */
  allowedRoles?: UserRole[];
}

/**
 * Wraps a route's content:
 * - Unauthenticated → redirect to /login
 * - Wrong role → show an access-denied message
 * - Authenticated + allowed → render children
 */
export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-4 text-center">
        <div className="text-4xl">🔒</div>
        <h2 className="text-xl font-bold text-gray-900">Access denied</h2>
        <p className="text-gray-500 max-w-sm text-sm">
          Your account ({user.role.replace("_", " ")}) does not have permission to view this page.
          Contact your administrator if you believe this is incorrect.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
