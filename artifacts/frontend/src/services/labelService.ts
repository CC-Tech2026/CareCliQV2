import { jsonFetch } from "@/services/http";

/** A label the office uses to find people ("Autism", "Female worker only").
 *  One list for the organisation, shared by participants and staff. */
export type OrgLabel = {
  id: string;
  label: string;
  /** The tag category it sits in ("Labels" for ones made here). */
  category?: string | null;
  /** How many participants and staff have it. */
  participants: number;
  workers: number;
};

export type LabelOverview = {
  labels: OrgLabel[];
  /** participant id -> label ids */
  participants: Record<string, string[]>;
  /** staff member id -> label ids */
  workers: Record<string, string[]>;
};

export type LabelTarget = "participants" | "workers";

const BASE = "/api/coordinator";

export function getLabels() {
  return jsonFetch<LabelOverview>(`${BASE}/labels`);
}

/** Give someone a label: an existing one by id, or by its words (the
 *  existing label with those words is used if there is one). */
export function addLabel(target: LabelTarget, personId: string, label: { tag_id: string } | { label: string }) {
  return jsonFetch<{ label: { id: string; label: string } }>(
    `${BASE}/${target}/${encodeURIComponent(personId)}/labels`,
    { method: "POST", body: JSON.stringify(label) },
  );
}

export function removeLabel(target: LabelTarget, personId: string, tagId: string) {
  return jsonFetch<void>(`${BASE}/${target}/${encodeURIComponent(personId)}/labels/${encodeURIComponent(tagId)}`, {
    method: "DELETE",
  });
}
