import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { getStoredSignature } from "@/lib/signature-store";

export interface AuditPayload {
  audit_version: string;
  ndis_principle: string;
  generated_at: string;
  session: {
    id: string;
    date: string;
    type: string;
    duration_minutes: number;
    status: string;
  };
  participant: {
    id: string;
    full_name: string;
    ndis_number?: string;
    date_of_birth?: string;
    biological_sex?: string;
  };
  practitioner?: {
    name?: string;
    credentials?: string;
    sign_off_date?: string;
  };
  clinical_notes: string;
  structured_notes: Record<string, string>;
  goals_addressed: string[];
  compliance: {
    score: number;
    blocking: boolean;
    issues: string[];
    status: string;
    ai_blended_score?: number;
    ai_status?: string;
    ai_notes?: string;
  };
  ai_insights?: {
    summary?: string;
    key_observations?: string[];
    next_session_recommendations?: string[];
    progress_trend?: string;
  };
  transcription?: string | null;
  photo_urls?: string[];
  evidence_summary?: {
    photo_count: number;
    has_transcription: boolean;
    has_activity_log: boolean;
  };
  body_markers?: Array<{ zone: string; color: string; note?: string }>;
}

export async function fetchAuditData(sessionId: string): Promise<AuditPayload> {
  const res = await fetch(`/api/sessions/${sessionId}/audit`);
  if (!res.ok) {
    throw new Error(`Failed to fetch audit record for session ${sessionId} (${res.status} ${res.statusText})`);
  }
  return res.json() as Promise<AuditPayload>;
}

export interface ProviderInfo {
  businessName?: string | null;
  abn?: string | null;
}

async function fetchProviderSettings(): Promise<ProviderInfo> {
  try {
    const res = await fetch("/api/settings/practitioner");
    if (!res.ok) return {};
    const data = (await res.json()) as { provider?: ProviderInfo | null };
    return (data.provider as ProviderInfo) ?? {};
  } catch {
    return {};
  }
}

async function fetchLogoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch("/opengraph.jpg");
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const BRAND_DARK = "#1e3a5f";
const BRAND_BLUE = "#3b82f6";
const SLATE_500 = "#64748b";
const SLATE_700 = "#334155";
const SLATE_900 = "#1e293b";
const RED = "#dc2626";
const GREEN = "#059669";
const AMBER = "#d97706";
const RULE_COLOR = "#e2e8f0";
const HEADER_BG = "#1e3a5f";
const HEADER_ACCENT = "#2563eb";

function getScoreColor(score: number | null): string {
  if (score == null) return SLATE_500;
  if (score >= 85) return GREEN;
  if (score >= 60) return AMBER;
  return RED;
}

function getScoreLabel(score: number | null): string {
  if (score == null) return "Not assessed";
  if (score >= 85) return `${score.toFixed(0)}% — Compliant`;
  if (score >= 60) return `${score.toFixed(0)}% — At Risk`;
  return `${score.toFixed(0)}% — Non-Compliant`;
}

