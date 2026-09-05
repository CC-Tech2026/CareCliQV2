import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>New folder</SheetTitle>
        </SheetHeader>
        <div className="mt-5 space-y-3">
          <Input placeholder="Folder name" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
          <Textarea
            rows={3}
            placeholder="What goes in here? (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <div>
            <p className="mb-1.5 text-[12px] font-bold" style={{ color: "var(--cc-text)" }}>
              Where does this belong?
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setGroup("record")}
                className="rounded-lg border p-2.5 text-left"
                style={{
                  borderColor: group === "record" ? "var(--cc-plum)" : "var(--cc-border)",
                  background: group === "record" ? "var(--cc-active-bg)" : "transparent",
                }}
              >
                <p className="text-[12.5px] font-bold" style={{ color: "var(--cc-text)" }}>
                  Record type
                </p>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--cc-muted)" }}>
                  Tied to a participant or worker
                </p>
              </button>
              <button
                type="button"
                onClick={() => setGroup("governance")}
                className="rounded-lg border p-2.5 text-left"
                style={{
                  borderColor: group === "governance" ? "var(--cc-plum)" : "var(--cc-border)",
                  background: group === "governance" ? "var(--cc-active-bg)" : "transparent",
                }}
              >
                <p className="text-[12.5px] font-bold" style={{ color: "var(--cc-text)" }}>
                  Governance & policy
                </p>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--cc-muted)" }}>
                  Business-level, org-wide
                </p>
              </button>
            </div>
          </div>
        </div>
        <SheetFooter className="mt-5">
          <Button
            disabled={submitting}
            className="w-full gap-2"
            onClick={() => void handleSubmit()}
            style={{ background: "var(--cc-plum)", color: "white" }}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Create folder
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
