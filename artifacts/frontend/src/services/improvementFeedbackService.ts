import { jsonFetch } from "@/services/http";

export function submitImprovementFeedback(description: string) {
  return jsonFetch<{ id: string; status: string }>("/api/improvement-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
}
