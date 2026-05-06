import React from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

/* -----------------------------
   Avatar Definitions
------------------------------ */

export interface AvatarDef {
  id: string;
  sheet: string;
  col: 0 | 1;
  row: 0 | 1;
}

export const AVATARS: AvatarDef[] = [
  { id: "a0", sheet: "/avatars/sheet-a.png", col: 0, row: 0 },
  { id: "a1", sheet: "/avatars/sheet-a.png", col: 1, row: 0 },
  { id: "a2", sheet: "/avatars/sheet-a.png", col: 0, row: 1 },
  { id: "a3", sheet: "/avatars/sheet-a.png", col: 1, row: 1 },

  { id: "b0", sheet: "/avatars/sheet-b.png", col: 0, row: 0 },
  { id: "b1", sheet: "/avatars/sheet-b.png", col: 1, row: 0 },
  { id: "b2", sheet: "/avatars/sheet-b.png", col: 0, row: 1 },
  { id: "b3", sheet: "/avatars/sheet-b.png", col: 1, row: 1 },

  { id: "c0", sheet: "/avatars/sheet-c.png", col: 0, row: 0 },
  { id: "c1", sheet: "/avatars/sheet-c.png", col: 1, row: 0 },
  { id: "c2", sheet: "/avatars/sheet-c.png", col: 0, row: 1 },
  { id: "c3", sheet: "/avatars/sheet-c.png", col: 1, row: 1 },

  { id: "d0", sheet: "/avatars/sheet-d.png", col: 0, row: 0 },
  { id: "d1", sheet: "/avatars/sheet-d.png", col: 1, row: 0 },
  { id: "d2", sheet: "/avatars/sheet-d.png", col: 0, row: 1 },
  { id: "d3", sheet: "/avatars/sheet-d.png", col: 1, row: 1 },

  { id: "e0", sheet: "/avatars/sheet-e.png", col: 0, row: 0 },
];

/* -----------------------------
   Avatar Style (FIXED CENTERING)
------------------------------ */

export function getAvatarStyle(
  avatar: AvatarDef,
  size = 48,
): React.CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: "50%",
    overflow: "hidden",
    position: "relative",
    backgroundColor: "#0f172a",
  };
}

export function getAvatarInnerStyle(avatar: AvatarDef): React.CSSProperties {
  return {
    position: "absolute",
    width: "200%",
    height: "200%",
    backgroundImage: `url(${avatar.sheet})`,
    backgroundRepeat: "no-repeat",
    backgroundSize: "100% 100%",
    left: avatar.col === 0 ? "0%" : "-100%",
    top: avatar.row === 0 ? "0%" : "-100%",
  };
}

/* -----------------------------
   Avatar Component
------------------------------ */

function AvatarItem({
  avatar,
  selected,
  onClick,
}: {
  avatar: AvatarDef;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative transition-all duration-200 rounded-full",
        "flex items-center justify-center",
        selected ? "scale-105" : "hover:scale-105 opacity-80 hover:opacity-100",
      )}
    >
      {/* Outer Frame */}
      <div
        style={getAvatarStyle(avatar, 52)}
        className={cn(
          "ring-1 ring-slate-700",
          selected && "ring-2 ring-indigo-500 shadow-md shadow-indigo-500/30",
        )}
      >
        {/* Inner Sprite (Centered properly) */}
        <div style={getAvatarInnerStyle(avatar)} />
      </div>

      {/* Selected Indicator */}
      {selected && (
        <div className="absolute -top-1 -right-1 bg-indigo-600 rounded-full p-[2px] shadow">
          <Check className="w-3 h-3 text-white" strokeWidth={3} />
        </div>
      )}
    </button>
  );
}

/* -----------------------------
   Avatar Picker
------------------------------ */

/* -----------------------------
   Avatar Display (single avatar by id, with fallback)
------------------------------ */

export function AvatarDisplay({
  avatarId,
  sizePx = 40,
  fallback,
}: {
  avatarId?: string | null;
  sizePx?: number;
  fallback?: React.ReactNode;
}) {
  const avatar = avatarId ? AVATARS.find((a) => a.id === avatarId) : null;
  if (!avatar) return <>{fallback ?? null}</>;
  return (
    <div
      style={{ ...getAvatarStyle(avatar, sizePx), borderRadius: "50%" }}
      className="overflow-hidden flex-shrink-0"
    >
      <div
        style={{
          position: "absolute",
          width: "200%",
          height: "200%",
          backgroundImage: `url(${avatar.sheet})`,
          backgroundRepeat: "no-repeat",
          backgroundSize: "100% 100%",
          left: avatar.col === 0 ? "0%" : "-100%",
          top: avatar.row === 0 ? "0%" : "-100%",
        }}
      />
    </div>
  );
}

/* -----------------------------
   Avatar Picker
------------------------------ */

export function AvatarPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Title */}
      <div>
        <p className="text-sm font-medium text-white">Choose Avatar</p>
        <p className="text-xs text-slate-400">
          Used when no profile image is set
        </p>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 gap-3">
        {AVATARS.map((av) => (
          <AvatarItem
            key={av.id}
            avatar={av}
            selected={value === av.id}
            onClick={() => onChange(av.id)}
          />
        ))}
      </div>
    </div>
  );
}
