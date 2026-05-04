import jsPDF from "jspdf";

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
}

export async function fetchAuditData(sessionId: string): Promise<AuditPayload> {
  const res = await fetch(`/api/sessions/${sessionId}/audit`);
  if (!res.ok) {
    throw new Error(`Failed to fetch audit record for session ${sessionId} (${res.status} ${res.statusText})`);
  }
  return res.json() as Promise<AuditPayload>;
}

export function appendSessionToPDF(
  pdf: jsPDF,
  data: AuditPayload,
  isFirstSession = true
) {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = pageW - margin * 2;

  if (!isFirstSession) {
    pdf.addPage();
  }

  let y = margin;

  const addPage = () => {
    pdf.addPage();
    y = margin;
  };

  const checkPageBreak = (neededH: number) => {
    if (y + neededH > pageH - margin) addPage();
  };

  const drawHRule = (color = "#e2e8f0") => {
    pdf.setDrawColor(color);
    pdf.setLineWidth(0.3);
    pdf.line(margin, y, pageW - margin, y);
    y += 4;
  };

  const writeText = (
    text: string,
    opts: {
      size?: number;
      bold?: boolean;
      color?: string;
      align?: "left" | "center" | "right";
      maxWidth?: number;
      lineGap?: number;
    } = {}
  ) => {
    const {
      size = 10,
      bold = false,
      color = "#1e293b",
      align = "left",
      maxWidth = contentW,
      lineGap = 1.5,
    } = opts;
    pdf.setFontSize(size);
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setTextColor(color);
    const lines = pdf.splitTextToSize(text, maxWidth);
    const lineH = size * 0.352778 + lineGap;
    checkPageBreak(lines.length * lineH + 2);
    pdf.text(
      lines,
      align === "center" ? pageW / 2 : align === "right" ? pageW - margin : margin,
      y,
      { align }
    );
    y += lines.length * lineH + 1;
  };

  const writeLabelValue = (label: string, value: string) => {
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor("#64748b");
    pdf.text(label.toUpperCase(), margin, y);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor("#1e293b");
    const labelW = pdf.getTextWidth(label.toUpperCase()) + 3;
    const valLines = pdf.splitTextToSize(value, contentW - labelW);
    pdf.text(valLines, margin + labelW, y);
    y += valLines.length * 5 + 1;
  };

  // ── Header band ──────────────────────────────────────────────────────
  pdf.setFillColor("#1e3a5f");
  pdf.rect(0, y - margin, pageW, 28, "F");

  pdf.setFontSize(16);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor("#ffffff");
  pdf.text("NDIS Session Audit Report", margin, y - margin + 13);

  pdf.setFontSize(8);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor("#94a3b8");
  pdf.text("AI Clinical Companion — Confidential", margin, y - margin + 20);
  const nowStr = new Date().toLocaleString("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  pdf.text(`Generated: ${nowStr}`, pageW - margin, y - margin + 20, {
    align: "right",
  });

  y += 18;

  // ── Participant Details ───────────────────────────────────────────────
  writeText("Participant Details", { size: 12, bold: true, color: "#1e3a5f" });
  y += 1;
  drawHRule("#bfdbfe");

  const p = data.participant ?? {};
  writeLabelValue("Name:", p.full_name ?? "—");
  if (p.ndis_number) writeLabelValue("NDIS Number:", p.ndis_number);
  if (p.date_of_birth) writeLabelValue("Date of Birth:", p.date_of_birth);
  y += 3;

  // ── Session Information ───────────────────────────────────────────────
  checkPageBreak(40);
  writeText("Session Information", { size: 12, bold: true, color: "#1e3a5f" });
  y += 1;
  drawHRule("#bfdbfe");

  const s = data.session ?? {};
  const sessionDate = s.date
    ? new Date(s.date).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";
  writeLabelValue("Date:", sessionDate);
  writeLabelValue("Type:", s.type ?? "—");
  writeLabelValue(
    "Duration:",
    s.duration_minutes ? `${s.duration_minutes} minutes` : "—"
  );
  if (s.status) writeLabelValue("Status:", s.status);
  y += 3;

  // ── Compliance Score ──────────────────────────────────────────────────
  checkPageBreak(30);
  writeText("Compliance Score", { size: 12, bold: true, color: "#1e3a5f" });
  y += 1;
  drawHRule("#bfdbfe");

  const score = data.compliance?.score ?? null;
  const scoreLabel =
    score == null
      ? "Not assessed"
      : score >= 85
      ? `${score.toFixed(0)}% — Compliant`
      : score >= 60
      ? `${score.toFixed(0)}% — At Risk`
      : `${score.toFixed(0)}% — Non-Compliant`;

  const scoreColor =
    score == null
      ? "#64748b"
      : score >= 85
      ? "#059669"
      : score >= 60
      ? "#d97706"
      : "#dc2626";
  writeText(scoreLabel, { size: 13, bold: true, color: scoreColor });

  if (data.compliance?.blocking) {
    y += 1;
    writeText(
      "⚠ Documentation is insufficient to support a claim for this session.",
      { size: 9, color: "#dc2626" }
    );
  }
  y += 3;

  // ── Clinical Notes ────────────────────────────────────────────────────
  checkPageBreak(20);
  writeText("Clinical Notes", { size: 12, bold: true, color: "#1e3a5f" });
  y += 1;
  drawHRule("#bfdbfe");

  const clinicalNotes: string =
    data.clinical_notes || "No clinical notes recorded.";
  writeText(clinicalNotes, { size: 10, color: "#1e293b" });
  y += 3;

  // ── Structured Clinical Notes ─────────────────────────────────────────
  const structuredNotes: Record<string, string> = data.structured_notes ?? {};
  const structuredEntries = Object.entries(structuredNotes).filter(
    ([, v]) => v && String(v).trim().length > 0
  );
  if (structuredEntries.length > 0) {
    checkPageBreak(20);
    writeText("Structured Clinical Notes", {
      size: 12,
      bold: true,
      color: "#1e3a5f",
    });
    y += 1;
    drawHRule("#bfdbfe");
    structuredEntries.forEach(([key, value]) => {
      checkPageBreak(14);
      const label = key
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      writeText(label, { size: 9, bold: true, color: "#475569" });
      writeText(String(value), { size: 10, color: "#1e293b" });
      y += 1;
    });
    y += 2;
  }

  // ── NDIS Goals Addressed ──────────────────────────────────────────────
  const goals: string[] = data.goals_addressed ?? [];
  if (goals.length > 0) {
    checkPageBreak(20);
    writeText("NDIS Goals Addressed", {
      size: 12,
      bold: true,
      color: "#1e3a5f",
    });
    y += 1;
    drawHRule("#bfdbfe");
    goals.forEach((goal: string) => {
      checkPageBreak(8);
      writeText(`• ${goal}`, { size: 10, color: "#334155" });
    });
    y += 3;
  }

  // ── Compliance Issues ─────────────────────────────────────────────────
  const complianceIssues: string[] = data.compliance?.issues ?? [];
  if (complianceIssues.length > 0) {
    checkPageBreak(20);
    writeText("Compliance Gaps", { size: 12, bold: true, color: "#1e3a5f" });
    y += 1;
    drawHRule("#bfdbfe");
    complianceIssues.forEach((issue: string) => {
      checkPageBreak(8);
      writeText(`• ${issue}`, { size: 10, color: "#dc2626" });
    });
    y += 2;
  }

  // ── AI Assessment ─────────────────────────────────────────────────────
  const aiNotes: string = data.compliance?.ai_notes ?? "";
  if (aiNotes) {
    checkPageBreak(20);
    writeText("AI Assessment", { size: 12, bold: true, color: "#1e3a5f" });
    y += 1;
    drawHRule("#bfdbfe");
    writeText(aiNotes, { size: 10, color: "#334155" });
    y += 3;
  }

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
    const footerY = pageH - 13;
    pdf.setDrawColor("#e2e8f0");
    pdf.setLineWidth(0.3);
    pdf.line(margin, footerY - 2, pageW - margin, footerY - 2);
    pdf.setFontSize(7.5);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor("#1e3a5f");
    pdf.text(`NDIS: "${ndisFooterPrinciple}"`, pageW / 2, footerY + 2, {
      align: "center",
      maxWidth: contentW,
    });
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor("#94a3b8");
    pdf.text(
      "AI Clinical Companion — Confidential. For NDIS audit and compliance use only.",
      pageW / 2,
      footerY + 6.5,
      { align: "center", maxWidth: contentW }
    );
    pdf.text(`Page ${pg} of ${totalPages}`, pageW - margin, footerY + 6.5, {
      align: "right",
    });
  }
}

export async function exportSingleSessionPDF(sessionId: string): Promise<void> {
  const data = await fetchAuditData(sessionId);
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  appendSessionToPDF(pdf, data, true);
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

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let ndisFooterPrinciple = "If it cannot be evidenced, it cannot be claimed.";
  let dateRangeStart = "";
  let dateRangeEnd = "";

  for (let i = 0; i < sessionIds.length; i++) {
    const data = await fetchAuditData(sessionIds[i]);
    appendSessionToPDF(pdf, data, i === 0);
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
