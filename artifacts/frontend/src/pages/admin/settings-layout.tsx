import { AdminShell } from "@/components/admin/AdminShell";
import { NavLayoutCard } from "@/components/settings/NavLayoutSettings";

export default function AdminLayoutSettingsPage() {
  return (
    <AdminShell>
      <div className="space-y-6">
        <NavLayoutCard />
      </div>
    </AdminShell>
  );
}
