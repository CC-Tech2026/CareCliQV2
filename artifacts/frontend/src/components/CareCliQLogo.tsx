interface CareCliQLogoProps {
  compact?: boolean;
  className?: string;
}

export function CareCliQLogo({ compact = false, className = "" }: CareCliQLogoProps) {
  return (
    <div
      className={`flex items-center select-none gap-2 ${compact ? "justify-center" : "justify-start"} ${className}`}
      title="CareCliQ"
    >
      <img
        src="/carecliQ_logo_new.png"
        alt="CareCliQ"
        className="object-contain shrink-0 transition-opacity duration-150"
        style={{ height: compact ? 32 : 42, width: compact ? 32 : 42 }}
      />
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
    <div className={`flex items-center select-none ${className}`}>
      <img
        src="/carecliQ_logo_new.png"
        alt="CareCliQ"
        className="object-contain shrink-0"
        style={{ height: 32, width: 32 }}
      />
    </div>
  );
}
