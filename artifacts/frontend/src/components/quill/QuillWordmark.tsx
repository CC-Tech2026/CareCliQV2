/** "Quill" in one continuous hand-drawn line that writes itself when it
 * appears: the Q, then "uill" joined up, then the dot on the i. An original
 * drawing for CareCliQ (not a font), so it needs nothing to load and stays
 * crisp at any size. With reduced motion turned on, it simply appears. */

// One path, three strokes in writing order: the Q's loop, its tail running
// into "uill", and the i's dot. Drawn upright, then leaned slightly forward.
const STROKES =
  "M 52 17 C 32 7, 8 24, 13 49 C 17 68, 41 73, 52 57 C 62 42, 59 19, 45 16 C 35 14, 30 22, 32 29 " +
  "M 28 59 C 37 65, 47 70, 59 68 C 67 66, 71 58, 73 47 C 71 57, 73 63, 80 63 C 87 63, 91 55, 93 46 " +
  "C 91 55, 92 62, 98 63 C 102 63, 105 59, 108 53 C 109 50, 110 47, 110 46 C 108 55, 109 62, 114 63 " +
  "C 119 63, 123 56, 127 47 C 132 36, 140 20, 139 12 C 138 6, 131 7, 130 15 C 128 30, 128 52, 132 61 " +
  "C 135 66, 142 62, 147 52 C 152 40, 159 20, 158 12 C 157 6, 150 7, 149 15 C 147 30, 147 52, 151 61 " +
  "C 154 66, 162 64, 172 55 " +
  "M 111 33.5 L 111.6 32.9";

const VIEW_BOX = "6.5 4 177 69";
const ASPECT = 177 / 69;

const STYLE = `
.quill-wordmark-write {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: quill-wordmark-write 1.5s cubic-bezier(0.55, 0.1, 0.35, 1) 0.1s forwards;
}
@keyframes quill-wordmark-write { to { stroke-dashoffset: 0; } }
@media (prefers-reduced-motion: reduce) {
  .quill-wordmark-write { animation: none; stroke-dashoffset: 0; }
}`;

export function QuillWordmark({
  height = 22,
  animate = true,
  className,
}: {
  /** Height in pixels; the width follows. */
  height?: number;
  /** Write itself in when it first appears. */
  animate?: boolean;
  className?: string;
}) {
  // Thicker at small sizes so the line doesn't turn spidery.
  const weight = height < 28 ? 6.5 : height < 44 ? 5.5 : 4.75;
  return (
    <svg
      viewBox={VIEW_BOX}
      width={Math.round(height * ASPECT)}
      height={height}
      role="img"
      aria-label="Quill"
      className={className}
      style={{ display: "block", overflow: "visible" }}
    >
      {animate && <style>{STYLE}</style>}
      <g transform="skewX(-8) translate(8 0)">
        <path
          d={STROKES}
          pathLength={1}
          fill="none"
          stroke="currentColor"
          strokeWidth={weight}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={animate ? "quill-wordmark-write" : undefined}
        />
      </g>
    </svg>
  );
}
