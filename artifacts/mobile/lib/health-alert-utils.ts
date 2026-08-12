import type { ShiftHealthAlert } from "@/lib/worker-api";

function parsePostgresTextArray(value: string): string[] {
  const inner = value.trim();
  if (!inner.startsWith("{") || !inner.endsWith("}")) return [];

  const content = inner.slice(1, -1);
  if (!content.trim()) return [];

  const items: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          current += '"';
          i += 1;
          continue;
        }
        inQuotes = false;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      const item = current.trim();
      if (item) items.push(item);
      current = "";
      continue;
    }
    current += ch;
  }

  const last = current.trim();
  if (last) items.push(last);
  return items;
}

export function parseRiskTextList(value: string): string[] | null {
  const text = value.trim();
  if (!text) return null;

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        const items = parsed.map((item) => String(item).trim()).filter(Boolean);
        return items.length ? items : null;
      }
    } catch {
      /* fall through */
    }
  }

  if (text.startsWith("{") && text.endsWith("}")) {
    const items = parsePostgresTextArray(text);
    return items.length ? items : null;
  }

  return null;
}

export function formatHealthAlertText(raw: string): { lines: string[]; isList: boolean } {
  const items = parseRiskTextList(raw);
  if (items?.length) {
    return { lines: items, isList: items.length > 1 };
  }
  if (raw.includes("• ")) {
    const bulletLines = raw
      .split("\n")
      .map((line) => line.replace(/^[•-]\s*/, "").trim())
      .filter(Boolean);
    if (bulletLines.length > 1) {
      return { lines: bulletLines, isList: true };
    }
  }
  const text = raw.trim();
  return { lines: text ? [text] : [], isList: false };
}

export function formatHealthAlertBody(alert: ShiftHealthAlert): { lines: string[]; isList: boolean } {
  const raw = (alert.instructions || alert.description || alert.detail || "").trim();
  return formatHealthAlertText(raw);
}

export function healthAlertShortLabel(alert: ShiftHealthAlert): string {
  const title = alert.title?.trim();
  if (title) return title;

  const { lines } = formatHealthAlertBody(alert);
  const desc = lines.join(" · ");
  if (!desc) return "Safety alert";

  const firstLine = desc.split(/\n/)[0]?.trim() ?? desc;
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine;
}
