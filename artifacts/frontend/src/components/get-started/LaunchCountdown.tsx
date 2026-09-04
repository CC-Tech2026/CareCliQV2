import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { SIGNATURE, DISPLAY_FONT } from "./shared";

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

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span
        className="text-4xl sm:text-6xl font-black tabular-nums leading-none"
        style={{ color: "var(--cc-text)", fontFamily: DISPLAY_FONT }}
      >
        {pad(value)}
      </span>
      <span className="mt-1.5 text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--cc-muted)" }}>
        {label}
      </span>
    </div>
  );
}

/** A living, launching rocket - gentle float, flickering flame, drifting
 * exhaust clouds - built as plain inline SVG + CSS keyframes rather than a
 * media asset or animation library, so it stays crisp at any size. */
function AnimatedRocket() {
  return (
    <div className="relative flex flex-col items-center" style={{ height: 280 }}>
      <style>{`
        @keyframes cc-rocket-float {
          0%, 100% { transform: translateY(0) rotate(-1.5deg); }
          50% { transform: translateY(-14px) rotate(1.5deg); }
        }
        @keyframes cc-flame-flicker {
          0%, 100% { transform: scaleY(1) scaleX(1); opacity: 1; }
          30% { transform: scaleY(1.25) scaleX(0.9); opacity: 0.85; }
          60% { transform: scaleY(0.9) scaleX(1.1); opacity: 1; }
        }
        @keyframes cc-smoke-drift {
          0% { transform: translate(0, 0) scale(0.6); opacity: 0.5; }
          100% { transform: translate(var(--dx), 40px) scale(1.4); opacity: 0; }
        }
        @keyframes cc-cloud-drift {
          0% { transform: translateX(0); }
          100% { transform: translateX(24px); }
        }
      `}</style>

      {/* Background clouds - slow opposing drift for a subtle parallax feel */}
      <div className="absolute inset-x-0 bottom-8 flex justify-between px-4" style={{ animation: "cc-cloud-drift 6s ease-in-out infinite alternate" }}>
        <div className="h-10 w-24 rounded-full opacity-60" style={{ background: "var(--cc-plum-subtle)" }} />
        <div className="h-8 w-20 rounded-full opacity-50" style={{ background: "var(--cc-plum-subtle)" }} />
      </div>

      {/* Rocket + flame + smoke */}
      <div className="relative z-10 mt-auto" style={{ animation: "cc-rocket-float 3.2s ease-in-out infinite" }}>
        <svg width="96" height="140" viewBox="0 0 96 140" fill="none">
          <ellipse cx="48" cy="118" rx="16" ry="8" fill={SIGNATURE} opacity="0.18" />
          <path d="M48 4C64 24 70 56 70 80C70 100 60 112 48 118C36 112 26 100 26 80C26 56 32 24 48 4Z" fill={SIGNATURE} />
          <path d="M48 4C58 22 63 46 64 68H32C33 46 38 22 48 4Z" fill="white" fillOpacity="0.18" />
          <circle cx="48" cy="52" r="11" fill="white" />
          <circle cx="48" cy="52" r="6" fill={SIGNATURE} />
          <path d="M26 78C14 82 8 96 8 108C18 106 28 98 30 88Z" fill="var(--cc-coral)" />
          <path d="M70 78C82 82 88 96 88 108C78 106 68 98 66 88Z" fill="var(--cc-coral)" />
          <path d="M40 116L36 134H44L48 122L52 134H60L56 116Z" fill="var(--cc-coral)" />
        </svg>
        {/* Flame */}
        <div
          className="absolute left-1/2 -translate-x-1/2"
          style={{ top: 130, width: 20, height: 30, transformOrigin: "top center", animation: "cc-flame-flicker 0.35s ease-in-out infinite" }}
        >
          <svg width="20" height="30" viewBox="0 0 20 30" fill="none">
            <path d="M10 0C14 8 18 14 18 20C18 26 14 30 10 30C6 30 2 26 2 20C2 14 6 8 10 0Z" fill="var(--cc-amber, #F59E0B)" />
          </svg>
        </div>
        {/* Smoke puffs */}
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="absolute left-1/2 rounded-full"
            style={{
              top: 158,
              width: 14,
              height: 14,
              background: "var(--cc-muted)",
              opacity: 0.25,
              // @ts-expect-error -- CSS custom property for the keyframe
              "--dx": `${(i - 1) * 22}px`,
              animation: `cc-smoke-drift ${1.4 + i * 0.3}s ease-out ${i * 0.25}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function LaunchCountdown({ onLaunch }: { onLaunch: () => void }) {
  const [, navigate] = useLocation();
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
    <div className="min-h-screen flex flex-col" style={{ background: "var(--auth-shell-bg)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 sm:px-10 py-6">
        <CareCliQLogo size={40} />
        <button
          type="button"
          onClick={() => navigate("/login")}
          className="text-[13px] font-bold underline underline-offset-2"
          style={{ color: SIGNATURE }}
        >
          Log in
        </button>
      </div>

      {/* Countdown */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <p className="text-[13px] sm:text-[15px] font-semibold" style={{ color: "var(--cc-muted)" }}>
          Countdown to launch
        </p>
        <h1 className="mt-1 text-3xl sm:text-4xl font-black" style={{ color: "var(--cc-text)", fontFamily: DISPLAY_FONT }}>
          CareCliQ launches 7 October 2026
        </h1>

        <div className="mt-8 flex items-start gap-4 sm:gap-8">
          <CountdownUnit value={days} label="days" />
          <span className="text-3xl sm:text-5xl font-black self-start mt-0.5" style={{ color: "var(--cc-border)" }}>:</span>
          <CountdownUnit value={hours} label="hrs" />
          <span className="text-3xl sm:text-5xl font-black self-start mt-0.5" style={{ color: "var(--cc-border)" }}>:</span>
          <CountdownUnit value={minutes} label="min" />
          <span className="text-3xl sm:text-5xl font-black self-start mt-0.5" style={{ color: "var(--cc-border)" }}>:</span>
          <CountdownUnit value={seconds} label="sec" />
        </div>

        <AnimatedRocket />
      </div>

      {/* Notify me band */}
      <div className="px-6 py-10 sm:py-12" style={{ background: SIGNATURE }}>
        <div className="mx-auto max-w-md text-center">
          <h2 className="text-xl sm:text-2xl font-black text-white" style={{ fontFamily: DISPLAY_FONT }}>
            Be the first to know when we launch.
          </h2>
          <p className="mt-2 text-[13px] text-white/80">
            Leave your email and we'll let you know the moment CareCliQ is live.
          </p>
          {joined ? (
            <p className="mt-5 text-[14px] font-bold text-white">You're on the list — see you on launch day!</p>
          ) : (
            <form onSubmit={handleNotifyMe} className="mt-5 flex flex-col sm:flex-row gap-2.5 justify-center">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="h-11 flex-1 sm:max-w-xs rounded-full px-4 text-[13px] outline-none"
                style={{ background: "white", color: "var(--cc-text)" }}
              />
              <button
                type="submit"
                disabled={submitting}
                className="h-11 px-6 rounded-full font-bold text-[13px] disabled:opacity-60 flex items-center justify-center gap-2"
                style={{ background: "var(--cc-text)", color: "white" }}
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
