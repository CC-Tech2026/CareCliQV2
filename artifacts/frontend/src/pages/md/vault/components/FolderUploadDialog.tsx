import { useEffect, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export interface ExistingFolderDocument {
  id: string;
  title: string;
  description?: string;
}

/** Generic upload panel reused by both governance-policy folders (which
 * take an optional description, and — when existingDocuments is passed —
 * a "new version of an existing policy" flow) and MD-created custom
 * folders (title only, no versioning) — the two backends differ slightly,
 * so the actual upload call is passed in rather than hardcoded here. */
export function FolderUploadDialog({
  open,
  onOpenChange,
  folderLabel,
  withDescription = true,
  existingDocuments,
  onUpload,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderLabel: string;
  withDescription?: boolean;
  /** When provided (non-empty), the dialog offers "replace an existing
   * policy" — picking one clones its title/description into the form as a
   * starting point and, on submit, marks that document superseded by this
   * new upload instead of leaving two unrelated documents sitting side by
   * side. */
  existingDocuments?: ExistingFolderDocument[];
  onUpload: (params: {
    title: string;
    description?: string;
    file: File;
    supersedesDocumentId?: string;
    versionLabel?: string;
  }) => Promise<unknown>;
  onUploaded: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"new" | "replace">("new");
  const [replaceId, setReplaceId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [versionLabel, setVersionLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canReplace = (existingDocuments?.length ?? 0) > 0;

  useEffect(() => {
    if (mode !== "replace" || !replaceId) return;
    const source = existingDocuments?.find((d) => d.id === replaceId);
    if (source) {
      setTitle(source.title);
      setDescription(source.description ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, replaceId]);

  function reset() {
    setMode("new");
    setReplaceId("");
    setTitle("");
    setDescription("");
    setVersionLabel("");
    setFile(null);
  }

  async function handleSubmit() {
    if (!title.trim() || !file) {
      toast({ title: "Add a title and choose a file", variant: "destructive" });
      return;
    }
    if (mode === "replace" && !replaceId) {
      toast({ title: "Choose which policy this replaces", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await onUpload({
        title: title.trim(),
        description: description.trim() || undefined,
        file,
        supersedesDocumentId: mode === "replace" ? replaceId : undefined,
        versionLabel: versionLabel.trim() || undefined,
      });
      toast({ title: mode === "replace" ? "New version uploaded" : "Document uploaded" });
      reset();
      onOpenChange(false);
      onUploaded();
    } catch (err) {
      toast({
        title: "Couldn't upload the document",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Upload to {folderLabel}</SheetTitle>
        </SheetHeader>
        <div className="mt-5 space-y-3">
          {canReplace && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("new")}
                className="rounded-lg border p-2.5 text-left"
                style={{
                  borderColor: mode === "new" ? "var(--cc-plum)" : "var(--cc-border)",
                  background: mode === "new" ? "var(--cc-active-bg)" : "transparent",
                }}
              >
                <p className="text-[12.5px] font-bold" style={{ color: "var(--cc-text)" }}>
                  New policy
                </p>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--cc-muted)" }}>
                  Doesn't replace anything
                </p>
              </button>
              <button
                type="button"
                onClick={() => setMode("replace")}
                className="rounded-lg border p-2.5 text-left"
                style={{
                  borderColor: mode === "replace" ? "var(--cc-plum)" : "var(--cc-border)",
                  background: mode === "replace" ? "var(--cc-active-bg)" : "transparent",
                }}
              >
                <p className="text-[12.5px] font-bold" style={{ color: "var(--cc-text)" }}>
                  New version
                </p>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--cc-muted)" }}>
                  Replaces an existing policy
                </p>
              </button>
            </div>
          )}

          {mode === "replace" && (
            <div>
              <Select value={replaceId} onValueChange={setReplaceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Which policy is this replacing?" />
                </SelectTrigger>
                <SelectContent>
                  {existingDocuments?.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-[11px]" style={{ color: "var(--cc-muted)" }}>
                Its title and description are copied in below — edit them and attach the revised file. The
                previous version is kept, not deleted, and stays available as history.
              </p>
            </div>
          )}

          <Input placeholder="Document title" value={title} onChange={(e) => setTitle(e.target.value)} />
          {withDescription && (
            <Textarea
              rows={3}
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
          {canReplace && (
            <Input
              placeholder="Version label (optional, e.g. v2 2026)"
              value={versionLabel}
              onChange={(e) => setVersionLabel(e.target.value)}
            />
          )}
          <label
            className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed py-6 text-[12.5px] font-semibold"
            style={{ borderColor: "var(--cc-border)", color: "var(--cc-muted)" }}
          >
            <Upload size={15} />
            {file ? file.name : "Choose a PDF or image, max 20MB"}
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <SheetFooter className="mt-5">
          <Button
            disabled={submitting}
            className="w-full gap-2"
            onClick={() => void handleSubmit()}
            style={{ background: "var(--cc-plum)", color: "white" }}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {mode === "replace" ? "Upload new version" : "Upload document"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
