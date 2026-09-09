import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

export function TrainingPanel({
  title,
  description,
  onClose,
  children,
  footer,
  variant = "editor",
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  variant?: "editor" | "course";
}) {
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="flex h-dvh w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <header className={variant === "course" ? "sr-only" : "shrink-0 border-b bg-card px-6 py-5 pr-14"}>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
            Learning & development
          </p>
          <SheetTitle className="text-xl leading-snug">{title}</SheetTitle>
          <SheetDescription className="mt-2 text-sm">
            {description}
          </SheetDescription>
        </header>
        <div className={variant === "course" ? "min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#faf6f8]" : "min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/20 p-5 sm:p-6"}>
          {children}
        </div>
        {footer && (
          <footer className="shrink-0 border-t bg-card px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </footer>
        )}
      </SheetContent>
    </Sheet>
  );
}
