import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { Building2, CalendarDays, Hash } from "lucide-react";

const PLUM  = "#5533CC";
const TEXT  = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT  = "#F5F3FC";

const ORG_DATA = {
  name: "CareCliQ Support Services",
  providerNumber: "4050123456",
};

function greeting(name?: string | null): string {
  const hour = new Date().getHours();
  const first = name?.split(" ")[0] || "there";
  if (hour < 12) return `Good morning, ${first}`;
  if (hour < 17) return `Good afternoon, ${first}`;
  return `Good evening, ${first}`;
}

export function HubHeader() {
  const { user } = useAuth();
  const today = format(new Date(), "EEEE, MMMM d, yyyy");

  return (
    <div
      className="rounded-xl border bg-white px-6 py-5 shadow-sm"
      style={{ borderColor: BORDER }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: org identity */}
        <div className="flex items-center gap-4">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg"
            style={{ background: SOFT }}
          >
            <img
              src="/carecliQ_logo.png"
              alt="CareCliQ"
              className="h-9 w-9 object-contain"
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <Building2 size={11} strokeWidth={2.5} style={{ color: MUTED }} />
              <span
                className="text-[10px] font-black uppercase tracking-[0.18em]"
                style={{ color: MUTED }}
              >
                Organisation Hub
              </span>
            </div>
            <h1 className="text-[17px] font-black leading-tight" style={{ color: TEXT }}>
              {ORG_DATA.name}
            </h1>
            <div className="mt-0.5 flex items-center gap-1">
              <Hash size={11} strokeWidth={2.5} style={{ color: MUTED }} />
              <span className="text-[11px] font-semibold" style={{ color: MUTED }}>
                Provider {ORG_DATA.providerNumber}
              </span>
            </div>
          </div>
        </div>

        {/* Right: greeting + date + role badge */}
        <div className="flex flex-col items-start gap-1.5 sm:items-end">
          <p className="text-[17px] font-black" style={{ color: PLUM }}>
            {greeting(user?.full_name)}
          </p>
          <div className="flex items-center gap-1.5" style={{ color: MUTED }}>
            <CalendarDays size={12} strokeWidth={2.5} />
            <span className="text-[12px] font-medium">{today}</span>
          </div>
          <span
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-black capitalize"
            style={{ background: SOFT, color: PLUM }}
          >
            {user?.role?.replace(/_/g, " ") || "Staff Member"}
          </span>
        </div>
      </div>
    </div>
  );
}
