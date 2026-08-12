import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useAccessibility } from "@/contexts/AccessibilityContext";

/**
 * Email invite links still point here (`/accept-invite?token=`).
 * Redirect into the shared YOUR → ORGANISATION signup wizard.
 */
export default function AcceptInvite() {
  const [, navigate] = useLocation();
  const { translate: t } = useAccessibility();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  useEffect(() => {
    if (!token) {
      navigate("/signup");
      return;
    }
    navigate(`/signup?token=${encodeURIComponent(token)}`);
  }, [token, navigate]);

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--cc-bg)" }}
    >
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="animate-spin" style={{ color: "var(--cc-plum)" }} size={32} />
        <p className="text-sm" style={{ color: "var(--cc-muted)" }}>
          {t("auth.invite.validating")}
        </p>
      </div>
    </div>
  );
}
