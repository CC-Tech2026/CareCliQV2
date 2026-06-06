import { format, addDays, addWeeks } from "date-fns";
import { Calendar, ClipboardCheck, Users, BookOpen, Target } from "lucide-react";

const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT = "#F5F3FC";

type EventType = "audit" | "training" | "meeting" | "review";

interface OrgEvent {
  id: string;
  title: string;
  date: Date;
  duration: string;
  type: EventType;
  location?: string;
  participants?: string;
}

const now = new Date();

const ORG_EVENTS: OrgEvent[] = [
  {
    id: "e1",
    title: "Internal NDIS Quality Audit",
    date: addDays(now, 8),
    duration: "3 days",
    type: "audit",
    location: "Head Office — Conference Room A",
    participants: "All clinical staff",
  },
  {
    id: "e2",
    title: "Mandatory Manual Handling Refresher",
    date: addDays(now, 11),
    duration: "Half day",
    type: "training",
    location: "Training Room 2 / Online",
    participants: "Support Workers cohort A",
  },
  {
    id: "e3",
    title: "All-Hands Team Meeting — June",
    date: addDays(now, 4),
    duration: "1 hour",
    type: "meeting",
    location: "Online — Zoom",
    participants: "All staff",
  },
  {
    id: "e4",
    title: "NDIS Plan Review Period — Q4 Participants",
    date: addDays(now, 14),
    duration: "2 weeks",
    type: "review",
    participants: "Support Coordinators + Clinicians",
  },
  {
    id: "e5",
    title: "Positive Behaviour Support Training",
    date: addWeeks(now, 3),
    duration: "Full day",
    type: "training",
    location: "Training Room 1",
    participants: "All frontline support workers",
  },
  {
    id: "e6",
    title: "Monthly Compliance & Clinical Governance Meeting",
    date: addDays(now, 21),
    duration: "2 hours",
    type: "meeting",
    location: "Boardroom / Online",
    participants: "Clinical leads + Coordinators",
  },
  {
    id: "e7",
    title: "Mid-Year Performance & Goal Reviews",
    date: addWeeks(now, 4),
    duration: "2 weeks",
    type: "review",
    participants: "All staff — individual sessions with managers",
  },
  {
    id: "e8",
    title: "NDIS Quality & Safeguards Commission Spot Check",
    date: addWeeks(now, 6),
    duration: "1 day",
    type: "audit",
    location: "Head Office",
    participants: "Senior management + clinical leads",
  },
];

const EVENT_CONFIG: Record<
  EventType,
  { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; label: string; color: string; bg: string; chip: string }
> = {
  audit: {
    icon: ClipboardCheck,
    label: "Audit",
    color: "#EF4444",
    bg: "#FEF2F2",
    chip: "bg-red-50 text-red-700 border border-red-200",
  },
  training: {
    icon: BookOpen,
    label: "Training",
    color: "#5533CC",
    bg: "#EEEAFB",
    chip: "bg-purple-50 text-purple-700 border border-purple-200",
  },
  meeting: {
    icon: Users,
    label: "Meeting",
    color: "#0EA5E9",
    bg: "#E0F2FE",
    chip: "bg-blue-50 text-blue-700 border border-blue-200",
  },
  review: {
    icon: Target,
    label: "Goal Review",
    color: "#10B981",
    bg: "#D1FAE5",
    chip: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  },
};

export function OrganizationCalendar() {
  const sorted = [...ORG_EVENTS].sort((a, b) => a.date.getTime() - b.date.getTime());

  return (
    <section className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black" style={{ color: TEXT }}>
            Organisation Calendar
          </h2>
          <p className="mt-0.5 text-[12px] font-medium" style={{ color: MUTED }}>
            Upcoming audits, training, meetings & reviews
          </p>
        </div>
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ background: SOFT, color: "#5533CC" }}
        >
          <Calendar size={16} strokeWidth={2.5} />
        </div>
      </div>

      <div className="space-y-3">
        {sorted.map((event) => {
          const cfg = EVENT_CONFIG[event.type];
          const Icon = cfg.icon;
          const isImminant = (event.date.getTime() - now.getTime()) < 1000 * 60 * 60 * 24 * 7;

          return (
            <div
              key={event.id}
              className="flex gap-4 rounded-xl border p-4"
              style={{ borderColor: BORDER }}
            >
              {/* Date chip */}
              <div
                className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl py-2 text-center"
                style={{ background: cfg.bg }}
              >
                <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: cfg.color }}>
                  {format(event.date, "MMM")}
                </span>
                <span className="text-xl font-black leading-none" style={{ color: cfg.color }}>
                  {format(event.date, "d")}
                </span>
                <span className="text-[9px] font-bold" style={{ color: cfg.color }}>
                  {format(event.date, "EEE")}
                </span>
              </div>

              {/* Details */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black ${cfg.chip}`}>
                    <Icon size={9} strokeWidth={2.5} />
                    {cfg.label}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{ background: SOFT, color: MUTED }}
                  >
                    {event.duration}
                  </span>
                  {isImminant && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700 border border-amber-200">
                      Coming up
                    </span>
                  )}
                </div>
                <h3 className="mt-1.5 text-[13px] font-black leading-snug" style={{ color: TEXT }}>
                  {event.title}
                </h3>
                {event.location && (
                  <p className="mt-0.5 text-[12px] font-medium" style={{ color: MUTED }}>
                    📍 {event.location}
                  </p>
                )}
                {event.participants && (
                  <p className="mt-0.5 text-[12px] font-medium" style={{ color: MUTED }}>
                    👥 {event.participants}
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
