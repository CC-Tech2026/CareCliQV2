import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { format } from "date-fns";
import { Link } from "wouter";
import { ArrowRight, CalendarDays } from "lucide-react";
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

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const hour = now.getHours();

  const firstName =
    user?.full_name?.trim().split(/\s+/)[0] ||
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
  }, [translate, user?.organizationId]);

  if (isMD) {
    return (
      <header className="rounded-2xl border border-cc-border bg-cc-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5">
          <div className="min-w-0">
            <p className="text-xs font-medium text-cc-muted">{greeting}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-cc-text sm:text-3xl">Your executive briefing</h1>
            <p className="mt-2 break-words text-sm text-cc-muted">{orgName}</p>
          </div>
          <div className="flex flex-col gap-3">
            <time dateTime={format(now, "yyyy-MM-dd")} className="inline-flex items-center gap-2 text-xs font-medium text-cc-muted"><CalendarDays size={14} />{today}</time>
            <nav aria-label="Executive resources" className="flex flex-wrap gap-2">
              <Link href="/md/executive" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-cc-plum px-4 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum">Performance review<ArrowRight size={14} /></Link>
              <Link href="/reports" className="inline-flex min-h-11 items-center rounded-lg border border-cc-border px-4 text-sm font-semibold text-cc-text hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum">Report library</Link>
            </nav>
          </div>
        </div>
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
