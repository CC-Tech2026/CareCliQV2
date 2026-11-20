import type { ShiftHealthAlert } from "@/lib/worker-api";

/**
 * Safety checks on what a worker writes during a shift, against what's known
 * about the participant (their allergies and health alerts). Plain matching,
 * on the phone, so it's instant, works offline and never guesses: it only
 * flags words the worker actually wrote. It doesn't block anything; it
 * points out a risk and what the participant's plan says to do.
 */

export type SafetyFlagKind =
  | "allergen"
  | "reaction"
  | "choking"
  | "mealtime"
  | "seizure"
  | "fall"
  | "hypo"
  | "medication";

export type SafetyFlag = {
  kind: SafetyFlagKind;
  /** danger: may need action now. caution: a reminder of the plan. */
  level: "danger" | "caution";
  /** The words in the note that raised it. */
  matched: string;
  /** For allergen flags: the allergy it relates to. */
  allergen?: string;
  /** The participant's own instructions, when their plan has them. */
  instructions?: string;
  /** Whether this usually needs an incident report. */
  reportIncident: boolean;
};

/** Everyday words that mean a common allergen. Lower case. */
const ALLERGEN_WORDS: Array<[RegExp, string[]]> = [
  [
    /peanut|groundnut/,
    ["peanut", "peanuts", "peanut butter", "satay", "groundnut"],
  ],
  [
    /tree ?nut|\bnuts?\b/,
    [
      "nut",
      "nuts",
      "almond",
      "almonds",
      "cashew",
      "cashews",
      "walnut",
      "hazelnut",
      "pecan",
      "pistachio",
      "macadamia",
      "nutella",
    ],
  ],
  [
    /dairy|milk|lactose|casein/,
    [
      "milk",
      "cheese",
      "yoghurt",
      "yogurt",
      "butter",
      "cream",
      "ice cream",
      "custard",
      "dairy",
      "milkshake",
    ],
  ],
  [/\beggs?\b/, ["egg", "eggs", "omelette", "mayonnaise", "mayo"]],
  [
    /gluten|wheat|coeliac|celiac/,
    [
      "bread",
      "toast",
      "sandwich",
      "pasta",
      "wheat",
      "gluten",
      "flour",
      "biscuit",
      "biscuits",
      "cake",
      "cereal",
      "noodles",
      "pizza",
    ],
  ],
  [
    /shellfish|crustacean|prawn|shrimp/,
    [
      "prawn",
      "prawns",
      "shrimp",
      "crab",
      "lobster",
      "shellfish",
      "mussels",
      "oysters",
      "scallops",
    ],
  ],
  [/\bfish\b/, ["fish", "salmon", "tuna", "fish and chips"]],
  [/\bsoy|soya/, ["soy", "soya", "tofu", "soy sauce"]],
  [/sesame/, ["sesame", "tahini", "hummus"]],
  [/\bbee|wasp|insect|sting/, ["bee", "wasp", "sting", "stung"]],
  [/latex/, ["latex", "balloon", "balloons"]],
  [
    /penicillin|amoxicillin/,
    ["penicillin", "amoxicillin", "amoxil", "augmentin"],
  ],
];

const REACTION = [
  "rash",
  "hives",
  "swelling",
  "swollen",
  "itchy",
  "itching",
  "wheezing",
  "wheeze",
  "short of breath",
  "trouble breathing",
  "difficulty breathing",
  "struggling to breathe",
  "vomited",
  "vomiting",
  "throat felt tight",
  "lips swelled",
];
const CHOKING = [
  "choked",
  "choking",
  "gagged",
  "gagging",
  "coughing while eating",
  "coughed while eating",
  "coughing while drinking",
  "coughed while drinking",
  "food got stuck",
  "food stuck",
  "aspirated",
];
const EATING = [
  "ate",
  "eat",
  "eating",
  "meal",
  "lunch",
  "dinner",
  "breakfast",
  "snack",
  "drink",
  "drank",
  "fed",
];
const SEIZURE = [
  "seizure",
  "seizures",
  "had a fit",
  "convulsing",
  "convulsion",
  "jerking",
  "shaking uncontrollably",
  "unresponsive",
  "blank stare",
  "staring spell",
];
const FALL = [
  "fell",
  "fell over",
  "had a fall",
  "slipped",
  "tripped",
  "on the floor",
  "lost balance",
];
const HYPO = [
  "shaky",
  "sweaty",
  "dizzy",
  "confused",
  "hypo",
  "low sugar",
  "low blood sugar",
  "pale and sweaty",
];
const MEDICATION = [
  "missed dose",
  "missed a dose",
  "missed medication",
  "forgot medication",
  "forgot his medication",
  "forgot her medication",
  "forgot their medication",
  "wrong medication",
  "wrong dose",
  "double dose",
  "given twice",
  "took too many",
];

const NEGATION =
  /\b(no|not|without|denied|denies|didn't|did not|wasn't|was not|never|none)\b(?:\W+\w+){0,3}\W*$/i;

