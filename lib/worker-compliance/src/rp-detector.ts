export interface RPFlag {
  category: string;
  phrase: string;
  index: number;
}

const RP_PHRASES: { category: string; patterns: RegExp[] }[] = [
  {
    category: "chemical_restraint",
    patterns: [
      /given\s+sedative/i, /administered\s+sedative/i, /chemical\s+restraint/i,
      /PRN\s+for\s+behaviour/i, /medicated\s+for\s+behaviour/i,
    ],
  },
  {
    category: "physical_restraint",
    patterns: [
      /held\s+down/i, /physically\s+restrained/i, /physical\s+restraint/i,
      /pinned\s+down/i, /forced\s+to\s+stay/i, /restrained\s+by\s+staff/i,
    ],
  },
  {
    category: "environmental_restraint",
    patterns: [
      /locked\s+in\s+room/i, /prevented\s+from\s+leaving/i, /door\s+locked/i,
      /not\s+allowed\s+to\s+leave/i,
    ],
  },
  {
    category: "seclusion",
    patterns: [/\bsecluded\b/i, /seclusion\s+room/i, /isolated\s+in/i],
  },
];

const SPEC_RP_KEYWORDS = [
  /physically guided/i, /\brestrained\b/i, /\bheld\b/i,
  /prevented from leaving/i, /\blocked\b/i, /\bsecluded\b/i,
  /\bforced\b/i, /chemical restraint/i, /\bPRN\b/i, /as needed.*behav/i,
];

export function detectRestrictivePractices(text: string): RPFlag[] {
  if (!text?.trim()) return [];
  const flags: RPFlag[] = [];
  for (const { category, patterns } of RP_PHRASES) {
    const seen = new Set<string>();
    for (const pattern of patterns) {
      const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        const phrase = match[0].toLowerCase();
        if (!seen.has(phrase)) {
          seen.add(phrase);
          flags.push({ category, phrase: match[0], index: match.index });
        }
      }
    }
  }
  return flags;
}

export function detectRestrictivePracticeHit(text: string): { phrase: string; category: string } | null {
  const rp = detectRestrictivePractices(text);
  if (rp.length > 0) return rp[0];
  for (const pattern of SPEC_RP_KEYWORDS) {
    const match = text.match(pattern);
    if (match) return { phrase: match[0], category: "restrictive_practice" };
  }
  return null;
}
