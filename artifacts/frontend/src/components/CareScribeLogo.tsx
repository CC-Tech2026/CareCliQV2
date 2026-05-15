/**
 * CareScribeLogo — brand mark component
 *
 * Sidebar palette context:
 *   background  #F7F5FA  (soft lavender-white)
 *   text        #3B2E42  (dark plum)
 *   accent      #6A407D  (plum)
 *   coral       #FF8FA3
 *   muted       #9A8C9E
 *
 * Three exports:
 *  CareScribeLogo         — sidebar (compact=false → full; compact=true → CS badge)
 *  CareScribeLogoSm       — mobile top bar (white bg, slightly smaller)
 */

// ── Shared gradient id ────────────────────────────────────────────────────────
// Using a unique id per usage to avoid SVG gradient collision across instances.
let _uid = 0;
function uid() {
  return `cs-grad-${++_uid}`;
}

// ── CS Monogram badge — collapsed sidebar ────────────────────────────────────
function CSBadge({ size = 44 }: { size?: number }) {
  const gid = uid();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="CareScribe"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#7C4A97" />
          <stop offset="100%" stopColor="#C2637A" />
        </linearGradient>
      </defs>
      {/* Rounded square */}
      <rect width="44" height="44" rx="13" fill={`url(#${gid})`} />
      {/* "CS" lettering */}
      <text
        x="22"
        y="29"
        textAnchor="middle"
        fill="white"
        fontSize="17"
        fontWeight="800"
        fontFamily='"Comfortaa","Quicksand","Nunito",system-ui,sans-serif'
        letterSpacing="-0.5"
      >
        CS
      </text>
    </svg>
  );
}

// ── Icon mark — pen nib + pulse line ─────────────────────────────────────────
function IconMark({ size = 32 }: { size?: number }) {
  const gid = uid();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#7C4A97" />
          <stop offset="100%" stopColor="#C2637A" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${gid})`} />
      {/* Pen / nib */}
      <path
        d="M23.5 9L30 15.5L16.5 29L10 31L12 24.5L23.5 9Z"
        fill="white"
        fillOpacity="0.95"
      />
      <path d="M12 24.5L10 31L16.5 29L12 24.5Z" fill="white" fillOpacity="0.45" />
      {/* Heartbeat line */}
      <path
        d="M7 34.5H14.5L16.5 31.5L18.5 36.5L21 29L23 34.5H33"
        stroke="white"
        strokeOpacity="0.55"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Wordmark text ─────────────────────────────────────────────────────────────
function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span
      style={{
        fontFamily: '"Comfortaa","Quicksand","Nunito",system-ui,sans-serif',
        fontSize: size,
        fontWeight: 900,
        letterSpacing: "-0.02em",
        lineHeight: 1,
        userSelect: "none",
      }}
    >
      <span style={{ color: "#3B2E42" }}>Care</span>
      <span style={{ color: "#6A407D" }}>Scribe</span>
    </span>
  );
}

// ── Public exports ────────────────────────────────────────────────────────────

interface CareScribeLogoProps {
  /** compact=true → show only CS badge (collapsed 88px sidebar) */
  compact?: boolean;
  className?: string;
}

/**
 * Sidebar logo.
 * compact=false → 32px icon mark + wordmark (expanded, 260px sidebar)
 * compact=true  → 44px CS badge (collapsed, 88px sidebar)
 *
 * The parent <aside> already animates width with transition-all duration-300,
 * so we cross-fade the two states with opacity + scale.
 */
export function CareScribeLogo({ compact = false, className = "" }: CareScribeLogoProps) {
  return (
    <div className={`relative flex items-center ${className}`} title="CareScribe">
      {/* Full logo — visible when expanded */}
      <div
        className="flex items-center gap-2.5 transition-all duration-300"
        style={{
          opacity: compact ? 0 : 1,
          transform: compact ? "scale(0.85)" : "scale(1)",
          pointerEvents: compact ? "none" : "auto",
          position: compact ? "absolute" : "relative",
          whiteSpace: "nowrap",
        }}
        aria-hidden={compact}
      >
        <IconMark size={32} />
        <Wordmark size={20} />
      </div>

      {/* CS badge — visible when collapsed */}
      <div
        className="flex items-center justify-center transition-all duration-300"
        style={{
          opacity: compact ? 1 : 0,
          transform: compact ? "scale(1)" : "scale(0.75)",
          pointerEvents: compact ? "auto" : "none",
          position: compact ? "relative" : "absolute",
        }}
        aria-hidden={!compact}
      >
        <CSBadge size={44} />
      </div>
    </div>
  );
}

/**
 * Mobile top-bar logo — always full (icon mark + wordmark).
 * White background context, slightly smaller than the sidebar version.
 */
export function CareScribeLogoSm({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-2 select-none ${className}`}
      title="CareScribe"
    >
      <IconMark size={28} />
      <Wordmark size={18} />
    </div>
  );
}
