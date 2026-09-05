import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { createCustomFolder } from "@/services/vaultService";

export function CreateFolderDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setLabel("");
    setDescription("");
  }

  async function handleSubmit() {
    if (!label.trim()) {
      toast({ title: "Give the folder a name", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await createCustomFolder(label.trim(), description.trim() || undefined);
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
