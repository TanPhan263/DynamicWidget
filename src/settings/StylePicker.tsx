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
  hanging: "top-0 h-2.5 w-[44%] rounded-b-[5px]",
  capsule: "top-1 h-2.5 w-[40%] rounded-full",
};

/** A miniature screen top showing where and how the island is drawn. */
function Miniature({ preview }: { preview: Preview }) {
  return (
    <span
      aria-hidden="true"
      className="relative block h-9 w-full overflow-hidden rounded-md bg-gradient-to-b from-neutral-200 to-neutral-100 ring-1 ring-black/5 ring-inset dark:from-neutral-700 dark:to-neutral-800 dark:ring-white/5"
    >
      <span className="absolute inset-x-0 top-0 h-1.5 bg-white/60 dark:bg-white/10" />
      <span className={cn("absolute left-1/2 -translate-x-1/2 bg-black", SHAPES[preview])} />
    </span>
  );
}

interface Props {
  value: IslandStyle;
  hasNotch: boolean;
  onChange: (style: IslandStyle) => void;
}

/** The chosen style's description, for the row the picker sits in. */
export const styleDescription = (value: IslandStyle, hasNotch: boolean) => options(hasNotch).find((o) => o.value === value)?.description ?? "";

/** Each style as a small picture of the top of the screen, with its name. */
export function StylePicker({ value, hasNotch, onChange }: Props) {
  return (
    <RadioGroup.Root aria-label={t("style.label")} value={value} onValueChange={(v) => onChange(v as IslandStyle)} className="flex gap-2">
      {options(hasNotch).map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          title={o.description}
          className="group flex w-24 flex-col gap-1 rounded-lg p-1 text-[11px] text-muted-foreground outline-none ring-1 ring-black/10 transition-shadow focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:font-medium data-[state=checked]:text-foreground data-[state=checked]:ring-2 data-[state=checked]:ring-foreground dark:ring-white/10"
        >
          <Miniature preview={o.preview} />
          {o.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
