import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  ArrowRight,
  UserRound,
  LayoutDashboard,
  Crown,
  Lock,
} from "lucide-react";

const PLUM   = "#5533CC";
const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const SOFT   = "#F5F3FC";
const BORDER = "#E2DEF2";
const CORAL  = "#F03060";

interface WorkspaceCard {
  role: string;
  title: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  allowedRoles: string[];
  accentColor: string;
  comingSoon?: boolean;
}

const WORKSPACES: WorkspaceCard[] = [
  {
    role: "Support Worker",
    title: "Support Worker",
    description: "Client visits, shift notes, daily documentation, and compliance tracking.",
    href: "/my-clients",
    icon: UserRound,
    allowedRoles: ["support_worker"],
    accentColor: PLUM,
  },
  {
    role: "Support Coordinator",
    title: "Support Coordinator",
    description: "Team oversight, NDIS plans, participant management, and billing.",
    href: "/dashboard",
    icon: LayoutDashboard,
    allowedRoles: ["support_coordinator"],
    accentColor: CORAL,
  },
  {
    role: "Managing Director",
    title: "Managing Director",
    description: "Executive overview, organisation analytics, and strategic reporting.",
    href: "/compliance",
    icon: Crown,
    allowedRoles: [],
    accentColor: "#F59E0B",
    comingSoon: true,
  },
];

export function WorkspaceLauncher() {
  const { user } = useAuth();
  const role = user?.role;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>
            Workspace Launcher
          </h2>
          <p className="mt-0.5 text-[15px] font-black" style={{ color: TEXT }}>
            Choose your workspace
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {WORKSPACES.map((ws) => {
          const Icon = ws.icon;
          const isOwned = ws.allowedRoles.includes(role || "");

          const CardContent = (
            <div
              className={`group relative flex flex-col overflow-hidden rounded-xl border bg-white p-5 transition-all duration-200 ${
                ws.comingSoon
                  ? "opacity-60 cursor-default"
                  : "hover:shadow-md hover:-translate-y-0.5 cursor-pointer"
              }`}
              style={{ borderColor: isOwned && !ws.comingSoon ? ws.accentColor : BORDER }}
            >
              {/* Icon */}
              <div
                className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg"
                style={{ background: SOFT, color: ws.comingSoon ? MUTED : ws.accentColor }}
              >
                <Icon size={18} strokeWidth={2.5} />
              </div>

              {/* Role chip */}
              <span
                className="mb-2 inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
                style={{ background: SOFT, color: MUTED }}
              >
                {ws.role}
              </span>

              <h3 className="text-[14px] font-black leading-snug" style={{ color: TEXT }}>
                {ws.title}
              </h3>
              <p
                className="mt-1.5 flex-1 text-[12px] font-medium leading-relaxed"
                style={{ color: MUTED }}
              >
                {ws.description}
              </p>

              {/* CTA */}
              <div className="mt-4">
                {ws.comingSoon ? (
                  <div
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-black"
                    style={{ background: SOFT, color: MUTED }}
                  >
                    <Lock size={11} strokeWidth={2.5} />
                    Coming Soon
                  </div>
                ) : (
                  <div
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-black transition-all group-hover:gap-3"
                    style={{
                      background: isOwned ? ws.accentColor : SOFT,
                      color: isOwned ? "#ffffff" : MUTED,
                    }}
                  >
                    Launch Workspace
                    <ArrowRight size={12} strokeWidth={2.5} />
                  </div>
                )}
              </div>

              {/* Active dot */}
              {isOwned && !ws.comingSoon && (
                <div
                  className="absolute right-4 top-4 h-2 w-2 rounded-full"
                  style={{ background: "#10B981" }}
                  title="Your active workspace"
                />
              )}
            </div>
          );

          return ws.comingSoon ? (
            <div key={ws.role}>{CardContent}</div>
          ) : (
            <Link key={ws.role} href={ws.href}>
              {CardContent}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
