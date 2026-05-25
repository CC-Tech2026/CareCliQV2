// src/pages/accept-invite.tsx

import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";

import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

import { ROLE_LABELS, normalizeUserRole, UserRole } from "@/lib/roles";

const PLUM = "#5533CC";
const CORAL = "#F03060";
const BORDER = "#D8D0F0";

interface InviteInfo {
  email: string;
  role: string;
  organization_name: string | null;
  expires_at: string;
}

export default function AcceptInvite() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { login } = useAuth();

  const token =
    new URLSearchParams(window.location.search).get("token") ?? "";

  const [step, setStep] = useState<"loading" | "error" | "form" | "done">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [invite, setInvite] = useState<InviteInfo | null>(null);

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [busy, setBusy] = useState(false);

  // -----------------------------
  // Validate invite
  // -----------------------------
  useEffect(() => {
    async function validateInvite() {
      if (!token) {
        setErrorMsg("No invitation token found.");
        setStep("error");
        return;
      }

      try {
        const res = await fetch(`/api/invitations/validate/${token}`);

        const data = await res.json().catch(() => null);

        if (!res.ok) {
          throw new Error(data?.detail || "Invalid or expired invitation");
        }

        setInvite(data);
        setStep("form");
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Validation failed");
        setStep("error");
      }
    }

    validateInvite();
  }, [token]);

  // -----------------------------
  // SAFE ROLE RESOLUTION (BULLETPROOF)
  // -----------------------------
  const roleLabel = useMemo(() => {
    const fallback: UserRole = "support_worker";

    if (!invite?.role) {
      return ROLE_LABELS[fallback];
    }

    const normalized = normalizeUserRole(invite.role);

    // extra safety: ensure key exists in ROLE_LABELS
    if (normalized in ROLE_LABELS) {
      return ROLE_LABELS[normalized];
    }

    return ROLE_LABELS[fallback];
  }, [invite]);

  // -----------------------------
  // Submit
  // -----------------------------
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!fullName.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }

    if (password.length < 8) {
      toast({
        title: "Weak password",
        description: "Minimum 8 characters",
        variant: "destructive",
      });
      return;
    }

    if (password !== confirm) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }

    setBusy(true);

    try {
      const res = await fetch(`/api/invitations/accept/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName.trim(),
          password,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.detail || "Activation failed");
      }

      if (invite?.email) {
        await login(invite.email, password);
      }

      setStep("done");

      toast({
        title: "Welcome",
        description: "Account activated successfully",
      });

      setTimeout(() => navigate("/dashboard"), 1500);
    } catch (err) {
      toast({
        title: "Activation failed",
        description: err instanceof Error ? err.message : "Server error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md p-8 rounded-2xl border" style={{ borderColor: BORDER }}>

        {step === "loading" && (
          <div className="flex flex-col items-center">
            <Loader2 className="animate-spin" style={{ color: PLUM }} />
            <p>Validating invitation...</p>
          </div>
        )}

        {step === "error" && (
          <div className="text-center">
            <AlertTriangle style={{ color: CORAL }} />
            <p className="mt-2">{errorMsg}</p>
          </div>
        )}

        {step === "done" && (
          <div className="text-center">
            <CheckCircle2 style={{ color: "green" }} />
            <p>Account activated</p>
          </div>
        )}

        {step === "form" && invite && (
          <>
            <h2 className="text-center font-bold">You're invited</h2>

            <p className="text-center text-sm">
              Role: <strong>{roleLabel}</strong>
            </p>

            <form onSubmit={handleSubmit} className="space-y-3 mt-4">
              <input
                className="w-full border p-2"
                placeholder="Full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />

              <input
                className="w-full border p-2"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <input
                className="w-full border p-2"
                type="password"
                placeholder="Confirm password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />

              <button
                disabled={busy}
                className="w-full p-2 text-white"
                style={{
                  background: `linear-gradient(135deg, ${PLUM}, ${CORAL})`,
                }}
              >
                {busy ? "Activating..." : "Activate Account"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}