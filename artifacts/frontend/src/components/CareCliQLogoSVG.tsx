/**
 * CareCliQ Logo Component
 * Uses PNG image from public folder with transparent background
 * Scales proportionally with object-contain to prevent distortion or overflow
 */

export function CareCliQLogo({ size = 64, className = "" }: { size?: number; className?: string }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
      className={className}
    >
      <img
        src="/carecliQ_logo_new.png"
        alt="CareCliQ"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          objectPosition: "center",
        }}
        draggable={false}
      />
    </div>
  );
}

export function CareCliQLogoWithText({ size = 64, className = "" }: { size?: number; className?: string }) {
  const textSize = Math.max(12, Math.floor(size / 3));
  return (
    <div className={`flex items-center gap-2.5 ${className}`} style={{ backgroundColor: "transparent" }}>
      <CareCliQLogo size={size} />
      <span
        className="font-black tracking-tight"
        style={{
          fontSize: `${textSize}px`,
          color: "#7C3AED",
        }}
      >
        CareCliQ
      </span>
    </div>
  );
}
