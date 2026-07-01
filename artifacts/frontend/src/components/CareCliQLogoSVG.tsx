/**
 * CareCliQ Logo Component
 * Uses image from public folder with transparent background
 */

export function CareCliQLogoSVG({ size = 64, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src="/carecliQ_logo_new.jpeg"
      alt="CareCliQ"
      width={size}
      height={size}
      className={className}
    />
  );
}

export function CareCliQLogoWithText({ size = 64, className = "" }: { size?: number; className?: string }) {
  const textSize = Math.max(12, Math.floor(size / 3));
  return (
    <div className={`flex items-center gap-2.5 ${className}`} style={{ backgroundColor: "transparent" }}>
      <CareCliQLogoSVG size={size} />
      <span
        className="font-black tracking-tight"
        style={{
          fontSize: `${textSize}px`,
          background: "linear-gradient(135deg, #E94B8C 0%, #6B3FA0 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        }}
      >
        CareCliQ
      </span>
    </div>
  );
}
