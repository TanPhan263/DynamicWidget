import { ImagePlus } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DEFAULT_AMBIENT } from "../island/ambient";
import type { Pictures } from "../shared/background";
import { THEME_IDS, THEMES } from "../shared/themes";
import { t } from "../shared/i18n";
import type { BackgroundSlot, IslandTheme } from "../shared/types";

interface Props {
  value: IslandTheme;
  onChange: (theme: IslandTheme) => void;
  /** The saved background pictures. */
  pictures: Pictures;
  /** A picture file the user chose for a slot; the caller frames and saves it. */
  onPicture: (slot: BackgroundSlot, file: File) => void;
  onRemovePicture: (slot: BackgroundSlot) => void;
}

/** Each theme as a tiny open panel with the floating island above it. */
export function ThemePicker({ value, onChange, pictures, onPicture, onRemovePicture }: Props) {
  const input = useRef<HTMLInputElement>(null);
  // Which slot the file chooser is open for.
  const [slot, setSlot] = useState<BackgroundSlot>("panel");
  const choose = (s: BackgroundSlot) => {
    setSlot(s);
    input.current?.click();
  };
  const islandPicture = pictures.island ?? pictures.panel;
  return (
    <div className="space-y-3">
      <RadioGroup.Root
        aria-label={t("general.theme")}
        value={value}
        onValueChange={(v) => onChange(v as IslandTheme)}
        className="grid grid-cols-4 gap-3 sm:grid-cols-8"
      >
        {THEME_IDS.map((id) => {
          const look = THEMES[id];
          const empty = id === "picture" && !pictures.panel;
          return (
            <RadioGroup.Item
              key={id}
              value={id}
              className="group flex flex-col items-center gap-1.5 rounded-xl p-1 text-xs text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=checked]:font-medium data-[state=checked]:text-foreground"
            >
              {empty ? (
                <span
                  aria-hidden="true"
                  className="grid h-14 w-full place-items-center rounded-lg border border-dashed border-foreground/25 text-foreground/50 transition-colors group-hover:border-foreground/45 group-hover:text-foreground/70 group-data-[state=checked]:border-foreground group-data-[state=checked]:text-foreground"
                >
                  <ImagePlus className="size-5" strokeWidth={1.5} />
                </span>
              ) : (
                <span
                  aria-hidden="true"
                  className="relative block h-14 w-full overflow-hidden rounded-lg ring-1 ring-black/10 transition-shadow group-hover:ring-black/25 group-data-[state=checked]:ring-2 group-data-[state=checked]:ring-foreground group-data-[state=checked]:ring-offset-2 group-data-[state=checked]:ring-offset-canvas dark:ring-white/10"
                  style={{ background: look.panel(DEFAULT_AMBIENT, pictures.panel) }}
                >
                  <span
                    className="absolute top-1.5 left-1/2 h-2 w-8 -translate-x-1/2 rounded-full ring-1 ring-white/15"
                    style={{ background: look.island(islandPicture) }}
                  />
                  <span className="absolute inset-x-2 bottom-2 grid grid-cols-3 gap-1">
                    <span className="h-3 rounded-[3px] bg-white/[0.08]" />
                    <span className="h-3 rounded-[3px] bg-white/[0.08]" />
                    <span className="h-3 rounded-[3px] bg-white/[0.08]" />
                  </span>
                </span>
              )}
              {t(`theme.${id}`)}
            </RadioGroup.Item>
          );
        })}
      </RadioGroup.Root>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        aria-label={t("picture.choose")}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPicture(slot, file);
          e.target.value = "";
        }}
      />
      {/* Picture shows a place for each picture first; nothing opens until one is chosen. */}
      {value === "picture" && (
        <div className="divide-y divide-black/[0.06] rounded-xl border border-black/[0.06] bg-card dark:divide-white/[0.06] dark:border-white/[0.07]">
          <PictureRow
            slot="panel"
            hint={pictures.panel ? t("picture.panelHint") : t("picture.none")}
            picture={pictures.panel}
            shape="h-10 w-16 rounded-md"
            onChoose={() => choose("panel")}
            onRemove={pictures.panel ? () => onRemovePicture("panel") : undefined}
          />
          <PictureRow
            slot="island"
            hint={pictures.island ? t("picture.islandHint") : pictures.panel ? t("picture.borrowHint") : t("picture.none")}
            picture={islandPicture}
            shape="h-4 w-16 rounded-full"
            onChoose={() => choose("island")}
            onRemove={pictures.island ? () => onRemovePicture("island") : undefined}
          />
        </div>
      )}
    </div>
  );
}

function PictureRow(p: {
  slot: BackgroundSlot;
  hint: string;
  picture: string | null;
  /** Thumbnail size and rounding, echoing the shape it fills. */
  shape: string;
  onChoose: () => void;
  onRemove?: () => void;
}) {
  const island = p.slot === "island";
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="grid w-16 shrink-0 place-items-center">
        {p.picture ? (
          <span
            aria-hidden="true"
            className={cn("block ring-1 ring-black/10 dark:ring-white/10", p.shape)}
            style={{ background: `url("${p.picture}") center / cover no-repeat` }}
          />
        ) : (
          <span aria-hidden="true" className={cn("grid place-items-center border border-dashed border-foreground/25 text-foreground/45", p.shape)}>
            <ImagePlus className="size-3.5" strokeWidth={1.5} />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{t(island ? "picture.island" : "picture.panel")}</div>
        <div className="truncate text-xs text-muted-foreground">{p.hint}</div>
      </div>
      <Button
        size="sm"
        variant="outline"
        aria-label={t(p.picture ? (island ? "picture.changeIsland" : "picture.changePanel") : island ? "picture.chooseIsland" : "picture.choosePanel")}
        onClick={p.onChoose}
      >
        {p.picture ? t("picture.changeButton") : t("picture.chooseButton")}
      </Button>
      {p.onRemove && (
        <Button size="sm" variant="ghost" aria-label={t(island ? "picture.removeIsland" : "picture.removePanel")} onClick={p.onRemove}>
          {t("common.remove")}
        </Button>
      )}
    </div>
  );
}
