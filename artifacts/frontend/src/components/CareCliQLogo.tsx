import { CareCliQLogoSVG } from "./CareCliQLogoSVG";

interface CareCliQLogoProps {
  compact?: boolean;
  className?: string;
}

export function CareCliQLogo({ compact = false, className = "" }: CareCliQLogoProps) {
  return (
    <div
      className={`flex items-center select-none gap-2 ${compact ? "justify-center" : "justify-start"} ${className}`}
      title="CareCliQ"
      style={{ backgroundColor: "transparent" }}
    >
      <CareCliQLogoSVG size={compact ? 68 : 85} />
      {!compact && (
        <span
          className="font-black text-[18px] tracking-tight leading-none"
          style={{ color: "var(--cc-plum)", fontFamily: "var(--app-font-display)" }}
        >
          CareCliQ
        </span>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Small logo — collapsed sidebar icon
───────────────────────────────────────────────────────────── */

interface CareCliQLogoSmProps {
  className?: string;
}

export function CareCliQLogoSm({ className = "" }: CareCliQLogoSmProps) {
  return (
    <div className={`flex items-center select-none ${className}`} style={{ backgroundColor: "transparent" }}>
      <CareCliQLogoImage size={68} />
    </div>
  );
}
