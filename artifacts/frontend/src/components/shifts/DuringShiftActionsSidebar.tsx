import { useCallback, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, MessageSquare, Phone, PhoneCall, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const DEFAULT_OFFICE_PHONE = "1300 000 000";

type Props = {
  onMessageOffice: () => void;
  officePhone?: string;
  className?: string;
  /** Pin between viewport edges (mobile session) instead of vertical center */
  pinned?: boolean;
};

type ActionItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  accent: string;
  onClick?: () => void;
  href?: string;
};

function SidebarAction({
  item,
  onActivate,
}: {
  item: ActionItem;
  onActivate: () => void;
}) {
  const Icon = item.icon;

  const inner = (
    <>
      <span className="min-w-0 flex-1 truncate text-left text-[10px] font-semibold leading-tight text-cc-text">
        {item.label}
      </span>
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white"
        style={{ background: item.accent }}
      >
        <Icon size={14} strokeWidth={2.25} />
      </span>
    </>
  );

  const rowClass =
    "flex w-full items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-cc-soft/80";

  if (item.href) {
    return (
      <a href={item.href} onClick={onActivate} className={rowClass} aria-label={item.label}>
        {inner}
      </a>
    );
  }

  return (
    <button type="button" onClick={onActivate} className={rowClass} aria-label={item.label}>
      {inner}
    </button>
  );
}

export function DuringShiftActionsSidebar({
  onMessageOffice,
  officePhone,
  className,
  pinned = false,
}: Props) {
  const { translate } = useAccessibility();
  const [expanded, setExpanded] = useState(false);
  const resolvedOfficePhone = (officePhone || DEFAULT_OFFICE_PHONE).replace(/\s/g, "");

  const collapse = useCallback(() => setExpanded(false), []);

  const handleMessageOffice = useCallback(() => {
    collapse();
    onMessageOffice();
  }, [collapse, onMessageOffice]);

  const actions: ActionItem[] = useMemo(
    () => [
      {
        id: "message",
        label: translate("shift.during.messageOffice"),
        icon: MessageSquare,
        accent: "var(--cc-plum)",
        onClick: handleMessageOffice,
      },
      {
        id: "call",
        label: translate("shift.during.callOffice"),
        icon: PhoneCall,
        accent: "var(--wm-green)",
        href: `tel:${resolvedOfficePhone}`,
      },
      {
        id: "emergency",
        label: translate("shift.during.emergency"),
        icon: Phone,
        accent: "var(--wm-red)",
        href: "tel:000",
      },
    ],
    [handleMessageOffice, resolvedOfficePhone, translate],
  );

  return (
    <aside
      className={cn(
        "fixed right-0 z-40 flex transition-[width] duration-300 ease-out",
        expanded ? "w-[11.25rem]" : "w-6",
        pinned ? "top-14 bottom-24 items-center" : "top-1/2 -translate-y-1/2",
        className,
      )}
      data-tutorial="during-shift-sidebar"
      aria-label={translate("shift.during.quickActions")}
    >
      <div
        className={cn(
          "flex w-full flex-col overflow-hidden rounded-l-xl border-l border-cc-border/50",
          "bg-card/55 shadow-[var(--cc-shadow-sm)] backdrop-blur-[3px]",
        )}
      >
        {expanded && (
          <>
            <div className="border-b border-cc-border/40 px-2.5 py-2">
              <p className="text-[9px] font-black uppercase tracking-wider text-cc-muted">
                {translate("shift.during.quickActions")}
              </p>
            </div>

            <div className="flex flex-col gap-0.5 p-1.5">
              {actions.map((item) => (
                <SidebarAction
                  key={item.id}
                  item={item}
                  onActivate={() => {
                    item.onClick?.();
                    if (item.href) collapse();
                  }}
                />
              ))}
            </div>
          </>
        )}

        <div
          className={cn(
            "flex justify-center border-cc-border/40 p-1",
            expanded ? "border-t px-1.5" : "border-0 py-0.5",
          )}
        >
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className={cn(
              "flex items-center justify-center rounded-md text-cc-muted transition-colors",
              "hover:bg-cc-soft/60 hover:text-cc-plum",
              expanded ? "h-7 w-full gap-1" : "h-12 w-4",
            )}
            aria-expanded={expanded}
            aria-label={expanded ? translate("shift.during.closeActions") : translate("shift.during.openActions")}
          >
            {expanded ? (
              <>
                <ChevronRight size={11} strokeWidth={1.75} />
                <span className="text-[10px] font-semibold">{translate("shift.during.closeActions")}</span>
              </>
            ) : (
              <ChevronLeft size={10} strokeWidth={1.5} />
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}
