import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Copy, Download, FileDown } from "lucide-react";
import { SERIES } from "@/components/charts/figures";
import type { BarChartBlock, ChatBlock, DownloadBlock, StatBlock, TableBlock } from "@/services/chatboxService";
import { QuillDocument } from "./QuillDocument";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const LINK = "var(--cc-plum)";

export type QuillSize = "compact" | "full";

/** The detail under an answer, laid out like the body of a short report:
 * topic headings with a rule, a line of key figures, ruled tables and
 * labelled bars. No boxed cards; only a drafted document sits on a page. */

type Group = { kind: "stats"; stats: StatBlock[] } | { kind: "block"; block: ChatBlock };

/** Consecutive figures read as one line. */
function group(blocks: ChatBlock[]): Group[] {
  const out: Group[] = [];
  for (const block of blocks) {
    const last = out[out.length - 1];
    if (block.type === "stat" && last?.kind === "stats") last.stats.push(block);
    else if (block.type === "stat") out.push({ kind: "stats", stats: [block] });
    else out.push({ kind: "block", block });
  }
  return out;
}

type Section = { name: string | null; blocks: ChatBlock[] };

/** Blocks by topic, in the order each topic first appears. */
function sections(blocks: ChatBlock[]): Section[] {
  const out: Section[] = [];
  for (const block of blocks) {
    const name = block.section ?? null;
    const existing = out.find((s) => s.name === name);
    if (existing) existing.blocks.push(block);
    else out.push({ name, blocks: [block] });
  }
  return out;
}

