/**
 * Animated SVG illustration shown in the gradient top-section of login/signup.
 * Uses pure CSS keyframe animations (defined in index.css).
 */

const CORAL = "#F1738A";
const BLUSH = "#F6B8C0";
const WHITE = "rgba(255,255,255,";

// ── Small sparkle star ────────────────────────────────────────────────────────
function Sparkle({
  style,
  delay,
  size = 14,
}: {
  style: React.CSSProperties;
  delay: string;
  size?: number;
}) {
  return (
    <span
      className="absolute select-none pointer-events-none font-bold"
      style={{
        ...style,
        fontSize: size,
        color: "rgba(255,255,255,0.75)",
        animation: `cs-twinkle 2.8s ease-in-out infinite ${delay}`,
      }}
    >
      ✦
    </span>
  );
}

// ── Background floating orbs ─────────────────────────────────────────────────
function BgOrbs() {
  return (
    <>
      {/* Large outer orb */}
      <div
        className="absolute rounded-full"
        style={{
          inset: "-10%",
          background: `radial-gradient(circle, ${WHITE}0.15) 0%, ${WHITE}0) 70%)`,
          animation: "cs-orb-pulse 5s ease-in-out infinite",
        }}
      />
      {/* Medium orb top-right */}
      <div
        className="absolute -top-6 -right-8 w-28 h-28 rounded-full"
        style={{
          background: `radial-gradient(circle, ${WHITE}0.2) 0%, ${WHITE}0) 70%)`,
          animation: "cs-float-slow 7s ease-in-out infinite 1s",
        }}
      />
      {/* Small orb bottom-left */}
      <div
        className="absolute -bottom-4 -left-6 w-20 h-20 rounded-full"
        style={{
          background: `radial-gradient(circle, ${WHITE}0.15) 0%, ${WHITE}0) 70%)`,
          animation: "cs-float-slow 6s ease-in-out infinite 0.5s",
        }}
      />
    </>
  );
}

// ── Clipboard + heart SVG illustration ───────────────────────────────────────
function ClipboardIllustration() {
  return (
    <div
      className="relative z-10"
      style={{ animation: "cs-float 4s ease-in-out infinite" }}
    >
      <svg width="110" height="120" viewBox="0 0 110 120" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Clipboard shadow */}
        <ellipse cx="55" cy="116" rx="30" ry="5" fill="rgba(0,0,0,0.1)" />

        {/* Clipboard body */}
        <rect x="12" y="22" width="74" height="86" rx="10" fill="white" opacity="0.95" />

        {/* Clipboard clip top */}
        <rect x="32" y="14" width="34" height="18" rx="6" fill="white" opacity="0.95" />
        <rect x="38" y="18" width="22" height="10" rx="3" fill={BLUSH} opacity="0.4" />
        <circle cx="49" cy="23" r="3" fill={BLUSH} opacity="0.6" />

        {/* Heart (animated) */}
        <path
          d="M49 56 C49 56 38 47 31 52 C24 57 26 67 35 73 L49 84 L63 73 C72 67 74 57 67 52 C60 47 49 56 49 56Z"
          fill={CORAL}
          opacity="0.9"
          style={{ animation: "cs-heartbeat 1.8s ease-in-out infinite", transformOrigin: "49px 65px" }}
        />

        {/* EKG line across clipboard */}
        <polyline
          points="18,98 28,98 32,88 37,108 42,88 47,98 58,98 62,92 66,104 70,98 80,98 90,98"
          stroke={BLUSH}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray="200"
          opacity="0.7"
          style={{ animation: "cs-ekg 2.5s ease-in-out infinite" }}
        />

        {/* Horizontal lines (note lines) */}
        <line x1="22" y1="42" x2="76" y2="42" stroke={BLUSH} strokeWidth="1.5" opacity="0.3" />
        <line x1="22" y1="50" x2="60" y2="50" stroke={BLUSH} strokeWidth="1.5" opacity="0.3" />
      </svg>
    </div>
  );
}

