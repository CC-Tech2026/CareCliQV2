/**
 * CareScribeLogo
 *
 * Renders the brand mark in two modes:
 *  - compact=false (default): icon mark + "Care Scribe" wordmark — for expanded sidebar / mobile header
 *  - compact=true            : icon mark only              — for collapsed sidebar (88 px)
 */

interface CareScribeLogoProps {
  compact?: boolean;
  className?: string;
}

/** Gradient-filled rounded-rect with a stylised pen-nib + pulse line */
function IconMark({ size = 32 }: { size?: number }) {
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
        <linearGradient id="cs-grad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8A4FAD" />
          <stop offset="100%" stopColor="#C2637A" />
        </linearGradient>
      </defs>

      {/* Rounded square background */}
      <rect width="40" height="40" rx="11" fill="url(#cs-grad)" />

      {/* Pen / nib shape */}
      <path
        d="M23.5 9L30 15.5L16.5 29L10 31L12 24.5L23.5 9Z"
        fill="white"
        fillOpacity="0.95"
        strokeLinejoin="round"
      />
      {/* Pen tip accent */}
      <path
        d="M12 24.5L10 31L16.5 29L12 24.5Z"
        fill="white"
        fillOpacity="0.5"
      />
      {/* Pulse / heartbeat line across the bottom */}
      <path
        d="M7 34.5H14.5L16.5 31.5L18.5 36.5L21 29L23 34.5H33"
        stroke="white"
        strokeOpacity="0.6"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CareScribeLogo({ compact = false, className = "" }: CareScribeLogoProps) {
  if (compact) {
    return (
      <div className={`flex items-center justify-center ${className}`} title="CareScribe">
        <IconMark size={36} />
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2.5 select-none ${className}`}>
      <IconMark size={32} />
      <span
        className="text-[20px] font-black tracking-tight leading-none"
        style={{ fontFamily: '"Comfortaa", "Quicksand", "Nunito", system-ui, sans-serif' }}
      >
        <span style={{ color: "#3B2E42" }}>Care</span>
        <span style={{ color: "#FF8FA3" }}>Scribe</span>
      </span>
    </div>
  );
}

/** Smaller variant for the mobile top bar (icon 28px, text 19px) */
export function CareScribeLogoSm({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 select-none ${className}`}>
      <IconMark size={28} />
      <span
        className="text-[19px] font-black tracking-tight leading-none"
        style={{ fontFamily: '"Comfortaa", "Quicksand", "Nunito", system-ui, sans-serif' }}
      >
        <span style={{ color: "#3B2E42" }}>Care</span>
        <span style={{ color: "#FF8FA3" }}>Scribe</span>
      </span>
    </div>
  );
}
