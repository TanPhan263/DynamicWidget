import { ArrowDown, ArrowUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { BAR_PRESETS, MusicBars } from "../island/MusicBars";
import { t, type MessageKey } from "../shared/i18n";
import type { BarsPosition, MusicBarsSettings } from "../shared/types";
import { WALLPAPER } from "./IslandIcons";
import { Row } from "./layout";

interface Look {
  position: BarsPosition;
  flipped: boolean;
  colors: [string, string];
}

const STYLES: { position: BarsPosition; flipped: boolean }[] = [
  { position: "inside", flipped: false },
  { position: "inside", flipped: true },
  { position: "below", flipped: false },
  { position: "below", flipped: true },
];

const positionLabel = (p: BarsPosition) => t(p === "inside" ? "music.inside" : "music.below");
const styleLabel = (s: { position: BarsPosition; flipped: boolean }) =>
  s.flipped ? t("music.styleFlipped", { name: positionLabel(s.position) }) : positionLabel(s.position);

/** A cover stand-in tinted with the bar colors. */
const Cover = ({ colors, size }: { colors: [string, string]; size: number }) => (
  <span className="shrink-0 rounded-[4px]" style={{ width: size, height: size, background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})` }} />
);

/** The closed island while music plays, drawn the way these settings make it look. */
function MiniIsland({ look, title, small }: { look: Look; title: boolean; small?: boolean }) {
  const inside = look.position === "inside";
  return (
    <div className="flex flex-col items-center" style={{ gap: small ? 3 : 6 }}>
      <div
        className={cn("flex items-center bg-black text-white shadow-[0_6px_18px_-6px_rgb(0_0_0/0.6)]", small ? "h-5 gap-1.5 rounded-b-[9px] px-2" : "h-9 gap-2.5 rounded-b-[16px] px-3.5")}
        style={{ minWidth: small ? 72 : 220 }}
      >
        <Cover colors={look.colors} size={small ? 9 : 18} />
        {title && !small ? (
          <span className="min-w-0 flex-1 truncate text-center text-xs font-medium">
            Midnight City <span className="text-white/60">· M83</span>
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {inside && <MusicBars count={4} height={small ? 8 : 14} barWidth={small ? 2 : 3} gap={small ? 1 : 2} colors={look.colors} flipped={look.flipped} />}
      </div>
      {!inside && (
        <span className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
          <MusicBars count={small ? 14 : 24} height={small ? 7 : 16} barWidth={small ? 2 : 3} gap={small ? 1 : 2} colors={look.colors} flipped={look.flipped} />
        </span>
      )}
    </div>
  );
}

const swatch =
  "size-7 shrink-0 rounded-full ring-1 ring-black/10 ring-offset-2 ring-offset-background outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring dark:ring-white/15";
/** A color input drawn as a plain round swatch. */
const colorInput = cn(
  swatch,
  "cursor-pointer appearance-none overflow-hidden border-0 bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0",
);

/**
 * Music bars, kept minimal: a live preview on top, the four styles to pick
 * from as small previews, colors as swatches, and two switches.
 */
export function MusicBarsSettingsCard({ bars, onChange }: { bars: MusicBarsSettings; onChange: (patch: Partial<MusicBarsSettings>) => void }) {
  const same = (a: [string, string], b: [string, string]) => a[0] === b[0] && a[1] === b[1];
  return (
    <Card className="overflow-hidden">
      <div
        aria-hidden="true"
        className={cn("flex h-32 justify-center transition-opacity", !bars.enabled && "opacity-40 grayscale")}
        style={{ background: WALLPAPER }}
      >
        <MiniIsland look={bars} title={bars.showTitle} />
      </div>

      <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
        <Row label={t("music.show")} htmlFor="bars-on">
          <Switch id="bars-on" checked={bars.enabled} onCheckedChange={(enabled) => onChange({ enabled })} />
        </Row>

        <div className={cn("space-y-2.5 px-4 py-3.5 transition-opacity", !bars.enabled && "opacity-50")}>
          <div className="text-[13px] font-medium">{t("music.style")}</div>
          <div role="radiogroup" aria-label={t("music.style")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STYLES.map((s) => {
              const on = bars.position === s.position && bars.flipped === s.flipped;
              const Arrow = s.flipped ? ArrowDown : ArrowUp;
              return (
                <button
                  key={`${s.position}-${s.flipped}`}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={styleLabel(s)}
                  onClick={() => onChange({ position: s.position, flipped: s.flipped })}
                  className={cn(
                    "group flex flex-col overflow-hidden rounded-lg text-left ring-1 ring-black/10 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring dark:ring-white/10",
                    on && "ring-2 ring-foreground dark:ring-foreground",
                  )}
                >
                  <span className="flex h-14 justify-center bg-neutral-200 dark:bg-neutral-800">
                    <MiniIsland look={{ ...s, colors: bars.colors }} title={false} small />
                  </span>
                  <span className={cn("flex items-center gap-1 px-2 py-1.5 text-[11px] text-muted-foreground", on && "text-foreground")}>
                    <Arrow className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{positionLabel(s.position)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <Row label={t("music.colors")}>
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            {BAR_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                title={t(`music.preset.${p.name}` as MessageKey)}
                aria-label={t(`music.preset.${p.name}` as MessageKey)}
                aria-pressed={same(p.colors, bars.colors)}
                onClick={() => onChange({ colors: p.colors })}
                className={cn(swatch, "aria-pressed:ring-2 aria-pressed:ring-foreground")}
                style={{ background: `linear-gradient(to top, ${p.colors[0]}, ${p.colors[1]})` }}
              />
            ))}
            <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
            <input type="color" aria-label={t("music.baseColor")} title={t("music.baseColor")} value={bars.colors[0]} onChange={(e) => onChange({ colors: [e.target.value, bars.colors[1]] })} className={colorInput} />
            <input type="color" aria-label={t("music.tipColor")} title={t("music.tipColor")} value={bars.colors[1]} onChange={(e) => onChange({ colors: [bars.colors[0], e.target.value] })} className={colorInput} />
          </div>
        </Row>

        <Row label={t("music.showTitle")} description={t("music.showTitleDesc")} htmlFor="bars-title">
          <Switch id="bars-title" checked={bars.showTitle} onCheckedChange={(showTitle) => onChange({ showTitle })} />
        </Row>
      </div>
    </Card>
  );
}
