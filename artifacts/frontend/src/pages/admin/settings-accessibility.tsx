import { AdminShell } from "@/components/admin/AdminShell";
import { AccessibilityPanel } from "@/components/AccessibilityPanel";

export default function AdminAccessibilitySettingsPage() {
  return (
    <AdminShell>
      <AccessibilityPanel showHeader={false} />
    </AdminShell>
  );
}
