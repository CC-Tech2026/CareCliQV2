import type { ActionItem, Outcome } from "@/lib/governance-outcomes";

/** What the finance page already loads (/api/billing/financial-summary and /api/billing/claims). */
export type FinanceInputs = {
  period_label: string;
  invoice_count: number;
  billed_cents: number;
  collected_cents: number;
  outstanding_cents: number;
  overdue_cents: number;
  profit_and_loss?: {
    net_profit_cents: number | null;
    margin_pct: number | null;
    wages_complete: boolean;
    overheads_set: boolean;
  };
  cash?: {
    on_hand_cents: number | null;
    runway_months: number | null;
    cash_positive: boolean;
    covers_months: number | null;
  };
};

export type ClaimsInputs = { readyCents: number; readyCount: number; needsFixing: number } | null;

/** Opens the costs and cash editor on the page instead of another page. */
export const EDIT_COSTS = "#edit-costs";

/** Exact to the cent under $1,000; whole dollars from $1,000 up. */
const dollars = (cents: number) => {
  const digits = cents % 100 === 0 || Math.abs(cents) >= 100000 ? 0 : 2;
  return (cents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const monthsText = (m: number) => `${Math.round(m * 10) / 10} ${m === 1 ? "month" : "months"}`;

export function financeOutcomes(d: FinanceInputs, claims: ClaimsInputs, links: { invoices: string; claims: string }): Outcome[] {
  const out: Outcome[] = [];
  const period = d.period_label.toLowerCase().startsWith("this") ? d.period_label.toLowerCase() : `in ${d.period_label}`;

  // Revenue and how much of it has been collected.
  const collected = d.billed_cents ? (d.collected_cents / d.billed_cents) * 100 : null;
  out.push(
    d.billed_cents
      ? {
          id: "revenue", area: "Revenue",
          status: collected! >= 80 ? "on_track" : collected! >= 50 ? "attention" : "off_track",
          headline: `You billed ${dollars(d.billed_cents)} ${period} and have collected ${Math.round(collected!)}% of it`,
          detail: `${d.invoice_count} ${plural(d.invoice_count, "invoice")}, ${dollars(d.collected_cents)} received.`,
          action: { label: "Open invoices", href: links.invoices },
        }
      : {
          id: "revenue", area: "Revenue", status: "no_data",
          headline: `Nothing has been billed ${period} yet`,
          detail: "Invoices are made from verified shifts.",
          action: { label: "Open billing", href: links.invoices },
        },
  );

  // Money owed.
  out.push(
    d.overdue_cents
      ? {
          id: "owed", area: "Money owed", status: "off_track",
          headline: `${dollars(d.overdue_cents)} is overdue`,
          detail: `${dollars(d.outstanding_cents)} unpaid in total. Chase the overdue invoices first.`,
          action: { label: "Chase overdue", href: links.invoices },
        }
      : d.outstanding_cents
        ? {
            id: "owed", area: "Money owed", status: "attention",
            headline: `${dollars(d.outstanding_cents)} is waiting to be paid, none of it overdue`,
            detail: "Keep an eye on invoices as their due dates come up.",
            action: { label: "Open invoices", href: links.invoices },
          }
        : {
            id: "owed", area: "Money owed", status: "on_track",
            headline: "Every invoice has been paid",
            detail: "Nothing is outstanding.",
            action: { label: "Open invoices", href: links.invoices },
          },
  );

  // Profit.
  const pl = d.profit_and_loss;
  const net = pl?.net_profit_cents ?? null;
  out.push(
    net == null
      ? {
          id: "profit", area: "Profit", status: "no_data",
          headline: "Profit can't be worked out yet",
          detail: !pl?.overheads_set ? "Add your monthly overheads; wages come from calculated pay." : "Wages haven't been calculated for these shifts yet.",
          action: { label: "Add costs", href: EDIT_COSTS },
        }
      : {
          id: "profit", area: "Profit",
          status: net < 0 ? "off_track" : (pl?.margin_pct ?? 0) < 10 ? "attention" : "on_track",
          headline: net < 0 ? `You made a loss of ${dollars(-net)} ${period}` : `You made ${dollars(net)} profit ${period}, a ${pl?.margin_pct ?? 0}% margin`,
          detail: pl && (!pl.overheads_set || !pl.wages_complete) ? "Some costs are missing, so the real figure may be lower." : "After wages and overheads.",
          action: { label: pl && !pl.overheads_set ? "Add overheads" : "See profit and loss", href: pl && !pl.overheads_set ? EDIT_COSTS : "#profit-and-loss" },
        },
  );

  // Cash.
  const cash = d.cash;
  out.push(
    cash?.on_hand_cents == null
      ? {
          id: "cash", area: "Cash", status: "no_data",
          headline: "Your cash position isn't set up",
          detail: "Add your bank balance to see how many months your reserves cover.",
          action: { label: "Add cash balance", href: EDIT_COSTS },
        }
      : cash.cash_positive
        ? {
            id: "cash", area: "Cash", status: "on_track",
            headline: `You're bringing in more than you spend, with ${dollars(cash.on_hand_cents)} in the bank`,
            detail: cash.covers_months != null ? `Reserves would cover ${monthsText(cash.covers_months)} of costs.` : "Keep the balance up to date.",
            action: { label: "Update cash", href: EDIT_COSTS },
          }
        : {
            id: "cash", area: "Cash",
            status: cash.runway_months != null && cash.runway_months < 6 ? "off_track" : "attention",
            headline: cash.runway_months != null ? `At this rate, cash lasts about ${monthsText(cash.runway_months)}` : `${dollars(cash.on_hand_cents)} in the bank`,
            detail: "You're spending more each month than you bring in.",
            action: { label: "Update cash", href: EDIT_COSTS },
          },
  );

  // NDIS claims.
  if (claims) {
    out.push(
      claims.needsFixing
        ? {
            id: "claims", area: "NDIS claims", status: "off_track",
            headline: `${claims.needsFixing} ${plural(claims.needsFixing, "claim needs", "claims need")} fixing before ${claims.needsFixing === 1 ? "it" : "they"} can be sent`,
            detail: claims.readyCount ? `${dollars(claims.readyCents)} more is ready to claim.` : "Open each to see what's missing.",
            action: { label: "Fix claims", href: links.claims },
          }
        : claims.readyCount
          ? {
              id: "claims", area: "NDIS claims", status: "attention",
              headline: `${dollars(claims.readyCents)} is ready to claim from the NDIA`,
              detail: `${claims.readyCount} ${plural(claims.readyCount, "invoice")} checked and ready to send.`,
              action: { label: "Send claims", href: links.claims },
            }
          : {
              id: "claims", area: "NDIS claims", status: "on_track",
              headline: "No NDIS claims are waiting to be sent",
              detail: "New claims appear here as NDIA-managed invoices are made.",
              action: { label: "Open claims", href: links.claims },
            },
    );
  }
  return out.map((o) => ({ ...o, ring: financeRing(o.id, d, claims) }));
}

/** Short money for a ring: $450, $1.2k, $12k, $1.3m. */
const shortDollars = (cents: number) => {
  const n = Math.abs(cents) / 100;
  const sign = cents < 0 ? "-" : "";
  if (n >= 1_000_000) return `${sign}$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (n >= 1_000) return `${sign}$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `${sign}$${Math.round(n)}`;
};

function financeRing(id: string, d: FinanceInputs, claims: ClaimsInputs): Outcome["ring"] {
  switch (id) {
    case "revenue": {
      if (!d.billed_cents) return { value: "$0", label: "Billed", caption: "nothing yet", pct: 0 };
      const pct = (d.collected_cents / d.billed_cents) * 100;
      return { value: shortDollars(d.billed_cents), label: "Billed", caption: `${Math.round(pct)}% collected`, pct };
    }
    case "owed":
      if (d.overdue_cents) return { value: shortDollars(d.overdue_cents), label: "Overdue", caption: `${shortDollars(d.outstanding_cents)} unpaid` };
      if (d.outstanding_cents) return { value: shortDollars(d.outstanding_cents), label: "Owed", caption: "none overdue" };
      return { value: "$0", label: "Owed", caption: "all paid" };
    case "profit": {
      const pl = d.profit_and_loss;
      const net = pl?.net_profit_cents ?? null;
      if (net == null) return { value: "N/A", label: "Profit", caption: "costs missing", pct: 0 };
      return { value: shortDollars(net), label: "Profit", caption: `${pl?.margin_pct ?? 0}% margin`, pct: Math.max(0, pl?.margin_pct ?? 0) };
    }
    case "cash": {
      const cash = d.cash;
      if (cash?.on_hand_cents == null) return { value: "N/A", label: "Cash", caption: "not set up", pct: 0 };
      if (cash.cash_positive) {
        return { value: shortDollars(cash.on_hand_cents), label: "Cash", caption: cash.covers_months != null ? `${monthsText(cash.covers_months)} cover` : "growing" };
      }
      return { value: shortDollars(cash.on_hand_cents), label: "Cash", caption: cash.runway_months != null ? `lasts ${monthsText(cash.runway_months)}` : "shrinking" };
    }
    case "claims":
      if (!claims) return undefined;
      if (claims.needsFixing) return { value: String(claims.needsFixing), label: "Claims", caption: "to fix" };
      if (claims.readyCount) return { value: shortDollars(claims.readyCents), label: "To claim", caption: `${claims.readyCount} ready` };
      return { value: "0", label: "Claims", caption: "none waiting" };
    default:
      return undefined;
  }
}

export function financeActions(d: FinanceInputs, claims: ClaimsInputs, links: { invoices: string; claims: string }): ActionItem[] {
  const items: ActionItem[] = [];
  if (d.overdue_cents) {
    items.push({ id: "overdue", group: "now", title: `Chase ${dollars(d.overdue_cents)} of overdue invoices`, detail: "Money already due to you. Overdue invoices are the first thing auditors and accountants ask about.", actionLabel: "Open overdue invoices", href: links.invoices });
  }
  if (claims?.needsFixing) {
    items.push({ id: "claims-fix", group: "now", title: `Fix ${claims.needsFixing} NDIS ${plural(claims.needsFixing, "claim")}`, detail: "They can't be sent to the NDIA until what's missing is added.", actionLabel: "Fix claims", href: links.claims });
  }
  if (claims?.readyCount) {
    items.push({ id: "claims-send", group: "week", title: `Send ${dollars(claims.readyCents)} of NDIS claims`, detail: `${claims.readyCount} ${plural(claims.readyCount, "invoice")} checked and ready for the NDIA.`, actionLabel: "Send claims", href: links.claims });
  }
  const pl = d.profit_and_loss;
  if (pl && !pl.overheads_set) {
    items.push({ id: "overheads", group: "week", title: "Add your monthly overheads", detail: "Rent, insurance, software and the like, so profit can be worked out.", actionLabel: "Add overheads", href: EDIT_COSTS });
  }
  if (d.cash?.on_hand_cents == null) {
    items.push({ id: "cash", group: "watch", title: "Add your cash balance", detail: "To see how many months your reserves would cover.", actionLabel: "Add cash balance", href: EDIT_COSTS });
  }
  const notYetDue = d.outstanding_cents - d.overdue_cents;
  if (notYetDue > 0) {
    items.push({ id: "unpaid", group: "watch", title: `${dollars(notYetDue)} not yet due`, detail: "Unpaid invoices still within their payment terms.", actionLabel: "Open invoices", href: links.invoices });
  }
  return items;
}
