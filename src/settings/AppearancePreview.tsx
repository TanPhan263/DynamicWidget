import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DEFAULT_AMBIENT } from "../island/ambient";
import type { Pictures } from "../shared/background";
import { themeLook } from "../shared/themes";
import { t } from "../shared/i18n";
import type { IslandStyle, IslandTheme } from "../shared/types";
import { WALLPAPER } from "./IslandIcons";

interface Props {
  style: IslandStyle;
  theme: IslandTheme;
  pictures: Pictures;
  islandSize: number;
  panelSize: number;
}

/** A strip of desktop with a menu bar, for one scene. */
function Scene({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="relative flex h-44 flex-1 flex-col items-center overflow-hidden" style={{ background: WALLPAPER }}>
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-5 bg-white/20 backdrop-blur-md" />
      <div className="relative flex w-full flex-1 justify-center">{children}</div>
      <figcaption className="relative mb-2 rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur">{caption}</figcaption>
    </figure>
  );
}

/**
 * The closed island and the open panel side by side, drawn with the chosen
 * style, theme, pictures and sizes, so each change shows at once.
 */
export function AppearancePreview({ style, theme, pictures, islandSize, panelSize }: Props) {
  const look = themeLook(theme);
  const attached = style === "notch";
  // As on the island: hanging from the top edge it stays black to merge with the notch, unless it shows a picture.
  const islandBg = attached && theme !== "picture" ? "#000" : look.island(pictures.island ?? pictures.panel);
  return (
    <div aria-hidden="true" className="flex divide-x divide-white/20">
      <Scene caption={t("size.island")}>
        <div style={{ transform: `scale(${islandSize / 100})`, transformOrigin: "50% 0%" }} className={cn(!attached && "pt-1.5")}>
          <div
            className={cn(
              "flex h-7 w-32 items-center justify-between px-3 text-[10px] font-semibold text-white shadow-[0_6px_16px_-6px_rgb(0_0_0/0.6)] ring-1 ring-white/10",
              attached ? "rounded-b-xl" : "rounded-full",
            )}
            style={{ background: islandBg }}
          >
            <span className="tabular-nums">9:41</span>
            <span className="h-2 w-4 rounded-[2px] border border-current p-px opacity-80">
              <span className="block h-full w-3/4 rounded-[1px] bg-current" />
            </span>
          </div>
        </div>
      </Scene>
      <Scene caption={t("size.panel")}>
        <div style={{ transform: `scale(${panelSize / 100})`, transformOrigin: "50% 0%" }} className={cn(!attached && "pt-1.5")}>
          <div
            className={cn("w-44 space-y-1.5 overflow-hidden p-2 shadow-[0_10px_24px_-8px_rgb(0_0_0/0.7)] ring-1 ring-white/10", attached ? "rounded-b-2xl" : "rounded-2xl")}
            style={{ background: look.panel(DEFAULT_AMBIENT, pictures.panel) }}
          >
            <div className="flex gap-1">
              <span className="h-2.5 w-10 rounded-full bg-white/20" />
              <span className="h-2.5 w-8 rounded-full bg-white/[0.08]" />
            </div>
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className="h-8 rounded-md bg-black/30 ring-1 ring-white/[0.07] backdrop-blur-sm" />
              ))}
            </div>
          </div>
        </div>
      </Scene>
    </div>
  );
}