// ── Orbiting care dots ────────────────────────────────────────────────────────
function OrbitDots() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      {/* Orbit 1 — clockwise */}
      <div
        className="absolute w-3 h-3 rounded-full"
        style={{
          background: "rgba(255,255,255,0.5)",
          animation: "cs-orbit 9s linear infinite",
          transformOrigin: "0 0",
        }}
      />
      {/* Orbit 2 — counter-clockwise, bigger radius */}
      <div
        className="absolute w-2 h-2 rounded-full"
        style={{
          background: BLUSH,
          opacity: 0.7,
          animation: "cs-orbit-rev 12s linear infinite 2s",
          transformOrigin: "0 0",
        }}
      />
      {/* Orbit 3 */}
      <div
        className="absolute w-2 h-2 rounded-full"
        style={{
          background: "rgba(255,255,255,0.4)",
          animation: "cs-orbit 7s linear infinite 4s",
          transformOrigin: "0 0",
        }}
      />
    </div>
  );
}

// ── Rising hearts ─────────────────────────────────────────────────────────────
function RisingHeart({ delay, left }: { delay: string; left: string }) {
  return (
    <span
      className="absolute bottom-2 text-base pointer-events-none select-none"
      style={{
        left,
        color: "rgba(255,255,255,0.55)",
        animation: `cs-rise-fade 3s ease-in-out infinite ${delay}`,
      }}
    >
      ♥
    </span>
  );
}

// ── Main export — LOGIN graphic ───────────────────────────────────────────────
export function LoginGraphic() {
  return (
    <div className="relative flex items-center justify-center w-52 h-52 mx-auto mt-4 mb-2">
      <BgOrbs />
      <OrbitDots />
      <ClipboardIllustration />

      {/* Sparkles */}
      <Sparkle style={{ top: "4%",  left: "6%"  }} delay="0s"    size={16} />
      <Sparkle style={{ top: "8%",  right: "4%" }} delay="0.9s"  size={11} />
      <Sparkle style={{ bottom: "8%", left: "4%" }} delay="1.6s" size={12} />
      <Sparkle style={{ bottom: "12%", right: "6%" }} delay="0.5s" size={10} />
      <Sparkle style={{ top: "40%", left: "0%"  }} delay="1.2s"  size={9}  />

      {/* Rising hearts */}
      <RisingHeart delay="0s"   left="28%" />
      <RisingHeart delay="1.1s" left="60%" />
    </div>
  );
}

// ── SIGNUP graphic — lighter, leaves room for step bar ────────────────────────
export function SignupGraphic() {
  return (
    <div className="relative flex items-center justify-center w-36 h-36 mx-auto mt-2 mb-1">
      {/* Morphing blob background */}
      <div
        className="absolute inset-0"
        style={{
          background: "rgba(255,255,255,0.1)",
          animation: "cs-blob-morph 6s ease-in-out infinite",
        }}
      />

      {/* Central icon — a floating document with a checkmark */}
      <div style={{ animation: "cs-float 3.5s ease-in-out infinite" }}>
        <svg width="80" height="88" viewBox="0 0 80 88" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Doc body */}
          <rect x="8" y="12" width="56" height="68" rx="8" fill="white" opacity="0.92" />
          {/* Folded corner */}
          <path d="M48 12 L64 28 L48 28 Z" fill={BLUSH} opacity="0.4" />
          <path d="M48 12 L48 28 L64 28" stroke="white" strokeWidth="1.5" opacity="0.5" />
          {/* Checkmark */}
          <circle cx="36" cy="50" r="14" fill={CORAL} opacity="0.15" />
          <path
            d="M28 50 L33 56 L44 44"
            stroke={CORAL}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ animation: "cs-heartbeat 2.5s ease-in-out infinite" }}
          />
          {/* Lines */}
          <line x1="16" y1="76" x2="56" y2="76" stroke={BLUSH} strokeWidth="1.5" opacity="0.35" />
          <line x1="16" y1="82" x2="44" y2="82" stroke={BLUSH} strokeWidth="1.5" opacity="0.25" />
        </svg>
      </div>

      {/* Sparkles */}
      <Sparkle style={{ top: "0%",  left: "2%"   }} delay="0s"   size={13} />
      <Sparkle style={{ top: "5%",  right: "0%"  }} delay="1.1s" size={9}  />
      <Sparkle style={{ bottom: "4%", left: "0%" }} delay="0.6s" size={10} />
      <Sparkle style={{ bottom: "0%", right: "2%" }} delay="1.7s" size={8} />
    </div>
  );
}
