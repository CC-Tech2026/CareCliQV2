import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** A right-hand side panel in the director's layout: a fixed header, a body
 *  that scrolls, and a footer that stays put so its buttons are always in
 *  reach. Same structure as the participant record panels. */
export function SidePanel({
  open,
  onOpenChange,
  eyebrow,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A short line above the title, e.g. the kind of record. */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={`flex w-full flex-col gap-0 p-0 ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}>
        <SheetHeader className="space-y-1 border-b border-cc-border p-5 pr-12 text-left">
          {eyebrow && <p className="text-xs font-semibold text-[var(--cc-brand-purple)]">{eyebrow}</p>}
          <SheetTitle className="text-lg font-semibold leading-snug" style={{ fontFamily: "var(--app-font-display)" }}>
            {title}
          </SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">{children}</div>
        {footer && (
          <SheetFooter className="flex-row items-center gap-2 border-t border-cc-border p-4 sm:space-x-0">
            {footer}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
