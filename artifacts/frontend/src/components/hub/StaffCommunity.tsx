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
  { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; label: string; color: string; bg: string }
> = {
  birthday:    { icon: Cake,     label: "Birthday",          color: CORAL,     bg: "#FFE8EE" },
  anniversary: { icon: Award,    label: "Work Anniversary",  color: PLUM,      bg: "#EEEAFB" },
  new_starter: { icon: Sparkles, label: "New Starter",       color: "#0EA5E9", bg: "#E0F2FE" },
  shoutout:    { icon: Heart,    label: "Team Shout-out",    color: "#10B981", bg: "#D1FAE5" },
};

const AVATAR_COLORS = [
  { bg: "#EEEAFB", color: PLUM },
  { bg: "#FFE8EE", color: CORAL },
  { bg: "#D1FAE5", color: "#059669" },
  { bg: "#E0F2FE", color: "#0284C7" },
  { bg: "#FEF3C7", color: "#D97706" },
];

function CommunityCard({ item, idx }: { item: CommunityItem; idx: number }) {
  const cfg  = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.shoutout;
  const Icon = cfg.icon;
  const av   = AVATAR_COLORS[idx % AVATAR_COLORS.length];

  return (
    <div className="flex items-start gap-4 rounded-xl border p-4" style={{ borderColor: BORDER }}>
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12px] font-black"
        style={{ background: av.bg, color: av.color }}
      >
        {item.avatar}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-black"
            style={{ background: cfg.bg, color: cfg.color }}
          >
            <Icon size={10} strokeWidth={2} />
            {cfg.label}
          </div>
        </div>
        <p className="mt-1.5 text-[13px] font-bold" style={{ color: TEXT }}>
          {item.name}
        </p>
        <p className="mt-0.5 text-[12px] leading-relaxed" style={{ color: MUTED }}>
          {item.detail}
        </p>
        {item.date && (
          <p className="mt-1.5 text-[11px] font-semibold" style={{ color: MUTED }}>
            {format(parseISO(item.date), "EEEE, MMMM d")}
          </p>
        )}
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
    <section className="rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      {/* Header */}
      <div
        className="px-6 py-4"
        style={{ borderBottom: `1px solid ${BORDER}` }}
      >
        <h2 className="text-[14px] font-black" style={{ color: TEXT }}>
          Staff Community
        </h2>
        <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
          Birthdays, anniversaries, new starters & recognition
        </p>
      </div>

      <div className="px-6 py-5">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl" style={{ background: SOFT }} />
            ))}
          </div>
        ) : fetchError ? (
          <div className="rounded-xl border p-6 text-center" style={{ borderColor: BORDER }}>
            <AlertTriangle size={22} className="mx-auto mb-2" style={{ color: "#F97316" }} />
            <p className="text-[13px] font-bold" style={{ color: TEXT }}>Could not load community data</p>
            <p className="mt-1 text-[12px]" style={{ color: MUTED }}>Check your connection and try again.</p>
          </div>
        ) : displayItems.length === 0 ? (
          <div className="rounded-xl border p-6 text-center" style={{ borderColor: BORDER }}>
            <Sparkles size={22} className="mx-auto mb-2" style={{ color: MUTED }} />
            <p className="text-[13px] font-bold" style={{ color: TEXT }}>Nothing to celebrate right now</p>
            <p className="mt-1 text-[12px]" style={{ color: MUTED }}>
              Birthdays, anniversaries, and new starters appear here automatically.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayItems.map((item, idx) => (
              <CommunityCard key={item.id} item={item} idx={idx} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
