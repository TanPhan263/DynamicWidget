import { RadioGroup } from "radix-ui";
import { cn } from "@/lib/utils";
import { t } from "../shared/i18n";
import type { IslandStyle } from "../shared/types";

type Preview = "hanging" | "capsule";

interface Option {
  value: IslandStyle;
  label: string;
  description: string;
  preview: Preview;
}

function options(hasNotch: boolean): Option[] {
  return [
    {
      value: "notch",
      label: t("style.notch"),
      description: hasNotch ? t("style.notchDesc") : t("style.notchDescNoNotch"),
      preview: "hanging",
    },
    { value: "island", label: t("style.island"), description: t("style.islandDesc"), preview: "capsule" },
  ];
}

const SHAPES: Record<Preview, string> = {
  hanging: "top-0 h-3.5 w-[44%] rounded-b-[7px]",
  capsule: "top-1.5 h-3.5 w-[40%] rounded-full",
};

/** A miniature screen top showing where and how the island is drawn. */
function Miniature({ preview }: { preview: Preview }) {
  return (
    <span
      aria-hidden="true"
      className="relative block h-16 w-full overflow-hidden rounded-md bg-gradient-to-b from-neutral-200 to-neutral-100 ring-1 ring-black/5 ring-inset dark:from-neutral-700 dark:to-neutral-800 dark:ring-white/5"
    >
      <span className="absolute inset-x-0 top-0 h-2.5 bg-white/60 dark:bg-white/10" />
      <span className={cn("absolute left-1/2 flex -translate-x-1/2 items-center bg-black px-1.5", SHAPES[preview])}>
        {preview !== "capsule" && <span className="text-[6px] font-semibold text-white/80">9:41</span>}
      </span>
    </span>
  );
}

interface Props {
  value: IslandStyle;
  hasNotch: boolean;
  onChange: (style: IslandStyle) => void;
}

export function StylePicker({ value, hasNotch, onChange }: Props) {
  return (
    <RadioGroup.Root
      aria-label={t("style.label")}
      value={value}
      onValueChange={(v) => onChange(v as IslandStyle)}
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
    >
      {options(hasNotch).map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          className="group flex flex-col items-start gap-1 rounded-xl border bg-card p-2.5 pb-3 text-left shadow-xs transition-[border-color,box-shadow] outline-none hover:border-foreground/20 focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=checked]:border-foreground/60 data-[state=checked]:bg-accent/60"
        >
          <Miniature preview={o.preview} />
          <span className="mt-1.5 px-0.5 text-sm font-medium">{o.label}</span>
          <span className="px-0.5 text-xs leading-snug text-muted-foreground">{o.description}</span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
