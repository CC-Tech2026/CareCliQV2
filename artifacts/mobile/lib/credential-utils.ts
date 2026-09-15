/** Canonical credential types, mirroring
 * artifacts/frontend/src/lib/credential-types.ts and the backend's
 * REQUIRED_CREDENTIAL_TYPES (backend/app/services/onboarding_escalation_service.py) —
 * there's no shared backend/frontend constant source yet, so this is kept in
 * sync manually. `mandatory` types are the ones required before a worker can
 * be rostered with a participant. */
export interface CredentialTypeMeta {
  type: string;
  label: string;
  mandatory: boolean;
}

export const CREDENTIAL_TYPES: CredentialTypeMeta[] = [
  { type: "ndis_screening", label: "NDIS Worker Screening Check", mandatory: true },
  { type: "wwcc", label: "Working with Children Check (WWCC)", mandatory: true },
  { type: "code_of_conduct", label: "Code of Conduct acknowledgement", mandatory: true },
  { type: "first_aid", label: "First Aid certificate", mandatory: true },
  { type: "cpr", label: "CPR certificate", mandatory: true },
  { type: "manual_handling", label: "Manual handling", mandatory: true },
  { type: "infection_control", label: "Infection control", mandatory: true },
  { type: "medication_admin", label: "Medication administration", mandatory: true },
  { type: "drivers_licence", label: "Driver Licence", mandatory: false },
  { type: "vehicle_registration", label: "Vehicle registration", mandatory: false },
  { type: "vehicle_insurance", label: "Vehicle insurance (comprehensive)", mandatory: false },
  { type: "qualification", label: "Qualification", mandatory: false },
];

export const CREDENTIAL_TYPE_OPTIONS = CREDENTIAL_TYPES.map((c) => c.type);

export type CredentialTypeOption = (typeof CREDENTIAL_TYPE_OPTIONS)[number];

export const MANDATORY_CREDENTIAL_TYPES = CREDENTIAL_TYPES.filter((c) => c.mandatory).map((c) => c.type);

const BY_TYPE = new Map(CREDENTIAL_TYPES.map((c) => [c.type, c]));

export function credentialTypeLabel(type: string): string {
  return BY_TYPE.get(type)?.label ?? type;
}

export function isCredentialMandatory(type: string): boolean {
  return BY_TYPE.get(type)?.mandatory ?? false;
}

/** A credential in one of these states already exists on file — renewing it
 * means updating that same row (and, if needed, replacing its document),
 * not creating a second record for the same requirement. */
export function needsCredentialUpdate(status: string): boolean {
  return status === "expiring" || status === "expired" || status === "rejected";
}
