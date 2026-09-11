export const CREDENTIAL_TYPE_OPTIONS = [
  "ndis_screening",
  "wwcc",
  "code_of_conduct",
  "Police Check",
  "first_aid",
  "cpr",
  "manual_handling",
  "infection_control",
  "medication_admin",
  "drivers_licence",
  "Other",
] as const;

export type CredentialTypeOption = (typeof CREDENTIAL_TYPE_OPTIONS)[number];

const CREDENTIAL_TYPE_LABELS: Record<string, string> = {
  ndis_screening: "NDIS Worker Screening",
  wwcc: "Working with Children Check (WWCC)",
  code_of_conduct: "Code of Conduct acknowledgement",
  first_aid: "First Aid",
  cpr: "CPR",
  manual_handling: "Manual handling",
  infection_control: "Infection control",
  medication_admin: "Medication administration",
  drivers_licence: "Driver Licence",
};

export function credentialTypeLabel(type: string): string {
  return CREDENTIAL_TYPE_LABELS[type] ?? type;
}

/** A credential in one of these states already exists on file — renewing it
 * means updating that same row (and, if needed, replacing its document),
 * not creating a second record for the same requirement. */
export function needsCredentialUpdate(status: string): boolean {
  return status === "expiring" || status === "expired" || status === "rejected";
}
