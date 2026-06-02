import { useLocation } from "wouter";
import { IdleTimeoutModal } from "@/components/auth/IdleTimeoutModal";
import { useAuth } from "@/contexts/AuthContext";
import { useIdleTimeout } from "@/hooks/useIdleTimeout";

const IDLE_EXCLUDED_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/accept-invite",
];

export function AuthSessionGuards() {
  const [location, setLocation] = useLocation();
  const { isAuthenticated, logout } = useAuth();
  const enabled =
    isAuthenticated &&
    !IDLE_EXCLUDED_PATHS.some((path) => location === path || location.startsWith(path + "/"));

  const idle = useIdleTimeout({
    enabled,
    onTimeout: () => {
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
