/**
 * Modern Profile Dropdown Menu
 * Interactive, professional, healthcare-focused user menu
 */

import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { LogOut, Settings, User, ShieldCheck, LockKeyhole } from "lucide-react";
import { DESIGN_SYSTEM as DS } from "@/lib/design-system";

interface ProfileDropdownProps {
  displayName: string;
  displayRole: string;
  initials: string;
  userRole?: string;
  onLogout: () => void;
}

export function ProfileDropdown({
  displayName,
  displayRole,
  initials,
  userRole,
  onLogout,
}: ProfileDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
    return undefined;
  }, [open]);

  const isWorker = userRole === "support_worker";

  return (
    <div className="relative" ref={ref}>
      {/* Profile Button */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 px-3 py-2 rounded-full transition-all hover:bg-black/5 active:scale-95"
        title={displayName}
      >
        <div className="text-right hidden sm:block">
          <p className="text-sm font-bold" style={{ color: DS.TEXT.primary }}>
            {displayName.split(" ")[0]}
          </p>
          <p className="text-xs font-medium capitalize" style={{ color: DS.TEXT.muted }}>
            {displayRole.split(" ")[0]}
          </p>
        </div>
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-black shrink-0 border-2 transition-all"
          style={{
            background: DS.BACKGROUND.section,
            color: DS.BRAND.primary,
            borderColor: open ? DS.BRAND.primary : DS.BORDER.light,
          }}
        >
          {initials}
        </div>
      </button>

      {/* Dropdown Menu */}
      {open && (
        <div
          className="absolute right-0 mt-2 w-64 rounded-xl shadow-lg border overflow-hidden z-50 animate-in fade-in-0 zoom-in-95 duration-200"
          style={{
            background: DS.BACKGROUND.card,
            borderColor: DS.BORDER.default,
            boxShadow: DS.SHADOWS.lg,
          }}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b" style={{ borderColor: DS.BORDER.light }}>
            <p className="text-sm font-bold" style={{ color: DS.TEXT.primary }}>
              {displayName}
            </p>
            <p className="text-xs font-medium capitalize mt-1" style={{ color: DS.TEXT.muted }}>
              {displayRole}
            </p>
          </div>

          {/* Menu Items */}
          <div className="py-2">
            {/* My Profile */}
            {isWorker && (
              <Link href="/worker/profile">
                <button
                  onClick={() => setOpen(false)}
                  className="w-full flex items-center gap-3 px-6 py-3 text-sm font-medium transition-colors hover:bg-black/5"
                  style={{ color: DS.TEXT.primary }}
                >
                  <User size={16} strokeWidth={2} />
                  <span>My Profile</span>
                </button>
              </Link>
            )}

            {/* Settings */}
            <Link href="/settings">
              <button
                onClick={() => setOpen(false)}
                className="w-full flex items-center gap-3 px-6 py-3 text-sm font-medium transition-colors hover:bg-black/5"
                style={{ color: DS.TEXT.primary }}
              >
                <Settings size={16} strokeWidth={2} />
                <span>Settings</span>
              </button>
            </Link>

            {/* Security */}
            {isWorker && (
              <Link href="/worker/security">
                <button
                  onClick={() => setOpen(false)}
                  className="w-full flex items-center gap-3 px-6 py-3 text-sm font-medium transition-colors hover:bg-black/5"
                  style={{ color: DS.TEXT.primary }}
                >
                  <LockKeyhole size={16} strokeWidth={2} />
                  <span>Security</span>
                </button>
              </Link>
            )}

            {/* Divider */}
            <div className="h-px my-2" style={{ background: DS.BORDER.light }} />

            {/* Logout */}
            <button
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className="w-full flex items-center gap-3 px-6 py-3 text-sm font-medium transition-colors hover:bg-red-50"
              style={{ color: DS.STATUS.critical }}
            >
              <LogOut size={16} strokeWidth={2} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
