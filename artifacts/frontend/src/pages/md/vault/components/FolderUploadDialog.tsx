import { useEffect, useState } from "react";
import { FilePlus2, History, Upload } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  ChoiceCard,
  DropZone,
  Field,
  PanelFooter,
  PanelHeader,
  PrimaryButton,
  SecondaryButton,
  inputClass,
  textareaClass,
} from "./PanelKit";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
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
  withWorkerVisibility = false,
  existingDocuments,
  onUpload,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderLabel: string;
  withDescription?: boolean;
  /** Only governance/policy folders offer this — a custom folder's files
   * aren't governance_documents rows, so there's nothing for a worker to
   * read/acknowledge. */
  withWorkerVisibility?: boolean;
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
    visibleToWorkers?: boolean;
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
  const [visibleToWorkers, setVisibleToWorkers] = useState(false);
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
    setVisibleToWorkers(false);
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
        visibleToWorkers: withWorkerVisibility ? visibleToWorkers : undefined,
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

  const fieldStyle = { borderColor: "var(--cc-border)", color: "var(--cc-text)" };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetTitle className="sr-only">Upload to {folderLabel}</SheetTitle>
        <SheetDescription className="sr-only">Add a document to this folder.</SheetDescription>
        <PanelHeader
          icon={Upload}
          title="Upload a file"
          description={<>Adding to <strong style={{ color: "var(--cc-text)" }}>{folderLabel}</strong></>}
        />

        <form
          id="folder-upload-form"
          onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}
          className="mt-6 flex-1 space-y-5"
        >
          {canReplace && (
            <div className="space-y-2" role="radiogroup" aria-label="New policy or new version">
              <ChoiceCard
                selected={mode === "new"}
                onSelect={() => setMode("new")}
                icon={FilePlus2}
                title="A new policy"
                description="Doesn't replace anything already in this folder."
              />
              <ChoiceCard
                selected={mode === "replace"}
                onSelect={() => setMode("replace")}
                icon={History}
                title="A new version"
                description="Replaces a policy. The previous version is kept as history."
              />
            </div>
          )}

          {mode === "replace" && (
            <Field
              label="Which policy is this replacing?"
              hint="Its title and description are copied in below. Edit them and attach the revised file."
            >
              <Select value={replaceId} onValueChange={setReplaceId}>
                <SelectTrigger className="h-11 rounded-xl px-4" aria-label="Policy being replaced">
                  <SelectValue placeholder="Choose a policy" />
                </SelectTrigger>
                <SelectContent>
                  {existingDocuments?.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <DropZone
            file={file}
            onFile={(f) => {
              setFile(f);
              // Name the document after its file if no title's been given yet.
              if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
            }}
            accept="application/pdf,image/jpeg,image/png"
            hint="PDF, JPG or PNG, up to 20 MB"
          />

          <Field label="Document title" htmlFor="upload-title">
            <input
              id="upload-title"
              placeholder="e.g. Incident management policy"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
              style={fieldStyle}
            />
          </Field>
          {withDescription && (
            <Field label="Description" htmlFor="upload-description" optional>
              <textarea
                id="upload-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={textareaClass}
                style={fieldStyle}
              />
            </Field>
          )}
          {canReplace && (
            <Field label="Version label" htmlFor="upload-version" optional>
              <input
                id="upload-version"
                placeholder="e.g. v2 2026"
                value={versionLabel}
                onChange={(e) => setVersionLabel(e.target.value)}
                className={inputClass}
                style={fieldStyle}
              />
            </Field>
          )}
          {withWorkerVisibility && (
            <label
              className="flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition hover:bg-cc-soft"
              style={{ borderColor: visibleToWorkers ? "var(--cc-brand-purple)" : "var(--cc-border)" }}
            >
              <Checkbox checked={visibleToWorkers} onCheckedChange={(v) => setVisibleToWorkers(v === true)} className="mt-0.5" />
              <span>
                <span className="block text-sm font-semibold" style={{ color: "var(--cc-text)" }}>
                  Share with workers
                </span>
                <span className="mt-0.5 block text-xs leading-5" style={{ color: "var(--cc-muted)" }}>
                  Staff can read this policy and acknowledge it. Off by default: turn on only for documents every worker
                  should read.
                </span>
              </span>
            </label>
          )}
        </form>

        <PanelFooter>
          <SecondaryButton onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" form="folder-upload-form" busy={submitting} disabled={!file || !title.trim()}>
            <Upload size={16} />
            {mode === "replace" ? "Upload new version" : "Upload file"}
          </PrimaryButton>
        </PanelFooter>
      </SheetContent>
    </Sheet>
  );
}
