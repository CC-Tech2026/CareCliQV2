import { AdminSettingsNavigation } from "@/components/admin/AdminSettingsNavigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { NavLayoutCard } from "@/components/settings/NavLayoutSettings";

export default function AdminLayoutSettingsPage() {
  return (
    <AdminShell>
      <div className="mx-auto w-full min-w-0 max-w-5xl space-y-5 pb-8">
        <AdminSettingsNavigation active="layout" />
        <NavLayoutCard />
      </div>
    </AdminShell>
  );
}
