import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Copy, CheckCircle2, UserPlus, Link2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const ROLE_OPTIONS = [
  { value: "support_worker",      label: "Support Worker",          desc: "Access to allocated participants + their own sessions/incidents" },
  { value: "allied_health",       label: "Allied Health Professional", desc: "Own caseload, clinical reporting, body map + therapy documentation" },
];

interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  onInviteSent?: () => void;
}

interface InviteResult {
  email: string;
  role: string;
  invite_url: string;
  token: string;
}

export function InviteModal({ open, onClose, onInviteSent }: InviteModalProps) {
  const { token } = useAuth();
  const { toast } = useToast();

  const [email, setEmail]   = useState("");
  const [role, setRole]     = useState("support_worker");
  const [busy, setBusy]     = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setEmail("");
    setRole("support_worker");
    setResult(null);
    setCopied(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSend() {
    if (!email.trim() || !email.includes("@")) {
      toast({ title: "Valid email required", variant: "destructive" });
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/invitations/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to create invitation");
      }
      const data = await res.json();
      setResult(data);
      onInviteSent?.();
    } catch (e) {
      toast({
        title: "Invitation failed",
        description: e instanceof Error ? e.message : "Could not create invitation",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  function copyLink() {
    if (!result) return;
    const fullUrl = `${window.location.origin}${result.invite_url}`;
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  const selectedRoleOption = ROLE_OPTIONS.find((r) => r.value === role);
  const PLUM = "#5533CC";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg" style={{ color: "#1E1640" }}>
            <UserPlus size={18} style={{ color: PLUM }} />
            {result ? "Invitation Created" : "Invite Staff Member"}
          </DialogTitle>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email" className="text-xs font-medium" style={{ color: "#4A3D5A" }}>
                Email Address
              </Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="worker@example.com.au"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-xl"
                onKeyDown={(e) => e.key === "Enter" && !busy && handleSend()}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium" style={{ color: "#4A3D5A" }}>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedRoleOption && (
                <p className="text-[11px] leading-relaxed" style={{ color: "#7A6A9E" }}>
                  {selectedRoleOption.desc}
                </p>
              )}
            </div>

            <div className="rounded-xl px-4 py-3 text-[12px] leading-relaxed" style={{ background: "rgba(85,51,204,0.05)", border: "1px solid rgba(209,196,244,0.6)", color: "#4A3D5A" }}>
              The invitee will receive a link to set their password and activate their account. Links expire after <strong>7 days</strong>. Since email delivery is not yet configured, copy and share the link manually below after creating.
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.25)" }}>
              <CheckCircle2 size={20} style={{ color: "#22c55e" }} className="shrink-0" />
              <div>
                <p className="text-sm font-medium" style={{ color: "#1E1640" }}>Invitation created</p>
                <p className="text-xs mt-0.5" style={{ color: "#7A6A9E" }}>
                  {result.email} — {ROLE_OPTIONS.find(r => r.value === result.role)?.label ?? result.role}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium flex items-center gap-1.5" style={{ color: "#4A3D5A" }}>
                <Link2 size={12} /> Invite Link <span className="font-normal">(share this with the invitee)</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={`${window.location.origin}${result.invite_url}`}
                  className="rounded-xl text-xs font-mono"
                  style={{ color: "#4A3D5A", background: "rgba(245,243,252,1)" }}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 rounded-xl"
                  onClick={copyLink}
                >
                  {copied ? <CheckCircle2 size={14} style={{ color: "#22c55e" }} /> : <Copy size={14} />}
                </Button>
              </div>
              <p className="text-[11px]" style={{ color: "#7A6A9E" }}>Link expires in 7 days.</p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {!result ? (
            <>
              <Button variant="outline" onClick={handleClose} className="rounded-xl">Cancel</Button>
              <Button onClick={handleSend} disabled={busy || !email.trim()} className="rounded-xl gap-1.5">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                Create Invitation
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={reset} className="rounded-xl">Send Another</Button>
              <Button onClick={handleClose} className="rounded-xl">Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
