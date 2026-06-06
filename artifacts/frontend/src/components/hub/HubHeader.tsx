import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { Building2, CalendarDays, Hash } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

const PLUM = "#5533CC";
const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT = "#F5F3FC";

interface OrgResponse {
  organization_name?: string;
  provider_number?: string;
}

function greeting(name?: string | null): string {
  const hour = new Date().getHours();
  const first = name?.split(" ")[0] || "there";

  if (hour < 12) return `Good morning, ${first}`;
  if (hour < 17) return `Good afternoon, ${first}`;
  return `Good evening, ${first}`;
}

export function HubHeader() {
  const { user } = useAuth();

  const [organizationName, setOrganizationName] =
    useState<string>("Organisation Hub");

  const [providerNumber, setProviderNumber] =
    useState<string>("Not Available");

  const today = format(new Date(), "EEEE, MMMM d, yyyy");

  useEffect(() => {
    apiFetch("/api/hub/org")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: OrgResponse) => {
        setOrganizationName(
          data.organization_name || "Organisation Hub"
        );

        setProviderNumber(
          data.provider_number || "Not Available"
        );
      })
      .catch(() => {
        console.error("Failed loading organisation data");
      });
  }, []);

  return (
    <div
      className="overflow-hidden rounded-2xl border bg-white shadow-sm"
      style={{ borderColor: BORDER }}
    >
      <div
        className="h-1.5 w-full"
        style={{
          background:
            "linear-gradient(90deg,#5533CC 0%,#6D4AFF 50%,#9D7DFF 100%)",
        }}
      />

      <div className="p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{ background: SOFT }}
            >
              <img
                src="/carecliQ_logo.png"
                alt="CareCliQ"
                className="h-12 w-12 object-contain"
              />
            </div>

            <div>
              <div className="mb-1 flex items-center gap-2">
                <Building2
                  size={13}
                  strokeWidth={2.5}
                  style={{ color: MUTED }}
                />

                <span
                  className="text-[11px] font-black uppercase tracking-[0.18em]"
                  style={{ color: MUTED }}
                >
                  CareCliQ Hub
                </span>
              </div>

              <h1
                className="text-2xl font-black"
                style={{ color: TEXT }}
              >
                {organizationName}
              </h1>

              <div className="mt-2 flex items-center gap-2">
                <Hash
                  size={12}
                  strokeWidth={2.5}
                  style={{ color: MUTED }}
                />

                <span
                  className="text-sm font-semibold"
                  style={{ color: MUTED }}
                >
                  Provider Number: {providerNumber}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-start gap-2 lg:items-end">
            <h2
              className="text-2xl font-black"
              style={{ color: PLUM }}
            >
              {greeting(user?.full_name)}
            </h2>

            <div
              className="flex items-center gap-2"
              style={{ color: MUTED }}
            >
              <CalendarDays size={14} strokeWidth={2.5} />
              <span className="text-sm font-medium">
                {today}
              </span>
            </div>

            <span
              className="inline-flex items-center rounded-full px-3 py-1 text-xs font-black capitalize"
              style={{
                background: "#EEE9FF",
                color: PLUM,
              }}
            >
              {user?.role?.replace(/_/g, " ") || "Staff Member"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}