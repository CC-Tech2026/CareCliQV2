import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** A right-hand side panel in the director's layout: a fixed header, a body
 *  that scrolls, and a footer that stays put so its buttons are always in
 *  reach. Same structure as the participant record panels, and the same
 *  purple icon tile as the vault's PanelHeader when an icon is given. */
export function SidePanel({
  open,
  onOpenChange,
  icon: Icon,
  eyebrow,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon?: LucideIcon;
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
        <SheetHeader className="flex-row items-start gap-3.5 space-y-0 border-b border-cc-border p-5 pr-12 text-left">
          {Icon && (
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--cc-brand-purple-soft)] text-[var(--cc-brand-purple)]"
              aria-hidden="true"
            >
              <Icon size={19} />
            </span>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            {eyebrow && <p className="text-xs font-semibold text-[var(--cc-brand-purple)]">{eyebrow}</p>}
            <SheetTitle className="text-lg font-semibold leading-snug" style={{ fontFamily: "var(--app-font-display)" }}>
              {title}
            </SheetTitle>
            {description && <SheetDescription>{description}</SheetDescription>}
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">{children}</div>
        {footer && (
          <SheetFooter className="flex-row items-center justify-end gap-2 border-t border-cc-border p-4 sm:space-x-0">
            {footer}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
