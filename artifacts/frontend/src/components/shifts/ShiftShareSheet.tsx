import { useEffect, useState } from "react";
import { Download, Mail, Share2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { downloadShiftExportFile, exportShiftPdf, shareShiftSummary } from "@/services/workerPerformanceService";
import { BORDER, CORAL, MUTED, PLUM, SOFT, TEXT } from "@/lib/shift-utils";


type Props = {
  shiftId: string;
  coordinatorEmail?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ShiftShareSheet({ shiftId, coordinatorEmail, open, onOpenChange }: Props) {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const [emailSelf, setEmailSelf] = useState(true);
  const [emailCoordinator, setEmailCoordinator] = useState(false);
  const [extraEmail, setExtraEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [resolvedCoordinatorEmail, setResolvedCoordinatorEmail] = useState<string | null>(
    coordinatorEmail ?? null,
  );

  useEffect(() => {
    setResolvedCoordinatorEmail(coordinatorEmail ?? null);
  }, [coordinatorEmail, shiftId]);

  useEffect(() => {
    if (!open) {
      setEmailSelf(true);
      setEmailCoordinator(false);
      setExtraEmail("");
    }
  }, [open]);

  async function handleDownload() {
    setBusy(true);
    try {
      const res = await exportShiftPdf(shiftId);
      if (res.export_id) {
        await downloadShiftExportFile(res.export_id, `shift-summary-${shiftId.slice(0, 8)}.pdf`);
      } else if (res.file_url) {
        window.open(res.file_url, "_blank");
      }
      toast({ title: "Download started" });
    } catch (e) {
      toast({
        title: "Download failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleShare() {
    setBusy(true);
    try {
      const additional = extraEmail
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await shareShiftSummary(shiftId, {
        email_self: emailSelf,
        email_coordinator: emailCoordinator,
        additional_recipients: additional,
      });
      if (!resolvedCoordinatorEmail && res.coordinator_emails?.[0]) {
        setResolvedCoordinatorEmail(res.coordinator_emails[0]);
      }
      toast({
        title: "Summary shared",
        description: `Sent to ${res.recipients.length} recipient(s).`,
      });
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Share failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-cc-text">
            <Share2 size={18} style={{ color: PLUM }} />
            {translate("share.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={handleDownload}
            disabled={busy}
          >
            <Download size={16} />
            {translate("share.download")}
          </Button>

          <div className="space-y-3 rounded-xl border border-cc-border p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-cc-muted">Email options</p>
            <label className="flex items-center gap-3 text-sm font-medium text-cc-text">
              <Checkbox checked={emailSelf} onCheckedChange={(v) => setEmailSelf(Boolean(v))} />
              <Mail size={16} className="text-cc-plum" />
              {translate("share.emailSelf")}
            </label>
            <div className="space-y-1">
              <label className="flex items-center gap-3 text-sm font-medium text-cc-text">
                <Checkbox
                  checked={emailCoordinator}
                  onCheckedChange={(v) => setEmailCoordinator(Boolean(v))}
                />
                <UserRound size={16} className="text-cc-plum" />
                {translate("share.emailCoordinator")}
              </label>
              {emailCoordinator && resolvedCoordinatorEmail && (
                <p className="pl-9 text-xs font-medium text-cc-muted">{resolvedCoordinatorEmail}</p>
              )}
              {emailCoordinator && !resolvedCoordinatorEmail && (
                <p className="pl-9 text-xs font-medium text-cc-muted">
                  Coordinator email will be resolved from your shift record.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="extra-recipients" className="text-xs text-cc-muted">
                Additional recipients (comma-separated)
              </Label>
              <Input
                id="extra-recipients"
                type="email"
                placeholder="colleague@example.com"
                value={extraEmail}
                onChange={(e) => setExtraEmail(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleShare}
            disabled={busy || (!emailSelf && !emailCoordinator && !extraEmail.trim())}
            style={{ background: PLUM }}
            className="text-white"
          >
            Send summary
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
