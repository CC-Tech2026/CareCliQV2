import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, CalendarDays, ShieldCheck, Settings, Plus, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/patients", label: "Participants", icon: Users },
  { href: "/sessions", label: "Sessions", icon: CalendarDays },
  { href: "/compliance", label: "Compliance", icon: ShieldCheck },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex min-h-screen w-full bg-slate-50 dark:bg-slate-950">
      <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col shrink-0 sticky top-0 h-screen hidden md:flex">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-8">
            <div className="bg-primary p-1.5 rounded-lg">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <span className="font-semibold text-lg tracking-tight">Clinical Companion</span>
          </div>
          
          <div className="space-y-6">
            <div>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-3">Menu</div>
              <nav className="space-y-1">
                {navItems.map((item) => {
                  const isActive = location.startsWith(item.href);
                  return (
                    <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive ? "bg-primary/10 text-primary" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200"}`}>
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>

        <div className="mt-auto p-6 border-t border-slate-200 dark:border-slate-800">
          <Button variant="outline" className="w-full justify-start gap-2 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 shadow-none">
            <Settings className="h-4 w-4" />
            Settings
          </Button>
          <div className="flex items-center gap-3 mt-4 px-2">
            <Avatar className="h-9 w-9 border border-slate-200 dark:border-slate-800">
              <AvatarFallback className="bg-primary/5 text-primary">DR</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="text-sm font-medium leading-none">Dr. Provider</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">Solo Practitioner</span>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-10 flex items-center justify-between px-6 md:px-8">
          <div className="md:hidden flex items-center gap-2">
            <div className="bg-primary p-1.5 rounded-lg">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <span className="font-semibold tracking-tight">Clinical Companion</span>
          </div>
          <div className="hidden md:block" />
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="text-slate-500 hover:text-slate-700 relative">
              <Bell className="h-5 w-5" />
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-destructive border-2 border-white dark:border-slate-900" />
            </Button>
            <Link href="/sessions/new">
              <Button size="sm" className="gap-2 shadow-sm">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New Session</span>
              </Button>
            </Link>
          </div>
        </header>

        <main className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
