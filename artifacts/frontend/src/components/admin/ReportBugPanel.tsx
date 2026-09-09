import { useEffect, useRef, useState } from "react";
import { Bug, Loader2, Paperclip, Video, X } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { readFileAsBase64 } from "@/lib/read-file-as-base64";
import { listAdminOrganizations, createAdminBugReport, type AdminOrgSummary, type BugReportSeverity } from "@/services/adminService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const AMBER = "#9A5B0A";
const CORAL = "var(--cc-coral)";

// Same shape/limits as the staff-facing form (settings.tsx's BugReportCard)
// — an admin's report goes through the same submission pipeline, just with
// an extra "who is this for" field neither staff form needs.
const MAX_ATTACHMENTS = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const ACCEPT = [...IMAGE_TYPES, ...VIDEO_TYPES].join(",");

const SEVERITY_OPTIONS: { value: BugReportSeverity; label: string; color: string }[] = [
  { value: "low", label: "Low", color: PLUM },
  { value: "medium", label: "Medium", color: AMBER },
  { value: "urgent", label: "Urgent", color: CORAL },
];

type PickedAttachment = { file: File; previewUrl: string | null };
type Scope = "internal" | "organization";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => void;
};

export function ReportBugPanel({ open, onOpenChange, onSubmitted }: Props) {
  const { toast } = useToast();
  const [orgs, setOrgs] = useState<AdminOrgSummary[] | null>(null);
  const [scope, setScope] = useState<Scope>("internal");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<BugReportSeverity>("low");
  const [attachments, setAttachments] = useState<PickedAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || orgs !== null) return;
    listAdminOrganizations()
      .then(setOrgs)
      .catch(() => setOrgs([]));
  }, [open, orgs]);

  function reset() {
    attachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
    setScope("internal");
    setOrganizationId(null);
    setDescription("");
    setSeverity("low");
    setAttachments([]);
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      toast({ title: `You can attach up to ${MAX_ATTACHMENTS} files`, variant: "destructive" });
      return;
    }
    const accepted: PickedAttachment[] = [];
    for (const file of incoming.slice(0, room)) {
      const isImage = IMAGE_TYPES.includes(file.type);
      const isVideo = VIDEO_TYPES.includes(file.type);
      if (!isImage && !isVideo) {
        toast({ title: `${file.name}: unsupported file type`, variant: "destructive" });
        continue;
      }
      const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
      if (file.size > maxBytes) {
        toast({ title: `${file.name}: exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit`, variant: "destructive" });
        continue;
      }
      accepted.push({ file, previewUrl: isImage ? URL.createObjectURL(file) : null });
    }
    if (accepted.length) setAttachments((prev) => [...prev, ...accepted]);
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  }

  const canSubmit = description.trim() !== "" && (scope === "internal" || organizationId !== null);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const uploaded = await Promise.all(
        attachments.map(async ({ file }) => ({ mime_type: file.type, data: await readFileAsBase64(file) })),
      );
      await createAdminBugReport(
        description.trim(),
        window.location.pathname,
        uploaded,
        severity,
        scope === "internal" ? null : organizationId,
      );
      toast({ title: "Bug report filed" });
      reset();
      onSubmitted();
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Couldn't file that report",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next); }}>
      <SheetContent
        side="right"
        className="inset-y-4 right-4 h-auto w-full flex-col gap-0 overflow-hidden rounded-3xl border p-0 shadow-2xl sm:max-w-lg flex"
        style={{ borderColor: BORDER }}
      >
        <div className="shrink-0 px-6 pb-4 pt-5" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <SheetTitle className="text-[18px] font-black" style={{ color: TEXT }}>Report a bug</SheetTitle>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="space-y-2">
            <label className="text-[12px] font-black" style={{ color: TEXT }}>Who is this for?</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setScope("internal")}
                className="rounded-xl border-2 p-2.5 text-left text-[12.5px] font-semibold"
                style={{
                  borderColor: scope === "internal" ? PLUM : BORDER,
                  background: scope === "internal" ? PLUM : "transparent",
                  color: scope === "internal" ? "#FFFFFF" : TEXT,
                }}
              >
                Internal
                <p className="mt-0.5 text-[11px] font-medium" style={{ color: scope === "internal" ? "rgba(255,255,255,0.85)" : MUTED }}>
                  Not tied to a provider
                </p>
              </button>
              <button
                type="button"
                onClick={() => setScope("organization")}
                className="rounded-xl border-2 p-2.5 text-left text-[12.5px] font-semibold"
                style={{
                  borderColor: scope === "organization" ? PLUM : BORDER,
                  background: scope === "organization" ? PLUM : "transparent",
                  color: scope === "organization" ? "#FFFFFF" : TEXT,
                }}
              >
                On behalf of a provider
                <p className="mt-0.5 text-[11px] font-medium" style={{ color: scope === "organization" ? "rgba(255,255,255,0.85)" : MUTED }}>
                  Pick which one
                </p>
              </button>
            </div>

            {scope === "organization" && (
              <Select value={organizationId ?? undefined} onValueChange={setOrganizationId}>
                <SelectTrigger className="h-11 rounded-xl border-0 text-[12px] shadow-none" style={{ background: SOFT }}>
                  <SelectValue placeholder={orgs === null ? "Loading organisations…" : "Choose an organisation"} />
                </SelectTrigger>
                <SelectContent>
                  {(orgs ?? []).map((o) => (
                    <SelectItem key={o.organization_id} value={o.organization_id}>{o.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-[12px] font-black" style={{ color: TEXT }}>Severity</label>
            <div className="grid grid-cols-3 gap-2">
              {SEVERITY_OPTIONS.map((opt) => {
                const selected = severity === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSeverity(opt.value)}
                    className="rounded-xl border-2 p-2.5 text-[12.5px] font-semibold"
                    style={{
                      borderColor: selected ? opt.color : BORDER,
                      background: selected ? opt.color : "transparent",
                      color: selected ? "#FFFFFF" : TEXT,
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[12px] font-black" style={{ color: TEXT }}>What happened?</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What happened, and what did you expect instead?"
              rows={5}
              className="resize-none text-[13px]"
              maxLength={5000}
            />
          </div>

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((a, i) => (
                <div
                  key={i}
                  className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border"
                  style={{ borderColor: BORDER, background: SOFT }}
                >
                  {a.previewUrl ? (
                    <img src={a.previewUrl} alt={a.file.name} className="h-full w-full object-cover" />
                  ) : (
                    <Video className="h-5 w-5" style={{ color: MUTED }} />
                  )}
                  <button
                    onClick={() => removeAttachment(i)}
                    className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => fileInputRef.current?.click()}
            disabled={attachments.length >= MAX_ATTACHMENTS}
          >
            <Paperclip className="h-3.5 w-3.5" />
            Add photo/video
          </Button>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-5 px-6 py-4" style={{ borderTop: `1px solid ${BORDER}` }}>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="text-[13px] font-semibold underline-offset-2 hover:underline disabled:opacity-50"
            style={{ color: TEXT }}
          >
            Cancel
          </button>
          <Button
            type="button"
            className="gap-1.5 rounded-full px-5"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bug className="h-3.5 w-3.5" />}
            File report
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
