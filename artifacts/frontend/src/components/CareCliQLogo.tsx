import { CareCliQLogo as CareCliQLogoImage } from "./CareCliQLogoSVG";

interface CareCliQLogoProps {
  compact?: boolean;
  className?: string;
  logoSize?: number;
}

export function CareCliQLogo({ compact = false, className = "", logoSize }: CareCliQLogoProps) {
  const resolvedSize = logoSize ?? (compact ? 56 : 64);
  return (
    <div
      className={`flex items-center select-none gap-2 ${compact ? "justify-center" : "justify-start"} ${className}`}
      title="CareCliQ"
      style={{ backgroundColor: "transparent" }}
    >
      <CareCliQLogoImage size={resolvedSize} />
      {!compact && (
        <span
          className="font-black tracking-tight leading-none"
          style={{
            color: "var(--cc-plum)",
            fontFamily: "var(--app-font-display)",
            fontSize: resolvedSize <= 40 ? 14 : 18,
          }}
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
    <div className={`flex items-center select-none justify-center ${className}`} style={{ backgroundColor: "transparent" }}>
      <CareCliQLogoImage size={48} />
    </div>
  );
}
