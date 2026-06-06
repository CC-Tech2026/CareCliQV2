import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api-fetch";

const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT = "#F7F5FF";
const PLUM = "#5533CC";

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) return "Good Morning";
  if (hour < 18) return "Good Afternoon";
  return "Good Evening";
}

export function HubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();

  const displayName =
    user?.full_name ||
    user?.email ||
    "Staff Member";

  const initials = getInitials(displayName);

  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/hub/org")
      .then((res) =>
        res.ok ? res.json() : Promise.reject()
      )
      .then((data) => {
        setOrgName(
          data?.organization_name || null
        );
      })
      .catch(() => {
        setOrgName(null);
      });
  }, []);

  const orgDisplay =
    orgName || "Organisation";

  const firstName =
    displayName.split(" ")[0];

  return (
    <div
      className="min-h-screen"
      style={{
        background: SOFT,
      }}
    >
      {/* HUB HEADER */}
      <header
        className="sticky top-0 z-50 border-b bg-white/95 backdrop-blur"
        style={{
          borderColor: BORDER,
        }}
      >
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex h-20 items-center justify-between">
            {/* LEFT */}
            <div className="flex items-center gap-5">
              <img
                src="/carecliQ_logo.png"
                alt="CareCliQ"
                className="h-12 w-auto object-contain"
              />

              <div
                className="h-10 w-px"
                style={{
                  background: BORDER,
                }}
              />

              <div>
                <div
                  className="text-xs font-bold uppercase tracking-[0.2em]"
                  style={{
                    color: MUTED,
                  }}
                >
                  CareCliQ Hub
                </div>

                <div
                  className="text-lg font-bold"
                  style={{
                    color: TEXT,
                  }}
                >
                  {orgDisplay}
                </div>
              </div>
            </div>

            {/* RIGHT */}
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <div
                  className="text-xs"
                  style={{
                    color: MUTED,
                  }}
                >
                  Signed in as
                </div>

                <div
                  className="text-sm font-semibold"
                  style={{
                    color: TEXT,
                  }}
                >
                  {displayName}
                </div>
              </div>

              <div
                className="flex h-11 w-11 items-center justify-center rounded-full font-bold"
                style={{
                  background: "#EDEAFF",
                  color: PLUM,
                }}
              >
                {initials}
              </div>
            </div>
          </div>
        </div>
      </header>
      
      {/* CONTENT */}
      <main className="mx-auto max-w-7xl px-6 py-8">
        {children}
      </main>
    </div>
  );
}