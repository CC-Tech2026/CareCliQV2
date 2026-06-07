import { useEffect, useState } from "react";
import { Cake, Award, Sparkles, Heart, AlertTriangle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { getStaffCommunity, type CommunityItem } from "@/services/hubService";

const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const BORDER = "#E2DEF2";
const PLUM   = "#5533CC";
const CORAL  = "#F03060";
const SOFT   = "#F5F3FC";

type CommunityType = "birthday" | "anniversary" | "new_starter" | "shoutout";

const TYPE_CONFIG: Record<
  CommunityType,
  { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; label: string; color: string; bg: string; chip: string }
> = {
  birthday:    { icon: Cake,     label: "Birthday",    color: CORAL,     bg: "#FFE8EE", chip: "bg-pink-50 text-pink-700" },
  anniversary: { icon: Award,    label: "Anniversary", color: PLUM,      bg: "#EEEAFB", chip: "bg-purple-50 text-purple-700" },
  new_starter: { icon: Sparkles, label: "New Starter", color: "#0EA5E9", bg: "#E0F2FE", chip: "bg-sky-50 text-sky-700" },
  shoutout:    { icon: Heart,    label: "Shout-out",   color: "#10B981", bg: "#D1FAE5", chip: "bg-emerald-50 text-emerald-700" },
};

const AVATAR_COLORS = [
  { bg: "#EEEAFB", color: PLUM },
  { bg: "#FFE8EE", color: CORAL },
  { bg: "#D1FAE5", color: "#059669" },
  { bg: "#E0F2FE", color: "#0284C7" },
  { bg: "#FEF3C7", color: "#D97706" },
];

function CommunityRow({ item, idx }: { item: CommunityItem; idx: number }) {
  const cfg  = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.shoutout;
  const Icon = cfg.icon;
  const av   = AVATAR_COLORS[idx % AVATAR_COLORS.length];
  const date = item.date ? format(parseISO(item.date), "d MMM") : null;

  return (
    <div
      className="flex items-center gap-3 py-3"
      style={{ borderBottom: `1px solid ${BORDER}` }}
    >
      {/* Avatar */}
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-black"
        style={{ background: av.bg, color: av.color }}
      >
        {item.avatar}
      </div>

      {/* Name + detail */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold leading-snug" style={{ color: TEXT }}>
          {item.name}
        </p>
        <p className="truncate text-[11px]" style={{ color: MUTED }}>
          {date ? `${date} · ` : ""}{item.detail}
        </p>
      </div>

      {/* Type badge */}
      <div
        className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black ${cfg.chip}`}
      >
        <Icon size={9} strokeWidth={2} />
        {cfg.label}
      </div>
    </div>
  );
}

export function StaffCommunity() {
  const [items,      setItems]      = useState<CommunityItem[] | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(false);
    getStaffCommunity()
      .then((data) => { if (!cancelled) setItems(data); })
      .catch(() => { if (!cancelled) setFetchError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const displayItems = items ?? [];

  return (
    <div className="rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: MUTED }}>
            Staff Community
          </p>
        </div>
        {!loading && displayItems.length > 0 && (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-black"
            style={{ background: SOFT, color: PLUM }}
          >
            {displayItems.length}
          </span>
        )}
      </div>

      <div className="px-5">
        {loading ? (
          <div className="py-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-9 w-9 animate-pulse rounded-full" style={{ background: SOFT }} />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-28 animate-pulse rounded" style={{ background: SOFT }} />
                  <div className="h-2.5 w-20 animate-pulse rounded" style={{ background: SOFT }} />
                </div>
              </div>
            ))}
          </div>
        ) : fetchError ? (
          <div className="py-6 text-center">
            <AlertTriangle size={18} className="mx-auto mb-2" style={{ color: "#F97316" }} />
            <p className="text-[12px] font-bold" style={{ color: TEXT }}>Could not load data</p>
          </div>
        ) : displayItems.length === 0 ? (
          <div className="py-6 text-center">
            <Sparkles size={18} className="mx-auto mb-2" style={{ color: MUTED }} />
            <p className="text-[12px] font-bold" style={{ color: TEXT }}>Nothing to celebrate yet</p>
            <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>Birthdays & anniversaries appear here.</p>
          </div>
        ) : (
          <div>
            {displayItems.map((item, idx) => (
              <CommunityRow
                key={item.id}
                item={item}
                idx={idx}
              />
            ))}
            {/* Remove bottom border on last item */}
            <div style={{ marginBottom: "4px" }} />
          </div>
        )}
      </div>
    </div>
  );
}
