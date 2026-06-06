import { Cake, Award, Sparkles, Heart } from "lucide-react";
import { format } from "date-fns";

const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";
const PLUM = "#5533CC";
const CORAL = "#F03060";
const SOFT = "#F5F3FC";

type CommunityType = "birthday" | "anniversary" | "new_starter" | "shoutout";

interface CommunityItem {
  id: string;
  type: CommunityType;
  name: string;
  detail: string;
  date?: Date;
  avatar: string;
}

const COMMUNITY_ITEMS: CommunityItem[] = [
  {
    id: "sc1",
    type: "birthday",
    name: "Mia Chen",
    detail: "Wishing Mia a wonderful birthday today! 🎂",
    date: new Date(),
    avatar: "MC",
  },
  {
    id: "sc2",
    type: "anniversary",
    name: "James Walker",
    detail: "James celebrates 5 years with CareCliQ today. Thank you for your dedication!",
    date: new Date(),
    avatar: "JW",
  },
  {
    id: "sc3",
    type: "new_starter",
    name: "Priya Sharma",
    detail: "Priya joins our team as a Support Worker. Welcome aboard!",
    date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2),
    avatar: "PS",
  },
  {
    id: "sc4",
    type: "shoutout",
    name: "Rachel Torres",
    detail: "Rachel received exceptional feedback from three participants this week for her compassionate care and clinical excellence. Outstanding work!",
    date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3),
    avatar: "RT",
  },
  {
    id: "sc5",
    type: "birthday",
    name: "Ben Kim",
    detail: "Happy birthday Ben! Enjoy your special day.",
    date: new Date(Date.now() - 1000 * 60 * 60 * 24),
    avatar: "BK",
  },
  {
    id: "sc6",
    type: "anniversary",
    name: "Daniel Okonkwo",
    detail: "Daniel marks his 2nd work anniversary. Keep up the great work!",
    date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5),
    avatar: "DO",
  },
];

const TYPE_CONFIG: Record<
  CommunityType,
  { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; label: string; color: string; bg: string }
> = {
  birthday: {
    icon: Cake,
    label: "Birthday",
    color: "#F03060",
    bg: "#FFE8EE",
  },
  anniversary: {
    icon: Award,
    label: "Work Anniversary",
    color: "#5533CC",
    bg: "#EEEAFB",
  },
  new_starter: {
    icon: Sparkles,
    label: "New Starter",
    color: "#0EA5E9",
    bg: "#E0F2FE",
  },
  shoutout: {
    icon: Heart,
    label: "Team Shout-out",
    color: "#10B981",
    bg: "#D1FAE5",
  },
};

const AVATAR_COLORS = [
  { bg: "#EEEAFB", color: PLUM },
  { bg: "#FFE8EE", color: CORAL },
  { bg: "#D1FAE5", color: "#059669" },
  { bg: "#E0F2FE", color: "#0284C7" },
  { bg: "#FEF3C7", color: "#D97706" },
];

export function StaffCommunity() {
  return (
    <section className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-5">
        <h2 className="text-lg font-black" style={{ color: TEXT }}>
          Staff Community
        </h2>
        <p className="mt-0.5 text-[12px] font-medium" style={{ color: MUTED }}>
          Birthdays, anniversaries, new starters & team recognition
        </p>
      </div>

      <div className="space-y-3">
        {COMMUNITY_ITEMS.map((item, idx) => {
          const cfg = TYPE_CONFIG[item.type];
          const Icon = cfg.icon;
          const av = AVATAR_COLORS[idx % AVATAR_COLORS.length];

          return (
            <div
              key={item.id}
              className="flex items-start gap-4 rounded-xl border p-4"
              style={{ borderColor: BORDER }}
            >
              {/* Avatar */}
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12px] font-black"
                style={{ background: av.bg, color: av.color }}
              >
                {item.avatar}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-black"
                    style={{ background: cfg.bg, color: cfg.color }}
                  >
                    <Icon size={10} strokeWidth={2.5} />
                    {cfg.label}
                  </div>
                </div>
                <p className="mt-1.5 text-[13px] font-black" style={{ color: TEXT }}>
                  {item.name}
                </p>
                <p className="mt-0.5 text-[12px] font-medium leading-relaxed" style={{ color: MUTED }}>
                  {item.detail}
                </p>
                {item.date && (
                  <p className="mt-1.5 text-[11px] font-semibold" style={{ color: MUTED }}>
                    {format(item.date, "EEEE, MMMM d")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
