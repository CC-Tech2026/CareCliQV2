/**
 * Modern Profile Dropdown Menu
 * Interactive, professional, healthcare-focused user menu
 */

import { useState } from "react";
import { Link } from "wouter";
import { LogOut, Settings, User, LockKeyhole, Shield, HelpCircle } from "lucide-react";
import { DESIGN_SYSTEM as DS } from "@/lib/design-system";
import { ProfileThemeToggle } from "@/components/layout/ProfileThemeToggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useAuth } from "@/contexts/AuthContext";

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
  const { translate } = useAccessibility();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const isWorker = userRole === "support_worker";

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-3 px-3 py-2 rounded-full transition-all hover:bg-cc-bg active:scale-95 outline-none"
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
            className="w-10 h-10 overflow-hidden rounded-full flex items-center justify-center text-xs font-black shrink-0 border-2 transition-all"
            style={{
              background: DS.BACKGROUND.section,
              color: DS.BRAND.primary,
              borderColor: open ? DS.BRAND.primary : DS.BORDER.light,
            }}
          >
            {user?.profile_photo_url ? (
              <img src={user.profile_photo_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-64 rounded-xl border p-0 shadow-lg overflow-hidden"
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

        <ProfileThemeToggle />

        {/* Menu Items */}
        <div className="py-2">
          {isWorker && (
            <DropdownMenuItem asChild className="px-6 py-3 cursor-pointer rounded-none focus:bg-cc-bg">
              <Link href="/worker/profile" onClick={() => setOpen(false)}>
                <User size={16} strokeWidth={2} />
                <span>{translate("nav.profile")}</span>
              </Link>
            </DropdownMenuItem>
          )}

          <DropdownMenuItem asChild className="px-6 py-3 cursor-pointer rounded-none focus:bg-cc-bg">
            <Link href="/settings" onClick={() => setOpen(false)}>
              <Settings size={16} strokeWidth={2} />
              <span>{translate("nav.settings")}</span>
            </Link>
          </DropdownMenuItem>

          {isWorker && (
            <DropdownMenuItem asChild className="px-6 py-3 cursor-pointer rounded-none focus:bg-cc-bg">
              <Link href="/worker/security" onClick={() => setOpen(false)}>
                <LockKeyhole size={16} strokeWidth={2} />
                <span>{translate("nav.security")}</span>
              </Link>
            </DropdownMenuItem>
          )}

          {isWorker && (
            <DropdownMenuItem asChild className="px-6 py-3 cursor-pointer rounded-none focus:bg-cc-bg">
              <Link href="/worker/privacy" onClick={() => setOpen(false)}>
                <Shield size={16} strokeWidth={2} />
                <span>{translate("nav.privacy")}</span>
              </Link>
            </DropdownMenuItem>
          )}

          {isWorker && (
            <DropdownMenuItem asChild className="px-6 py-3 cursor-pointer rounded-none focus:bg-cc-bg">
              <Link href="/worker/help" onClick={() => setOpen(false)}>
                <HelpCircle size={16} strokeWidth={2} />
                <span>{translate("nav.help")}</span>
              </Link>
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator className="my-2" style={{ background: DS.BORDER.light }} />

          <DropdownMenuItem
            className="px-6 py-3 cursor-pointer rounded-none focus:bg-[var(--cc-status-critical-bg)]"
            style={{ color: DS.STATUS.critical }}
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <LogOut size={16} strokeWidth={2} />
            <span>{translate("common.signOut")}</span>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
