import { Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  remainingSeconds: number;
  onStaySignedIn: () => void;
};

export function IdleTimeoutModal({ open, remainingSeconds, onStaySignedIn }: Props) {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = String(remainingSeconds % 60).padStart(2, "0");
  return (
    <Dialog open={open}>
      <DialogContent className="rounded-2xl sm:max-w-md" hideCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1E1640]">
            <Clock size={18} className="text-[#F03060]" />
            You'll be logged out in 2 minutes
          </DialogTitle>
          <DialogDescription>
            You have been inactive. CareCliQ will sign you out to protect participant records.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-2xl bg-[#F5F3FC] px-5 py-4 text-center">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#7A6A9E]">Signing out in</p>
          <p className="mt-1 text-4xl font-black text-[#5533CC]">{minutes}:{seconds}</p>
        </div>
        <DialogFooter>
          <Button onClick={onStaySignedIn} className="w-full rounded-xl">
            Stay logged in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
