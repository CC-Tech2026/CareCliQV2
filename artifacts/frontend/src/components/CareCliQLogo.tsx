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
          src="/carecliQ_logo.png"
          alt="CS"
          className="
            object-contain
            shrink-0
            transition-all duration-1000 ease-out
            hover:scale-[1.03]
          "
          style={{
            height: 70,
            width: 70,
          }}
        />
      ) : (
        <img
          src="/carecliQ_logo.png"
          alt="CareCliQ"
          className="
            object-contain
            shrink-0
            transition-all duration-1000 ease-out
            max-h-full
          "
          style={{
            height: "clamp(45px, 5vh, 150px)",
            width: "auto",
            maxWidth: 200,
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
        src="/carecliQ_logo.png"
        alt="CareCliQ"
        className="
          object-contain
          shrink-0
          transition-all duration-200 ease-out
        "
        style={{
          height: 100,
          width: "auto",
          maxWidth: 180,
        }}
      />
    </div>
  );
}
