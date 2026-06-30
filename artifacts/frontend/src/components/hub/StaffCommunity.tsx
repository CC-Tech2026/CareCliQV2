import { useEffect, useState } from "react";
import { Cake, Award, Sparkles, Heart, AlertTriangle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { getStaffCommunity, type CommunityItem } from "@/services/hubService";

const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const SOFT   = "var(--cc-soft)";

type CommunityType = "birthday" | "anniversary" | "new_starter" | "shoutout";

const TYPE_CONFIG: Record<
  CommunityType,
  { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; labelKey: string; color: string; bg: string; chip: string }
> = {
  birthday:    { icon: Cake,     labelKey: "hub.community.type.birthday",    color: CORAL,     bg: "#FCE7F3", chip: "bg-pink-50 text-pink-700" },
  anniversary: { icon: Award,    labelKey: "hub.community.type.anniversary", color: PLUM,      bg: "#EEEAFB", chip: "bg-purple-50 text-purple-700" },
  new_starter: { icon: Sparkles, labelKey: "hub.community.type.newStarter", color: "#0EA5E9", bg: "#E0F2FE", chip: "bg-sky-50 text-sky-700" },
  shoutout:    { icon: Heart,    labelKey: "hub.community.type.shoutout",   color: "#10B981", bg: "#D1FAE5", chip: "bg-emerald-50 text-emerald-700" },
};

const AVATAR_COLORS = [
  { bg: "#EEEAFB", color: PLUM },
  { bg: "#FCE7F3", color: CORAL },
  { bg: "#D1FAE5", color: "#059669" },
  { bg: "#E0F2FE", color: "#0284C7" },
  { bg: "#FEF3C7", color: "#D97706" },
];

function CommunityRow({ item, idx }: { item: CommunityItem; idx: number }) {
  const { translate } = useAccessibility();
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
        {translate(cfg.labelKey)}
      </div>
    </div>
  );
}

export function StaffCommunity() {
  const { translate } = useAccessibility();
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
    <div className="rounded-2xl border bg-cc-surface shadow-sm" style={{ borderColor: BORDER }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: MUTED }}>
            {translate("hub.community.title")}
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
            <p className="text-[12px] font-bold" style={{ color: TEXT }}>{translate("hub.community.loadFailed")}</p>
          </div>
        ) : displayItems.length === 0 ? (
          <div className="py-6 text-center">
            <Sparkles size={18} className="mx-auto mb-2" style={{ color: MUTED }} />
            <p className="text-[12px] font-bold" style={{ color: TEXT }}>{translate("hub.community.emptyTitle")}</p>
            <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>{translate("hub.community.emptyHint")}</p>
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