/** First phrase from `words` in `text` that isn't negated just before it. */
function found(text: string, words: string[]): string | null {
  const lower = text.toLowerCase();
  for (const word of words) {
    const re = new RegExp(
      `\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    );
    const m = re.exec(lower);
    if (!m) continue;
    const before = lower.slice(Math.max(0, m.index - 40), m.index);
    if (NEGATION.test(before)) continue;
    return text.slice(m.index, m.index + m[0].length);
  }
  return null;
}

function alertText(a: ShiftHealthAlert): string {
  return [a.type, a.title, a.description, a.instructions, a.detail]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** The allergies on the participant's record, as short names ("Peanuts"). */
export function participantAllergies(
  alerts: ShiftHealthAlert[] = [],
): string[] {
  const names = new Set<string>();
  for (const a of alerts) {
    if ((a.type ?? "").toLowerCase() !== "allergy" && !/allerg/i.test(a.title))
      continue;
    const fromTitle = a.title.split(/[—–-]/).slice(1).join(" ").trim();
    const raw = fromTitle || (a.description ?? a.instructions ?? "");
    for (const part of raw.split(/,|;|\band\b|\n/)) {
      const name = part
        .replace(/^(allergic to|allergy to|allergies?:?)\s*/i, "")
        .replace(/\(.*?\)/g, "")
        .trim();
      if (name && name.length <= 40)
        names.add(name.charAt(0).toUpperCase() + name.slice(1));
    }
  }
  return Array.from(names);
}

function instructionsFor(
  alerts: ShiftHealthAlert[],
  test: RegExp,
): string | undefined {
  const hit = alerts.find((a) => test.test(alertText(a)));
  const text = (hit?.instructions || hit?.description || "").trim();
  return text || undefined;
}

/** Safety flags for a note, most urgent first. */
export function findSafetyFlags(
  text: string,
  alerts: ShiftHealthAlert[] = [],
): SafetyFlag[] {
  const note = (text ?? "").trim();
  if (!note) return [];
  const flags: SafetyFlag[] = [];
  const allergies = participantAllergies(alerts);
  const all = alerts.map(alertText).join(" ");

  // 1. Something the participant is allergic to is mentioned.
  for (const allergy of allergies) {
    const key = allergy.toLowerCase();
    const words = ALLERGEN_WORDS.find(([re]) => re.test(key))?.[1] ?? [
      key,
      key.replace(/s$/, ""),
    ];
    // Nut butters aren't dairy: "peanut butter" mustn't raise a dairy flag.
    const forCheck = /dairy|milk|lactose|casein/.test(key)
      ? note.replace(
          /\b(peanut|nut|almond|cashew|apple)\s+butter\b/gi,
          "$1 spread",
        )
      : note;
    const hit = found(forCheck, words);
    if (hit) {
      flags.push({
        kind: "allergen",
        level: "danger",
        matched: hit,
        allergen: allergy,
        instructions: instructionsFor(
          alerts,
          new RegExp(key.replace(/s$/, ""), "i"),
        ),
        reportIncident: false,
      });
    }
  }

  // 2. Signs of a reaction, for someone with allergies.
  if (allergies.length) {
    const hit = found(note, REACTION);
    if (hit) {
      flags.push({
        kind: "reaction",
        level: "danger",
        matched: hit,
        instructions: instructionsFor(
          alerts,
          /allerg|anaphyla|epipen|adrenaline/,
        ),
        reportIncident: true,
      });
    }
  }

  // 3. Choking, and a mealtime reminder when there's a swallowing risk.
  const swallowRisk =
    /swallow|dysphagia|chok|thicken|texture|iddsi|minced|pureed|aspirat/.test(
      all,
    );
  const choked = found(note, CHOKING);
  if (choked) {
    flags.push({
      kind: "choking",
      level: "danger",
      matched: choked,
      instructions: instructionsFor(
        alerts,
        /swallow|dysphagia|chok|mealtime|iddsi/,
      ),
      reportIncident: true,
    });
  } else if (swallowRisk) {
    const ate = found(note, EATING);
    if (ate) {
      flags.push({
        kind: "mealtime",
        level: "caution",
        matched: ate,
        instructions: instructionsFor(
          alerts,
          /swallow|dysphagia|chok|mealtime|iddsi|thicken|texture/,
        ),
        reportIncident: false,
      });
    }
  }

  // 4. A seizure.
  const seizure = found(note, SEIZURE);
  if (seizure) {
    flags.push({
      kind: "seizure",
      level: "danger",
      matched: seizure,
      instructions: instructionsFor(alerts, /seizure|epilep/),
      reportIncident: true,
    });
  }

  // 5. A fall.
  const fall = found(note, FALL);
  if (fall) {
    flags.push({
      kind: "fall",
      level: "danger",
      matched: fall,
      instructions: instructionsFor(alerts, /fall|mobility|transfer/),
      reportIncident: true,
    });
  }

  // 6. Signs of low blood sugar, for someone with diabetes.
  if (/diabet|insulin|hypo|blood sugar|glucose/.test(all)) {
    const hypo = found(note, HYPO);
    if (hypo) {
      flags.push({
        kind: "hypo",
        level: "danger",
        matched: hypo,
        instructions: instructionsFor(alerts, /diabet|insulin|hypo|glucose/),
        reportIncident: false,
      });
    }
  }

  // 7. A medication mistake.
  const med = found(note, MEDICATION);
  if (med) {
    flags.push({
      kind: "medication",
      level: "danger",
      matched: med,
      reportIncident: true,
    });
  }

  return flags;
}
