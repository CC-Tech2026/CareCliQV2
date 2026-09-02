import { Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type Props = {
  open: boolean;
  remainingSeconds: number;
  onStaySignedIn: () => void;
};

export function IdleTimeoutModal({ open, remainingSeconds, onStaySignedIn }: Props) {
  const { translate } = useAccessibility();
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = String(remainingSeconds % 60).padStart(2, "0");
  return (
    <Dialog open={open}>
      <DialogContent className="rounded-2xl sm:max-w-md" hideCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1A1A2E]">
            <Clock size={18} className="text-[#7C3AED]" />
            {translate("auth.idle.title")}
          </DialogTitle>
          <DialogDescription>
            {translate("auth.idle.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-2xl bg-[#ECECEC] px-5 py-4 text-center">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#6A6A77]">{translate("auth.idle.countdown")}</p>
          <p className="mt-1 text-4xl font-black text-[#E8457A]">{minutes}:{seconds}</p>
        </div>
        <DialogFooter>
          <Button onClick={onStaySignedIn} className="w-full rounded-xl">
            {translate("auth.idle.staySignedIn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
