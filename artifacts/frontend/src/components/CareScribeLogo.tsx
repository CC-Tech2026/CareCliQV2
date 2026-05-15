/**
 * CareScribeLogo — official brand PNG assets (transparent backgrounds).
 *
 * Sidebar: #F5F3FC background, 260px expanded / 88px collapsed.
 *
 * Swap is INSTANT (no CSS transition) — the sidebar width animation at
 * 300ms already provides a smooth visual; fading the logo on top just
 * felt sluggish. We simply show/hide the correct asset immediately.
 */

interface CareScribeLogoProps {
  compact?: boolean;
  className?: string;
}

export function CareScribeLogo({ compact = false, className = "" }: CareScribeLogoProps) {
  return (
    <div className={`flex items-center select-none ${className}`} title="CareScribe">
      {compact ? (
        /* Collapsed sidebar — CS monogram */
        <img
          key="cs"
          src="/cs.png"
          alt="CS"
          style={{ height: 46, width: 46, objectFit: "contain", display: "block" }}
        />
      ) : (
        /* Expanded sidebar — full wordmark */
        <img
          key="full"
          src="/carescribe_logo.png"
          alt="CareScribe"
          style={{ height: 36, width: "auto", maxWidth: 155, objectFit: "contain", display: "block" }}
        />
      )}
    </div>
  );
}

/** Mobile top bar — always full wordmark */
export function CareScribeLogoSm({ className = "" }: { className?: string }) {
  return (
    <img
      src="/carescribe_logo.png"
      alt="CareScribe"
      className={`select-none object-contain ${className}`}
      style={{ height: 28, width: "auto", maxWidth: 140 }}
    />
  );
}
