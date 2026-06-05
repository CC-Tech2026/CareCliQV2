interface CareCliQLogoProps {
  compact?: boolean;
  className?: string;
}

export function CareCliQLogo({
  compact = false,
  className = "",
}: CareCliQLogoProps) {
  return (
    <div
      className={`
        flex items-center
        overflow-visible
        select-none
        ${compact ? "justify-center" : "justify-start"}
        ${className}
      `}
      title="CareCliQ"
    >
      {compact ? (
        <img
          src="/cs.png"
          alt="CS"
          className="
            object-contain
            shrink-0
            transition-all duration-1000 ease-out
            hover:scale-[1.03]
          "
          style={{
            height: 48,
            width: 48,
          }}
        />
      ) : (
        <img
          src="/logo.png"
          alt="CareCliQ"
          className="
            object-contain
            shrink-0
            transition-all duration-1000 ease-out
            max-h-full
          "
          style={{
            height: "clamp(50px, 3.2vh, 64px)", // 👈 responsive scaling (key upgrade)
            width: "auto",
            maxWidth: 180,
          }}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────
   Mobile Logo
────────────────────────────────────────── */

interface CareCliQLogoSmProps {
  className?: string;
}

export function CareCliQLogoSm({ className = "" }: CareCliQLogoSmProps) {
  return (
    <div
      className={`
        flex items-center
        select-none
        overflow-visible
        ${className}
      `}
    >
      <img
        src="/logo.png"
        alt="CareCliQ"
        className="
          object-contain
          shrink-0
          transition-all duration-200 ease-out
        "
        style={{
          height: 40,
          width: "auto",
          maxWidth: 150,
        }}
      />
    </div>
  );
}
