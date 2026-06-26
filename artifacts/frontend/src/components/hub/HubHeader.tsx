import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { apiFetch } from "@/lib/api-fetch";
import { ArrowRight, CalendarDays } from "lucide-react";

const ROLE_LABEL: Record<string, string> = {
  support_worker:      "Support Worker",
  support_coordinator: "Support Coordinator",
  managing_director:   "Managing Director",
  allied_health:       "Allied Health",
  admin:               "Administrator",
};

const ROLE_CTA: Record<string, { label: string; href: string }> = {
  support_worker:      { label: "View My Clients",       href: "/my-clients" },
  support_coordinator: { label: "Go to Dashboard",       href: "/dashboard" },
  managing_director:   { label: "Executive Dashboard",   href: "/md/executive" },
  allied_health:       { label: "View Caseload",         href: "/patients" },
  admin:               { label: "Go to Dashboard",       href: "/dashboard" },
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

export function HubHeader() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const displayName = user?.full_name || user?.email || "Staff Member";
  const role        = ROLE_LABEL[user?.role ?? ""] ?? "Staff Member";
  const today       = format(new Date(), "EEEE, MMMM d");
  const cta         = ROLE_CTA[user?.role ?? ""] ?? ROLE_CTA.support_coordinator;

  const [orgName, setOrgName] = useState<string>("Organisation Hub");

  useEffect(() => {
    apiFetch("/api/hub/org")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: OrgResponse) => {
        setOrgName(data.organization_name || "Organisation Hub");
      })
      .catch(() => {});
  }, []);

  return (
    <div
      className="relative overflow-hidden rounded-3xl"
      style={{ background: "var(--cc-plum)" }}
    >
      {/* Decorative circles */}
      <span
        className="pointer-events-none absolute -top-16 -right-16 h-56 w-56 rounded-full opacity-[0.12]"
        style={{ background: "var(--cc-bg)" }}
      />
      <span
        className="pointer-events-none absolute -bottom-10 right-20 h-36 w-36 rounded-full opacity-[0.07]"
        style={{ background: "var(--cc-bg)" }}
      />
      <span
        className="pointer-events-none absolute top-8 right-32 h-16 w-16 rounded-full opacity-[0.08]"
        style={{ background: "#BE185D" }}
      />
      <span
        className="pointer-events-none absolute bottom-6 -left-6 h-24 w-24 rounded-full opacity-[0.08]"
        style={{ background: "var(--cc-bg)" }}
      />

      {/* Content */}
      <div className="relative z-10 px-8 py-8">
        {/* Role badge */}
        <span
          className="inline-flex items-center rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em]"
          style={{ background: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.9)" }}
        >
          {role}
        </span>

        {/* Greeting */}
        <h1 className="mt-4 text-[30px] font-black leading-tight tracking-tight text-white sm:text-[36px]">
          {greeting(user?.full_name)}
        </h1>

        {/* Org + date */}
        <p className="mt-1.5 text-[13px] font-semibold" style={{ color: "rgba(255,255,255,0.65)" }}>
          {orgName}
        </p>

        <div className="mt-1 flex items-center gap-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
          <CalendarDays size={12} strokeWidth={2.5} />
          <span className="text-[12px]">{today}</span>
        </div>

        {/* CTA */}
        <button
          onClick={() => navigate(cta.href)}
          className="mt-6 flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[12px] font-black transition-opacity hover:opacity-90"
          style={{ color: "#3730A3" }}
        >
          {cta.label}
          <ArrowRight size={13} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
