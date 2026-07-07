import type { GoalDetail, WorkerClient } from "@/lib/worker-api";
import { shiftInitials } from "@/lib/shift-utils";

export function safeClientDate(value?: string | null): string {
  if (!value) return "Not recorded";
  try {
    return new Date(value).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

export function clientInitials(name?: string): string {
  return shiftInitials(name ?? "?");
}

export function activeGoals(goals?: GoalDetail[]): GoalDetail[] {
  if (!goals?.length) return [];
  return goals.filter((goal) => {
    const status = String(goal.status || "active").toLowerCase();
    return status !== "completed" && status !== "achieved" && status !== "archived";
  });
}

export function planDaysLeft(client: WorkerClient): number | null {
  if (!client.plan_end_date) return null;
  const end = new Date(client.plan_end_date).getTime();
  return Math.ceil((end - Date.now()) / 86_400_000);
}

export function complianceBadgeMeta(status?: string): { label: string; color: string; bg: string } {
  if (status === "compliant") return { label: "Compliant", color: "#15803D", bg: "#DCFCE7" };
  if (status === "non_compliant") return { label: "Non-compliant", color: "#DC2626", bg: "#FCEBEB" };
  if (status === "draft") return { label: "Draft", color: "#64748B", bg: "#F1F5F9" };
  return { label: "Needs review", color: "#854F0B", bg: "#FFF3E0" };
}

export function sessionScoreLabel(session: {
  compliance_score?: number | null;
  compliance_status?: string;
  status?: string;
}): string {
  if (session.compliance_score != null) return `${Math.round(session.compliance_score)}%`;
  return session.compliance_status || session.status || "draft";
}
