/**
 * Flat-design illustrated characters for auth pages.
 * Inspired by consumer care-app UX (human figures, phone mockups, floating elements).
 * All animations via CSS keyframes defined in index.css.
 */

// ── Sparkle helper ────────────────────────────────────────────────────────────
function Sparkle({ style, delay, size = 14 }: { style: React.CSSProperties; delay: string; size?: number }) {
  return (
    <span
      className="absolute select-none pointer-events-none font-bold"
      style={{ ...style, fontSize: size, color: "rgba(255,255,255,0.78)", animation: `cs-twinkle 2.8s ease-in-out infinite ${delay}` }}
    >✦</span>
  );
}

// ── Care-worker SVG character + phone mockup ──────────────────────────────────
function CareWorker({ scale = 1 }: { scale?: number }) {
  const w = 240 * scale;
  const h = 256 * scale;

  return (
    <svg
      width={w} height={h}
      viewBox="0 0 240 256"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ animation: "cs-float 4s ease-in-out infinite", overflow: "visible" }}
    >
      {/* ── Platform shadow ── */}
      <ellipse cx="100" cy="253" rx="56" ry="9" fill="rgba(0,0,0,0.10)" />

      {/* ── Legs ── */}
      <rect x="82" y="152" width="19" height="94" rx="9.5" fill="#DEB2E4" />
      <rect x="102" y="152" width="19" height="94" rx="9.5" fill="#C9A0D4" />

      {/* ── Shoes ── */}
      <ellipse cx="91"  cy="248" rx="17" ry="6.5" fill="#F1738A" />
      <ellipse cx="112" cy="248" rx="17" ry="6.5" fill="#D95C74" />

      {/* ── Torso / shirt ── */}
      <rect x="70" y="85" width="60" height="72" rx="16" fill="#542269" />
      {/* Collar accent */}
      <path d="M90 85 L100 97 L110 85 Z" fill="rgba(246,184,192,0.32)" />

      {/* ── Neck ── */}
      <rect x="94" y="71" width="12" height="17" rx="5" fill="#F8C4A3" />

      {/* ── Hair (back layer) ── */}
      <ellipse cx="100" cy="42" rx="28" ry="26" fill="#2D1810" />

      {/* ── Head ── */}
      <circle cx="100" cy="48" r="24" fill="#F8C4A3" />

      {/* ── Ears ── */}
      <circle cx="76"  cy="48" r="7.5" fill="#F8C4A3" />
      <circle cx="124" cy="48" r="7.5" fill="#F8C4A3" />
      <circle cx="76"  cy="48" r="5"   fill="#F0B890" />
      <circle cx="124" cy="48" r="5"   fill="#F0B890" />

      {/* ── Left arm ── */}
      <rect x="40" y="87" width="28" height="64" rx="14" fill="#542269" transform="rotate(-8, 54, 119)" />
      {/* ── Right arm ── */}
      <rect x="132" y="87" width="28" height="64" rx="14" fill="#542269" transform="rotate(10, 146, 119)" />

      {/* ── Hands ── */}
      <circle cx="46"  cy="150" r="11.5" fill="#F8C4A3" />
      <circle cx="155" cy="148" r="11.5" fill="#F8C4A3" />

      {/* ── Hair fringe (front) ── */}
      <path d="M74 36 Q82 22 100 20 Q118 22 126 36 Q118 30 100 32 Q82 30 74 36 Z" fill="#2D1810" />
      {/* Side hair lock left */}
      <path d="M74 36 Q66 52 68 70" stroke="#2D1810" strokeWidth="15" strokeLinecap="round" fill="none" />
      {/* Side hair lock right */}
      <path d="M126 36 Q134 52 132 70" stroke="#2D1810" strokeWidth="15" strokeLinecap="round" fill="none" />

      {/* ── Face ── */}
      {/* Eyes */}
      <circle cx="91"  cy="46" r="3.5" fill="#2D1810" />
      <circle cx="109" cy="46" r="3.5" fill="#2D1810" />
      {/* Eye shine */}
      <circle cx="92.5" cy="44.5" r="1.3" fill="white" />
      <circle cx="110.5" cy="44.5" r="1.3" fill="white" />
      {/* Blush */}
      <ellipse cx="83"  cy="55" rx="8" ry="5" fill="#F1738A" opacity="0.2" />
      <ellipse cx="117" cy="55" rx="8" ry="5" fill="#F1738A" opacity="0.2" />
      {/* Smile */}
      <path d="M91 60 Q100 69 109 60" stroke="#C07850" strokeWidth="2.5" fill="none" strokeLinecap="round" />

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ── Floating phone mockup (upper-right) ── */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <g style={{ animation: "cs-float 5s ease-in-out infinite 1.2s" }}>
        {/* Phone drop shadow */}
        <rect x="168" y="50" width="56" height="94" rx="13" fill="rgba(84,34,105,0.15)" transform="translate(3,3)" />
        {/* Phone body */}
        <rect x="164" y="44" width="56" height="94" rx="13" fill="white" opacity="0.96" />
        {/* Screen bg */}
        <rect x="168" y="48" width="48" height="86" rx="9" fill="#F5EEFF" />

        {/* App header row */}
        <rect x="168" y="48" width="48" height="24" rx="9" fill="rgba(84,34,105,0.09)" />
        {/* Avatar in header */}
        <circle cx="179" cy="60" r="7" fill="#F1738A" opacity="0.65" />
        {/* Header text lines */}
        <line x1="191" y1="56" x2="213" y2="56" stroke="#DEB2E4" strokeWidth="2" strokeLinecap="round" />
        <line x1="191" y1="63" x2="207" y2="63" stroke="#DEB2E4" strokeWidth="1.5" strokeLinecap="round" />

        {/* Card 1 */}
        <rect x="170" y="76" width="44" height="24" rx="7" fill="white" />
        <circle cx="181" cy="88" r="7" fill="#F1738A" opacity="0.55" />
        <line x1="192" y1="85" x2="211" y2="85" stroke="#DEB2E4" strokeWidth="2" strokeLinecap="round" />
        <line x1="192" y1="92" x2="207" y2="92" stroke="#DEB2E4" strokeWidth="1.5" strokeLinecap="round" />

        {/* Card 2 */}
        <rect x="170" y="104" width="44" height="24" rx="7" fill="white" />
        <circle cx="181" cy="116" r="7" fill="#DEB2E4" opacity="0.9" />
        <line x1="192" y1="113" x2="211" y2="113" stroke="#DEB2E4" strokeWidth="2" strokeLinecap="round" />
        <line x1="192" y1="120" x2="207" y2="120" stroke="#DEB2E4" strokeWidth="1.5" strokeLinecap="round" />

        {/* Bottom nav bar */}
        <rect x="168" y="124" width="48" height="10" rx="0" fill="rgba(232,213,232,0.3)" />
        <circle cx="180" cy="129" r="3.5" fill="#F1738A" opacity="0.7" />
        <circle cx="192" cy="129" r="3.5" fill="#DEB2E4" opacity="0.5" />
        <circle cx="204" cy="129" r="3.5" fill="#DEB2E4" opacity="0.5" />

        {/* Notification badge */}
        <circle cx="218" cy="46" r="8" fill="#F1738A" />
        <text x="218" y="50" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">3</text>
      </g>

      {/* ── Floating heart (top-left) ── */}
      <path
        d="M42 88 C42 88 35 81 28 85 C21 89 23 99 30 103 L42 115 L54 103 C61 99 63 89 56 85 C49 81 42 88 42 88 Z"
        fill="#F1738A"
        opacity="0.9"
        style={{ animation: "cs-float 3.2s ease-in-out infinite 0.4s" }}
      />

      {/* ── Floating checkmark badge (lower left) ── */}
      <g style={{ animation: "cs-float 4.5s ease-in-out infinite 0.8s" }}>
        <circle cx="30" cy="170" r="16" fill="rgba(255,255,255,0.22)" />
        <path d="M22 170 L27 176 L38 162" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </g>

      {/* ── Rising hearts ── */}
      <text
        x="68" y="148"
        fill="rgba(255,255,255,0.55)"
        fontSize="14"
        style={{ animation: "cs-rise-fade 3.1s ease-in-out infinite 0s" }}
      >♥</text>
      <text
        x="140" y="142"
        fill="rgba(255,255,255,0.45)"
        fontSize="11"
        style={{ animation: "cs-rise-fade 3.1s ease-in-out infinite 1.5s" }}
      >♥</text>
    </svg>
  );
}

