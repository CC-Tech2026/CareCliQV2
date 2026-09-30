import { useEffect, useState } from "react";
import { Check, Copy, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SignatureCanvas, useSignatureCanvasState } from "@/components/shifts/SignatureCanvas";
import { useToast } from "@/hooks/use-toast";
import { sendAgreementForEsign, type SignerRelationship } from "@/services/serviceAgreementService";

const RELATIONSHIPS: Array<{ value: SignerRelationship; label: string }> = [
  { value: "participant", label: "The participant" },
  { value: "nominee", label: "Plan nominee" },
  { value: "guardian", label: "Parent or guardian" },
  { value: "other", label: "Other representative" },
];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The provider signs here, then the participant (or their representative)
 * is emailed a link to review and sign from their own device. */
export function EmailAgreementDialog({
  open,
  onOpenChange,
  agreementId,
  agreementNumber,
  participantName,
  participantEmail,
  providerName,
  resend,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agreementId: string;
  agreementNumber?: string | null;
  participantName: string;
  participantEmail?: string | null;
  providerName?: string;
  /** Pre-fill from the link already sent. */
  resend?: { signer_name: string | null; relationship: SignerRelationship | null } | null;
  onSent: () => void;
}) {
  const { toast } = useToast();
  const provider = useSignatureCanvasState();
  const [providerSigner, setProviderSigner] = useState(providerName ?? "");
  const [relationship, setRelationship] = useState<SignerRelationship>("participant");
  const [signerName, setSignerName] = useState(participantName);
  const [signerEmail, setSignerEmail] = useState(participantEmail ?? "");
  const [saving, setSaving] = useState(false);
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFallbackLink(null);
    setCopied(false);
    setProviderSigner(providerName ?? "");
    const rel = resend?.relationship ?? "participant";
    setRelationship(rel);
    setSignerName(resend?.signer_name ?? participantName);
    // The stored address is masked, so a resend asks for it again.
    setSignerEmail(resend ? "" : participantEmail ?? "");
  }, [open, providerName, participantName, participantEmail, resend]);

  const chooseRelationship = (value: SignerRelationship) => {
    setRelationship(value);
    // Keep the participant's name only while it's them signing.
    if (value === "participant") setSignerName(participantName);
    else if (signerName === participantName) setSignerName("");
  };

  const emailOk = EMAIL_RE.test(signerEmail.trim());
  const ready = providerSigner.trim() && provider.hasStroke && signerName.trim() && emailOk;

  const submit = async () => {
    if (!ready) return;
    setSaving(true);
    try {
      const result = await sendAgreementForEsign(agreementId, {
        provider_name: providerSigner.trim(),
        provider_signature_png: provider.signaturePng,
        signer_name: signerName.trim(),
        signer_email: signerEmail.trim(),
        relationship,
      });
      onSent();
      if (result.sign_url) {
        // Email isn't going out — show the link so it can be shared another way.
        setFallbackLink(result.sign_url);
        return;
      }
      toast({
        title: "Sent for signature",
        description: `${signerName.trim()} will get a link at ${result.sent_to}. It works for 14 days.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Not sent", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    if (!fallbackLink) return;
    try {
      await navigator.clipboard.writeText(fallbackLink);
      setCopied(true);
    } catch {
      toast({ title: "Couldn't copy", description: "Select the link and copy it manually." });
    }
  };

  if (fallbackLink) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Signing link ready — email not sent</DialogTitle>
            <DialogDescription>
              Your signature is saved, but the email couldn't be queued just now. Send this link to{" "}
              {signerName.trim()} yourself — it works for 14 days, after they confirm a code sent to{" "}
              {signerEmail.trim()}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={fallbackLink} aria-label="Signing link" onFocus={(e) => e.currentTarget.select()} />
            <Button variant="outline" className="shrink-0 gap-1.5" onClick={() => void copy()}>
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{resend ? "Send a new signing link" : `Email ${agreementNumber ?? "agreement"} for signature`}</DialogTitle>
          <DialogDescription>
            Sign for your organisation, then we'll email a secure link so they can read and sign on their own device.
            {resend ? " The previous link will stop working." : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-cc-muted">1 · Your signature</p>
            <div className="space-y-1.5">
              <Label htmlFor="esign-provider" className="text-xs">Signing for the provider</Label>
              <Input id="esign-provider" value={providerSigner} onChange={(e) => setProviderSigner(e.target.value)} />
            </div>
            <SignatureCanvas minWidth={260} minHeight={90} onChange={provider.onCanvasChange} />
          </section>

          <section className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-cc-muted">2 · Who signs for {participantName}</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Who is signing">
              {RELATIONSHIPS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={relationship === r.value}
                  onClick={() => chooseRelationship(r.value)}
                  className="rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
                  style={{
                    borderColor: relationship === r.value ? "var(--cc-plum)" : "var(--cc-border)",
                    background: relationship === r.value ? "var(--cc-soft)" : "transparent",
                    color: relationship === r.value ? "var(--cc-plum)" : "var(--cc-muted)",
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="esign-name" className="text-xs">Their full name</Label>
                <Input id="esign-name" value={signerName} onChange={(e) => setSignerName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="esign-email" className="text-xs">Email</Label>
                <Input
                  id="esign-email"
                  type="email"
                  inputMode="email"
                  value={signerEmail}
                  onChange={(e) => setSignerEmail(e.target.value)}
                  placeholder="name@example.com"
                  aria-invalid={Boolean(signerEmail.trim()) && !emailOk}
                />
                {signerEmail.trim() && !emailOk && (
                  <p className="text-[11px]" style={{ color: "var(--cc-status-danger)" }}>Enter a valid email.</p>
                )}
              </div>
            </div>
          </section>

          <p className="flex items-start gap-2 rounded-lg p-3 text-[12px]" style={{ background: "var(--cc-soft)", color: "var(--cc-text)" }}>
            <ShieldCheck size={15} className="mt-0.5 shrink-0" style={{ color: "var(--cc-plum)" }} />
            Before they can see the agreement, they confirm a code sent to this address. When they sign, the signed PDF is
            saved to the participant's record and the vault, and your accounts email is told.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="gap-1.5" onClick={submit} disabled={!ready || saving}>
            <Mail size={15} /> {saving ? "Sending…" : "Sign & send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
