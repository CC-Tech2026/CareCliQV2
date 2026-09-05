import { useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

/** Generic upload panel reused by both governance-policy folders (which
 * take an optional description) and MD-created custom folders (title only)
 * — the two backends differ slightly, so the actual upload call is passed
 * in rather than hardcoded here. */
export function FolderUploadDialog({
  open,
  onOpenChange,
  folderLabel,
  withDescription = true,
  onUpload,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderLabel: string;
  withDescription?: boolean;
  onUpload: (params: { title: string; description?: string; file: File }) => Promise<unknown>;
  onUploaded: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setTitle("");
    setDescription("");
    setFile(null);
  }

  async function handleSubmit() {
    if (!title.trim() || !file) {
      toast({ title: "Add a title and choose a file", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await onUpload({ title: title.trim(), description: description.trim() || undefined, file });
      toast({ title: "Document uploaded" });
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
          <Input placeholder="Document title" value={title} onChange={(e) => setTitle(e.target.value)} />
          {withDescription && (
            <Textarea
              rows={3}
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
            Upload document
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
