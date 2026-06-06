import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api-fetch";

const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT   = "#F5F3FC";
const PLUM   = "#5533CC";

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
  const initials = getInitials(displayName);

  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/hub/org")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => { setOrgName(data?.organization_name || null); })
      .catch(() => { setOrgName(null); });
  }, []);

  const orgDisplay = orgName ?? "CareCliQ Hub";

  return (
    <div className="min-h-screen w-full" style={{ background: SOFT }}>
      {/* Top bar — matches AppLayout header proportions */}
      <header
        className="sticky top-0 z-30 w-full border-b bg-white"
        style={{ borderColor: BORDER }}
      >
        <div className="mx-auto flex h-[56px] max-w-7xl items-center justify-between gap-4 px-5 md:px-8">
          {/* Left: logo + org name */}
          <div className="flex items-center gap-3">
            <img
              src="/carecliQ_logo.png"
              alt="CareCliQ"
              className="h-10 w-10 object-contain shrink-0"
            />
            <div className="h-5 w-px" style={{ background: BORDER }} />
            <span
              className="text-[14px] font-black tracking-tight hidden sm:block"
              style={{ color: TEXT }}
            >
              {orgDisplay}
            </span>
          </div>

          {/* Right: user avatar + name */}
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold shrink-0"
              style={{ background: "#EDEAFF", color: PLUM }}
            >
              {initials}
            </div>
            <span
              className="hidden text-[13px] font-semibold sm:block"
              style={{ color: MUTED }}
            >
              {displayName.split(" ")[0]}
            </span>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="mx-auto max-w-7xl px-5 py-6 pb-16 md:px-8">
        {children}
      </main>
    </div>
  );
}
