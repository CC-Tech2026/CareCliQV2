import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { format } from "date-fns";
import { apiFetch } from "@/lib/api-fetch";

interface OrgResponse {
  organization_name?: string;
  provider_number?: string;
}

export function HubHeader() {
  const { user } = useAuth();
  const { translate, translateParams } = useAccessibility();

  const [orgName, setOrgName] = useState(
    translate("hub.orgFallback")
  );

  const now = new Date();
  const hour = now.getHours();

  const firstName =
    user?.full_name?.split(" ")[0] ??
    translate("hub.header.greetingFallback");

  const greeting =
    hour < 12
      ? translateParams("hub.header.greetingMorning", {
          name: firstName,
        })
      : hour < 17
        ? translateParams("hub.header.greetingAfternoon", {
            name: firstName,
          })
        : translateParams("hub.header.greetingEvening", {
            name: firstName,
          });

  const today = format(now, "EEEE, d MMMM yyyy");
  const isMD = user?.role === "managing_director";

  useEffect(() => {
    let cancelled = false;

    apiFetch("/api/hub/org")
      .then((res) =>
        res.ok ? res.json() : Promise.reject()
      )
      .then((data: OrgResponse) => {
        if (!cancelled) {
          setOrgName(
            data.organization_name ||
              translate("hub.orgFallback")
          );
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [translate]);

  if (isMD) {
    // A director's landing moment gets more weight than a staff greeting -
    // bigger type, a purple-tinted banner (carrying the same Governance
    // purple from the header line and login pages), and the org name reads
    // as a subheading rather than small print, since this whole view is
    // scoped to running that one organisation.
    return (
      <header
        className="flex items-end justify-between gap-6 rounded-2xl px-6 py-6 sm:px-8 sm:py-7"
        style={{ background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.12)" }}
      >
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: "#7C3AED" }}>
            Executive Overview
          </p>
          <h1
            className="mt-1.5 text-[32px] sm:text-[38px] font-black leading-[1.05] tracking-tight"
            style={{ color: "var(--cc-text)" }}
          >
            {greeting}
          </h1>
          <p className="mt-2 text-[15px] font-bold" style={{ color: "var(--cc-muted)" }}>
            {orgName}
          </p>
        </div>

        <time
          className="hidden shrink-0 text-[12px] font-bold sm:block"
          style={{ color: "var(--cc-muted)" }}
        >
          {today}
        </time>
      </header>
    );
  }

  return (
    <header className="flex items-end justify-between gap-6 px-1">

      <div className="min-w-0">

        <h1
          className="text-[25px] font-black tracking-tight"
          style={{
            color: "var(--cc-text)",
          }}
        >
          {greeting}
        </h1>

        <p
          className="mt-1 text-[12px]"
          style={{
            color: "var(--cc-muted)",
          }}
        >
          {orgName}
        </p>

      </div>

      <time
        className="hidden shrink-0 text-[11px] font-semibold sm:block"
        style={{
          color: "var(--cc-muted)",
        }}
      >
        {today}
      </time>

    </header>
  );
}