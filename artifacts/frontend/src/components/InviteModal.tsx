import { useMemo, useState } from "react";
import { useAccessibility } from "@/contexts/AccessibilityContext";

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
    labelKey: "hub.invite.role.supportWorker",
    descKey: "hub.invite.role.supportWorkerDesc",
    accessKey: "hub.invite.role.supportWorkerAccess",
  },
  {
    value: "support_coordinator",
    labelKey: "hub.invite.role.coordinator",
    descKey: "hub.invite.role.coordinatorDesc",
    accessKey: "hub.invite.role.coordinatorAccess",
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
  const { translate } = useAccessibility();

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
        title: translate("hub.invite.invalidEmail"),
        description: translate("hub.invite.invalidEmailDesc"),
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
            translate("hub.invite.unableToCreate")
        );
      }

      setResult(payload);

      const deliveryStatus = payload?.email_delivery?.status;

      toast({
        title: deliveryStatus === "queued" ? translate("hub.invite.sent") : translate("hub.invite.created"),
        description:
          deliveryStatus === "queued"
            ? translate("hub.invite.sentDesc")
            : translate("hub.invite.createdDesc"),
      });

      onInviteSent?.();
    } catch (error) {
      toast({
        title: translate("hub.invite.failed"),

        description:
          error instanceof Error
            ? error.message
            : translate("hub.invite.unexpectedError"),

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
        title: translate("hub.invite.linkCopied"),
      });

      setTimeout(() => {
        setCopied(false);
      }, 2500);
    } catch {
      toast({
        title: translate("hub.invite.copyFailed"),
        description: translate("hub.invite.copyFailedDesc"),
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
          <DialogTitle className="flex items-center gap-2 text-lg text-[#1A1A2E]">
            <UserPlus
              size={18}
              className="text-[#E8457A]"
            />

            {result
              ? translate("hub.invite.titleCreated")
              : translate("hub.invite.title")}
          </DialogTitle>

          <DialogDescription>
            {translate("hub.invite.description")}
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-5 py-2">
            <div className="space-y-1.5">
              <Label
                htmlFor="invite-email"
                className="text-xs font-medium"
              >
                {translate("hub.invite.emailLabel")}
              </Label>

              <Input
                id="invite-email"
                type="email"
                autoComplete="email"
                placeholder={translate("hub.invite.emailPlaceholder")}
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
                {translate("hub.invite.roleLabel")}
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
                      {translate(option.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedRole && (
                <div className="rounded-xl border border-violet-100 bg-violet-50 px-4 py-3">
                  <p className="text-xs font-medium text-[#1A1A2E]">
                    {translate(selectedRole.labelKey)}
                  </p>

                  <p className="mt-1 text-[11px] leading-relaxed text-[#6C5B8A]">
                    {translate(selectedRole.descKey)}
                  </p>

                  <div className="mt-3 flex items-start gap-2 text-[11px] text-[#E8457A]">
                    <ShieldCheck
                      size={13}
                      className="mt-0.5 shrink-0"
                    />

                    <span>
                      {translate(selectedRole.accessKey)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-900">
              {translate("hub.invite.expiryNote")}{" "}
              <strong>{translate("hub.invite.expiryDays")}</strong>.{" "}
              {translate("hub.invite.expirySuffix")}
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
                    ? translate("hub.invite.emailed")
                    : translate("hub.invite.created")}
                </p>

                <p className="mt-0.5 text-xs text-muted-foreground">
                  {result.email} ·{" "}
                  {translate(ROLE_OPTIONS.find((r) => r.value === result.role)?.labelKey ?? result.role)}
                </p>
              </div>
            </div>

            {result.email_delivery && result.email_delivery.status !== "queued" && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-900">
                {translate("hub.invite.emailStatus")} <strong>{result.email_delivery.status}</strong>.{" "}
                {result.email_delivery.message || translate("hub.invite.copyManually")}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-medium">
                <Link2 size={12} />
                {translate("hub.invite.secureLink")}
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
                {translate("hub.invite.shareLink")}
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
                {translate("common.cancel")}
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
                  ? translate("hub.invite.creating")
                  : translate("hub.invite.createInvitation")}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={resetState}
                className="rounded-xl"
              >
                {translate("hub.invite.sendAnother")}
              </Button>

              <Button
                onClick={handleClose}
                className="rounded-xl"
              >
                {translate("hub.invite.done")}
              </Button>
            </>
          )}
        </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
