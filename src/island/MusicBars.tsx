import { useReducedMotion } from "motion/react";
import { t } from "../shared/i18n";
import { useEffect, useState } from "react";

/** Gradient presets for the bars: base color, then tip color. */
export const BAR_PRESETS: { name: string; colors: [string, string] }[] = [
  { name: "White", colors: ["#ffffff", "#ffffff"] },
  { name: "Sunset", colors: ["#f97316", "#ec4899"] },
  { name: "Ocean", colors: ["#0ea5e9", "#22d3ee"] },
  { name: "Aurora", colors: ["#22c55e", "#a855f7"] },
  { name: "Fire", colors: ["#ef4444", "#facc15"] },
  { name: "Candy", colors: ["#a855f7", "#f472b6"] },
];

/** How often the bars pick new heights. */
const BEAT_MS = 140;

/** Random heights under an arch, so the middle bars reach highest, like a spectrum. */
function beat(count: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const arch = count > 4 ? 0.55 + 0.45 * Math.sin((Math.PI * (i + 0.5)) / count) : 1;
    return Math.max(0.15, arch * (0.25 + Math.random() * 0.75));
  });
}

interface Props {
  count: number;
  height: number;
  colors: [string, string];
  flipped?: boolean;
  barWidth?: number;
  gap?: number;
}

/** A row of bars that spring to new heights several times a second while sound plays. */
export function MusicBars({ count, height, colors, flipped = false, barWidth = 3, gap = 2 }: Props) {
  const reduce = useReducedMotion();
  const [levels, setLevels] = useState(() => beat(count));
  useEffect(() => {
    setLevels(beat(count));
    if (reduce) return;
    const id = setInterval(() => setLevels(beat(count)), BEAT_MS);
    return () => clearInterval(id);
  }, [count, reduce]);

  return (
    <span
      className="flex"
      style={{ height, gap, alignItems: flipped ? "flex-start" : "flex-end" }}
      role="img"
      aria-label={t("music.playing")}
    >
      {levels.map((level, i) => (
        <span
          key={i}
          className="h-full rounded-full"
          style={{
            width: barWidth,
            transformOrigin: flipped ? "top" : "bottom",
            transform: `scaleY(${level})`,
            transition: reduce ? undefined : `transform ${BEAT_MS}ms cubic-bezier(0.3, 1.5, 0.5, 1)`,
            background: `linear-gradient(to ${flipped ? "bottom" : "top"}, ${colors[0]}, ${colors[1]})`,
          }}
        />
      ))}
    </span>
  );
}
