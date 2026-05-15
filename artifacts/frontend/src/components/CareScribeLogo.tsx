/**
 * CareScribeLogo — uses the official brand PNGs (transparent backgrounds).
 *
 * Sidebar context: background #F7F5FA (soft lavender-white), 260px expanded / 88px collapsed.
 *
 * Exports:
 *  CareScribeLogo   — desktop sidebar (compact prop switches CS badge ↔ full wordmark)
 *  CareScribeLogoSm — mobile top bar (always full wordmark, slightly smaller)
 */

interface CareScribeLogoProps {
  compact?: boolean;
  className?: string;
}

export function CareScribeLogo({ compact = false, className = "" }: CareScribeLogoProps) {
  return (
    <div className={`relative flex items-center select-none ${className}`} title="CareScribe">

      {/* Full wordmark — expanded sidebar */}
      <img
        src="/carescribe_logo.png"
        alt="CareScribe"
        style={{
          height: 36,
          width: "auto",
          maxWidth: 160,
          objectFit: "contain",
          opacity: compact ? 0 : 1,
          transform: compact ? "scale(0.88)" : "scale(1)",
          transition: "opacity 0.25s ease, transform 0.25s ease",
          position: compact ? "absolute" : "relative",
          pointerEvents: compact ? "none" : "auto",
        }}
      />

      {/* CS monogram — collapsed sidebar */}
      <img
        src="/cs.png"
        alt="CS"
        style={{
          height: 46,
          width: 46,
          objectFit: "contain",
          opacity: compact ? 1 : 0,
          transform: compact ? "scale(1)" : "scale(0.75)",
          transition: "opacity 0.25s ease, transform 0.25s ease",
          position: compact ? "relative" : "absolute",
          pointerEvents: compact ? "auto" : "none",
        }}
      />
    </div>
  );
}

/** Mobile top bar — always full wordmark, white background context */
export function CareScribeLogoSm({ className = "" }: { className?: string }) {
  return (
    <img
      src="/carescribe_logo.png"
      alt="CareScribe"
      className={`select-none object-contain ${className}`}
      style={{ height: 30, width: "auto", maxWidth: 150 }}
    />
  );
}
