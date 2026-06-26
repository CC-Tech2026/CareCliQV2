import { useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useToast } from "@/hooks/use-toast";

import {
  Loader2,
  Copy,
  CheckCircle2,
  UserPlus,
  Link2,
  ShieldCheck,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api-fetch";
import { useReAuth } from "@/hooks/useReAuth";

const ROLE_OPTIONS = [
  {
    value: "support_worker",
    label: "Support Worker",
    desc: "Access to allocated participants and own sessions/incidents only.",
    access:
      "Own clients · Own notes · Own incidents · Own credentials",
  },

  {
    value: "allied_health",
    label: "Allied Health Professional",
    desc: "Clinical documentation, body map coding, and therapy reporting.",
    access:
      "Clinical reports · Body maps · Therapy documentation",
  },

  {
    value: "support_coordinator",
    label: "Support Coordinator",
    desc: "Full organisation oversight, compliance, billing, and reports.",
    access:
      "Organisation oversight · Billing · Compliance · Team management",
  },
] as const;

interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  onInviteSent?: () => void;
}

interface InviteResult {
  id?: string;
  email: string;
  role: string;
  invite_url: string;
  token: string;
  expires_at?: string;
  email_delivery?: {
    status: "queued" | "disabled" | "not_configured" | string;
    provider?: string;
    message?: string;
  };
}

