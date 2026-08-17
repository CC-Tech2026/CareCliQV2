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