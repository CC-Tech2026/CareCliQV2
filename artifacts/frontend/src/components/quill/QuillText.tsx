import type { ReactNode } from "react";

/** Quill's reply text, laid out as a brief.
 *
 * Quill is asked for a one-sentence headline, then a short list where each
 * item starts with its topic ("- **Credentials:** Tom Walsh has three
 * expired"). The headline reads as the lead; topic items become labelled
 * rows that match the topic names over the cards below. Anything else a
 * model writes (plain paragraphs, ordinary lists, "# Title" lines) still
 * renders cleanly. Deliberately small, not a markdown engine. */

type Item = { topic: string | null; text: string };

type Part =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: Item[] }
  | { kind: "ol"; items: Item[] };

const BULLET = /^\s*(?:[-*•])\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
// "**Credentials:** text" or "**Credentials**: text"
const TOPIC = /^\*\*([^*]{1,40}?):?\*\*:?\s+(.+)$/;

function toItem(text: string): Item {
  const m = TOPIC.exec(text.trim());
  return m ? { topic: m[1].trim(), text: m[2] } : { topic: null, text };
}

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
      const item = toItem((bullet ?? numbered)![1]);
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
  const parts = parse(text);
  return (
    <div className="space-y-3">
      {parts.map((part, i) => {
        if (part.kind === "p") {
          // The opening sentence is the headline when a list follows it.
          const lead = i === 0 && parts.length > 1;
          return (
            <p key={i} className={lead ? "font-medium" : undefined}>
              {inline(part.text)}
            </p>
          );
        }
        if (part.items.every((item) => item.topic)) return <TopicList key={i} items={part.items} />;
        const List = part.kind === "ul" ? "ul" : "ol";
        return (
          <List key={i} className={`space-y-1 pl-5 ${part.kind === "ul" ? "list-disc" : "list-decimal"}`}>
            {part.items.map((item, j) => (
              <li key={j} className="pl-0.5">
                {item.topic && <strong className="font-semibold">{item.topic}: </strong>}
                {inline(item.text)}
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

/** "- **Topic:** sentence" items as labelled rows: the topic on its own
 * line, the point under it, a hairline between rows. */
function TopicList({ items }: { items: Item[] }) {
  return (
    <ul className="divide-y border-y" style={{ borderColor: "var(--cc-border)" }}>
      {items.map((item, j) => (
        <li key={j} className="py-2" style={{ borderColor: "var(--cc-border)" }}>
          <span className="block text-[0.84em] font-semibold" style={{ color: "var(--cc-text)" }}>
            {item.topic}
          </span>
          <span className="block">{inline(item.text)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The same text without markup, for copying. */
export function plainText(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1");
}
