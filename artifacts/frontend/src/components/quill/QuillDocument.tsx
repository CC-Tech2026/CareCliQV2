import { useMemo, useState, type ReactNode } from "react";
import { Check, Copy, FileText, Printer } from "lucide-react";
import type { DocumentBlock } from "@/services/chatboxService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

/** A report, template or letter Quill wrote, laid out as a page you can
 * copy, open in Word or print to PDF. The Markdown comes from the model, so
 * it's parsed into a small set of parts and never rendered as HTML. */

type Part =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "quote"; text: string }
  | { kind: "rule" };

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function parseDocument(markdown: string): Part[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const parts: Part[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) parts.push({ kind: "p", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      parts.push({ kind: "h", level: Math.min(heading[1].length, 3) as 1 | 2 | 3, text: heading[2].replace(/\*\*/g, "") });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      parts.push({ kind: "rule" });
      continue;
    }
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(cells(lines[i++]));
      i--;
      parts.push({ kind: "table", head, rows });
      continue;
    }
    const bullet = /^\s*[-*•]\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flush();
      const kind = bullet ? "ul" : "ol";
      const text = (bullet ?? numbered)![1];
      const last = parts[parts.length - 1];
      if (last && last.kind === kind) last.items.push(text);
      else parts.push({ kind, items: [text] });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flush();
      parts.push({ kind: "quote", text: line.replace(/^\s*>\s?/, "") });
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return parts;
}

/** **bold** and [blanks] to fill in; everything else is plain text. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]{1,60}\](?!\())/g).filter(Boolean).map((piece, i) => {
    if (piece.startsWith("**") && piece.endsWith("**")) return <strong key={i} className="font-semibold">{piece.slice(2, -2)}</strong>;
    if (piece.startsWith("[") && piece.endsWith("]"))
      return (
        <span key={i} className="rounded px-1" style={{ background: "var(--cc-amber-soft, var(--cc-soft))", color: TEXT }}>
          {piece}
        </span>
      );
    return <span key={i}>{piece.replace(/\*\*/g, "")}</span>;
  });
}

