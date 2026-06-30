import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
};

export function WorkerMobileShiftBackLink({ className }: Props) {
  const { translate } = useAccessibility();

  return (
    <Link
      href="/my-shifts"
      className={cn(
        "inline-flex items-center gap-1.5 text-[13px] font-semibold transition-opacity hover:opacity-80 text-cc-plum",
        className,
      )}
    >
      <ArrowLeft size={15} strokeWidth={2.25} aria-hidden />
      {translate("shift.briefing.backToList")}
    </Link>
  );
}
