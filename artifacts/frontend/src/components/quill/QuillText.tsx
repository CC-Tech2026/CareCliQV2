import type { ReactNode } from "react";

/** Quill's reply text, laid out as a brief.
 *
 * Quill is asked for a one-sentence headline, then a short list where each
 * item starts with its topic. Keep a readable prose layout, with semantic
 * headings and lists, safe links, quotes and code. Raw HTML is rendered as
 * text; tables and charts use the structured blocks returned by the API. */

type Item = { topic: string | null; text: string };

type Part =
  | { kind: "p"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string; language: string }
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
  let code: string[] | null = null;
  let language = "";
  const flush = () => {
    if (paragraph.length) parts.push({ kind: "p", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*```/.test(line)) {
      flush();
      if (code !== null) {
        parts.push({ kind: "code", text: code.join("\n"), language });
        code = null;
      } else {
        code = [];
        language = line.trim().slice(3).trim();
      }
      continue;
    }
    if (code !== null) {
      code.push(raw);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flush();
      parts.push({ kind: "quote", text: line.replace(/^\s*>\s?/, "") });
      continue;
    }
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
      parts.push({ kind: "heading", text: heading[1].replace(/\*\*/g, "") });
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  if (code !== null) parts.push({ kind: "code", text: code.join("\n"), language });
  return parts;
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g).filter(Boolean).map((piece, i) => {
    if (piece.startsWith("**") && piece.endsWith("**")) return <strong key={i} className="font-semibold">{piece.slice(2, -2)}</strong>;
    if (piece.startsWith("`")) return <code key={i} className="rounded bg-[var(--cc-soft)] px-1 py-0.5 text-[0.88em]">{piece.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(piece);
    if (link) {
      // Model output never becomes executable markup or an unsafe link.
      const safe = /^https?:\/\//i.test(link[2]) || /^\/(?![\/\\])/.test(link[2]);
      if (safe && !/[\u0000-\u0020\\]/.test(link[2])) return <a key={i} href={link[2]} target={link[2].startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer" className="text-[var(--cc-plum)] underline decoration-current/40 underline-offset-4 hover:decoration-current">{link[1]}</a>;
      return <span key={i}>{link[1]}</span>;
    }
    return <span key={i}>{piece}</span>;
  });
}

export function QuillText({ text }: { text: string }) {
  const parts = parse(text);
  return (
    <div className="space-y-3 break-words [overflow-wrap:anywhere]">
      {parts.map((part, i) => {
        if (part.kind === "heading") return <h3 key={i} className="pt-2 text-[1.05em] font-semibold tracking-tight first:pt-0">{inline(part.text)}</h3>;
        if (part.kind === "quote") return <blockquote key={i} className="border-l-2 border-[var(--cc-border)] pl-3 text-[var(--cc-muted)]">{inline(part.text)}</blockquote>;
        if (part.kind === "code") return <div key={i} className="overflow-hidden rounded-xl border border-[var(--cc-border)] bg-[var(--cc-soft)]">
          {part.language && <div className="border-b border-[var(--cc-border)] px-3 py-1.5 text-[0.8em] text-[var(--cc-muted)]">{part.language}</div>}
          <pre className="overflow-x-auto p-3 text-[0.85em] leading-6"><code>{part.text}</code></pre>
        </div>;
        if (part.kind === "p") {
          // The opening sentence is the headline when a list follows it.
          const lead = i === 0 && parts.length > 1;
          return (
            <p key={i} className={lead ? "font-medium" : undefined}>
              {inline(part.text)}
            </p>
          );
        }
        if (part.kind === "ul" && part.items.every((item) => item.topic)) return <TopicList key={i} items={part.items} />;
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

/** Topic bullets read as short paragraphs, with an inline label. */
function TopicList({ items }: { items: Item[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item, j) => (
        <li key={j}>
          <strong className="font-semibold" style={{ color: "var(--cc-text)" }}>{item.topic}: </strong>
          {inline(item.text)}
        </li>
      ))}
    </ul>
  );
}

/** The same text without markup, for copying. */
export function plainText(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1");
}
