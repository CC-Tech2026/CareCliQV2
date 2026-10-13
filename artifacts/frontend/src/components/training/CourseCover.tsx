import { useEffect, useState } from "react";
import { BookOpen, GraduationCap, ShieldCheck } from "lucide-react";

export const COURSE_COLORS = ["#DDD6FE", "#FED7AA", "#BAE6FD", "#BBF7D0", "#FBCFE8", "#CBD5E1"];

/**
 * Course artwork: a flat tint with one icon, in the same purple as the
 * vault's folders unless the module has its own colour or image.
 */
export function CourseCover({
  title,
  count = 0,
  color,
  imageUrl,
  className = "h-36",
}: {
  title: string;
  count?: number;
  color?: string | null;
  imageUrl?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [imageUrl]);
  const index =
    Array.from(title).reduce((sum, c) => sum + c.charCodeAt(0), 0) % 3;
  const Icon = [BookOpen, GraduationCap, ShieldCheck][index];
  const custom = color && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
  return (
    <div
      className={`relative w-full shrink-0 overflow-hidden rounded-xl ${className}`}
      style={{ backgroundColor: custom ?? "var(--cc-brand-purple-soft)" }}
    >
      {imageUrl && !failed && <img src={imageUrl} alt="" className="absolute inset-0 z-[1] h-full w-full object-cover" onError={() => setFailed(true)} />}
      <span className="absolute left-3 top-3 z-[2] rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
        {count} {count === 1 ? "material" : "materials"}
      </span>
      <span
        aria-hidden="true"
        className="absolute bottom-3 right-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/85"
        style={{ color: "var(--cc-brand-purple)" }}
      >
        <Icon size={24} strokeWidth={1.75} />
      </span>
    </div>
  );
}
