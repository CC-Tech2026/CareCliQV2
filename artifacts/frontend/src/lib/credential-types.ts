/**
 * Canonical metadata for support worker credential types: label, whether it's
 * mandatory before a worker can be rostered with a participant (vs. one that
 * can be completed after starting), and plain-language guidance on how to
 * actually obtain it. Previously this list existed as several independently
 * hand-maintained copies (WorkerDetail.tsx, MyCredentialsCard.tsx,
 * onboarding-training.tsx) with no "how do I get this" guidance anywhere -
 * this is the single source of truth for the worker-facing side.
 *
 * External links are only included where there's one confident, stable,
 * national URL (NDIS Worker Screening Check). Several of these are issued by
 * a state/territory authority or a private registered training organisation,
 * so there is no single correct link - guidance text says where to look
 * instead of pointing at a guessed URL.
 */
export interface CredentialTypeMeta {
  type: string;
  label: string;
  /** Must be in place before the worker can be rostered with a participant. */
  mandatory: boolean;
  guidance: string;
  externalUrl?: string;
  externalLabel?: string;
}

export const CREDENTIAL_TYPES: CredentialTypeMeta[] = [
  {
    type: "ndis_screening",
    label: "NDIS Worker Screening Check",
    mandatory: true,
    guidance: "Apply through your state or territory's NDIS Worker Screening Unit. You'll need to verify your identity and pay an application fee - processing can take several weeks, so apply as early as possible. Many employers can also initiate the application on your behalf.",
    externalUrl: "https://www.ndiscommission.gov.au/workers/ndis-worker-screening-check",
    externalLabel: "NDIS Worker Screening Check overview",
  },
  {
    type: "wwcc",
    label: "Working with Children Check (WWCC)",
    mandatory: true,
    guidance: "Issued by your own state or territory's Working with Children Check authority (for example Service NSW, Blue Card Services in QLD, or the WWCC unit in your state) - not the NDIS Commission. Apply online through your state government's website using your identity documents.",
  },
  {
    type: "code_of_conduct",
    label: "Code of Conduct acknowledgement",
    mandatory: true,
    guidance: "Read the NDIS Code of Conduct and confirm you understand and will comply with it. Your coordinator can provide the document, or you can read it on the NDIS Quality and Safeguards Commission's website (ndiscommission.gov.au).",
  },
  {
    type: "first_aid",
    label: "First Aid certificate",
    mandatory: true,
    guidance: "First Aid certification (unit HLTAID011 - Provide First Aid, or equivalent) is issued by a Registered Training Organisation (RTO) - e.g. St John Ambulance, Red Cross, or a local TAFE. Courses typically run one day and need renewing every 3 years.",
  },
  {
    type: "cpr",
    label: "CPR certificate",
    mandatory: true,
    guidance: "CPR certification (unit HLTAID009 - Provide Cardiopulmonary Resuscitation) is a shorter course offered by the same RTOs as First Aid, and usually needs renewing every 12 months.",
  },
  {
    type: "manual_handling",
    label: "Manual handling",
    mandatory: true,
    guidance: "Covers safe techniques for assisting participants with mobility, transfers and lifting. Ask your coordinator whether your organisation runs this in-house, or complete it through an RTO.",
  },
  {
    type: "infection_control",
    label: "Infection control",
    mandatory: true,
    guidance: "Covers standard infection prevention and control precautions (unit HLTINF006 or equivalent). Many NDIS providers run their own short version - check with your coordinator before booking an external course.",
  },
  {
    type: "medication_admin",
    label: "Medication administration",
    mandatory: true,
    guidance: "Requirements vary by role and state, and this is often provided directly by your employer. Ask your coordinator whether an internal module or an external RTO course applies to your role.",
  },
  {
    type: "drivers_licence",
    label: "Driver Licence",
    mandatory: false,
    guidance: "A current licence from your state or territory's road transport authority. Only needed if your role involves transporting participants or driving between visits - can be added once you're rostered onto a role that requires it.",
  },
  {
    type: "vehicle_registration",
    label: "Vehicle registration",
    mandatory: false,
    guidance: "Keep your vehicle's registration current if you use your own car for participant transport or community access shifts.",
  },
  {
    type: "vehicle_insurance",
    label: "Vehicle insurance (comprehensive)",
    mandatory: false,
    guidance: "Comprehensive insurance is strongly recommended if you use your own car for work - required by most providers before you can claim mileage or transport participants.",
  },
  {
    type: "qualification",
    label: "Qualification",
    mandatory: false,
    guidance: "Upload any relevant formal qualification (e.g. Certificate III/IV in Individual Support). Not required to start work, but strengthens your profile.",
  },
];

const BY_TYPE = new Map(CREDENTIAL_TYPES.map((c) => [c.type, c]));

export function credentialTypeMeta(type: string): CredentialTypeMeta | undefined {
  return BY_TYPE.get(type);
}

export function credentialTypeLabel(type: string): string {
  return BY_TYPE.get(type)?.label ?? type;
}

export function isCredentialMandatory(type: string): boolean {
  return BY_TYPE.get(type)?.mandatory ?? false;
}

export const MANDATORY_CREDENTIAL_TYPES = CREDENTIAL_TYPES.filter((c) => c.mandatory).map((c) => c.type);
