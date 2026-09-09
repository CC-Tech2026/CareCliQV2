import { useEffect, useState } from "react";
import { BookOpen, GraduationCap, ShieldCheck } from "lucide-react";

export const COURSE_COLORS = ["#DDD6FE", "#FED7AA", "#BAE6FD", "#BBF7D0", "#FBCFE8", "#CBD5E1"];

/** Decorative course artwork stays crisp at every screen size. */
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
  const colors = [
    "from-violet-100 to-indigo-200",
    "from-amber-100 to-orange-200",
    "from-sky-100 to-cyan-200",
  ];
  const Icon = [BookOpen, GraduationCap, ShieldCheck][index];
  return (
    <div
      className={`relative w-full shrink-0 overflow-hidden rounded-xl ${className} ${color ? "" : `bg-gradient-to-br ${colors[index]}`}`}
      style={color && /^#[0-9a-f]{6}$/i.test(color) ? { backgroundColor: color } : undefined}
    >
      {imageUrl && !failed && <img src={imageUrl} alt="" className="absolute inset-0 z-[1] h-full w-full object-cover" onError={() => setFailed(true)} />}
      <span className="absolute left-3 top-3 z-[2] rounded-md bg-white/90 px-2 py-1 text-[10px] font-bold text-slate-700">
        {count} {count === 1 ? "material" : "materials"}
      </span>
      <div
        aria-hidden="true"
        className="absolute -right-4 -top-8 h-36 w-36 rounded-full border-[20px] border-white/30"
      />
      <div
        aria-hidden="true"
        className="absolute bottom-4 right-10 rotate-[-12deg] rounded-xl border border-white/80 bg-white/85 p-4 text-indigo-700 shadow-lg"
      >
        <Icon size={38} strokeWidth={1.5} />
      </div>
      <div
        aria-hidden="true"
        className="absolute bottom-5 left-8 h-3 w-16 rounded-full bg-white/60"
      />
    </div>
  );
}
