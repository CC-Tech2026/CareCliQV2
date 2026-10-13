import { AdminSettingsNavigation } from "@/components/admin/AdminSettingsNavigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { AccessibilityPanel } from "@/components/AccessibilityPanel";

export default function AdminAccessibilitySettingsPage() {
  return (
    <AdminShell>
      <div className="mx-auto w-full min-w-0 max-w-5xl space-y-5 pb-8"><AdminSettingsNavigation active="accessibility" /><section aria-label="Display and accessibility" className="rounded-xl border border-cc-border bg-cc-surface p-4 sm:p-6"><AccessibilityPanel showHeader={false} /></section></div>
    </AdminShell>
  );
}