// ── Small signup character (upper-body only, welcoming pose) ──────────────────
function CareWorkerBust() {
  return (
    <svg
      width="180" height="130"
      viewBox="0 0 240 170"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ animation: "cs-float 4s ease-in-out infinite" }}
    >
      {/* ── Torso ── */}
      <rect x="70" y="88" width="60" height="75" rx="16" fill="#542269" />
      <path d="M90 88 L100 100 L110 88 Z" fill="rgba(246,184,192,0.32)" />
      <rect x="94" y="73" width="12" height="18" rx="5" fill="#F8C4A3" />

      {/* ── Left arm (raised slightly — welcoming gesture) ── */}
      <rect x="36" y="78" width="28" height="60" rx="14" fill="#542269" transform="rotate(-18, 50, 108)" />
      {/* ── Right arm ── */}
      <rect x="136" y="88" width="28" height="58" rx="14" fill="#542269" transform="rotate(8, 150, 117)" />

      {/* ── Hands ── */}
      <circle cx="38"  cy="138" r="12" fill="#F8C4A3" />
      {/* Wave fingers on raised hand */}
      <circle cx="30"  cy="128" r="5"  fill="#F8C4A3" />
      <circle cx="25"  cy="120" r="4.5" fill="#F8C4A3" />
      <circle cx="155" cy="146" r="12" fill="#F8C4A3" />

      {/* ── Hair (back) ── */}
      <ellipse cx="100" cy="42" rx="28" ry="26" fill="#2D1810" />
      {/* ── Head ── */}
      <circle cx="100" cy="48" r="24" fill="#F8C4A3" />
      {/* ── Ears ── */}
      <circle cx="76"  cy="48" r="7.5" fill="#F8C4A3" />
      <circle cx="124" cy="48" r="7.5" fill="#F8C4A3" />
      <circle cx="76"  cy="48" r="5"   fill="#F0B890" />
      <circle cx="124" cy="48" r="5"   fill="#F0B890" />
      {/* ── Hair fringe ── */}
      <path d="M74 36 Q82 22 100 20 Q118 22 126 36 Q118 30 100 32 Q82 30 74 36 Z" fill="#2D1810" />
      <path d="M74 36 Q66 52 68 70" stroke="#2D1810" strokeWidth="15" strokeLinecap="round" fill="none" />
      <path d="M126 36 Q134 52 132 70" stroke="#2D1810" strokeWidth="15" strokeLinecap="round" fill="none" />
      {/* ── Face ── */}
      <circle cx="91"  cy="46" r="3.5" fill="#2D1810" />
      <circle cx="109" cy="46" r="3.5" fill="#2D1810" />
      <circle cx="92.5" cy="44.5" r="1.3" fill="white" />
      <circle cx="110.5" cy="44.5" r="1.3" fill="white" />
      <ellipse cx="83"  cy="55" rx="8" ry="5" fill="#F1738A" opacity="0.2" />
      <ellipse cx="117" cy="55" rx="8" ry="5" fill="#F1738A" opacity="0.2" />
      <path d="M91 60 Q100 69 109 60" stroke="#C07850" strokeWidth="2.5" fill="none" strokeLinecap="round" />

      {/* ── Floating badge: "New" ── */}
      <g style={{ animation: "cs-float 3.5s ease-in-out infinite 0.6s" }}>
        <rect x="148" y="60" width="44" height="22" rx="11" fill="rgba(255,255,255,0.25)" />
        <text x="170" y="75" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold">Welcome!</text>
      </g>
    </svg>
  );
}

