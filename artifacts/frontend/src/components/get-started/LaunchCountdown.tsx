import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { DISPLAY_FONT } from "./shared";

/** Midnight 7 October 2026, Adelaide time (ACDT, UTC+10:30 - daylight
 * saving has already started by early October) - the single instant every
 * visitor's countdown targets, regardless of their own timezone. */
export const LAUNCH_INSTANT = new Date("2026-10-06T13:30:00Z");

export function isBeforeLaunch(): boolean {
  return new Date() < LAUNCH_INSTANT;
}

function useCountdown(target: Date) {
  const [remaining, setRemaining] = useState(() => Math.max(0, target.getTime() - Date.now()));
  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(Math.max(0, target.getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [target]);

  const totalSeconds = Math.floor(remaining / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    done: remaining <= 0,
  };
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

/** One "tear-off calendar page" block - white card, two binder rings punched
 * along the top edge, a solid coral header strip carrying the label, and a
 * big dark number underneath. A slight per-card tilt keeps the row from
 * looking like a flat digital countdown. */
function CountdownPill({ value, label, tilt = 0 }: { value: number; label: string; tilt?: number }) {
  return (
    <div
      className="relative w-[72px] sm:w-[clamp(84px,50vw,140px)] overflow-hidden rounded-2xl bg-white"
      style={{ boxShadow: "0 14px 30px -8px rgba(27,23,69,0.5)", transform: `rotate(${tilt}deg)` }}
    >
      <div className="pointer-events-none absolute left-1/2 top-2 flex -translate-x-1/2 gap-3 sm:gap-[clamp(16px,2vw,60px)]">
        <span className="h-2.5 w-2.5 sm:h-3.5 sm:w-3.5 rounded-full" style={{ background: "#1B1745" }} />
        <span className="h-2.5 w-2.5 sm:h-3.5 sm:w-3.5 rounded-full" style={{ background: "#1B1745" }} />
      </div>
      <div
        className="pt-5 pb-1.5 sm:pt-6 sm:pb-2 text-center text-[9px] sm:text-[clamp(9px,1vw,13px)] font-black uppercase tracking-[0.14em] text-white"
        style={{ background: "var(--cc-coral)" }}
      >
        {label}
      </div>
      <div className="flex items-center justify-center py-3 sm:py-5">
        <span
          className="text-[1.85rem] sm:text-[clamp(2.6rem,4.6vw,4.5rem)] font-black tabular-nums leading-none"
          style={{ fontFamily: DISPLAY_FONT, color: "#1B1745" }}
        >
          {pad(value)}
        </span>
      </div>
    </div>
  );
}

/** The scene (public/carecliq-rocket-scene.svg) as a large backdrop. Sized
 * off viewport width alone with a matching aspect-ratio (rather than
 * independent width/height caps, which used to stretch the art out of
 * shape and - past ~150px viewport width - lock it to one fixed pixel
 * size regardless of screen, so it read as a different scale on a laptop
 * vs. a large monitor or projector) so it scales continuously with the
 * screen instead of jumping between two fixed sizes. Wrapped in a gentle
 * CSS float so it still reads as "alive" without hand-animating every
 * element inside the SVG itself. */
function RocketScene() {
  return (
    <div className="pointer-events-none absolute inset-0 flex justify-center overflow-hidden">
      <style>{`
        @keyframes cc-rocket-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-16px); }
        }
      `}</style>
      <img
        src="/carecliq-rocket-scene.svg"
        alt=""
        aria-hidden="true"
        className="w-[clamp(760px,105vw,1900px)] max-w-none select-none"
        style={{ aspectRatio: "1500 / 800", height: "auto", animation: "cc-rocket-float 4.2s ease-in-out infinite" }}
      />
    </div>
  );
}

/** "VERY SOON" / "LAUNCHING" poster-style lockup. "Very soon" sits on a
 * solid dark chip rather than relying on a stroke against the photo behind
 * it - a chip's contrast can't blend into whatever the background happens
 * to be doing at that spot, where a stroke's could. "Launching" keeps the
 * layered/echo poster effect, now in an italic cut for a bit more
 * personality than plain upright type, plus a slight skew for graphic
 * punch. */
function LaunchHeadline() {
  return (
    <div className="relative inline-flex flex-col items-center" style={{ transform: "skewY(-2deg)" }}>
      <span
        className="relative inline-block rounded-full px-[clamp(14px,2vw,20px)] py-[clamp(5px,0.7vw,8px)] text-[clamp(12px,1.3vw,15px)] font-black uppercase tracking-[0.35em] text-white"
        style={{ background: "#1B1745", boxShadow: "0 6px 16px -4px rgba(27,23,69,0.55)" }}
      >
        Very soon
      </span>
      <span
        className="relative mt-2 text-[clamp(2.75rem,9vw,8rem)] font-black uppercase leading-[0.88] italic"
        style={{ fontFamily: DISPLAY_FONT, letterSpacing: "-0.04em" }}
      >
        <span aria-hidden="true" className="absolute inset-0 translate-x-[clamp(5px,0.7vw,14px)] translate-y-[clamp(5px,0.7vw,14px)]" style={{ color: "#1B1745" }}>
          Launching
        </span>
        <span
          className="relative"
          style={{ color: "var(--cc-coral)", WebkitTextStroke: "2.5px white", paintOrder: "stroke fill" }}
        >
          Launching
        </span>
      </span>
    </div>
  );
}

export function LaunchCountdown({ onLaunch }: { onLaunch: () => void }) {
  const { toast } = useToast();
  const { days, hours, minutes, seconds, done } = useCountdown(LAUNCH_INSTANT);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [joined, setJoined] = useState(false);

  // The moment the countdown itself reaches zero, hand off to the real
  // flow immediately - a callback into the parent's own state rather than
  // navigating to the current route, which wouter won't remount on.
  useEffect(() => {
    if (done) onLaunch();
  }, [done, onLaunch]);

  async function handleNotifyMe(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/launch-waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.detail === "string" ? body.detail : "Could not save your email.");
      }
      setJoined(true);
    } catch (err) {
      toast({
        title: "Couldn't join the list",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="relative min-h-screen flex flex-col overflow-hidden"
      style={{
        backgroundImage: "url(/carecliq-launch-sky.jpg)",
        backgroundSize: "cover",
        backgroundPosition: "center 48%",
        backgroundRepeat: "no-repeat",
      }}
    >
      {/* Scene - behind everything else on the page, its own clouds pulled
          down toward the pills/notify area below. */}
      <RocketScene />

      {/* Countdown */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-start px-4 sm:px-6 pt-4 sm:pt-5 text-center">
        <LaunchHeadline />
        <p
          className="relative mt-3 text-[clamp(1rem,2.2vw,1.875rem)] font-black uppercase italic"
          style={{ fontFamily: DISPLAY_FONT, color: "#1B1745", letterSpacing: "-0.01em" }}
        >
          CareCliQ opens for your business on 7 October 2026
        </p>

        {/* Spacer sized to clear the rocket itself - short enough that the
            pills sit up in the scene's cloud layer, not below it. */}
        <div className="h-[clamp(40px,8vw,60px)]" aria-hidden="true" />

        {/* Split into two pairs pushed out toward the edges - days/hours
            left, minutes/seconds right - so the rocket and its CareCliQ
            logo window show through the gap in the middle. The mobile
            width is a fixed floor sized to the mobile pill/gap sizes
            below (not the fluid clamp used from sm up) so two groups of
            two 72px pills never out-measure a narrow phone screen and
            get clipped or forced onto their own line. */}
        <div className="flex w-full max-w-[320px] sm:max-w-[clamp(400px,75vw,850px)] items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-4">
            <CountdownPill value={days} label="days" tilt={-3} />
            <CountdownPill value={hours} label="hours" tilt={2} />
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <CountdownPill value={minutes} label="minutes" tilt={-2} />
            <CountdownPill value={seconds} label="seconds" tilt={3} />
          </div>
        </div>
      </div>

      {/* Notify me band - clear at the top so the scene's own clouds show
          through unobscured, darkening further down for text contrast,
          rather than a flat scrim that washes the clouds out entirely. */}
      <div
        className="relative z-10 px-6 pt-6 pb-4 sm:pt-8 sm:pb-5"
        style={{ background: "linear-gradient(180deg, rgba(43,26,74,0) 0%, rgba(43,26,74,0.55) 35%, rgba(43,26,74,0.82) 100%)" }}
      >
        <div className="mx-auto max-w-4xl flex flex-col md:flex-row items-center md:items-center justify-between gap-4 text-center md:text-left">
          <div>
            <h2 className="text-lg sm:text-2xl font-black text-white" style={{ fontFamily: DISPLAY_FONT }}>
              Be the first to know when we launch.
            </h2>
            <p className="mt-1.5 text-[13px] text-white/80">
              Leave your email and we'll let you know the moment CareCliQ is live.
            </p>
          </div>

          {joined ? (
            <p className="shrink-0 text-[14px] font-bold text-white">You're on the list — see you on launch day!</p>
          ) : (
            <form onSubmit={handleNotifyMe} className="flex w-full flex-col sm:flex-row gap-2.5 md:w-auto md:shrink-0">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="h-11 flex-1 sm:w-64 rounded-full px-4 text-[13px] outline-none"
                style={{ background: "white", color: "var(--cc-text)" }}
              />
              <button
                type="submit"
                disabled={submitting}
                className="h-11 px-6 rounded-full font-bold text-[13px] disabled:opacity-60 flex items-center justify-center gap-2"
                style={{ background: "var(--cc-coral)", color: "white" }}
              >
                {submitting && <Loader2 size={13} className="animate-spin" />}
                Notify me
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