export function QuillBlocks({ blocks, size }: { blocks: ChatBlock[]; size: QuillSize }) {
  if (!blocks.length) return null;
  const groups = sections(blocks);
  const labelled = groups.length > 1;
  return (
    <div className={labelled ? "space-y-6 pt-1" : "space-y-4"}>
      {groups.map((section, s) => (
        <section key={section.name ?? `s${s}`} aria-label={labelled ? (section.name ?? "Other details") : undefined}>
          {labelled && (
            <h3
              className="mb-3 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.08em]"
              style={{ color: MUTED }}
            >
              <span>{section.name ?? "Other details"}</span>
              <span aria-hidden="true" className="h-px flex-1" style={{ background: BORDER }} />
            </h3>
          )}
          <div className="space-y-4">
            {group(section.blocks).map((g, i) => {
              if (g.kind === "stats") return <Figures key={i} stats={g.stats} size={size} />;
              const b = g.block;
              if (b.type === "table") return <TableView key={i} block={b} size={size} />;
              if (b.type === "bar_chart") return <BarsView key={i} block={b} />;
              if (b.type === "download") return <DownloadView key={i} block={b} />;
              if (b.type === "document") return <QuillDocument key={i} block={b} full={size === "full"} />;
              return null;
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Figures ──────────────────────────────────────────────────────────────────

function Figures({ stats, size }: { stats: StatBlock[]; size: QuillSize }) {
  return (
    <dl className={`flex flex-wrap gap-y-3 ${size === "full" ? "gap-x-8" : "gap-x-6"}`}>
      {stats.map((s, i) => (
        <div key={i} className="min-w-0 max-w-[14rem]">
          <dd
            className="text-[20px] font-semibold leading-tight tabular-nums"
            style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}
          >
            {s.value ?? "Not set"}
            {s.target != null && (
              <span className="ml-1.5 text-[11.5px] font-normal" style={{ color: MUTED, fontFamily: "inherit" }}>
                {typeof s.target === "number" ? `of ${s.target} target` : s.target}
              </span>
            )}
          </dd>
          <dt className="mt-0.5 text-[11.5px] leading-snug" style={{ color: MUTED }}>
            {s.label}
          </dt>
        </div>
      ))}
    </dl>
  );
}

// ── Tables ───────────────────────────────────────────────────────────────────

type Cell = string | number | null;

const NUMERIC = /^-?\$?-?[\d,]+(\.\d+)?%?$/;
const SHORT_CELL = 18;

function toNumber(cell: Cell): number | null {
  if (typeof cell === "number") return cell;
  if (typeof cell !== "string") return null;
  const s = cell.replace(/[$,%\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

function isNumericColumn(rows: Cell[][], col: number): boolean {
  const values = rows.map((r) => r[col]).filter((c) => c != null && c !== "" && c !== "—");
  return values.length > 0 && values.every((c) => typeof c === "number" || NUMERIC.test(String(c).trim()));
}

/** Words that carry a status get their real status colour; nothing else is tinted. */
function cellTone(cell: Cell): string | undefined {
  if (typeof cell !== "string") return undefined;
  const v = cell.trim().toLowerCase();
  if (
    v === "urgent" || v === "expired" || v === "overdue" || v === "report owed" ||
    /\bdays? ago$/.test(v) || v.includes("(overspent)")
  ) {
    return "var(--cc-danger-text)";
  }
  if (v === "soon" || v === "today") return "var(--cc-amber)";
  if (v === "cancelled") return MUTED;
  return undefined;
}

function csvEscape(cell: Cell): string {
  const s = cell == null ? "" : String(cell);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tableAsText(block: TableBlock): string {
  const lines = [block.columns.join("\t"), ...block.rows.map((r) => r.map((c) => (c == null ? "" : String(c))).join("\t"))];
  return `${block.title}\n${lines.join("\n")}`;
}

function TableView({ block, size }: { block: TableBlock; size: QuillSize }) {
  const limit = size === "full" ? 10 : 6;
  const [expanded, setExpanded] = useState(false);
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [copied, setCopied] = useState(false);
  // A two-column table with no headings is a list of label / value pairs.
  const keyValue = block.columns.length === 2 && block.columns.every((c) => !c);

  const numeric = useMemo(() => block.columns.map((_, i) => isNumericColumn(block.rows, i)), [block]);
  const rows = useMemo(() => {
    if (!sort) return block.rows;
    const { col, dir } = sort;
    return [...block.rows].sort((a, b) => {
      const na = toNumber(a[col]);
      const nb = toNumber(b[col]);
      if (na != null && nb != null) return (na - nb) * dir;
      return String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * dir;
    });
  }, [block.rows, sort]);
  const shown = expanded ? rows : rows.slice(0, limit);
  const pad = size === "full" ? "px-2.5" : "px-1.5";

  function toggleSort(col: number) {
    setSort((s) => (s?.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 }));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(tableAsText(block));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  }

  function downloadCsv() {
    const csv = [block.columns, ...block.rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${block.title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "quill-table"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex items-center gap-2 pb-1.5">
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold" style={{ color: TEXT }}>
          {block.title}
          {!keyValue && (
            <span className="ml-2 font-normal" style={{ color: MUTED }}>
              {block.rows.length} {block.rows.length === 1 ? "row" : "rows"}
            </span>
          )}
        </p>
        <IconAction label={copied ? "Copied" : "Copy table"} onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </IconAction>
        <IconAction label="Download as CSV" onClick={downloadCsv}>
          <Download size={14} />
        </IconAction>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]" style={{ borderCollapse: "collapse" }}>
          {!keyValue && (
            <thead>
              <tr className="border-b" style={{ borderColor: TEXT }}>
                {block.columns.map((c, i) => (
                  <th
                    key={i}
                    scope="col"
                    aria-sort={sort?.col === i ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                    className={`whitespace-nowrap ${pad} pb-1.5 pt-0 font-medium first:pl-0 ${numeric[i] ? "text-right" : "text-left"}`}
                    style={{ color: MUTED, fontSize: 11.5 }}
                  >
                    {c ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(i)}
                        className="inline-flex items-center gap-1 rounded hover:underline focus-visible:outline-none focus-visible:ring-2"
                        style={{ ["--tw-ring-color" as string]: LINK }}
                      >
                        {c}
                        {sort?.col === i && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                      </button>
                    ) : (
                      <span className="sr-only">Status</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {shown.map((row, r) => (
              <tr key={r} className="border-b" style={{ borderColor: BORDER }}>
                {row.map((cell, c) => {
                  const tone = cellTone(cell);
                  const short = size === "full" && cell != null && String(cell).length <= SHORT_CELL;
                  const label = keyValue && c === 0;
                  return (
                    <td
                      key={c}
                      className={`${pad} py-2 align-top first:pl-0 ${numeric[c] && !keyValue ? "text-right tabular-nums whitespace-nowrap" : short ? "whitespace-nowrap" : ""} ${label ? "w-[38%]" : ""}`}
                      style={{
                        color: label ? MUTED : (tone ?? TEXT),
                        fontWeight: tone && tone !== MUTED ? 600 : undefined,
                      }}
                    >
                      {cell ?? "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-left text-[12px] font-semibold hover:underline"
          style={{ color: LINK }}
        >
          {expanded ? "Show fewer" : `Show all ${rows.length} rows`}
        </button>
      )}
    </div>
  );
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--cc-soft)]"
      style={{ color: MUTED }}
    >
      {children}
    </button>
  );
}

// ── Bars ─────────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(value: unknown, spansYears: boolean): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(value));
  if (!m) return String(value);
  const name = MONTHS[Number(m[2]) - 1] ?? m[2];
  return spansYears ? `${name} ${m[1].slice(2)}` : name;
}

function compactMoney(value: number): string {
  if (Math.abs(value) >= 1000) return `$${(Math.round(value / 100) / 10).toLocaleString("en-AU")}k`;
  return `$${Math.round(value).toLocaleString("en-AU")}`;
}

/** One row per month (or category): its label, a bar per series scaled to
 * the largest value in the block, and the figure at the end of each bar.
 * Easier to read in a narrow panel than a column chart with an axis. */
function BarsView({ block }: { block: BarChartBlock }) {
  const series = block.series.slice(0, SERIES.length);
  const isMoney = series.some((s) => s.key.endsWith("_aud"));
  const years = new Set(block.data.map((d) => String(d[block.x_key]).slice(0, 4)));
  const spansYears = years.size > 1;
  const max = Math.max(1, ...block.data.flatMap((d) => series.map((s) => Math.abs(Number(d[s.key]) || 0))));
  const fmt = (v: number) => (isMoney ? compactMoney(v) : v.toLocaleString("en-AU"));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2">
        <p className="mr-auto text-[12.5px] font-semibold" style={{ color: TEXT }}>
          {block.title}
        </p>
        {series.length > 1 &&
          series.map((s, i) => (
            <span key={s.key} className="flex items-center gap-1.5 text-[11.5px]" style={{ color: MUTED }}>
              <span className="h-2 w-2 rounded-sm" style={{ background: SERIES[i] }} />
              {s.label}
            </span>
          ))}
      </div>
      <ul className="space-y-1.5">
        {block.data.map((d, r) => (
          <li key={r} className="grid grid-cols-[3.25rem_1fr] items-center gap-2 text-[11.5px]">
            <span className="tabular-nums" style={{ color: MUTED }}>
              {monthLabel(d[block.x_key], spansYears)}
            </span>
            <span className="space-y-0.5">
              {series.map((s, i) => {
                const value = Number(d[s.key]) || 0;
                return (
                  <span key={s.key} className="flex items-center gap-2" title={`${s.label}: ${fmt(value)}`}>
                    <span
                      className="h-2.5 rounded-sm"
                      style={{ width: `${Math.max((Math.abs(value) / max) * 78, value ? 1.5 : 0)}%`, background: SERIES[i] }}
                    />
                    <span className="shrink-0 tabular-nums" style={{ color: TEXT }}>
                      {fmt(value)}
                    </span>
                  </span>
                );
              })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Downloads ────────────────────────────────────────────────────────────────

function DownloadView({ block }: { block: DownloadBlock }) {
  return (
    <a
      href={block.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-2.5 border-b py-2 text-[12.5px]"
      style={{ borderColor: BORDER }}
    >
      <FileDown size={16} className="shrink-0" style={{ color: MUTED }} />
      <span className="min-w-0 flex-1 truncate font-semibold" style={{ color: TEXT }}>
        {block.title}
        {block.count != null && (
          <span className="ml-2 font-normal" style={{ color: MUTED }}>
            {block.count} {block.count === 1 ? "file" : "files"}
          </span>
        )}
      </span>
      <span className="shrink-0 text-[12px] font-semibold group-hover:underline" style={{ color: LINK }}>
        Download
      </span>
    </a>
  );
}
