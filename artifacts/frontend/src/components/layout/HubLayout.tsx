import { useAuth } from "@/contexts/AuthContext";

const PLUM = "#5533CC";
const TEXT = "#1E1640";
const BORDER = "#E2DEF2";

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

  return (
    <div className="min-h-screen w-full" style={{ background: "#F5F3FC" }}>
      {/* Slim top bar */}
      <header
        className="sticky top-0 z-30 w-full border-b bg-white/90 backdrop-blur-md"
        style={{ borderColor: BORDER }}
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-5 md:px-8">
          {/* Left: logo + org name */}
          <div className="flex items-center gap-3">
            <img
              src="/carecliQ_logo.png"
              alt="CareCliQ"
              className="h-8 w-8 object-contain"
            />
            <span className="text-[15px] font-black tracking-tight" style={{ color: TEXT }}>
              Sunshine Disability Services
            </span>
          </div>

          {/* Right: user avatar + name */}
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold"
              style={{ background: "#EDEAFF", color: PLUM }}
            >
              {initials}
            </div>
            <span className="hidden text-[13px] font-semibold sm:block" style={{ color: TEXT }}>
              {displayName.split(" ")[0]}
            </span>
          </div>
        </div>
      </header>

      {/* Full-width page content */}
      <main className="mx-auto max-w-7xl px-5 py-6 pb-16 md:px-8">
        {children}
      </main>
    </div>
  );
}
