import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Copy, Download, FileDown } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_PROPS, BAR_PROPS, GRID_PROPS, SERIES, TOOLTIP_PROPS } from "@/components/charts/figures";
import type { BarChartBlock, ChatBlock, DownloadBlock, StatBlock, TableBlock } from "@/services/chatboxService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const LINK = "var(--cc-plum)";

export type QuillSize = "compact" | "full";

type Group = { kind: "stats"; stats: StatBlock[] } | { kind: "block"; block: ChatBlock };

/** Consecutive figures read as one strip, not a grid of separate cards. */
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

export function QuillBlocks({ blocks, size }: { blocks: ChatBlock[]; size: QuillSize }) {
  if (!blocks.length) return null;
  return (
    <div className="space-y-3">
      {group(blocks).map((g, i) => {
        if (g.kind === "stats") return <StatStrip key={i} stats={g.stats} size={size} />;
        const b = g.block;
        if (b.type === "table") return <TableView key={i} block={b} size={size} />;
        if (b.type === "bar_chart") return <ChartView key={i} block={b} size={size} />;
        if (b.type === "download") return <DownloadView key={i} block={b} />;
        return null;
      })}
    </div>
  );
}

// ── Figures ──────────────────────────────────────────────────────────────────

function StatStrip({ stats, size }: { stats: StatBlock[]; size: QuillSize }) {
  const maxCols = size === "full" ? 4 : 2;
  const cols = Math.min(stats.length, maxCols);
  return (
    <div
      className="grid overflow-hidden rounded-xl border"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 1, background: BORDER, borderColor: BORDER }}
    >
      {stats.map((s, i) => {
        // A lone figure on the last row spans it, so no empty grey cell shows.
        const spanRest = i === stats.length - 1 && stats.length % cols !== 0;
        return (
          <div
            key={i}
            className="min-w-0 px-3.5 py-2.5"
            style={{ background: "var(--cc-surface)", gridColumn: spanRest ? `span ${cols - (stats.length % cols) + 1}` : undefined }}
          >
            <p className="truncate text-[11px] font-medium" style={{ color: MUTED }} title={s.label}>
              {s.label}
            </p>
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
              <span
                className="text-[19px] font-semibold leading-tight tabular-nums"
                style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}
              >
                {s.value ?? "Not set"}
              </span>
              {s.target != null && (
                <span className="text-[11px]" style={{ color: MUTED }}>
                  {typeof s.target === "number" ? `of ${s.target} target` : s.target}
                </span>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ── Tables ───────────────────────────────────────────────────────────────────

type Cell = string | number | null;

const NUMERIC = /^-?\$?-?[\d,]+(\.\d+)?%?$/;

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
  if (v === "urgent" || v === "expired" || v === "overdue" || /\bdays? ago$/.test(v) || v.includes("(overspent)")) {
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
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: BORDER, background: "var(--cc-surface)" }}>
      <div className="flex items-center gap-2 border-b px-3.5 py-2" style={{ borderColor: BORDER }}>
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold" style={{ color: TEXT }}>
          {block.title}
          <span className="ml-2 font-normal" style={{ color: MUTED }}>
            {block.rows.length} {block.rows.length === 1 ? "row" : "rows"}
          </span>
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
          <thead>
            <tr>
              {block.columns.map((c, i) => (
                <th
                  key={i}
                  scope="col"
                  aria-sort={sort?.col === i ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                  className={`whitespace-nowrap px-3.5 py-2 font-medium ${numeric[i] ? "text-right" : "text-left"}`}
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
          <tbody>
            {shown.map((row, r) => (
              <tr key={r} className="border-t" style={{ borderColor: BORDER }}>
                {row.map((cell, c) => {
                  const tone = cellTone(cell);
                  return (
                    <td
                      key={c}
                      className={`px-3.5 py-2 align-top ${numeric[c] ? "text-right tabular-nums whitespace-nowrap" : ""}`}
                      style={{ color: tone ?? TEXT, fontWeight: tone && tone !== MUTED ? 600 : undefined }}
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
          className="w-full border-t px-3.5 py-2 text-left text-[12px] font-semibold hover:underline"
          style={{ borderColor: BORDER, color: LINK }}
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

// ── Charts ───────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(value: unknown, spansYears: boolean): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(value));
  if (!m) return String(value);
  const name = MONTHS[Number(m[2]) - 1] ?? m[2];
  return spansYears ? `${name} ${m[1].slice(2)}` : name;
}

function money(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
}

function compactMoney(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (Math.abs(n) >= 1000) return `$${Math.round(n / 100) / 10}k`;
  return `$${Math.round(n)}`;
}

function ChartView({ block, size }: { block: BarChartBlock; size: QuillSize }) {
  const series = block.series.slice(0, SERIES.length);
  const isMoney = series.some((s) => s.key.endsWith("_aud"));
  const years = new Set(block.data.map((d) => String(d[block.x_key]).slice(0, 4)));
  const spansYears = years.size > 1;
  return (
    <div className="rounded-xl border px-3.5 py-3" style={{ borderColor: BORDER, background: "var(--cc-surface)" }}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
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
      <div style={{ width: "100%", height: size === "full" ? 220 : 150 }}>
        <ResponsiveContainer>
          <BarChart data={block.data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis
              dataKey={block.x_key}
              {...AXIS_PROPS}
              tick={{ fontSize: 11, fill: MUTED }}
              tickFormatter={(v) => monthLabel(v, spansYears)}
            />
            <YAxis
              {...AXIS_PROPS}
              width={isMoney ? 48 : 32}
              tick={{ fontSize: 11, fill: MUTED }}
              tickFormatter={(v) => (isMoney ? compactMoney(v) : String(v))}
            />
            <Tooltip
              {...TOOLTIP_PROPS}
              cursor={{ fill: "var(--cc-soft)" }}
              labelFormatter={(v) => monthLabel(v, true)}
              formatter={(value: unknown, name: unknown) => [isMoney ? money(value) : String(value), String(name)]}
            />
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label ?? s.key} fill={SERIES[i]} {...BAR_PROPS} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
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
      className="flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors hover:bg-[var(--cc-soft)]"
      style={{ borderColor: BORDER, background: "var(--cc-surface)" }}
    >
      <FileDown size={18} className="shrink-0" style={{ color: MUTED }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold" style={{ color: TEXT }}>
          {block.title}
        </span>
        {block.count != null && (
          <span className="block text-[11.5px]" style={{ color: MUTED }}>
            {block.count} {block.count === 1 ? "file" : "files"}
          </span>
        )}
      </span>
      <span className="shrink-0 text-[12px] font-semibold" style={{ color: LINK }}>
        Download
      </span>
    </a>
  );
}
