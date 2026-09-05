import { useMemo, useState } from "react";
import { Download, Loader2, CheckCircle2, Mail, Circle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { buildVaultZip, triggerBlobDownload } from "@/lib/vaultZip";
import { logShareEvent, type DocRef } from "@/services/vaultService";

type Tab = "download" | "email" | "link";

function roleLabel(role: string): string {
  return role
    .split("_")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

export function ShareAuditorDialog({
  open,
  onOpenChange,
  documents,
  folderKeys,
  targetDescription,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documents: DocRef[];
  folderKeys: string[];
  targetDescription: string;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("download");

  const [packStage, setPackStage] = useState<"idle" | "generating" | "done">("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultFilename, setResultFilename] = useState("");

  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState(`CareCliQ audit records: ${targetDescription}`);
  const [message, setMessage] = useState(
    `Hi,\n\nPlease find the requested CareCliQ audit records attached, covering ${targetDescription}.\n\nDownload the pack from the vault and attach it here before sending.\n\nRegards,\n${user?.full_name || "CareCliQ"}${
      user?.role ? `, ${roleLabel(user.role)}` : ""
    }`
  );

  function resetPack() {
    setPackStage("idle");
    setProgress({ done: 0, total: 0 });
    setResultBlob(null);
    setResultFilename("");
  }

  function close(next: boolean) {
    if (!next) {
      resetPack();
      setTab("download");
    }
    onOpenChange(next);
  }

  async function handleDownloadPack() {
    if (documents.length === 0) return;
    setPackStage("generating");
    setProgress({ done: 0, total: documents.length });
    try {
      const { blob, documentCount } = await buildVaultZip(documents, setProgress);
      const filename = `carecliq-audit-pack-${new Date().toISOString().slice(0, 10)}.zip`;
      triggerBlobDownload(blob, filename);
      setResultBlob(blob);
      setResultFilename(filename);
      setPackStage("done");
      await logShareEvent({
        method: "download_zip",
        folder_keys: folderKeys,
        documents,
      }).catch(() => undefined);
      void documentCount;
    } catch (err) {
      toast({
        title: "Couldn't build the pack",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      resetPack();
    }
  }

  async function handleEmailClick(provider: "email_gmail" | "email_outlook" | "email_mailto") {
    if (!email.trim()) {
      toast({ title: "Enter the auditor's email first", variant: "destructive" });
      return;
    }
    const to = encodeURIComponent(email.trim());
    const su = encodeURIComponent(subject);
    const body = encodeURIComponent(message);
    let url = "";
    if (provider === "email_gmail") {
      url = `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${su}&body=${body}`;
    } else if (provider === "email_outlook") {
      url = `https://outlook.office.com/mail/deeplink/compose?to=${to}&subject=${su}&body=${body}`;
    } else {
      url = `mailto:${to}?subject=${su}&body=${body}`;
    }
    if (provider === "email_mailto") {
      window.location.href = url;
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    await logShareEvent({
      method: provider,
      folder_keys: folderKeys,
      documents,
      recipient_hint: email.trim(),
    }).catch(() => undefined);
  }

  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-[480px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Share with auditor</DialogTitle>
          <p className="text-[13px]" style={{ color: "var(--cc-muted)" }}>
            {targetDescription}
          </p>
        </DialogHeader>

        <div
          className="grid grid-cols-3 rounded-lg p-1 text-[12.5px] font-semibold"
          style={{ background: "var(--cc-soft)" }}
        >
          {(
            [
              ["download", "Download pack"],
              ["email", "Email auditor"],
              ["link", "Shareable link"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              disabled={key === "link"}
              onClick={() => setTab(key)}
              className="rounded-md py-2 disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: tab === key ? "var(--cc-bg)" : "transparent",
                color: tab === key ? "var(--cc-plum)" : "var(--cc-muted)",
              }}
            >
              {label}
              {key === "link" && <span className="ml-1 text-[10px]">(soon)</span>}
            </button>
          ))}
        </div>

        {tab === "download" && (
          <div className="mt-4 space-y-3">
            {packStage === "idle" && (
              <>
                <div
                  className="rounded-lg border px-3 py-2 text-[12.5px] font-semibold"
                  style={{ borderColor: "var(--cc-plum)", background: "var(--cc-active-bg)", color: "var(--cc-plum)" }}
                >
                  ZIP of originals ({documents.length} document{documents.length === 1 ? "" : "s"})
                </div>
                <Button
                  className="w-full gap-2"
                  disabled={documents.length === 0}
                  onClick={() => void handleDownloadPack()}
                  style={{ background: "var(--cc-plum)", color: "white" }}
                >
                  <Download size={15} />
                  Download pack
                </Button>
              </>
            )}

            {packStage === "generating" && (
              <div className="rounded-lg border p-3.5" style={{ background: "var(--cc-soft)", borderColor: "var(--cc-border)" }}>
                <div className="flex items-center gap-2 text-[12.5px] font-semibold">
                  <Loader2 size={14} className="animate-spin" style={{ color: "var(--cc-plum)" }} />
                  Compressing document {progress.done} of {progress.total}…
                </div>
                <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--cc-border)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${percent}%`, background: "var(--cc-plum)" }}
                  />
                </div>
                <p className="mt-2 text-[11.5px]" style={{ color: "var(--cc-muted)" }}>
                  {progress.done} of {progress.total} files compressed
                </p>
              </div>
            )}

            {packStage === "done" && (
              <div className="rounded-lg border p-3.5 space-y-1.5" style={{ background: "var(--cc-status-success-bg)", borderColor: "var(--cc-border)" }}>
                <div className="flex items-center gap-2 text-[13px] font-bold" style={{ color: "var(--cc-status-success)" }}>
                  <CheckCircle2 size={16} />
                  {resultFilename} downloaded
                </div>
                <p className="text-[11.5px]" style={{ color: "var(--cc-muted)" }}>
                  {documents.length} file{documents.length === 1 ? "" : "s"}
                  {resultBlob ? ` · ${(resultBlob.size / (1024 * 1024)).toFixed(2)} MB` : ""}
                </p>
                <button type="button" onClick={resetPack} className="text-[12.5px] font-bold underline" style={{ color: "var(--cc-plum)" }}>
                  Generate another
                </button>
              </div>
            )}
          </div>
        )}

        {tab === "email" && (
          <div className="mt-4 space-y-3">
            <p className="text-[11.5px]" style={{ color: "var(--cc-muted)" }}>
              CareCliQ doesn't send this email itself. This opens a prefilled draft in your own mail
              client, so download the pack from the first tab and attach it before sending.
            </p>
            <Input placeholder="Auditor's email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
            <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <Textarea rows={6} value={message} onChange={(e) => setMessage(e.target.value)} />
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" onClick={() => void handleEmailClick("email_gmail")}>
                Gmail
              </Button>
              <Button variant="outline" onClick={() => void handleEmailClick("email_outlook")}>
                Outlook
              </Button>
              <Button variant="outline" className="gap-1.5" onClick={() => void handleEmailClick("email_mailto")}>
                <Mail size={13} />
                Mail app
              </Button>
            </div>
          </div>
        )}

        {tab === "link" && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border p-3.5 text-[12.5px]" style={{ color: "var(--cc-muted)" }}>
            <Circle size={14} />
            Expiring shareable links are coming soon. They'll require the auditor to verify a one-time
            code emailed to them before any document is shown.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
