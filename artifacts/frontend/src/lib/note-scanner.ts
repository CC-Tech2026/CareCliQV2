export interface Highlight {
  start: number;
  end: number;
  type: "rp" | "subjective" | "person_first";
  phrase: string;
  message: string;
}

const SUBJECTIVE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bseems?\s+to\b/gi, label: "Subjective language" },
  { pattern: /\bappears?\s+to\b/gi, label: "Subjective language" },
  { pattern: /\btried\s+to\b/gi, label: "Subjective language" },
  { pattern: /\bwas\s+being\b/gi, label: "Subjective language" },
  { pattern: /\bI\s+think\b/gi, label: "First-person language" },
  { pattern: /\bI\s+feel\b/gi, label: "First-person language" },
  { pattern: /\bI\s+believe\b/gi, label: "First-person language" },
  { pattern: /\bmaybe\b/gi, label: "Uncertain language" },
  { pattern: /\bprobably\b/gi, label: "Uncertain language" },
  { pattern: /\bmight\s+have\b/gi, label: "Uncertain language" },
  { pattern: /\bcould\s+have\b/gi, label: "Uncertain language" },
  { pattern: /\bperhaps\b/gi, label: "Uncertain language" },
  { pattern: /\bseemed\b/gi, label: "Subjective language" },
  { pattern: /\bappeared\b/gi, label: "Subjective language" },
  { pattern: /\blooks\s+like\b/gi, label: "Subjective language" },
];

const PERSON_FIRST_PATTERNS: { pattern: RegExp; suggestion: string }[] = [
  { pattern: /\bautistic\s+(?:person|child|adult|individual|client|man|woman|boy|girl)\b/gi, suggestion: "person with autism" },
  { pattern: /\bwheelchair[- ]?bound\b/gi, suggestion: "person who uses a wheelchair" },
  { pattern: /\bconfined\s+to\s+(?:a\s+)?wheelchair\b/gi, suggestion: "person who uses a wheelchair" },
  { pattern: /\bsuffers?\s+from\b/gi, suggestion: "has a diagnosis of" },
  { pattern: /\bthe\s+disabled\b/gi, suggestion: "person with disability" },
  { pattern: /\bspecial\s+needs\b/gi, suggestion: "support needs" },
  { pattern: /\bintellectually\s+disabled\s+(?:person|individual|client)\b/gi, suggestion: "person with intellectual disability" },
  { pattern: /\bmental(?:ly)?\s+retard\w*\b/gi, suggestion: "person with intellectual disability" },
  { pattern: /\bblind\s+(?:person|people|client|man|woman)\b/gi, suggestion: "person who is blind" },
  { pattern: /\bdeaf\s+(?:person|people|client|man|woman)\b/gi, suggestion: "person who is deaf" },
  { pattern: /\bepilept(?:ic|ics)\b/gi, suggestion: "person with epilepsy" },
  { pattern: /\bdisabled\s+people\b/gi, suggestion: "people with disability" },
];

const RP_SCAN_PATTERNS: { pattern: RegExp; category: string }[] = [
  { pattern: /\bgiven\s+sedative\b/gi, category: "chemical_restraint" },
  { pattern: /\badministered\s+sedative\b/gi, category: "chemical_restraint" },
  { pattern: /\bchemical\s+(?:calm|restraint|control)\b/gi, category: "chemical_restraint" },
  { pattern: /\bsedated\s+to\s+calm\b/gi, category: "chemical_restraint" },
  { pattern: /\bPRN\s+for\s+behaviour\b/gi, category: "chemical_restraint" },
  { pattern: /\bcalming\s+medication\b/gi, category: "chemical_restraint" },
  { pattern: /\bmedicated\s+for\s+behaviour\b/gi, category: "chemical_restraint" },
  { pattern: /\bheld\s+down\b/gi, category: "physical_restraint" },
  { pattern: /\bphysically\s+restrained\b/gi, category: "physical_restraint" },
  { pattern: /\bphysical\s+restraint\b/gi, category: "physical_restraint" },
  { pattern: /\bpinned\s+down\b/gi, category: "physical_restraint" },
  { pattern: /\bgrabbed\s+and\s+held\b/gi, category: "physical_restraint" },
  { pattern: /\bprone\s+restraint\b/gi, category: "physical_restraint" },
  { pattern: /\bcrisis\s+hold\b/gi, category: "physical_restraint" },
  { pattern: /\bmanual\s+restraint\b/gi, category: "physical_restraint" },
  { pattern: /\btied\s+to\s+chair\b/gi, category: "mechanical_restraint" },
  { pattern: /\bstrapped\s+to\b/gi, category: "mechanical_restraint" },
  { pattern: /\bmechanical\s+restraint\b/gi, category: "mechanical_restraint" },
  { pattern: /\bwrist\s+restraint\b/gi, category: "mechanical_restraint" },
  { pattern: /\blocked\s+in\s+room\b/gi, category: "environmental_restraint" },
  { pattern: /\benvironmental\s+restraint\b/gi, category: "environmental_restraint" },
  { pattern: /\bconfined\s+to\s+(?:a\s+)?room\b/gi, category: "environmental_restraint" },
  { pattern: /\bplaced\s+in\s+seclusion\b/gi, category: "seclusion" },
  { pattern: /\bseclusion\s+room\b/gi, category: "seclusion" },
  { pattern: /\bisolated\s+in\b/gi, category: "seclusion" },
  { pattern: /\bsecluded\b/gi, category: "seclusion" },
  { pattern: /\btime[- ]?out\s+room\b/gi, category: "seclusion" },
];

export function scanNoteHighlights(text: string): Highlight[] {
  if (!text || text.trim().length === 0) return [];
  const highlights: Highlight[] = [];

  for (const { pattern, category } of RP_SCAN_PATTERNS) {
    const p = new RegExp(pattern.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = p.exec(text)) !== null) {
      highlights.push({
        start: m.index,
        end: m.index + m[0].length,
        type: "rp",
        phrase: m[0],
        message: `Restrictive practice (${category.replace(/_/g, " ")}) — must be in behaviour support plan`,
      });
    }
  }

  for (const { pattern, label } of SUBJECTIVE_PATTERNS) {
    const p = new RegExp(pattern.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = p.exec(text)) !== null) {
      highlights.push({
        start: m.index,
        end: m.index + m[0].length,
        type: "subjective",
        phrase: m[0],
        message: `${label} — use objective, observable language`,
      });
    }
  }

  for (const { pattern, suggestion } of PERSON_FIRST_PATTERNS) {
    const p = new RegExp(pattern.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = p.exec(text)) !== null) {
      highlights.push({
        start: m.index,
        end: m.index + m[0].length,
        type: "person_first",
        phrase: m[0],
        message: `Person-first language: use "${suggestion}"`,
      });
    }
  }

  return highlights.sort((a, b) => a.start - b.start);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildHighlightedHtml(text: string, highlights: Highlight[]): string {
  if (!highlights.length) return escapeHtml(text);
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  let html = "";
  let pos = 0;
  for (const h of sorted) {
    if (h.start < pos) continue;
    const safeEnd = Math.min(h.end, text.length);
    html += escapeHtml(text.slice(pos, h.start));
    const bg =
      h.type === "rp"
        ? "rgba(252,165,165,0.55)"
        : "rgba(252,211,77,0.55)";
    html += `<mark style="background:${bg};border-radius:2px;color:transparent" title="${escapeHtml(h.message)}">${escapeHtml(text.slice(h.start, safeEnd))}</mark>`;
    pos = safeEnd;
  }
  html += escapeHtml(text.slice(pos));
  return html;
}
