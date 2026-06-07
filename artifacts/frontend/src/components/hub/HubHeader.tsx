import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { Building2, CalendarDays } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

const PLUM   = "#5533CC";
const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT   = "#F5F3FC";

const ROLE_LABEL: Record<string, string> = {
  support_worker:     "Support Worker",
  support_coordinator:"Support Coordinator",
  managing_director:  "Managing Director",
  allied_health:      "Allied Health",
  admin:              "Administrator",
};

interface OrgResponse {
  organization_name?: string;
  provider_number?: string;
}

function greeting(name?: string | null): string {
  const hour  = new Date().getHours();
  const first = name?.split(" ")[0] || "there";
  if (hour < 12) return `Good morning, ${first}`;
  if (hour < 17) return `Good afternoon, ${first}`;
  return `Good evening, ${first}`;
}

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export function HubHeader() {
  const { user } = useAuth();
  const displayName = user?.full_name || user?.email || "Staff Member";
  const initials    = getInitials(displayName);
  const role        = ROLE_LABEL[user?.role ?? ""] ?? "Staff Member";
  const today       = format(new Date(), "EEEE, MMMM d, yyyy");

  const [orgName, setOrgName]       = useState<string>("Organisation Hub");
  const [providerNum, setProviderNum] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/hub/org")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: OrgResponse) => {
        setOrgName(data.organization_name || "Organisation Hub");
        setProviderNum(data.provider_number || null);
      })
      .catch(() => {});
  }, []);

  return (
    <div
      className="overflow-hidden rounded-2xl border bg-white shadow-sm"
      style={{ borderColor: BORDER }}
    >
      <div className="flex flex-col gap-0 lg:flex-row">

        {/* LEFT — org identity */}
        <div
          className="flex items-center gap-5 px-7 py-6 lg:flex-1"
          style={{ borderRight: `1px solid ${BORDER}` }}
        >
          {/* Logo block */}
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl"
            style={{ background: SOFT }}
          >
            <img
              src="/carecliQ_logo.png"
              alt="CareCliQ"
              className="h-10 w-10 object-contain"
            />
          </div>

          {/* Org info */}
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-1.5">
              <Building2 size={11} strokeWidth={2.5} style={{ color: MUTED }} />
              <span
                className="text-[10px] font-black uppercase tracking-[0.2em]"
                style={{ color: MUTED }}
              >
                Organisation
              </span>
            </div>

            <h1 className="truncate text-[22px] font-black leading-tight" style={{ color: TEXT }}>
              {orgName}
            </h1>

            {providerNum && (
              <p className="mt-1 text-[12px] font-semibold" style={{ color: MUTED }}>
                NDIS Provider · {providerNum}
              </p>
            )}
          </div>
        </div>

        {/* RIGHT — personal greeting */}
        <div className="flex items-center justify-between gap-6 px-7 py-6 lg:w-[340px] lg:justify-start lg:flex-col lg:items-start lg:gap-3">
          {/* Avatar + name */}
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[13px] font-black"
              style={{ background: "#EDEAFF", color: PLUM }}
            >
              {initials}
            </div>
            <div>
              <p className="text-[14px] font-black leading-snug" style={{ color: TEXT }}>
                {greeting(user?.full_name)}
              </p>
              <span
                className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-black"
                style={{ background: SOFT, color: PLUM }}
              >
                {role}
              </span>
            </div>
          </div>

          {/* Date */}
          <div className="flex items-center gap-1.5" style={{ color: MUTED }}>
            <CalendarDays size={13} strokeWidth={2.5} />
            <span className="text-[12px] font-medium">{today}</span>
          </div>
        </div>

      </div>
    </div>
  );
}
