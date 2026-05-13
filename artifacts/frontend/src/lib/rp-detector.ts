export interface RPFlag {
  category: string;
  phrase: string;
  index: number;
  suggested_rewrite?: string;
}

const RP_PHRASES: { category: string; patterns: RegExp[] }[] = [
  {
    category: "chemical_restraint",
    patterns: [
      /given\s+sedative/i,
      /administered\s+sedative/i,
      /chemical\s+calm/i,
      /chemical\s+restraint/i,
      /sedated\s+to\s+calm/i,
      /medication\s+to\s+restrain/i,
      /PRN\s+for\s+behaviour/i,
      /calming\s+medication/i,
      /chemical\s+control/i,
      /medicated\s+for\s+behaviour/i,
    ],
  },
  {
    category: "physical_restraint",
    patterns: [
      /held\s+down/i,
      /physically\s+restrained/i,
      /physical\s+restraint/i,
      /pinned\s+down/i,
      /grabbed\s+and\s+held/i,
      /forced\s+to\s+stay/i,
      /arm\s+held/i,
      /restrained\s+by\s+staff/i,
      /manual\s+restraint/i,
      /staff\s+held/i,
      /body\s+hold/i,
      /crisis\s+hold/i,
      /prone\s+restraint/i,
    ],
  },
  {
    category: "mechanical_restraint",
    patterns: [
      /tied\s+to\s+chair/i,
      /strapped\s+to/i,
      /mechanical\s+restraint/i,
      /wrist\s+restraint/i,
      /lap\s+belt/i,
      /safety\s+strap/i,
      /restrained\s+with/i,
      /wheelchair\s+strap/i,
      /body\s+suit/i,
      /restraint\s+device/i,
    ],
  },
  {
    category: "environmental_restraint",
    patterns: [
      /locked\s+in\s+room/i,
      /environmental\s+restraint/i,
      /confined\s+to/i,
      /restricted\s+to\s+room/i,
      /door\s+locked/i,
      /prevented\s+from\s+leaving/i,
      /access\s+denied/i,
      /not\s+allowed\s+to\s+leave/i,
      /restricted\s+access/i,
      /room\s+locked/i,
    ],
  },
  {
    category: "seclusion",
    patterns: [
      /placed\s+in\s+seclusion/i,
      /seclusion\s+room/i,
      /isolated\s+in/i,
      /\bsecluded\b/i,
      /time[\s-]out\s+room/i,
      /placed\s+alone\s+in/i,
      /removed\s+and\s+isolated/i,
      /\bsolitary\b/i,
      /seclusion\s+used/i,
    ],
  },
];

export const RP_CATEGORY_LABELS: Record<string, string> = {
  chemical_restraint: "Chemical Restraint",
  physical_restraint: "Physical Restraint",
  mechanical_restraint: "Mechanical Restraint",
  environmental_restraint: "Environmental Restraint",
  seclusion: "Seclusion",
};

export function detectRestrictivePractices(text: string): RPFlag[] {
  if (!text || text.trim().length === 0) return [];

  const flags: RPFlag[] = [];

  for (const { category, patterns } of RP_PHRASES) {
    const seenPhrases = new Set<string>();
    for (const pattern of patterns) {
      const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
      let match: RegExpExecArray | null;
      while ((match = globalPattern.exec(text)) !== null) {
        const phrase = match[0].toLowerCase();
        if (!seenPhrases.has(phrase)) {
          seenPhrases.add(phrase);
          flags.push({
            category,
            phrase: match[0],
            index: match.index,
          });
        }
      }
    }
  }

  return flags;
}

export function detectRestrictivePracticesAll(fields: string[]): RPFlag[] {
  const combined = fields.filter(Boolean).join("\n");
  return detectRestrictivePractices(combined);
}
