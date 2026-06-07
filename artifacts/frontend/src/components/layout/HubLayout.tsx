import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api-fetch";

const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT   = "#F7F5FF";
const PLUM   = "#5533CC";

const ROLE_LABEL: Record<string, string> = {
  support_worker:     "Support Worker",
  support_coordinator:"Support Coordinator",
  managing_director:  "Managing Director",
  allied_health:      "Allied Health",
  admin:              "Administrator",
};

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function HubLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const displayName = user?.full_name || user?.email || "Staff Member";
  const initials    = getInitials(displayName);
  const role        = ROLE_LABEL[user?.role ?? ""] ?? "Staff Member";

  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/hub/org")
      .then((res) => res.ok ? res.json() : Promise.reject())
      .then((data) => setOrgName(data?.organization_name || null))
      .catch(() => setOrgName(null));
  }, []);

  return (
    <div className="min-h-screen" style={{ background: SOFT }}>

      {/* ── STICKY HEADER ─────────────────────────────── */}
      <header
        className="sticky top-0 z-50 bg-white"
        style={{ borderBottom: `1px solid ${BORDER}`, boxShadow: "0 1px 0 0 #E2DEF2" }}
      >
        {/* Plum accent line */}
        <div style={{ height: 3, background: PLUM }} />

        <div className="mx-auto max-w-7xl px-6">
          <div className="flex h-14 items-center justify-between">

            {/* LEFT — logo + org */}
            <div className="flex items-center gap-4">
              <img
                src="/carecliQ_logo.png"
                alt="CareCliQ"
                className="h-8 w-auto object-contain"
              />
              <div
                className="hidden h-5 w-px sm:block"
                style={{ background: BORDER }}
              />
              <span
                className="hidden text-[13px] font-semibold sm:block"
                style={{ color: TEXT }}
              >
                {orgName ?? "Organisation Hub"}
              </span>
            </div>

            {/* RIGHT — role + name + avatar */}
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <div className="text-[11px] font-semibold" style={{ color: MUTED }}>
                  {role}
                </div>
                <div className="text-[13px] font-bold" style={{ color: TEXT }}>
                  {displayName}
                </div>
              </div>

              <div
                className="flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-black"
                style={{ background: "#EDEAFF", color: PLUM }}
              >
                {initials}
              </div>
            </div>

          </div>
        </div>
      </header>

      {/* ── CONTENT ──────────────────────────────────── */}
      <main className="mx-auto max-w-7xl px-6 py-8">
        {children}
      </main>
    </div>
  );
}
