import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { signAgreement } from "@/services/serviceAgreementService";

/** Both parties sign on screen (in person or on a shared device). The
 * signed PDF is generated and stored, and the plan's agreement is marked
 * signed. */
export function SignAgreementDialog({
  open,
  onOpenChange,
  agreementId,
  agreementNumber,
  participantName,
  providerName,
  onSigned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agreementId: string;
  agreementNumber?: string | null;
  participantName: string;
  providerName?: string;
  onSigned: () => void;
}) {
  const { toast } = useToast();
  const provider = useSignatureCanvasState();
  const participant = useSignatureCanvasState();
  const [providerSigner, setProviderSigner] = useState(providerName ?? "");
  const [participantSigner, setParticipantSigner] = useState(participantName);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProviderSigner(providerName ?? "");
    setParticipantSigner(participantName);
    setConfirmed(false);
  }, [open, providerName, participantName]);

  const ready =
    providerSigner.trim() && participantSigner.trim() && provider.hasStroke && participant.hasStroke && confirmed;

  const submit = async () => {
    if (!ready) return;
    setSaving(true);
    try {
      await signAgreement(agreementId, {
        provider_name: providerSigner.trim(),
        provider_signature_png: provider.signaturePng,
        participant_name: participantSigner.trim(),
        participant_signature_png: participant.signaturePng,
      });
      toast({ title: "Agreement signed", description: "The signed copy is saved to the participant's record and the vault." });
      onSigned();
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Couldn't sign", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Sign {agreementNumber ?? "service agreement"}</DialogTitle>
          <DialogDescription>
            Go through the agreement with {participantName} (or their representative) before both of you sign.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs text-cc-muted" htmlFor="provider-signer">Provider signatory</label>
            <Input id="provider-signer" value={providerSigner} onChange={(e) => setProviderSigner(e.target.value)} />
            <SignatureCanvas minWidth={220} minHeight={90} onChange={provider.onCanvasChange} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-cc-muted" htmlFor="participant-signer">Participant or representative</label>
            <Input id="participant-signer" value={participantSigner} onChange={(e) => setParticipantSigner(e.target.value)} />
            <SignatureCanvas minWidth={220} minHeight={90} onChange={participant.onCanvasChange} />
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm text-cc-text">
          <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          The participant (or their representative) has read the agreement, understands it, and received a copy in a format
          they can use.
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!ready || saving}>{saving ? "Signing…" : "Sign agreement"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
