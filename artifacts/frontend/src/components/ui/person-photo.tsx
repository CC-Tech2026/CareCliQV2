import { useState } from "react";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** A person's profile photo, round, falling back to their initials when they
 * have none or it fails to load (signed links expire). */
export function PersonPhoto({
  name,
  photoUrl,
  size = 44,
  className = "",
}: {
  name: string;
  photoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const style = { width: size, height: size, background: "var(--cc-soft)" };
  if (photoUrl && failed !== photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(photoUrl)}
        className={`shrink-0 rounded-full object-cover ${className}`}
        style={style}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${className}`}
      style={{ ...style, color: "var(--cc-text)", fontSize: Math.max(11, Math.round(size * 0.32)) }}
    >
      {initials(name) || "?"}
    </span>
  );
}
