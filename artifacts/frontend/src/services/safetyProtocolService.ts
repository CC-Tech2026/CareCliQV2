import { jsonFetch } from "@/services/http";

export type SafetyScenario = {
  trigger: string;
  response: string;
  sort_order?: number;
};

export type DeescalationTechnique = {
  title: string;
  steps: string[];
  sort_order?: number;
};

export type PhysicalSafetyNote = {
  note: string;
  sort_order?: number;
};

export type EscalationContact = {
  role: "coordinator" | "on_call" | "emergency";
  label: string;
  phone: string;
  sort_order?: number;
};

export type SafetyProtocol = {
  participant_id: string;
  organization_id: string;
  safety_card_body: string;
  scenarios: SafetyScenario[];
  deescalation_techniques: DeescalationTechnique[];
  physical_safety_notes: PhysicalSafetyNote[];
  escalation_contacts: EscalationContact[];
  content_version: number;
  updated_at?: string | null;
  updated_by?: string | null;
  requires_safety_ack?: boolean;
  acknowledged_version?: number | null;
  has_safety_content?: boolean;
};

export type SafetyProtocolUpdate = Partial<
  Pick<
    SafetyProtocol,
    | "safety_card_body"
    | "scenarios"
    | "deescalation_techniques"
    | "physical_safety_notes"
    | "escalation_contacts"
  >
>;

export function getCoordinatorSafetyProtocol(participantId: string) {
  return jsonFetch<SafetyProtocol>(`/api/participants/${participantId}/safety-protocol`);
}

export function updateCoordinatorSafetyProtocol(participantId: string, payload: SafetyProtocolUpdate) {
  return jsonFetch<SafetyProtocol>(`/api/participants/${participantId}/safety-protocol`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function getWorkerSafetyProtocol(participantId: string) {
  return jsonFetch<SafetyProtocol>(`/api/worker/participants/${participantId}/safety-protocol`);
}

export function acknowledgeWorkerSafetyProtocol(participantId: string, contentVersion: number) {
  return jsonFetch<{ acknowledged_at: string; requires_safety_ack: boolean }>(
    `/api/worker/participants/${participantId}/safety-protocol/acknowledge`,
    {
      method: "POST",
      body: JSON.stringify({ content_version: contentVersion }),
    },
  );
}
