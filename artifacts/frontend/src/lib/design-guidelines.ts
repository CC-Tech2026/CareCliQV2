/**
 * CareCliQ Design & UX Guidelines
 * Healthcare-focused, professional, accessible design principles
 */

export const DESIGN_GUIDELINES = {
  // ── PHILOSOPHY ──────────────────────────────────────────────────────────
  philosophy: `
    CareCliQ Design System is built on healthcare industry best practices.
    We prioritize clarity, trust, and accessibility over trendy aesthetics.
    
    Core Principles:
    1. CLARITY - Information must be immediately understandable
    2. TRUST - Professional design builds confidence in healthcare context
    3. SAFETY - Semantic colors prevent critical errors
    4. ACCESSIBILITY - WCAG 2.1 AA or better compliance
    5. CONSISTENCY - Predictable patterns reduce cognitive load
  `,

  // ── COLOR USAGE ─────────────────────────────────────────────────────────
  colorUsage: {
    greens: {
      meaning: "Safe, compliant, positive status",
      usage: "Badges, success alerts, completed items, healthy metrics",
      examples: [
        "✓ Compliant (badge)",
        "✓ Valid credential",
        "✓ Session completed",
        "✓ Active participant",
      ],
    },
    reds: {
      meaning: "Critical, urgent, requires action",
      usage: "Alerts, errors, expired items, non-compliant markers",
      examples: [
        "⚠ Non-compliant (alert)",
        "⚠ Expired credential",
        "⚠ Critical incident",
        "⚠ At-risk participant",
      ],
    },
    ambers: {
      meaning: "Warning, needs attention soon",
      usage: "Expiring items, pending reviews, caution alerts",
      examples: [
        "⚠ Expiring in 30 days",
        "⚠ Pending review",
        "⚠ Action required",
      ],
    },
    blues: {
      meaning: "Information, neutral, metadata",
      usage: "Informational alerts, links, secondary data",
      examples: [
        "ℹ New message",
        "ℹ System update",
        "ℹ Information card",
      ],
    },
  },

  // ── TYPOGRAPHY USAGE ────────────────────────────────────────────────────
  typography: {
    pageHeading: {
      rule: "28px, bold, for main page titles only",
      usage: "Dashboard, Compliance Centre, Settings - one per page",
      dontUse: "Multiple on same page, for card titles",
    },
    sectionHeading: {
      rule: "18px, bold, for section divisions",
      usage: "Breaking up major content areas",
      dontUse: "Overused, should be sparse",
    },
    cardHeading: {
      rule: "16px, semibold, within cards/components",
      usage: "Card titles, subheadings, labels",
    },
    body: {
      rule: "14px regular, for all body content",
      usage: "Paragraphs, descriptions, details",
    },
    caption: {
      rule: "12px, for supporting text",
      usage: "Timestamps, metadata, hints",
    },
    label: {
      rule: "11px bold uppercase, for UI labels",
      usage: "Status badges, section labels",
    },
  },

  // ── SPACING PRINCIPLES ──────────────────────────────────────────────────
  spacing: {
    rule: "Use 8px base unit consistently (4, 8, 12, 16, 24, 32, 48px)",
    dense: "8px - For compact lists, tight layouts",
    comfortable: "16px - Standard padding for most components",
    spacious: "24-32px - Between major sections",
    hierarchy: "Larger gaps = more important separation",
  },

  // ── CARD DESIGN ─────────────────────────────────────────────────────────
  cards: {
    rules: [
      "White background (#FFFFFF)",
      "Subtle border (light slate #E2E8F0)",
      "Soft shadow (xs: very subtle, md: more emphasis)",
      "Rounded corners (8-12px)",
      "Padding: 16-24px depending on content density",
    ],
    types: {
      metric: "For KPIs - clear value hierarchy, optional icon/status",
      alert: "For notifications - colored left border, semantic color",
      content: "For data presentation - clean, scannable layout",
      action: "For inputs/forms - focus states, clear validation",
    },
  },

  // ── ICONOGRAPHY ─────────────────────────────────────────────────────────
  icons: {
    sizing: "Use consistent sizes: 16px (inline), 20px (secondary), 24px (primary)",
    colors: "Match text color hierarchy - primary/secondary/muted",
    usage: "Enhance text, don't replace it",
    healthcare: [
      "ShieldCheck - Compliance/safety",
      "AlertTriangle - Warnings/risks",
      "CheckCircle2 - Success/completion",
      "Calendar - Dates/scheduling",
      "Users - Teams/people",
      "BarChart2 - Analytics/data",
    ],
  },

  // ── BUTTONS & INTERACTIONS ──────────────────────────────────────────────
  interactions: {
    primary: {
      rule: "Bold action requiring attention",
      color: "Brand primary (#5533CC)",
      usage: "Save, Submit, Continue, Create",
    },
    secondary: {
      rule: "Supporting action",
      color: "Light background, text only",
      usage: "Cancel, Close, Back, More options",
    },
    danger: {
      rule: "Destructive action",
      color: "Red (#DC2626)",
      usage: "Delete, Archive, Remove",
    },
    disabled: {
      rule: "Action unavailable",
      opacity: "50%, not clickable",
      usage: "Conditions not met",
    },
    hover: "All interactive elements have clear hover state",
    transitions: "150-250ms smooth transitions (no jarring changes)",
  },

  // ── RESPONSIVE DESIGN ────────────────────────────────────────────────────
  responsive: {
    mobile: "Single column, full width (0-639px)",
    tablet: "Two columns, comfortable spacing (640-1023px)",
    desktop: "Multi-column, maximum width 1280px",
    principle: "Graceful degradation - mobile first",
  },

  // ── ACCESSIBILITY ────────────────────────────────────────────────────────
  accessibility: {
    contrast: "WCAG AAA minimum 7:1 for all text on colored backgrounds",
    colorNotAlone: "Color alone must not convey meaning - use icons/labels",
    focusStates: "Clear focus indicators for keyboard navigation",
    motionReduction: "Respect prefers-reduced-motion for animations",
    readability: "Min 14px for body text, 16px on mobile",
  },

  // ── ANTI-PATTERNS (What NOT to do) ──────────────────────────────────────
  antiPatterns: [
    "❌ Gradients - Avoid trendy gradients (use solid colors)",
    "❌ AI-Generated - No glossy/skeuomorphic effects",
    "❌ Excessive Animation - Reduces trust in clinical context",
    "❌ Inconsistent Spacing - Breaks visual coherence",
    "❌ Multiple Fonts - Stick to clear sans-serif",
    "❌ Neon Colors - Use professional healthcare palette only",
    "❌ Unindicated Status - Always use semantic colors",
    "❌ Truncated Text - Provide full information or tooltips",
    "❌ Mixed Design Systems - Use tokens consistently",
  ],

  // ── EXAMPLES BY PAGE TYPE ────────────────────────────────────────────────
  examples: {
    dashboard: "Hero stat cards, quick actions, critical alerts",
    forms: "Clear labels, error states, confirmation",
    lists: "Status badges, metadata, compact presentation",
    modals: "Dark overlay, card on top, clear actions",
    alerts: "Semantic colors, icons, clear messaging",
    tables: "Striped rows, hover states, sortable headers",
  },
};

export const MIGRATION_GUIDE = `
  HOW TO UPDATE YOUR COMPONENT TO USE NEW DESIGN SYSTEM:
  
  1. Import design system:
     import { DESIGN_SYSTEM as DS } from "@/lib/design-system";
  
  2. Replace hardcoded colors:
     OLD: style={{ color: "#5533CC" }}
     NEW: style={{ color: DS.BRAND.primary }}
  
  3. Use semantic colors for status:
     import { getStatusColor } from "@/lib/design-system";
     color={getStatusColor(status)} // Returns green/red/amber/blue
  
  4. Use new components:
     import { StatusCard, AlertBanner, ContextCard } from "@/components/healthcare/HealthcareCards";
  
  5. Maintain consistent spacing:
     className="gap-4 p-6" → Use DS.SPACING values
  
  6. Add proper shadows:
     style={{ boxShadow: DS.SHADOWS.card }}
  
  7. Test contrast:
     Ensure 7:1 ratio for critical text
     Use WAVE browser extension to verify
`;