export function InviteModal({
  open,
  onClose,
  onInviteSent,
}: InviteModalProps) {
  const { token } = useAuth();
  const { requireReAuth, modal } = useReAuth();

  const { toast } = useToast();

  const [email, setEmail] = useState("");

  const [role, setRole] =
    useState<string>("support_worker");

  const [busy, setBusy] = useState(false);

  const [result, setResult] =
    useState<InviteResult | null>(null);

  const [copied, setCopied] = useState(false);

  const selectedRole = useMemo(() => {
    return ROLE_OPTIONS.find(
      (r) => r.value === role
    );
  }, [role]);

  function resetState() {
    setEmail("");
    setRole("support_worker");
    setResult(null);
    setCopied(false);
    setBusy(false);
  }

  function handleClose() {
    resetState();
    onClose();
  }

  function validateEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      value
    );
  }

  async function handleSend() {
    const cleanedEmail = email.trim().toLowerCase();

    if (!validateEmail(cleanedEmail)) {
      toast({
        title: "Invalid email address",
        description:
          "Please enter a valid staff email.",
        variant: "destructive",
      });

      return;
    }

    setBusy(true);

    try {
      /**
       * Backend API
       *
       * POST /api/invitations/create
       */
      const response = await requireReAuth(() => apiFetch(
        "/api/invitations/create",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",

            ...(token
              ? {
                  Authorization: `Bearer ${token}`,
                }
              : {}),
          },

          body: JSON.stringify({
            email: cleanedEmail,
            role,
          }),
        }
      ));

      if (!response) return;

      const payload = await response
        .json()
        .catch(() => null);

      if (!response.ok) {
        throw new Error(
          payload?.detail ||
            payload?.message ||
            "Unable to create invitation."
        );
      }

      setResult(payload);

      const deliveryStatus = payload?.email_delivery?.status;

      toast({
        title: deliveryStatus === "queued" ? "Invitation sent" : "Invitation created",
        description:
          deliveryStatus === "queued"
            ? "The secure invite link was emailed automatically."
            : "Secure invitation link generated. Copy it if email is not configured.",
      });

      onInviteSent?.();
    } catch (error) {
      toast({
        title: "Invitation failed",

        description:
          error instanceof Error
            ? error.message
            : "Unexpected server error",

        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!result?.invite_url) return;

    try {
      const fullUrl = `${window.location.origin}${result.invite_url}`;

      await navigator.clipboard.writeText(
        fullUrl
      );

      setCopied(true);

      toast({
        title: "Invite link copied",
      });

      setTimeout(() => {
        setCopied(false);
      }, 2500);
    } catch {
      toast({
        title: "Copy failed",

        description:
          "Unable to copy invite link.",

        variant: "destructive",
      });
    }
  }

  return (
    <>
      {modal}
      <Dialog
        open={open}
        onOpenChange={(open) => {
          if (!open) handleClose();
        }}
      >
        <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg text-[#111827]">
            <UserPlus
              size={18}
              className="text-[#3730A3]"
            />

            {result
              ? "Invitation Created"
              : "Invite Staff Member"}
          </DialogTitle>

          <DialogDescription>
            Securely invite team members to
            CareCliQ with role-based access
            permissions and organisation-level
            controls.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-5 py-2">
            <div className="space-y-1.5">
              <Label
                htmlFor="invite-email"
                className="text-xs font-medium"
              >
                Staff Email Address
              </Label>

              <Input
                id="invite-email"
                type="email"
                autoComplete="email"
                placeholder="worker@example.com.au"
                value={email}
                disabled={busy}
                onChange={(e) =>
                  setEmail(e.target.value)
                }
                className="rounded-xl"
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !busy
                  ) {
                    handleSend();
                  }
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Staff Role
              </Label>

              <Select
                value={role}
                onValueChange={setRole}
                disabled={busy}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  {ROLE_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedRole && (
                <div className="rounded-xl border border-violet-100 bg-violet-50 px-4 py-3">
                  <p className="text-xs font-medium text-[#111827]">
                    {selectedRole.label}
                  </p>

                  <p className="mt-1 text-[11px] leading-relaxed text-[#6C5B8A]">
                    {selectedRole.desc}
                  </p>

                  <div className="mt-3 flex items-start gap-2 text-[11px] text-[#3730A3]">
                    <ShieldCheck
                      size={13}
                      className="mt-0.5 shrink-0"
                    />

                    <span>
                      {selectedRole.access}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-900">
              Invitation links expire after{" "}
              <strong>7 days</strong>.
              Access permissions are enforced
              automatically based on the assigned
              role and organisation policies.
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
              <CheckCircle2
                size={20}
                className="shrink-0 text-green-600"
              />

              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {result.email_delivery?.status === "queued"
                    ? "Invitation emailed"
                    : "Invitation created"}
                </p>

                <p className="mt-0.5 text-xs text-muted-foreground">
                  {result.email} —{" "}
                  {ROLE_OPTIONS.find(
                    (r) =>
                      r.value === result.role
                  )?.label ?? result.role}
                </p>
              </div>
            </div>

            {result.email_delivery && result.email_delivery.status !== "queued" && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-900">
                Automatic email status: <strong>{result.email_delivery.status}</strong>.
                {" "}
                {result.email_delivery.message || "Copy and share the link manually."}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-medium">
                <Link2 size={12} />
                Secure Invite Link
              </Label>

              <div className="flex gap-2">
                <Input
                  readOnly
                  value={`${window.location.origin}${result.invite_url}`}
                  className="rounded-xl font-mono text-[11px]"
                  onClick={(e) =>
                    (
                      e.target as HTMLInputElement
                    ).select()
                  }
                />

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-xl"
                  onClick={handleCopy}
                >
                  {copied ? (
                    <CheckCircle2
                      size={14}
                      className="text-green-600"
                    />
                  ) : (
                    <Copy size={14} />
                  )}
                </Button>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Share this link securely with the
                invited staff member.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {!result ? (
            <>
              <Button
                variant="outline"
                onClick={handleClose}
                className="rounded-xl"
                disabled={busy}
              >
                Cancel
              </Button>

              <Button
                onClick={handleSend}
                disabled={
                  busy || !email.trim()
                }
                className="rounded-xl gap-1.5"
              >
                {busy ? (
                  <Loader2
                    size={14}
                    className="animate-spin"
                  />
                ) : (
                  <UserPlus size={14} />
                )}

                {busy
                  ? "Creating..."
                  : "Create Invitation"}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={resetState}
                className="rounded-xl"
              >
                Send Another
              </Button>

              <Button
                onClick={handleClose}
                className="rounded-xl"
              >
                Done
              </Button>
            </>
          )}
        </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
