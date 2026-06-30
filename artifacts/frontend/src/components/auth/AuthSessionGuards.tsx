import { useLocation } from "wouter";
import { IdleTimeoutModal } from "@/components/auth/IdleTimeoutModal";
import { useAuth } from "@/contexts/AuthContext";
import { useIdleTimeout } from "@/hooks/useIdleTimeout";
import { captureCurrentRestoreContext } from "@/lib/auth-session";

const IDLE_EXCLUDED_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/accept-invite",
  "/account/secure",
];

export function AuthSessionGuards() {
  const [location, setLocation] = useLocation();
  const { isAuthenticated, logout, user } = useAuth();
  const enabled =
    isAuthenticated &&
    !IDLE_EXCLUDED_PATHS.some((path) => location === path || location.startsWith(path + "/"));

  const idle = useIdleTimeout({
    enabled,
    onTimeout: () => {
      captureCurrentRestoreContext(user?.id);
      logout();
      setLocation("/login");
    },
  });

  return (
    <IdleTimeoutModal
      open={idle.warningOpen}
      remainingSeconds={idle.remainingSeconds}
      onStaySignedIn={idle.staySignedIn}
    />
  );
}