// ── Main exports ──────────────────────────────────────────────────────────────

export function LoginGraphic() {
  return (
    <div className="relative flex items-end justify-center w-full mt-2 mb-0" style={{ minHeight: 160 }}>
      <CareWorker scale={0.88} />
      {/* Sparkles around the composition */}
      <Sparkle style={{ top: "4%",  left:  "6%"  }} delay="0s"   size={16} />
      <Sparkle style={{ top: "10%", right: "8%"  }} delay="0.9s" size={11} />
      <Sparkle style={{ top: "45%", left:  "2%"  }} delay="1.6s" size={10} />
      <Sparkle style={{ bottom: "2%", right: "14%" }} delay="0.5s" size={9}  />
    </div>
  );
}

export function SignupGraphic() {
  return (
    <div className="relative flex items-end justify-center w-full mt-1 mb-1" style={{ minHeight: 90 }}>
      <CareWorkerBust />
      <Sparkle style={{ top: "0%",  left:  "10%" }} delay="0s"   size={13} />
      <Sparkle style={{ top: "4%",  right: "12%" }} delay="1.1s" size={10} />
      <Sparkle style={{ bottom: "0%", left: "6%" }} delay="0.7s" size={9}  />
      <Sparkle style={{ bottom: "8%", right: "8%" }} delay="1.5s" size={8}  />
    </div>
  );
}
