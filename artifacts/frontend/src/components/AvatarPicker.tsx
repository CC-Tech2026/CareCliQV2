import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export interface AvatarDef {
  id: string;
  sheet: string;
  col: 0 | 1;
  row: 0 | 1;
}

export const AVATARS: AvatarDef[] = [
  // sheet-a: 4 female/mixed characters
  { id: "a0", sheet: "/avatars/sheet-a.png", col: 0, row: 0 },
  { id: "a1", sheet: "/avatars/sheet-a.png", col: 1, row: 0 },
  { id: "a2", sheet: "/avatars/sheet-a.png", col: 0, row: 1 },
  { id: "a3", sheet: "/avatars/sheet-a.png", col: 1, row: 1 },
  // sheet-b: 4 characters
  { id: "b0", sheet: "/avatars/sheet-b.png", col: 0, row: 0 },
  { id: "b1", sheet: "/avatars/sheet-b.png", col: 1, row: 0 },
  { id: "b2", sheet: "/avatars/sheet-b.png", col: 0, row: 1 },
  { id: "b3", sheet: "/avatars/sheet-b.png", col: 1, row: 1 },
  // sheet-c: 4 characters
  { id: "c0", sheet: "/avatars/sheet-c.png", col: 0, row: 0 },
  { id: "c1", sheet: "/avatars/sheet-c.png", col: 1, row: 0 },
  { id: "c2", sheet: "/avatars/sheet-c.png", col: 0, row: 1 },
  { id: "c3", sheet: "/avatars/sheet-c.png", col: 1, row: 1 },
  // sheet-d: 4 characters
  { id: "d0", sheet: "/avatars/sheet-d.png", col: 0, row: 0 },
  { id: "d1", sheet: "/avatars/sheet-d.png", col: 1, row: 0 },
  { id: "d2", sheet: "/avatars/sheet-d.png", col: 0, row: 1 },
  { id: "d3", sheet: "/avatars/sheet-d.png", col: 1, row: 1 },
  // sheet-e: 1 character
  { id: "e0", sheet: "/avatars/sheet-e.png", col: 0, row: 0 },
];

/** Returns inline style to render a single avatar from its sprite sheet */
export function getAvatarStyle(
  avatarId: string,
  sizePx = 40,
): React.CSSProperties | null {
  const def = AVATARS.find((a) => a.id === avatarId);
  if (!def) return null;
  return {
    backgroundImage: `url(${def.sheet})`,
    backgroundSize: "200% 200%",
    backgroundPosition: `${def.col * 100}% ${def.row * 100}%`,
    backgroundRepeat: "no-repeat",
    width: sizePx,
    height: sizePx,
    borderRadius: "50%",
    backgroundColor: "#111827",
    flexShrink: 0,
  };
}

interface AvatarPickerProps {
  value: string | null;
  onChange: (avatarId: string | null) => void;
  className?: string;
}

export function AvatarPicker({ value, onChange, className }: AvatarPickerProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid grid-cols-6 sm:grid-cols-9 gap-2">
        {AVATARS.map((av) => {
          const isSelected = value === av.id;
          return (
            <button
              key={av.id}
              type="button"
              onClick={() => onChange(isSelected ? null : av.id)}
              title={`Avatar ${av.id}`}
              className={cn(
                "relative rounded-full transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2",
                isSelected
                  ? "ring-2 ring-indigo-500 ring-offset-2 scale-110"
                  : "hover:scale-105 opacity-80 hover:opacity-100",
              )}
            >
              <div
                style={{
                  backgroundImage: `url(${av.sheet})`,
                  backgroundSize: "200% 200%",
                  backgroundPosition: `${av.col * 100}% ${av.row * 100}%`,
                  backgroundRepeat: "no-repeat",
                  width: 52,
                  height: 52,
                  borderRadius: "50%",
                  backgroundColor: "#111827",
                }}
              />
              {isSelected && (
                <span className="absolute -top-1 -right-1 h-4 w-4 bg-indigo-600 rounded-full flex items-center justify-center">
                  <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-[11px] text-slate-400 hover:text-red-500 transition-colors underline underline-offset-2"
        >
          Remove avatar
        </button>
      )}
    </div>
  );
}

/** Compact single avatar display (for sidebar, headers, etc.) */
export function AvatarDisplay({
  avatarId,
  sizePx = 36,
  fallback,
  className,
}: {
  avatarId?: string | null;
  sizePx?: number;
  fallback?: React.ReactNode;
  className?: string;
}) {
  const style = avatarId ? getAvatarStyle(avatarId, sizePx) : null;
  if (!style) return <>{fallback}</>;
  return (
    <div
      className={cn("shrink-0", className)}
      style={style}
    />
  );
}
