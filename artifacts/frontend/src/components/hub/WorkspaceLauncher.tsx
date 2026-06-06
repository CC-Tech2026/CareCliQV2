import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowRight, UserRound, LayoutDashboard, Crown } from "lucide-react";

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
  const role = user?.role ?? "";

  const ws = WORKSPACES.find((w) => w.allowedRoles.includes(role));
  if (!ws) return null;

  const Icon = ws.icon;

  return (
    <section>
      <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>
        Your Workspace
      </p>

      <Link href={ws.href}>
        <div
          className="group flex items-center gap-4 rounded-xl border bg-white px-5 py-4 transition-all duration-150 hover:shadow-md hover:-translate-y-px cursor-pointer"
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
            style={{ background: ws.accentColor, color: "#ffffff" }}
          >
            Launch
            <ArrowRight size={13} strokeWidth={2.5} />
          </div>
        </div>
      </Link>
    </section>
  );
}
