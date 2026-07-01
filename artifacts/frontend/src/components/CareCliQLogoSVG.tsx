/**
 * CareCliQ Logo - SVG Component
 * Pink/Purple gradient design with circuit pattern
 */

export function CareCliQLogoSVG({ size = 42, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="carecliQ-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#E94B8C" />
          <stop offset="50%" stopColor="#D4499D" />
          <stop offset="100%" stopColor="#6B3FA0" />
        </linearGradient>
        <linearGradient id="carecliQ-gradient-alt" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#D4499D" />
          <stop offset="50%" stopColor="#8B4BA9" />
          <stop offset="100%" stopColor="#6B3FA0" />
        </linearGradient>
      </defs>

      {/* Outer curved bracket left */}
      <path
        d="M 40 30 Q 20 30 20 100 Q 20 170 40 170"
        stroke="url(#carecliQ-gradient)"
        strokeWidth="16"
        fill="none"
        strokeLinecap="round"
      />

      {/* Outer curved bracket right */}
      <path
        d="M 160 30 Q 180 30 180 100 Q 180 170 160 170"
        stroke="url(#carecliQ-gradient-alt)"
        strokeWidth="16"
        fill="none"
        strokeLinecap="round"
      />

      {/* Inner circuit pattern - left connector */}
      <line x1="60" y1="70" x2="100" y2="70" stroke="url(#carecliQ-gradient)" strokeWidth="6" strokeLinecap="round" />
      <circle cx="100" cy="70" r="5" fill="url(#carecliQ-gradient)" />

      {/* Inner circuit pattern - right connector */}
      <line x1="100" y1="100" x2="140" y2="100" stroke="url(#carecliQ-gradient-alt)" strokeWidth="6" strokeLinecap="round" />
      <circle cx="140" cy="100" r="5" fill="url(#carecliQ-gradient-alt)" />

      {/* Top dot */}
      <circle cx="85" cy="60" r="7" fill="url(#carecliQ-gradient)" />

      {/* Middle dot */}
      <circle cx="110" cy="80" r="6" fill="url(#carecliQ-gradient-alt)" />

      {/* Bottom connection */}
      <line x1="70" y1="100" x2="100" y2="130" stroke="url(#carecliQ-gradient)" strokeWidth="5" strokeLinecap="round" />
      <line x1="100" y1="130" x2="130" y2="130" stroke="url(#carecliQ-gradient-alt)" strokeWidth="5" strokeLinecap="round" />

      {/* Bottom right dot */}
      <circle cx="130" cy="140" r="7" fill="url(#carecliQ-gradient-alt)" />
    </svg>
  );
}

export function CareCliQLogoWithText({ size = 42, className = "" }: { size?: number; className?: string }) {
  const textSize = Math.max(12, Math.floor(size / 3));
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
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
