import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowRight, UserRound, LayoutDashboard, Crown, Loader2 } from "lucide-react";

const PLUM   = "#5533CC";
const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const SOFT   = "#F5F3FC";
const BORDER = "#E2DEF2";
const CORAL  = "#F03060";

interface WorkspaceDef {
  title: string;
  subtitle: string;
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  allowedRoles: string[];
  accentColor: string;
}

const WORKSPACES: WorkspaceDef[] = [
  {
    title: "Support Worker Workspace",
    subtitle: "Client visits, shift notes, daily documentation and compliance tracking.",
    href: "/my-clients",
    icon: UserRound,
    allowedRoles: ["support_worker"],
    accentColor: PLUM,
  },
  {
    title: "Support Coordinator Workspace",
    subtitle: "Team oversight, NDIS plans, participant management and billing.",
    href: "/dashboard",
    icon: LayoutDashboard,
    allowedRoles: ["support_coordinator"],
    accentColor: CORAL,
  },
  {
    title: "Managing Director Workspace",
    subtitle: "Executive overview, organisation analytics and strategic reporting.",
    href: "/dashboard",
    icon: Crown,
    allowedRoles: ["managing_director", "admin"],
    accentColor: "#F59E0B",
  },
];

export function WorkspaceLauncher() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [launching, setLaunching] = useState(false);

  const role = user?.role ?? "";
  const ws = WORKSPACES.find((w) => w.allowedRoles.includes(role));

  if (!ws) return null;

  const Icon = ws.icon;

  function handleLaunch(e: React.MouseEvent) {
    e.preventDefault();
    if (launching) return;
    setLaunching(true);
    setTimeout(() => {
      navigate(ws.href);
    }, 1800);
  }

  return (
    <>
      {/* Full-screen launch overlay */}
      {launching && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6"
          style={{ background: "rgba(245,243,252,0.96)", backdropFilter: "blur(6px)" }}
        >
          {/* Pulsing icon ring */}
          <div className="relative flex items-center justify-center">
            <span
              className="absolute h-24 w-24 animate-ping rounded-full opacity-20"
              style={{ background: ws.accentColor }}
            />
            <div
              className="relative flex h-20 w-20 items-center justify-center rounded-2xl shadow-lg"
              style={{ background: ws.accentColor }}
            >
              <Icon size={32} strokeWidth={2.5} color="#fff" />
            </div>
          </div>

          {/* Spinner + label */}
          <div className="flex flex-col items-center gap-2">
            <Loader2
              size={22}
              strokeWidth={2.5}
              className="animate-spin"
              style={{ color: ws.accentColor }}
            />
            <p className="text-[15px] font-black" style={{ color: TEXT }}>
              Launching {ws.title}
            </p>
            <p className="text-[12px] font-medium" style={{ color: MUTED }}>
              Setting up your workspace…
            </p>
          </div>
        </div>
      )}

      {/* Launcher row */}
      <section>
        <p
          className="mb-3 text-[11px] font-black uppercase tracking-[0.18em]"
          style={{ color: MUTED }}
        >
          Your Workspace
        </p>

        <button
          onClick={handleLaunch}
          disabled={launching}
          className="group w-full flex items-center gap-4 rounded-xl border bg-white px-5 py-4 text-left transition-all duration-150 hover:shadow-md hover:-translate-y-px disabled:pointer-events-none"
          style={{ borderColor: BORDER }}
        >
          {/* Icon well */}
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
            style={{ background: SOFT, color: ws.accentColor }}
          >
            <Icon size={20} strokeWidth={2.5} />
          </div>

          {/* Text */}
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-black leading-snug" style={{ color: TEXT }}>
              {ws.title}
            </p>
            <p className="mt-0.5 truncate text-[12px] font-medium" style={{ color: MUTED }}>
              {ws.subtitle}
            </p>
          </div>

          {/* CTA */}
          <div
            className="flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-black transition-all duration-150 group-hover:gap-3"
            style={{ background: ws.accentColor, color: "#fff" }}
          >
            {launching ? (
              <Loader2 size={13} strokeWidth={2.5} className="animate-spin" />
            ) : (
              <>
                Launch
                <ArrowRight size={13} strokeWidth={2.5} />
              </>
            )}
          </div>
        </button>
      </section>
    </>
  );
}
