/**
 * Auth page illustrations using the provided professional SVG assets.
 * Animations via CSS keyframes defined in index.css.
 */

// ── Sparkle helper ────────────────────────────────────────────────────────────
function Sparkle({ style, delay, size = 14 }: { style: React.CSSProperties; delay: string; size?: number }) {
  return (
    <span
      className="absolute select-none pointer-events-none font-bold"
      style={{
        ...style,
        fontSize: size,
        color: "rgba(255,255,255,0.78)",
        animation: `cs-twinkle 2.8s ease-in-out infinite ${delay}`,
      }}
    >
      ✦
    </span>
  );
}

// ── Background orbs ───────────────────────────────────────────────────────────
function BgOrb({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`absolute rounded-full pointer-events-none ${className ?? ""}`}
      style={{
        background: "rgba(255,255,255,0.12)",
        animation: "cs-orb-pulse 5s ease-in-out infinite",
        ...style,
      }}
    />
  );
}

// ── LOGIN graphic ─────────────────────────────────────────────────────────────
export function LoginGraphic() {
  return (
    <div className="relative w-full flex items-end justify-center" style={{ minHeight: 180 }}>
      {/* Soft background glow behind the illustration */}
      <BgOrb style={{ width: 260, height: 260, bottom: -40, left: "50%", transform: "translateX(-50%)", animationDelay: "0s" }} />
      <BgOrb style={{ width: 160, height: 160, bottom: 20, right: "10%", animationDelay: "1.5s", opacity: 0.7 }} />

      {/* Main illustration — floats gently */}
      <img
        src="/auth-illustration-1.svg"
        alt="Care worker illustration"
        className="relative z-10 w-auto"
        style={{
          height: 200,
          maxWidth: "90%",
          animation: "cs-float 4.5s ease-in-out infinite",
          filter: "drop-shadow(0 8px 24px rgba(55,48,163,0.25))",
        }}
      />

      {/* Sparkles */}
      <Sparkle style={{ top: "6%",  left:  "8%"  }} delay="0s"    size={17} />
      <Sparkle style={{ top: "12%", right: "6%"  }} delay="0.9s"  size={12} />
      <Sparkle style={{ top: "50%", left:  "3%"  }} delay="1.7s"  size={10} />
      <Sparkle style={{ bottom: "6%", right: "12%" }} delay="0.5s" size={9}  />
      <Sparkle style={{ bottom: "14%", left: "14%" }} delay="1.3s" size={8}  />

      {/* Rising hearts */}
      <span
        className="absolute bottom-4 pointer-events-none select-none text-lg"
        style={{ left: "30%", color: "rgba(255,255,255,0.55)", animation: "cs-rise-fade 3s ease-in-out infinite 0s" }}
      >♥</span>
      <span
        className="absolute bottom-4 pointer-events-none select-none"
        style={{ left: "64%", color: "rgba(255,255,255,0.4)", fontSize: 13, animation: "cs-rise-fade 3s ease-in-out infinite 1.5s" }}
      >♥</span>
    </div>
  );
}

// ── SIGNUP graphic ────────────────────────────────────────────────────────────
export function SignupGraphic() {
  return (
    <div className="relative w-full flex items-end justify-center" style={{ minHeight: 110 }}>
      {/* Soft glow */}
      <BgOrb style={{ width: 200, height: 200, bottom: -30, left: "50%", transform: "translateX(-50%)", animationDelay: "0.3s" }} />

      {/* Main illustration — floats gently */}
      <img
        src="/auth-illustration-2.svg"
        alt="Care illustration"
        className="relative z-10 w-auto"
        style={{
          height: 130,
          maxWidth: "85%",
          animation: "cs-float 4s ease-in-out infinite 0.5s",
          filter: "drop-shadow(0 6px 18px rgba(55,48,163,0.22))",
        }}
      />

      {/* Sparkles */}
      <Sparkle style={{ top: "0%",  left:  "8%"   }} delay="0s"    size={14} />
      <Sparkle style={{ top: "8%",  right: "6%"   }} delay="1.1s"  size={10} />
      <Sparkle style={{ bottom: "2%", left: "4%"  }} delay="0.6s"  size={9}  />
      <Sparkle style={{ bottom: "4%", right: "10%" }} delay="1.7s" size={8}  />
    </div>
  );
}
