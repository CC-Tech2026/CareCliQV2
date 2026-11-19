import { useEffect, useState } from "react";

/** A row of bars that moves with the microphone level, so it's plain people
 * are being picked up. Reads the analyser itself, so nothing else re-renders. */
export function LevelMeter({ analyser, paused, bars = 48, className = "h-12 w-full max-w-sm" }: {
  analyser: AnalyserNode | null;
  paused: boolean;
  bars?: number;
  className?: string;
}) {
  const [levels, setLevels] = useState<number[]>(() => Array(bars).fill(0));

  useEffect(() => {
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    const id = setInterval(() => {
      let level = 0;
      if (!paused) {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        level = Math.min(1, Math.sqrt(sum / data.length) * 4);
      }
      setLevels((prev) => [...prev.slice(1), level]);
    }, 90);
    return () => clearInterval(id);
  }, [analyser, paused]);

  return (
    <div className={`flex items-center justify-center gap-[3px] ${className}`} aria-hidden>
      {levels.map((l, i) => (
        <span
          key={i}
          className={`w-1 rounded-full ${paused ? "bg-cc-border" : "bg-cc-text/70"}`}
          style={{ height: `${Math.max(8, Math.round(l * 100))}%` }}
        />
      ))}
    </div>
  );
}
