import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowRight, UserRound, LayoutDashboard, Stethoscope, Crown, Lock } from "lucide-react";

const PLUM = "#5533CC";
const CORAL = "#F03060";
const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const SOFT = "#F5F3FC";
const BORDER = "#E2DEF2";

interface WorkspaceCard {
  role: string;
  title: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  gradient: string;
  allowedRoles: string[];
  comingSoon?: boolean;
}

const WORKSPACES: WorkspaceCard[] = [
  {
    role: "Support Worker",
    title: "Support Worker",
    description: "Client visits, shift notes, daily documentation, and compliance tracking.",
    href: "/my-clients",
    icon: UserRound,
    gradient: "linear-gradient(135deg, #5533CC 0%, #7B4FE0 100%)",
    allowedRoles: ["support_worker"],
  },
  {
    role: "Support Coordinator",
    title: "Support Coordinator",
    description: "Team oversight, NDIS plans, participant management, and billing.",
    href: "/dashboard",
    icon: LayoutDashboard,
    gradient: "linear-gradient(135deg, #F03060 0%, #FF6B95 100%)",
    allowedRoles: ["support_coordinator"],
  },
  {
    role: "Clinician",
    title: "Clinician",
    description: "Clinical sessions, assessments, reports, and therapeutic outcomes.",
    href: "/sessions",
    icon: Stethoscope,
    gradient: "linear-gradient(135deg, #0EA5E9 0%, #38BDF8 100%)",
    allowedRoles: ["allied_health"],
  },
  {
    role: "Managing Director",
    title: "Managing Director",
    description: "Executive overview, organisation analytics, and strategic reporting.",
    href: "/compliance",
    icon: Crown,
    gradient: "linear-gradient(135deg, #F59E0B 0%, #FCD34D 100%)",
    allowedRoles: [],
    comingSoon: true,
  },
];

export function WorkspaceLauncher() {
  const { user } = useAuth();
  const role = user?.role;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-black" style={{ color: TEXT }}>
          Workspace Launcher
        </h2>
        <span
          className="rounded-full px-3 py-1 text-[11px] font-black"
          style={{ background: SOFT, color: PLUM }}
        >
          {WORKSPACES.length} workspaces
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {WORKSPACES.map((ws) => {
          const Icon = ws.icon;
          const isOwned = ws.allowedRoles.includes(role || "");

          const CardContent = (
            <div
              className={`group relative flex flex-col overflow-hidden rounded-2xl border p-5 transition-all duration-200 ${
                ws.comingSoon
                  ? "opacity-70 cursor-default"
                  : "hover:shadow-lg hover:-translate-y-0.5 cursor-pointer"
              }`}
              style={{ borderColor: BORDER, background: "#FFFFFF" }}
            >
              {/* Icon area */}
              <div
                className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl text-white shadow-md"
                style={{ background: ws.gradient }}
              >
                <Icon size={22} strokeWidth={2.5} />
              </div>

              {/* Role badge */}
              <span
                className="mb-2 inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider"
                style={{ background: SOFT, color: PLUM }}
              >
                {ws.role}
              </span>

              <h3 className="text-[15px] font-black leading-snug" style={{ color: TEXT }}>
                {ws.title}
              </h3>
              <p className="mt-1.5 text-[12px] font-medium leading-relaxed flex-1" style={{ color: MUTED }}>
                {ws.description}
              </p>

              {/* CTA */}
              <div className="mt-4">
                {ws.comingSoon ? (
                  <div
                    className="flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-black"
                    style={{ background: SOFT, color: MUTED }}
                  >
                    <Lock size={12} strokeWidth={2.5} />
                    Coming Soon
                  </div>
                ) : (
                  <div
                    className="flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-black text-white shadow-sm transition-all group-hover:gap-3"
                    style={{ background: isOwned ? PLUM : MUTED }}
                  >
                    Launch
                    <ArrowRight size={13} strokeWidth={2.5} />
                  </div>
                )}
              </div>

              {/* Active indicator */}
              {isOwned && !ws.comingSoon && (
                <div
                  className="absolute right-4 top-4 h-2.5 w-2.5 rounded-full"
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
