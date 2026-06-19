import { useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/PasswordInput";

type Props = {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (password: string) => void;
};

export function ReAuthModal({ open, busy, error, onCancel, onSubmit }: Props) {
  const [password, setPassword] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password) onSubmit(password);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1E1640]">
            <ShieldCheck size={18} className="text-[#5533CC]" />
            Confirm your identity
          </DialogTitle>
          <DialogDescription>
            This action affects sensitive CareCliQ records. Re-enter your password to continue.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <PasswordInput
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            disabled={busy}
            placeholder="Current password"
            className="rounded-xl"
          />
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy} className="rounded-xl">
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !password} className="rounded-xl gap-2">
              {busy && <Loader2 size={14} className="animate-spin" />}
              Continue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