function DocumentBody({ parts }: { parts: Part[] }) {
  return (
    <div className="space-y-3 break-words text-[13.5px] leading-[1.7] [overflow-wrap:anywhere]" style={{ color: TEXT }}>
      {parts.map((part, i) => {
        switch (part.kind) {
          case "h":
            if (part.level === 1)
              return <h2 key={i} className="pt-1 text-[18px] font-semibold leading-snug" style={{ fontFamily: "var(--app-font-display)" }}>{inline(part.text)}</h2>;
            if (part.level === 2)
              return <h3 key={i} className="border-b pb-1 pt-3 text-[14.5px] font-semibold" style={{ borderColor: BORDER }}>{inline(part.text)}</h3>;
            return <h4 key={i} className="pt-2 text-[13.5px] font-semibold">{inline(part.text)}</h4>;
          case "p":
            return <p key={i}>{inline(part.text)}</p>;
          case "quote":
            return <blockquote key={i} className="border-l-2 pl-3" style={{ borderColor: BORDER, color: MUTED }}>{inline(part.text)}</blockquote>;
          case "rule":
            return <hr key={i} style={{ borderColor: BORDER }} />;
          case "table":
            return (
              <div key={i} className="overflow-x-auto">
                <table className="w-full text-[12.5px]" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {part.head.map((h, j) => (
                        <th key={j} className="border-b px-2 py-1.5 text-left font-semibold" style={{ borderColor: TEXT }}>{inline(h)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {part.rows.map((row, r) => (
                      <tr key={r}>
                        {part.head.map((_, c) => (
                          <td key={c} className="border-b px-2 py-1.5 align-top" style={{ borderColor: BORDER }}>{inline(row[c] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default: {
            const List = part.kind === "ul" ? "ul" : "ol";
            return (
              <List key={i} className={`space-y-1 pl-5 ${part.kind === "ul" ? "list-disc" : "list-decimal"}`}>
                {part.items.map((item, j) => <li key={j}>{inline(item)}</li>)}
              </List>
            );
          }
        }
      })}
    </div>
  );
}

// ── Export ───────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inlineHtml(s: string): string {
  return escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/** The document as standalone HTML, for Word and for printing. */
export function documentHtml(title: string, parts: Part[]): string {
  const body = parts
    .map((p) => {
      switch (p.kind) {
        case "h":
          return `<h${p.level}>${inlineHtml(p.text)}</h${p.level}>`;
        case "p":
          return `<p>${inlineHtml(p.text)}</p>`;
        case "quote":
          return `<blockquote>${inlineHtml(p.text)}</blockquote>`;
        case "rule":
          return "<hr>";
        case "table":
          return `<table><thead><tr>${p.head.map((h) => `<th>${inlineHtml(h)}</th>`).join("")}</tr></thead><tbody>${p.rows
            .map((r) => `<tr>${p.head.map((_, c) => `<td>${inlineHtml(r[c] ?? "")}</td>`).join("")}</tr>`)
            .join("")}</tbody></table>`;
        default:
          return `<${p.kind}>${p.items.map((it) => `<li>${inlineHtml(it)}</li>`).join("")}</${p.kind}>`;
      }
    })
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5;color:#1a1a2e;max-width:720px;margin:24px auto;padding:0 16px}
h1{font-size:18pt;margin:0 0 12px}h2{font-size:14pt;border-bottom:1px solid #ccc;padding-bottom:2px;margin-top:18px}h3{font-size:12pt}
table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #bbb;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f2f2f5}
blockquote{border-left:3px solid #ccc;margin:0;padding-left:10px;color:#555}
</style></head><body>${body}</body></html>`;
}

function fileName(title: string, ext: string) {
  return `${title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "quill-document"}.${ext}`;
}

const TYPE_LABEL: Record<DocumentBlock["document_type"], string> = {
  report: "Report",
  template: "Template",
  letter: "Letter",
  checklist: "Checklist",
  summary: "Summary",
  other: "Document",
};

export function QuillDocument({ block, full }: { block: DocumentBlock; full: boolean }) {
  const parts = useMemo(() => parseDocument(block.content), [block.content]);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  // A title the model also wrote as the first heading isn't shown twice.
  const first = parts[0];
  const shown = first?.kind === "h" && first.level === 1 && first.text.trim() === block.title.trim() ? parts.slice(1) : parts;
  const long = block.content.length > (full ? 2400 : 1200);

  async function copy() {
    try {
      await navigator.clipboard.writeText(block.content.replace(/\*\*([^*]+)\*\*/g, "$1"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  function downloadWord() {
    // Word opens HTML saved as .doc, with headings and tables intact.
    const html = documentHtml(block.title, [{ kind: "h", level: 1, text: block.title }, ...shown]);
    const url = URL.createObjectURL(new Blob(["﻿", html], { type: "application/msword" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName(block.title, "doc");
    a.click();
    URL.revokeObjectURL(url);
  }

  function printPdf() {
    const html = documentHtml(block.title, [{ kind: "h", level: 1, text: block.title }, ...shown]);
    // A same-origin blob page (the HTML is escaped and has no scripts), so
    // the print dialog can be opened on it once it loads.
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const w = window.open(url, "_blank", "width=820,height=900");
    if (!w) {
      URL.revokeObjectURL(url);
      return;
    }
    w.addEventListener("load", () => {
      w.focus();
      w.print();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  }

  return (
    <figure className="m-0" aria-label={`${TYPE_LABEL[block.document_type] ?? "Document"}: ${block.title}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2">
        <FileText size={15} aria-hidden="true" style={{ color: MUTED }} />
        <figcaption className="min-w-0 flex-1 truncate text-[13px] font-semibold" style={{ color: TEXT }}>
          {block.title}
          <span className="ml-2 font-normal" style={{ color: MUTED }}>{TYPE_LABEL[block.document_type] ?? "Document"}</span>
        </figcaption>
        <div className="flex items-center gap-1">
          <DocAction label={copied ? "Copied" : "Copy"} onClick={copy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </DocAction>
          <DocAction label="Word" onClick={downloadWord} title="Download for Microsoft Word">
            <FileText size={13} />
          </DocAction>
          <DocAction label="PDF" onClick={printPdf} title="Print or save as PDF">
            <Printer size={13} />
          </DocAction>
        </div>
      </div>
      <div
        className={`rounded-lg border ${full ? "px-8 py-6" : "px-4 py-4"}`}
        style={{ borderColor: BORDER, background: "var(--cc-surface)" }}
      >
        <div className={long && !expanded ? "max-h-[360px] overflow-hidden" : undefined}>
          <DocumentBody parts={shown} />
        </div>
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-[12px] font-semibold hover:underline"
          style={{ color: "var(--cc-plum)" }}
        >
          {expanded ? "Show less" : "Show the whole document"}
        </button>
      )}
    </figure>
  );
}

function DocAction({ label, title, onClick, children }: { label: string; title?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className="flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium transition-colors hover:bg-[var(--cc-soft)]"
      style={{ color: MUTED }}
    >
      {children}
      {label}
    </button>
  );
}
