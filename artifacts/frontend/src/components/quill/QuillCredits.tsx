import { useState } from "react";
import { startQuillTopUp, type QuillCredits } from "@/services/chatboxService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const LINK = "var(--cc-plum)";
const CTA = "var(--cc-cta)";

/** Quill's credits: a monthly allowance per person that renews on the 1st,
 * plus packs they can buy when they can't wait for the renewal. */

export function renewsLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "long" });
}

export function packPrice(c: QuillCredits): string {
  const dollars = c.pack.price_cents / 100;
  const price = dollars.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: dollars % 1 ? 2 : 0 });
  return c.pack.gst_added ? `${price} + GST` : price;
}

/** Sends the person to Stripe Checkout for one pack, and back here after. */
function useBuyPack() {
  const [state, setState] = useState<"idle" | "starting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  async function buy() {
    setState("starting");
    setError(null);
    try {
      const url = await startQuillTopUp(`${window.location.pathname}${window.location.search}`);
      window.location.assign(url);
    } catch (err) {
      setState("error");
      setError((err as Error)?.message || "Checkout couldn't be started. Please try again.");
    }
  }
  return { buy, starting: state === "starting", error };
}

function BuyButton({ credits, compact = false }: { credits: QuillCredits; compact?: boolean }) {
  const { buy, starting, error } = useBuyPack();
  const blocked = credits.packs_left_this_month <= 0 || !!credits.paused_reason;
  return (
    <div>
      <button
        type="button"
        onClick={() => void buy()}
        disabled={starting || blocked}
        className={`flex items-center justify-center rounded-lg font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40 ${compact ? "h-8 px-3 text-[12px]" : "h-9 px-4 text-[12.5px]"}`}
        style={{ background: CTA }}
      >
        {starting ? "Opening checkout..." : `Add ${credits.pack.credits} credits for ${packPrice(credits)}`}
      </button>
      {credits.packs_left_this_month <= 0 && !credits.paused_reason && (
        <p className="mt-1.5 text-[11.5px]" style={{ color: MUTED }}>
          You've bought the most packs allowed this month. Ask your managing director if you need more.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-[11.5px]" style={{ color: "var(--cc-danger-text)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/** One line under the composer: what's left and when it renews. */
export function CreditsLine({ credits, onOpenDetails }: { credits: QuillCredits | null; onOpenDetails: () => void }) {
  if (!credits) return null;
  const low = credits.remaining <= Math.max(20, credits.allowance * 0.1);
  return (
    <button
      type="button"
      onClick={onOpenDetails}
      className="text-[11px] hover:underline"
      style={{ color: low ? "var(--cc-danger-text)" : MUTED, fontWeight: low ? 600 : undefined }}
      title="See your Quill credits"
    >
      {credits.remaining.toLocaleString("en-AU")} credits left, renews {renewsLabel(credits.renews_on)}
    </button>
  );
}

/** Shown in place of an answer when the person has run out. */
export function OutOfCredits({ credits }: { credits: QuillCredits | null }) {
  if (!credits) return null;
  if (credits.paused_reason) return null;
  return (
    <div className="space-y-2">
      <p className="text-[12px]" style={{ color: MUTED }}>
        Your {credits.allowance} monthly credits come back on {renewsLabel(credits.renews_on)}. Bought credits are used
        after your monthly ones and last 12 months.
      </p>
      <BuyButton credits={credits} compact />
    </div>
  );
}

/** The Credits section in Quill's settings. */
export function CreditsSection({
  credits,
  isDirector,
  justAdded,
}: {
  credits: QuillCredits | null;
  isDirector: boolean;
  justAdded: boolean;
}) {
  if (!credits) {
    return (
      <p className="py-3 text-[12.5px]" style={{ color: MUTED }}>
        Your credits couldn't be loaded right now.
      </p>
    );
  }
  const used = Math.min(credits.allowance_used, credits.allowance);
  const pct = credits.allowance ? Math.round((used / credits.allowance) * 100) : 0;
  return (
    <div className="space-y-4 py-3">
      {justAdded && (
        <p role="status" className="text-[12.5px] font-semibold" style={{ color: "var(--cc-success-text, var(--cc-text))" }}>
          Thanks. Your credits are added as soon as the payment clears, usually within a minute.
        </p>
      )}
      {credits.paused_reason && (
        <p role="alert" className="text-[12.5px] font-semibold" style={{ color: "var(--cc-danger-text)" }}>
          {credits.paused_reason}
        </p>
      )}
      <div>
        <p className="flex items-baseline gap-2">
          <span className="text-[22px] font-semibold tabular-nums" style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}>
            {credits.remaining.toLocaleString("en-AU")}
          </span>
          <span className="text-[12.5px]" style={{ color: MUTED }}>
            credits left
          </span>
        </p>
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
          style={{ background: "var(--cc-soft)" }}
          role="meter"
          aria-valuemin={0}
          aria-valuemax={credits.allowance}
          aria-valuenow={Math.round(used)}
          aria-label="Monthly credits used"
        >
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 90 ? "var(--cc-danger-text)" : LINK }} />
        </div>
        <p className="mt-1.5 text-[12px]" style={{ color: MUTED }}>
          {Math.round(used).toLocaleString("en-AU")} of {credits.allowance.toLocaleString("en-AU")} monthly credits used.
          Renews on {renewsLabel(credits.renews_on)}.
          {credits.topup_balance > 0 && ` Plus ${credits.topup_balance.toLocaleString("en-AU")} bought credits.`}
        </p>
      </div>

      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 border-t pt-3 text-[12px]" style={{ borderColor: BORDER }}>
        <dt style={{ color: MUTED }}>A quick question</dt>
        <dd className="text-right tabular-nums" style={{ color: TEXT }}>about 1 credit</dd>
        <dt style={{ color: MUTED }}>A question across several areas</dt>
        <dd className="text-right tabular-nums" style={{ color: TEXT }}>1 to 2 credits</dd>
        <dt style={{ color: MUTED }}>A drafted report or template</dt>
        <dd className="text-right tabular-nums" style={{ color: TEXT }}>2 to 5 credits</dd>
        {isDirector && (
          <>
            <dt style={{ color: MUTED }}>Your organisation this month</dt>
            <dd className="text-right tabular-nums" style={{ color: TEXT }}>
              {Math.round(credits.org_used).toLocaleString("en-AU")} of {credits.org_allowance.toLocaleString("en-AU")}
            </dd>
          </>
        )}
      </dl>

      <div className="border-t pt-3" style={{ borderColor: BORDER }}>
        <p className="mb-2 text-[12px]" style={{ color: MUTED }}>
          Can't wait for the renewal? Buy a pack, paid by card through Stripe and invoiced to your organisation.
          The credits are yours, used after your monthly ones and kept for 12 months.
        </p>
        <BuyButton credits={credits} />
      </div>
    </div>
  );
}