export function appendSessionToPDF(
  pdf: jsPDF,
  data: AuditPayload,
  isFirstSession = true,
  logoDataUrl: string | null = null,
  providerInfo: ProviderInfo = {}
) {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = pageW - margin * 2;

  if (!isFirstSession) {
    pdf.addPage();
  }

  let y = margin;

  const drawContinuationHeader = () => {
    const stripH = 10;
    pdf.setFillColor(HEADER_BG);
    pdf.rect(0, 0, pageW, stripH, "F");
    pdf.setFillColor(HEADER_ACCENT);
    pdf.rect(0, stripH - 2, pageW, 2, "F");

    if (logoDataUrl) {
      try {
        pdf.addImage(logoDataUrl, "JPEG", pageW - margin - 8, 1, 8, 8);
      } catch {
        // skip on failure
      }
    }

    pdf.setFontSize(7);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor("#93c5fd");
    pdf.text("AI CLINICAL COMPANION", margin, 4.5);

    pdf.setFont("helvetica", "normal");
    pdf.setTextColor("#94a3b8");
    pdf.text("NDIS Session Audit Report — continued", margin, 8);
  };

  const addPage = () => {
    pdf.addPage();
    drawContinuationHeader();
    y = 16;
  };

  const checkPageBreak = (neededH: number) => {
    if (y + neededH > pageH - margin - 16) addPage();
  };

  const drawHRule = (color = RULE_COLOR) => {
    pdf.setDrawColor(color);
    pdf.setLineWidth(0.3);
    pdf.line(margin, y, pageW - margin, y);
    y += 5;
  };

  const writeSectionHeading = (title: string) => {
    checkPageBreak(22);
    pdf.setFontSize(11);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(BRAND_DARK);
    pdf.text(title, margin, y);
    y += 2;
    drawHRule("#bfdbfe");
  };

  const writeWrappedText = (
    text: string,
    opts: {
      size?: number;
      bold?: boolean;
      color?: string;
      maxWidth?: number;
      lineGap?: number;
    } = {}
  ) => {
    const {
      size = 10,
      bold = false,
      color = SLATE_900,
      maxWidth = contentW,
      lineGap = 1.8,
    } = opts;

    pdf.setFontSize(size);
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setTextColor(color);

    const lines = pdf.splitTextToSize(text, maxWidth);
    const lineH = size * 0.352778 + lineGap;
    const ORPHAN_GUARD = 3;

    let i = 0;
    while (i < lines.length) {
      const remaining = lines.length - i;
      const spaceLeft = pageH - margin - 16 - y;
      const linesAvailable = Math.floor(spaceLeft / lineH);

      if (linesAvailable <= 0) {
        addPage();
        continue;
      }

      if (linesAvailable < ORPHAN_GUARD && remaining > ORPHAN_GUARD) {
        addPage();
        continue;
      }

      const chunk = lines.slice(i, i + linesAvailable);
      pdf.text(chunk, margin, y);
      y += chunk.length * lineH;
      i += chunk.length;
    }

    y += 1;
  };

  // ── Header band ──────────────────────────────────────────────────────────
  const headerH = 34;
  pdf.setFillColor(HEADER_BG);
  pdf.rect(0, 0, pageW, headerH, "F");

  pdf.setFillColor(HEADER_ACCENT);
  pdf.rect(0, headerH - 3, pageW, 3, "F");

  const logoSize = 22;
  const logoX = pageW - margin - logoSize;
  const logoY = (headerH - logoSize) / 2;

  if (logoDataUrl) {
    try {
      pdf.addImage(logoDataUrl, "JPEG", logoX, logoY, logoSize, logoSize);
    } catch {
      // fallback: draw branded placeholder square
      pdf.setFillColor(HEADER_ACCENT);
      pdf.roundedRect(logoX, logoY, logoSize, logoSize, 3, 3, "F");
      pdf.setFontSize(7);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor("#ffffff");
      pdf.text("ACC", logoX + logoSize / 2, logoY + logoSize / 2 + 2.5, { align: "center" });
    }
  } else {
    // No image available — draw branded rounded square as placeholder
    pdf.setFillColor(HEADER_ACCENT);
    pdf.roundedRect(logoX, logoY, logoSize, logoSize, 3, 3, "F");
    pdf.setFontSize(7);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor("#ffffff");
    pdf.text("ACC", logoX + logoSize / 2, logoY + logoSize / 2 + 2.5, { align: "center" });
  }

  pdf.setFontSize(8);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor("#93c5fd");
  pdf.text("AI CLINICAL COMPANION", margin, 9);

  pdf.setFontSize(15);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor("#ffffff");
  pdf.text("NDIS Session Audit Report", margin, 20);

  // Provider business name and ABN in header (if set)
  const providerBusinessName = providerInfo.businessName?.trim() || null;
  const providerABN = providerInfo.abn?.trim() || null;
  const providerParts: string[] = [];
  if (providerBusinessName) providerParts.push(providerBusinessName);
  if (providerABN) providerParts.push(`ABN: ${providerABN}`);
  if (providerParts.length > 0) {
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor("#cbd5e1");
    pdf.text(providerParts.join("  |  "), margin, 28);
  }

  const nowStr = new Date().toLocaleString("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  pdf.setFontSize(7);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor("#94a3b8");
  pdf.text(`Generated: ${nowStr}`, logoX - 3, 13, { align: "right" });
  pdf.text("Confidential — NDIS audit use only", logoX - 3, 20, { align: "right" });

  y = headerH + 8;

  // ── Participant Details table ────────────────────────────────────────────
  writeSectionHeading("Participant Details");

  const p = data.participant ?? {};
  const participantRows: [string, string][] = [
    ["Name", p.full_name ?? "—"],
  ];
  if (p.ndis_number) participantRows.push(["NDIS Number", p.ndis_number]);
  if (p.date_of_birth) participantRows.push(["Date of Birth", p.date_of_birth]);

  autoTable(pdf, {
    startY: y,
    margin: { left: margin, right: margin },
    tableWidth: contentW,
    body: participantRows,
    showHead: false,
    columnStyles: {
      0: { cellWidth: 45, fontStyle: "bold", textColor: SLATE_500, fontSize: 9 },
      1: { textColor: SLATE_900, fontSize: 10 },
    },
    styles: {
      cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
      lineColor: RULE_COLOR,
      lineWidth: 0.2,
    },
    alternateRowStyles: { fillColor: "#f8fafc" },
    theme: "plain",
  });

  y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // ── Session Information table ────────────────────────────────────────────
  writeSectionHeading("Session Information");

  const s = data.session ?? {};
  const sessionDate = s.date
    ? new Date(s.date).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";

  const sessionRows: [string, string][] = [
    ["Date", sessionDate],
    ["Type", s.type ?? "—"],
    ["Duration", s.duration_minutes ? `${s.duration_minutes} minutes` : "—"],
  ];
  if (s.status) sessionRows.push(["Status", s.status]);

  autoTable(pdf, {
    startY: y,
    margin: { left: margin, right: margin },
    tableWidth: contentW,
    body: sessionRows,
    showHead: false,
    columnStyles: {
      0: { cellWidth: 45, fontStyle: "bold", textColor: SLATE_500, fontSize: 9 },
      1: { textColor: SLATE_900, fontSize: 10 },
    },
    styles: {
      cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
      lineColor: RULE_COLOR,
      lineWidth: 0.2,
    },
    alternateRowStyles: { fillColor: "#f8fafc" },
    theme: "plain",
  });

  y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // ── Compliance Score ──────────────────────────────────────────────────────
  writeSectionHeading("Compliance Score");

  const score = data.compliance?.score ?? null;
  const scoreColor = getScoreColor(score);
  const scoreLabel = getScoreLabel(score);

  const complianceRows: [string, string][] = [
    ["Score", scoreLabel],
  ];
  if (data.compliance?.status) complianceRows.push(["Status", data.compliance.status]);
  if (data.compliance?.ai_blended_score != null) {
    complianceRows.push([
      "AI-Blended Score",
      `${data.compliance.ai_blended_score.toFixed(0)}%${data.compliance.ai_status ? " — " + data.compliance.ai_status : ""}`,
    ]);
  }

  autoTable(pdf, {
    startY: y,
    margin: { left: margin, right: margin },
    tableWidth: contentW,
    body: complianceRows,
    showHead: false,
    columnStyles: {
      0: { cellWidth: 45, fontStyle: "bold", textColor: SLATE_500, fontSize: 9 },
      1: { textColor: SLATE_900, fontSize: 10 },
    },
    didParseCell: (hookData) => {
      if (hookData.column.index === 1 && hookData.row.index === 0) {
        hookData.cell.styles.textColor = scoreColor;
        hookData.cell.styles.fontStyle = "bold";
        hookData.cell.styles.fontSize = 11;
      }
    },
    styles: {
      cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
      lineColor: RULE_COLOR,
      lineWidth: 0.2,
    },
    alternateRowStyles: { fillColor: "#f8fafc" },
    theme: "plain",
  });

  y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;

  if (data.compliance?.blocking) {
    checkPageBreak(10);
    pdf.setFillColor("#fef2f2");
    pdf.setDrawColor("#fecaca");
    pdf.setLineWidth(0.3);
    pdf.roundedRect(margin, y, contentW, 10, 2, 2, "FD");
    pdf.setFontSize(8.5);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(RED);
    pdf.text(
      "\u26A0  Documentation is insufficient to support a claim for this session.",
      margin + 4,
      y + 6.5
    );
    y += 14;
  } else {
    y += 4;
  }

  // ── Clinical Notes ────────────────────────────────────────────────────────
  writeSectionHeading("Clinical Notes");

  const clinicalNotes = data.clinical_notes || "No clinical notes recorded.";
  writeWrappedText(clinicalNotes, { size: 10, color: SLATE_900 });
  y += 4;

  // ── Structured Clinical Notes ─────────────────────────────────────────────
  const structuredEntries = Object.entries(data.structured_notes ?? {}).filter(
    ([, v]) => v && String(v).trim().length > 0
  );

  if (structuredEntries.length > 0) {
    writeSectionHeading("Structured Clinical Notes");

    const structuredRows: [string, string][] = structuredEntries.map(([key, value]) => [
      key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      String(value),
    ]);

    autoTable(pdf, {
      startY: y,
      margin: { left: margin, right: margin },
      tableWidth: contentW,
      body: structuredRows,
      showHead: false,
      columnStyles: {
        0: { cellWidth: 52, fontStyle: "bold", textColor: SLATE_500, fontSize: 9 },
        1: { textColor: SLATE_700, fontSize: 10 },
      },
      styles: {
        cellPadding: { top: 4, bottom: 4, left: 3, right: 3 },
        lineColor: RULE_COLOR,
        lineWidth: 0.2,
        overflow: "linebreak",
      },
      alternateRowStyles: { fillColor: "#f8fafc" },
      theme: "plain",
      pageBreak: "avoid",
    });

    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ── NDIS Goals Addressed ──────────────────────────────────────────────────
  const goals = data.goals_addressed ?? [];
  if (goals.length > 0) {
    writeSectionHeading("NDIS Goals Addressed");

    const goalRows: [string, string][] = goals.map((g, i) => [
      `${i + 1}.`,
      g,
    ]);

    autoTable(pdf, {
      startY: y,
      margin: { left: margin, right: margin },
      tableWidth: contentW,
      body: goalRows,
      showHead: false,
      columnStyles: {
        0: { cellWidth: 10, fontStyle: "bold", textColor: BRAND_BLUE, fontSize: 10 },
        1: { textColor: SLATE_700, fontSize: 10 },
      },
      styles: {
        cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
        lineColor: RULE_COLOR,
        lineWidth: 0.2,
        overflow: "linebreak",
      },
      alternateRowStyles: { fillColor: "#f0f9ff" },
      theme: "plain",
      pageBreak: "avoid",
    });

    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ── Compliance Issues ─────────────────────────────────────────────────────
  const complianceIssues = data.compliance?.issues ?? [];
  if (complianceIssues.length > 0) {
    writeSectionHeading("Compliance Gaps");

    const issueRows: [string, string][] = complianceIssues.map((issue, i) => [
      `${i + 1}.`,
      issue,
    ]);

    autoTable(pdf, {
      startY: y,
      margin: { left: margin, right: margin },
      tableWidth: contentW,
      body: issueRows,
      showHead: false,
      columnStyles: {
        0: { cellWidth: 10, fontStyle: "bold", textColor: RED, fontSize: 10 },
        1: { textColor: RED, fontSize: 10 },
      },
      styles: {
        cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
        lineColor: "#fecaca",
        lineWidth: 0.2,
        fillColor: "#fff5f5",
        overflow: "linebreak",
      },
      theme: "plain",
      pageBreak: "avoid",
    });

    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ── AI Assessment ─────────────────────────────────────────────────────────
  const aiNotes = data.compliance?.ai_notes ?? "";
  if (aiNotes) {
    writeSectionHeading("AI Assessment");
    writeWrappedText(aiNotes, { size: 10, color: SLATE_700 });
    y += 4;
  }

  // ── Physical Examination ──────────────────────────────────────────────────
  const bodyMarkers = data.body_markers ?? [];
  if (bodyMarkers.length > 0) {
    writeSectionHeading("Physical Examination");

    // --- Mini body diagram (canvas → PNG) ---
    const COLOR_HEX: Record<string, string> = {
      red: "#ef4444", yellow: "#f59e0b", blue: "#3b82f6", green: "#10b981",
    };
    // Zone centroids aligned with new 200×430 body diagram
    const CENTROIDS: Record<string, [number, number]> = {
      // Front zones
      head: [100,31], neck: [100,69], left_shoulder: [22,106], right_shoulder: [178,106],
      left_chest: [76,118], right_chest: [124,118],
      left_breast: [80,118], right_breast: [120,118],
      abdomen: [100,162], left_hip: [70,200], right_hip: [130,200],
      left_groin: [76,220], right_groin: [124,220],
      left_upper_arm: [25,137], right_upper_arm: [175,137],
      left_elbow: [25,172], right_elbow: [175,172],
      left_forearm: [25,202], right_forearm: [175,202],
      left_wrist: [25,236], right_wrist: [175,236],
      left_hand: [25,259], right_hand: [175,259],
      left_thigh: [77,256], right_thigh: [123,256],
      left_knee: [77,298], right_knee: [123,298],
      left_shin: [77,340], right_shin: [123,340],
      left_ankle: [77,378], right_ankle: [123,378],
      left_foot: [72,406], right_foot: [128,406],
      // Back zones
      head_back: [100,31], neck_back: [100,69],
      left_shoulder_back: [22,106], right_shoulder_back: [178,106],
      left_scapula: [75,107], right_scapula: [125,107],
      upper_back: [100,110], mid_back: [100,155], lower_back: [100,184],
      sacrum: [100,206], left_gluteal: [74,219], right_gluteal: [126,219],
      left_upper_arm_back: [25,137], right_upper_arm_back: [175,137],
      left_elbow_back: [25,172], right_elbow_back: [175,172],
      left_forearm_back: [25,202], right_forearm_back: [175,202],
      left_hand_back: [25,259], right_hand_back: [175,259],
      left_hamstring: [77,282], right_hamstring: [123,282],
      left_popliteal: [77,323], right_popliteal: [123,323],
      left_calf: [77,361], right_calf: [123,361],
      left_achilles: [76,394], right_achilles: [124,394],
      left_heel: [71,416], right_heel: [129,416],
    };

    const canvas = document.createElement("canvas");
    const CW = 200, CH = 430;
    canvas.width = CW;
    canvas.height = CH;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, CW, CH);

    const SILL = "#e8d0b8";  // skin-tone silhouette fill
    const SILO = "#c4906a";  // silhouette outline stroke

    const fillEllipse = (cx: number, cy: number, rx: number, ry: number) => {
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    };
    const fillRR = (x: number, y: number, w: number, h: number, r = 6) => {
      ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); ctx.stroke();
    };

    ctx.fillStyle = SILL;
    ctx.strokeStyle = SILO;
    ctx.lineWidth = 1.2;

    const participantSex = data.participant?.biological_sex ?? "unspecified";

    if (participantSex === "male") {
      fillEllipse(100, 31, 24, 27);
      fillEllipse(75, 34, 4, 7); fillEllipse(125, 34, 4, 7);
      fillRR(90, 57, 20, 23, 5);
      fillEllipse(22, 106, 21, 14); fillEllipse(178, 106, 21, 14);
      fillRR(44, 82, 112, 139, 6);
      fillRR(10, 106, 30, 60, 10); fillRR(160, 106, 30, 60, 10);
      fillEllipse(26, 166, 17, 9); fillEllipse(174, 166, 17, 9);
      fillRR(12, 164, 28, 70, 10); fillRR(160, 164, 28, 70, 10);
      fillRR(10, 234, 30, 46, 10); fillRR(160, 234, 30, 46, 10);
      fillRR(62, 218, 30, 80, 8); fillRR(108, 218, 30, 80, 8);
      fillEllipse(78, 300, 20, 10); fillEllipse(122, 300, 20, 10);
      fillRR(61, 298, 32, 80, 8); fillRR(107, 298, 32, 80, 8);
      fillEllipse(78, 380, 18, 8); fillEllipse(122, 380, 18, 8);
      fillRR(50, 378, 50, 44, 6); fillRR(100, 378, 50, 44, 6);
    } else if (participantSex === "female") {
      fillEllipse(100, 30, 23, 25);
      fillEllipse(76, 33, 3.5, 6); fillEllipse(124, 33, 3.5, 6);
      fillRR(91, 54, 18, 26, 5);
      fillEllipse(32, 103, 18, 12); fillEllipse(168, 103, 18, 12);
      fillRR(50, 82, 100, 131, 6);
      ctx.fillStyle = "#d4b89a"; ctx.strokeStyle = SILO;
      fillEllipse(82, 114, 18, 20); fillEllipse(118, 114, 18, 20);
      ctx.fillStyle = SILL;
      fillRR(22, 93, 24, 70, 8); fillRR(154, 93, 24, 70, 8);
      fillEllipse(34, 164, 15, 8); fillEllipse(166, 164, 15, 8);
      fillRR(22, 162, 26, 70, 8); fillRR(152, 162, 26, 70, 8);
      fillRR(22, 230, 26, 48, 8); fillRR(152, 230, 26, 48, 8);
      fillRR(63, 256, 29, 78, 8); fillRR(108, 256, 29, 78, 8);
      fillEllipse(78, 336, 18, 10); fillEllipse(122, 336, 18, 10);
      fillRR(61, 334, 32, 72, 8); fillRR(107, 334, 32, 72, 8);
      fillEllipse(78, 406, 16, 7); fillEllipse(122, 406, 16, 7);
      fillRR(50, 404, 50, 26, 6); fillRR(100, 404, 50, 26, 6);
    } else {
      fillEllipse(100, 31, 24, 27);
      fillEllipse(75, 34, 4, 7); fillEllipse(125, 34, 4, 7);
      fillRR(90, 57, 20, 23, 5);
      fillEllipse(28, 106, 20, 13); fillEllipse(172, 106, 20, 13);
      fillRR(48, 82, 104, 134, 6);
      fillRR(16, 106, 28, 60, 10); fillRR(156, 106, 28, 60, 10);
      fillEllipse(30, 166, 16, 9); fillEllipse(170, 166, 16, 9);
      fillRR(14, 164, 28, 70, 10); fillRR(158, 164, 28, 70, 10);
      fillRR(14, 234, 28, 46, 10); fillRR(158, 234, 28, 46, 10);
      fillRR(64, 214, 30, 82, 8); fillRR(106, 214, 30, 82, 8);
      fillEllipse(79, 298, 19, 10); fillEllipse(121, 298, 19, 10);
      fillRR(62, 296, 32, 80, 8); fillRR(106, 296, 32, 80, 8);
      fillEllipse(79, 378, 18, 8); fillEllipse(121, 378, 18, 8);
      fillRR(50, 376, 50, 44, 6); fillRR(100, 376, 50, 44, 6);
    }

    // Marker dots with labels
    for (const m of bodyMarkers) {
      const c = CENTROIDS[m.zone];
      if (!c) continue;
      ctx.beginPath();
      ctx.arc(c[0], c[1], 7, 0, Math.PI * 2);
      ctx.fillStyle = COLOR_HEX[m.color] ?? "#6b7280";
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const imgData = canvas.toDataURL("image/png");
    // Embed at 45mm wide, preserving 200:430 ratio
    const imgWidthMm = 45;
    const imgHeightMm = (CH / CW) * imgWidthMm;
    checkPageBreak(imgHeightMm + 10);
    pdf.addImage(imgData, "PNG", margin, y, imgWidthMm, imgHeightMm);

    // --- Findings table beside the diagram ---
    const COLOR_LABELS: Record<string, string> = {
      red: "Pain", yellow: "Discomfort", blue: "Treatment Area", green: "Resolved",
    };
    const markerRows: [string, string, string][] = bodyMarkers.map((m) => [
      m.zone.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      COLOR_LABELS[m.color] ?? m.color,
      m.note?.trim() || "—",
    ]);

    const tableX = margin + imgWidthMm + 4;
    const tableW = contentW - imgWidthMm - 4;

    autoTable(pdf, {
      startY: y,
      margin: { left: tableX, right: margin },
      tableWidth: tableW,
      head: [["Zone", "Finding", "Note"]],
      body: markerRows,
      headStyles: {
        fillColor: BRAND_DARK,
        textColor: "#ffffff",
        fontSize: 7,
        fontStyle: "bold",
        cellPadding: { top: 2, bottom: 2, left: 3, right: 3 },
      },
      columnStyles: {
        0: { cellWidth: 32, fontStyle: "bold", textColor: SLATE_700, fontSize: 8 },
        1: { cellWidth: 26, textColor: SLATE_700, fontSize: 8 },
        2: { textColor: SLATE_900, fontSize: 8 },
      },
      styles: {
        cellPadding: { top: 2, bottom: 2, left: 3, right: 3 },
        lineColor: RULE_COLOR,
        lineWidth: 0.2,
        overflow: "linebreak",
      },
      alternateRowStyles: { fillColor: "#f8fafc" },
      theme: "plain",
      pageBreak: "avoid",
    });

    const tableBottom = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    y = Math.max(y + imgHeightMm, tableBottom) + 8;
  }

  // ── Practitioner Sign-Off ─────────────────────────────────────────────────
  const signOffBlockH = 60;
  checkPageBreak(signOffBlockH);

  const prac = data.practitioner ?? {};
  const pracName = prac.name || "NDIS Support Practitioner";
  const pracCreds = prac.credentials || "Support Worker";
  const pracDate = prac.sign_off_date || new Date().toLocaleDateString("en-AU", {
    day: "numeric", month: "long", year: "numeric",
  });

  const signOffProviderName = providerInfo.businessName?.trim() || null;
  const signOffABN = providerInfo.abn?.trim() || null;

  writeSectionHeading("Practitioner Sign-Off");

  // Outer rounded container — taller if provider info is present
  const hasProviderInfo = !!(signOffProviderName || signOffABN);
  const boxH = hasProviderInfo ? 46 : 38;
  pdf.setFillColor("#f0f9ff");
  pdf.setDrawColor("#bfdbfe");
  pdf.setLineWidth(0.4);
  pdf.roundedRect(margin, y, contentW, boxH, 3, 3, "FD");

  // "Prepared by" label
  pdf.setFontSize(7.5);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(BRAND_BLUE);
  pdf.text("PREPARED BY", margin + 5, y + 6.5);

  // Practitioner name
  pdf.setFontSize(12);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(BRAND_DARK);
  pdf.text(pracName, margin + 5, y + 14);

  // Credentials
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(SLATE_500);
  pdf.text(pracCreds, margin + 5, y + 20);

  // Provider info below credentials (if set)
  if (hasProviderInfo) {
    const providerLineParts: string[] = [];
    if (signOffProviderName) providerLineParts.push(signOffProviderName);
    if (signOffABN) providerLineParts.push(`ABN: ${signOffABN}`);
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(SLATE_500);
    pdf.text(providerLineParts.join("  |  "), margin + 5, y + 27);
  }

  // Divider between left info and right signature area
  const dividerX = margin + contentW * 0.55;
  pdf.setDrawColor("#bfdbfe");
  pdf.setLineWidth(0.3);
  pdf.line(dividerX, y + 4, dividerX, y + boxH - 4);

  // Right: "Sign-off Date" label
  const rightX = dividerX + 6;
  pdf.setFontSize(7.5);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(BRAND_BLUE);
  pdf.text("SIGN-OFF DATE", rightX, y + 6.5);

  pdf.setFontSize(10);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(BRAND_DARK);
  pdf.text(pracDate, rightX, y + 14);

  // Signature line label
  pdf.setFontSize(7.5);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(BRAND_BLUE);
  pdf.text("SIGNATURE", rightX, y + 22);

  // Signature box drawn with jsPDF primitives
  const sigBoxX = rightX;
  const sigBoxY = y + 24;
  const sigBoxW = contentW - (dividerX - margin) - 12;
  const sigBoxH = 10;
  pdf.setFillColor("#ffffff");
  pdf.setDrawColor("#94a3b8");
  pdf.setLineWidth(0.4);
  pdf.roundedRect(sigBoxX, sigBoxY, sigBoxW, sigBoxH, 1.5, 1.5, "FD");

  // Embed real signature if one is stored, otherwise show placeholder
  const storedSignature = getStoredSignature();
  if (storedSignature) {
    try {
      const format = storedSignature.startsWith("data:image/png") ? "PNG" : "JPEG";
      pdf.addImage(storedSignature, format, sigBoxX + 1, sigBoxY + 1, sigBoxW - 2, sigBoxH - 2);
    } catch {
      // fallback to placeholder on failure
      pdf.setFontSize(7);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor("#cbd5e1");
      pdf.text("Sign here", sigBoxX + sigBoxW / 2, sigBoxY + sigBoxH / 2 + 1.5, { align: "center" });
    }
  } else {
    // Dashed signature line inside the box
    pdf.setDrawColor("#cbd5e1");
    pdf.setLineWidth(0.2);
    const dashY = sigBoxY + sigBoxH - 3;
    const dashStep = 3;
    for (let dx = sigBoxX + 3; dx < sigBoxX + sigBoxW - 3; dx += dashStep * 2) {
      pdf.line(dx, dashY, Math.min(dx + dashStep, sigBoxX + sigBoxW - 3), dashY);
    }

    // "Sign here" placeholder text inside box
    pdf.setFontSize(7);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor("#cbd5e1");
    pdf.text("Sign here", sigBoxX + sigBoxW / 2, sigBoxY + sigBoxH / 2 + 1.5, { align: "center" });
  }

  y += boxH + 6;

  // Acknowledgement line
  checkPageBreak(10);
  pdf.setFontSize(7.5);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(SLATE_500);
  const ackText = "I confirm that the information in this session record is accurate and complete to the best of my knowledge.";
  const ackLines = pdf.splitTextToSize(ackText, contentW);
  pdf.text(ackLines, margin, y);
  y += ackLines.length * 4 + 2;

  return pdf;
}

export function addPDFFooters(pdf: jsPDF, ndisFooterPrinciple: string) {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = pageW - margin * 2;

  const totalPages = (
    pdf.internal as unknown as { getNumberOfPages: () => number }
  ).getNumberOfPages();

  for (let pg = 1; pg <= totalPages; pg++) {
    pdf.setPage(pg);
    const footerY = pageH - 14;

    pdf.setFillColor("#f8fafc");
    pdf.rect(0, footerY - 5, pageW, 19, "F");

    pdf.setDrawColor(RULE_COLOR);
    pdf.setLineWidth(0.4);
    pdf.line(margin, footerY - 5, pageW - margin, footerY - 5);

    pdf.setFontSize(7.5);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(BRAND_DARK);
    pdf.text(`"${ndisFooterPrinciple}"`, pageW / 2, footerY + 1, {
      align: "center",
      maxWidth: contentW - 30,
    });

    pdf.setFont("helvetica", "normal");
    pdf.setTextColor("#94a3b8");
    pdf.text(
      "AI Clinical Companion — Confidential. For NDIS audit and compliance use only.",
      margin,
      footerY + 6
    );
    pdf.text(`Page ${pg} of ${totalPages}`, pageW - margin, footerY + 6, {
      align: "right",
    });
  }
}

export async function exportSingleSessionPDF(sessionId: string): Promise<void> {
  const [data, logoDataUrl, providerInfo] = await Promise.all([
    fetchAuditData(sessionId),
    fetchLogoDataUrl(),
    fetchProviderSettings(),
  ]);

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  appendSessionToPDF(pdf, data, true, logoDataUrl, providerInfo);
  addPDFFooters(pdf, data.ndis_principle ?? "If it cannot be evidenced, it cannot be claimed.");

  const p = data.participant ?? {};
  const s = data.session ?? {};
  const participantName = (p.full_name || "unknown")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  const dateStr = (s.date || new Date().toISOString().slice(0, 10)).replace(/-/g, "_");
  pdf.save(`ndis_audit_${participantName}_${dateStr}.pdf`);
}

export async function exportBulkSessionsPDF(
  sessionIds: string[],
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  if (sessionIds.length === 0) return;

  const [logoDataUrl, providerInfo] = await Promise.all([
    fetchLogoDataUrl(),
    fetchProviderSettings(),
  ]);

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let ndisFooterPrinciple = "If it cannot be evidenced, it cannot be claimed.";
  let dateRangeStart = "";
  let dateRangeEnd = "";

  for (let i = 0; i < sessionIds.length; i++) {
    const data = await fetchAuditData(sessionIds[i]);
    appendSessionToPDF(pdf, data, i === 0, logoDataUrl, providerInfo);
    if (data.ndis_principle) ndisFooterPrinciple = data.ndis_principle;
    const sessionDate = data.session?.date ?? "";
    if (sessionDate) {
      if (!dateRangeStart || sessionDate < dateRangeStart) dateRangeStart = sessionDate;
      if (!dateRangeEnd || sessionDate > dateRangeEnd) dateRangeEnd = sessionDate;
    }
    onProgress?.(i + 1, sessionIds.length);
  }

  addPDFFooters(pdf, ndisFooterPrinciple);

  const startStr = dateRangeStart.replace(/-/g, "_");
  const endStr = dateRangeEnd.replace(/-/g, "_");
  const filename =
    sessionIds.length === 1
      ? `ndis_audit_${startStr}.pdf`
      : `ndis_audit_bulk_${startStr}_to_${endStr}_${sessionIds.length}sessions.pdf`;

  pdf.save(filename);
}
