import { UserPlus } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const PLUM = "var(--cc-plum)";

export default function AdminOnboardingPage() {
  return (
    <AdminShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-black" style={{ color: TEXT }}>Onboarding</h1>
          <p className="text-[12px] font-medium" style={{ color: MUTED }}>Track new providers signing up, and existing providers migrating from another system.</p>
        </div>

        <div className="rounded-2xl border p-12 text-center" style={{ borderColor: BORDER, background: SURFACE }}>
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "var(--cc-plum-soft)" }}>
            <UserPlus size={20} style={{ color: PLUM }} />
          </span>
          <p className="mt-3 text-[13px] font-black" style={{ color: TEXT }}>Nothing to show yet</p>
          <p className="mx-auto mt-1 max-w-sm text-[12px] font-medium" style={{ color: MUTED }}>
            Once the onboarding pipeline is wired up, new signups and migration status for existing providers will show up here.
          </p>
        </div>
      </div>
    </AdminShell>
  );
}
