import { useEffect, useState } from "react";
import { Building2, FolderPlus, Users } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { FolderIcon } from "./FileManager";
import {
  ChoiceCard,
  Field,
  PanelFooter,
  PanelHeader,
  PrimaryButton,
  SecondaryButton,
  inputClass,
  textareaClass,
} from "./PanelKit";
import { useToast } from "@/hooks/use-toast";
import { createCustomFolder } from "@/services/vaultService";

type FolderGroup = "record" | "governance";

export function CreateFolderDialog({
  open,
  onOpenChange,
  onCreated,
  initialGroup = "record",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  initialGroup?: FolderGroup;
}) {
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [group, setGroup] = useState<FolderGroup>(initialGroup);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setGroup(initialGroup);
  }, [open, initialGroup]);

  function reset() {
    setLabel("");
    setDescription("");
    setGroup(initialGroup);
  }

  async function handleSubmit() {
    if (!label.trim()) {
      toast({ title: "Give the folder a name", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await createCustomFolder(label.trim(), description.trim() || undefined, group);
      toast({ title: "Folder created" });
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast({
        title: "Couldn't create the folder",
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
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-md">
        <SheetTitle className="sr-only">New folder</SheetTitle>
        <SheetDescription className="sr-only">Create a folder in the vault.</SheetDescription>
        <PanelHeader icon={FolderPlus} title="New folder" description="Keep documents that don't fit an existing folder together, ready to share." />

        <form
          id="create-folder-form"
          onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}
          className="mt-6 flex-1 space-y-5"
        >
          <div className="flex items-center gap-4 rounded-2xl p-4" style={{ background: "var(--cc-brand-purple-soft)" }}>
            <FolderIcon size={52} />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold" style={{ color: "var(--cc-text)" }}>
                {label.trim() || "Untitled folder"}
              </p>
              <p className="text-xs" style={{ color: "var(--cc-muted)" }}>
                {group === "record" ? "Records by type" : "Other governance folders"} · 0 files
              </p>
            </div>
          </div>

          <Field label="Folder name" htmlFor="new-folder-name">
            <input
              id="new-folder-name"
              autoFocus
              placeholder="e.g. Board meeting minutes"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className={inputClass}
              style={{ borderColor: "var(--cc-border)", color: "var(--cc-text)" }}
            />
          </Field>
          <Field label="What goes in here?" htmlFor="new-folder-description" optional>
            <textarea
              id="new-folder-description"
              rows={3}
              placeholder="A line for whoever opens this folder next"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={textareaClass}
              style={{ borderColor: "var(--cc-border)", color: "var(--cc-text)" }}
            />
          </Field>

          <div className="space-y-2" role="radiogroup" aria-label="Where does this folder belong?">
            <p className="text-sm font-medium" style={{ color: "var(--cc-text)" }}>Where does this belong?</p>
            <ChoiceCard
              selected={group === "record"}
              onSelect={() => setGroup("record")}
              icon={Users}
              title="Records by type"
              description="Documents tied to a participant or worker."
            />
            <ChoiceCard
              selected={group === "governance"}
              onSelect={() => setGroup("governance")}
              icon={Building2}
              title="Governance and policy"
              description="Business-level records for the whole organisation."
            />
          </div>
        </form>

        <PanelFooter>
          <SecondaryButton onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" form="create-folder-form" busy={submitting} disabled={!label.trim()}>
            <FolderPlus size={16} /> Create folder
          </PrimaryButton>
        </PanelFooter>
      </SheetContent>
    </Sheet>
  );
}
