import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { Building2, Hash } from "lucide-react";

const PLUM = "#5533CC";
const CORAL = "#F03060";
const TEXT = "#1E1640";
const MUTED = "#7A6A9E";

const ORG_DATA = {
  name: "CareCliQ Support Services",
  providerNumber: "4050123456",
  tagline: "Empowering independence through quality care",
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
      className="relative overflow-hidden rounded-3xl px-8 py-8"
      style={{
        background: `linear-gradient(135deg, ${PLUM} 0%, #7B4FE0 50%, #9B6FF0 100%)`,
      }}
    >
      {/* Background decoration */}
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full opacity-10"
        style={{ background: CORAL }}
      />
      <div
        className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full opacity-10"
        style={{ background: "#FFFFFF" }}
      />

      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: logo + org name */}
        <div className="flex items-center gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/15 shadow-lg backdrop-blur-sm">
            <img
              src="/carecliQ_logo.png"
              alt="CareCliQ"
              className="h-12 w-12 object-contain"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <Building2 size={13} className="text-white/70" />
              <span className="text-[11px] font-black uppercase tracking-[0.22em] text-white/70">
                Organisation Hub
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-white">
              {ORG_DATA.name}
            </h1>
            <div className="mt-1 flex items-center gap-1.5">
              <Hash size={12} className="text-white/60" />
              <span className="text-[12px] font-semibold text-white/70">
                Provider {ORG_DATA.providerNumber}
              </span>
            </div>
          </div>
        </div>

        {/* Right: greeting + date */}
        <div className="text-right">
          <p className="text-xl font-black text-white">
            {greeting(user?.full_name)}
          </p>
          <p className="mt-1 text-[13px] font-medium text-white/70">{today}</p>
          <span
            className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black capitalize"
            style={{ background: "rgba(255,255,255,0.18)", color: "#ffffff" }}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: CORAL }}
            />
            {user?.role?.replace(/_/g, " ") || "Staff Member"}
          </span>
        </div>
      </div>

      {/* Tagline strip */}
      <div className="relative mt-5 border-t border-white/10 pt-4">
        <p className="text-[12px] font-medium italic text-white/60">
          {ORG_DATA.tagline}
        </p>
      </div>
    </div>
  );
}
