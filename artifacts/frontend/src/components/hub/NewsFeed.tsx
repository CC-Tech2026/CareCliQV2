import { formatDistanceToNow } from "date-fns";
import { Megaphone, GraduationCap, AlertCircle, Star, FileText, Shield } from "lucide-react";

const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT = "#F5F3FC";

type Severity = "critical" | "high" | "medium" | "info" | "positive";

interface NewsItem {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  timestamp: Date;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  category: string;
}

const NEWS_ITEMS: NewsItem[] = [
  {
    id: "n1",
    title: "NDIS Price Guide 2025–26 Now Active",
    body: "The updated NDIS Support Catalogue effective 1 July 2025 introduces new line items for Assistive Technology and revised rates for Core Supports. All claims must reference the updated item numbers from this date.",
    severity: "critical",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
    icon: Shield,
    category: "Policy Update",
  },
  {
    id: "n2",
    title: "Mandatory Manual Handling Refresher — Due 30 June",
    body: "All support workers are required to complete the annual manual handling and safe practices refresher before 30 June. Bookings are open via the Toolkit. Failure to complete will trigger a credential flag.",
    severity: "high",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 18),
    icon: GraduationCap,
    category: "Training",
  },
  {
    id: "n3",
    title: "Internal Audit Scheduled — 14–16 July 2026",
    body: "Our annual internal NDIS Quality & Safeguards Commission audit is scheduled for 14–16 July. All practitioners should ensure session notes are finalised and compliance scores are above 85% before this date.",
    severity: "high",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 36),
    icon: AlertCircle,
    category: "Audit Reminder",
  },
  {
    id: "n4",
    title: "Team Achievement: 100% Compliance This Quarter",
    body: "Congratulations to our entire support team! We achieved a 100% NDIS compliance rate across all active participants for Q4. This is a remarkable milestone and reflects the dedication of every staff member.",
    severity: "positive",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 48),
    icon: Star,
    category: "Staff Achievement",
  },
  {
    id: "n5",
    title: "Updated Incident Reporting Policy (IRP-2025-v3)",
    body: "The Incident Reporting Policy has been revised to align with the updated NDIS Code of Conduct. All staff must read and acknowledge the new policy. An acknowledgement task will appear in your Toolkit.",
    severity: "medium",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 72),
    icon: FileText,
    category: "Policy Update",
  },
  {
    id: "n6",
    title: "Behaviour Support Plan Training — Online Module Available",
    body: "A new self-paced online module on Positive Behaviour Support is now available in the Toolkit. This module is recommended for all frontline support workers and mandatory for those supporting participants with complex needs.",
    severity: "info",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 96),
    icon: GraduationCap,
    category: "Training",
  },
  {
    id: "n7",
    title: "Organisation Newsletter — June 2026",
    body: "This month's newsletter includes a message from the Director, highlights from our community outreach program, and a spotlight on our participant success stories. Read the full edition in the Toolkit.",
    severity: "info",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 120),
    icon: Megaphone,
    category: "Announcement",
  },
];

const SEVERITY_STYLES: Record<Severity, { badge: string; dot: string; label: string }> = {
  critical: {
    badge: "bg-red-50 text-red-700 border border-red-200",
    dot: "#EF4444",
    label: "Critical",
  },
  high: {
    badge: "bg-orange-50 text-orange-700 border border-orange-200",
    dot: "#F97316",
    label: "High",
  },
  medium: {
    badge: "bg-amber-50 text-amber-700 border border-amber-200",
    dot: "#F59E0B",
    label: "Medium",
  },
  info: {
    badge: "bg-blue-50 text-blue-700 border border-blue-200",
    dot: "#3B82F6",
    label: "Info",
  },
  positive: {
    badge: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    dot: "#10B981",
    label: "Positive",
  },
};

export function NewsFeed() {
  return (
    <section className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black" style={{ color: TEXT }}>
            News & Announcements
          </h2>
          <p className="mt-0.5 text-[12px] font-medium" style={{ color: MUTED }}>
            Policy updates, training, and org-wide communications
          </p>
        </div>
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-black"
          style={{ background: SOFT, color: "#5533CC" }}
        >
          {NEWS_ITEMS.length}
        </span>
      </div>

      <div className="space-y-3">
        {NEWS_ITEMS.map((item) => {
          const sty = SEVERITY_STYLES[item.severity];
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              className="flex gap-4 rounded-xl border p-4 transition-colors hover:bg-[#FAFAFA]"
              style={{ borderColor: BORDER }}
            >
              {/* Icon */}
              <div
                className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                style={{ background: SOFT, color: "#5533CC" }}
              >
                <Icon size={16} strokeWidth={2.5} />
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${sty.badge}`}>
                    {sty.label}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{ background: SOFT, color: MUTED }}
                  >
                    {item.category}
                  </span>
                </div>
                <h3 className="mt-1.5 text-[13px] font-black leading-snug" style={{ color: TEXT }}>
                  {item.title}
                </h3>
                <p className="mt-1 text-[12px] font-medium leading-relaxed" style={{ color: MUTED }}>
                  {item.body}
                </p>
                <p className="mt-2 text-[11px] font-semibold" style={{ color: MUTED }}>
                  {formatDistanceToNow(item.timestamp, { addSuffix: true })}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
