import { Lightbulb } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const PLUM = "var(--cc-plum)";

export default function AdminFeedbackPage() {
  return (
    <AdminShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-black" style={{ color: TEXT }}>Improvements & Feedback</h1>
          <p className="text-[12px] font-medium" style={{ color: MUTED }}>Feature requests and feedback about CareCliQ, submitted by providers.</p>
        </div>

        <div className="rounded-2xl border p-12 text-center" style={{ borderColor: BORDER, background: SURFACE }}>
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "var(--cc-plum-soft)" }}>
            <Lightbulb size={20} style={{ color: PLUM }} />
          </span>
          <p className="mt-3 text-[13px] font-black" style={{ color: TEXT }}>Nothing submitted yet</p>
          <p className="mx-auto mt-1 max-w-sm text-[12px] font-medium" style={{ color: MUTED }}>
            Feedback and improvement suggestions from providers will appear here once that submission flow exists.
          </p>
        </div>
      </div>
    </AdminShell>
  );
}
