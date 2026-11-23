import type { ReactNode } from "react";

/** Quill's reply text: paragraphs, **bold**, and simple lists.
 *
 * Deliberately small, not a markdown engine. Quill is told to write plain
 * prose with **bold** for key figures, but a model sometimes answers with a
 * dash or numbered list anyway; those render as real lists instead of
 * showing raw dashes. Headings ("# Title") are shown as bold lines. */

type Part =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

const BULLET = /^\s*(?:[-*•])\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

function parse(text: string): Part[] {
  const parts: Part[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) parts.push({ kind: "p", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const kind = bullet ? "ul" : "ol";
      const item = (bullet ?? numbered)![1];
      const last = parts[parts.length - 1];
      if (last && last.kind === kind) last.items.push(item);
      else parts.push({ kind, items: [item] });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      parts.push({ kind: "p", text: `**${heading[1].replace(/\*\*/g, "")}**` });
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return parts;
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((piece, i) =>
    piece.startsWith("**") && piece.endsWith("**") && piece.length > 4 ? (
      <strong key={i} className="font-semibold">
        {piece.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{piece}</span>
    ),
  );
}

export function QuillText({ text }: { text: string }) {
  return (
    <div className="space-y-2.5">
      {parse(text).map((part, i) => {
        if (part.kind === "p") return <p key={i}>{inline(part.text)}</p>;
        const List = part.kind === "ul" ? "ul" : "ol";
        return (
          <List key={i} className={`space-y-1 pl-5 ${part.kind === "ul" ? "list-disc" : "list-decimal"}`}>
            {part.items.map((item, j) => (
              <li key={j} className="pl-0.5">
                {inline(item)}
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

/** The same text without markup, for copying. */
export function plainText(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1");
}
