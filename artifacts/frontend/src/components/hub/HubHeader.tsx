import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { format } from "date-fns";
import { apiFetch } from "@/lib/api-fetch";
import { ArrowRight, CalendarDays } from "lucide-react";

const ROLE_KEY: Record<string, string> = {
  support_worker: "hub.role.supportWorker",
  support_coordinator: "hub.role.supportCoordinator",
  managing_director: "hub.role.managingDirector",
  allied_health: "hub.role.alliedHealth",
  admin: "hub.role.admin",
};

const ROLE_CTA_KEY: Record<string, { label: string; href: string }> = {
  support_worker: { label: "hub.header.cta.dashboard", href: "/dashboard" },
  support_coordinator: { label: "hub.header.cta.dashboard", href: "/dashboard" },
  managing_director: { label: "hub.header.cta.executive", href: "/md/executive" },
  allied_health: { label: "hub.header.cta.caseload", href: "/patients" },
  admin: { label: "hub.header.cta.dashboard", href: "/dashboard" },
};

interface OrgResponse {
  organization_name?: string;
  provider_number?: string;
}

export function HubHeader() {
  const { user } = useAuth();
  const { translate, translateParams } = useAccessibility();
  const [, navigate] = useLocation();
  const displayName = user?.full_name || user?.email || translate("hub.role.staffFallback");
  const role = translate(ROLE_KEY[user?.role ?? ""] ?? "hub.role.staffFallback");
  const today = format(new Date(), "EEEE, MMMM d");
  const cta = ROLE_CTA_KEY[user?.role ?? ""] ?? ROLE_CTA_KEY.support_coordinator;

  const [orgName, setOrgName] = useState<string>(translate("hub.orgFallback"));

  useEffect(() => {
    apiFetch("/api/hub/org")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: OrgResponse) => {
        setOrgName(data.organization_name || translate("hub.orgFallback"));
      })
      .catch(() => {});
  }, [translate]);

  const hour = new Date().getHours();
  const first = user?.full_name?.split(" ")[0] || translate("hub.header.greetingFallback");
  const greeting =
    hour < 12
      ? translateParams("hub.header.greetingMorning", { name: first })
      : hour < 17
        ? translateParams("hub.header.greetingAfternoon", { name: first })
        : translateParams("hub.header.greetingEvening", { name: first });

  return (
    <div
      className="relative overflow-hidden rounded-3xl"
      style={{ background: "var(--cc-plum)" }}
    >
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

      <div className="relative z-10 px-8 py-8">
        <span
          className="inline-flex items-center rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em]"
          style={{ background: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.9)" }}
        >
          {role}
        </span>

        <h1 className="mt-4 text-[30px] font-black leading-tight tracking-tight text-white sm:text-[36px]">
          {greeting}
        </h1>

        <p className="mt-1.5 text-[13px] font-semibold" style={{ color: "rgba(255,255,255,0.65)" }}>
          {orgName}
        </p>

        <div className="mt-1 flex items-center gap-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
          <CalendarDays size={12} strokeWidth={2.5} />
          <span className="text-[12px]">{today}</span>
        </div>

        <button
          onClick={() => navigate(cta.href)}
          className="mt-6 flex items-center gap-2 rounded-full px-5 py-2.5 text-[12px] font-black transition-opacity hover:opacity-90"
          style={{ background: "#FFFFFF", color: "#3730A3" }}
        >
          {translate(cta.label)}
          <ArrowRight size={13} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
