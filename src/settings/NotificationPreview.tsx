import { Moon, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { t } from "../shared/i18n";
import { WALLPAPER } from "./IslandIcons";

interface Props {
  /** The island hangs from the top edge (notch or bar) rather than floating. */
  attached: boolean;
  /** The island's background (CSS), as the theme draws it. */
  background: string;
  seconds: number;
  doNotDisturb: boolean;
  /** Sits over the bottom of the preview, such as the test button. */
  children?: ReactNode;
}

/**
 * A notification popping out of the island the way these settings deliver
 * it: open for `seconds` (the bar underneath runs that long), or held back
 * with the island closed while Do Not Disturb is on.
 */
export function NotificationPreview({ attached, background, seconds, doNotDisturb, children }: Props) {
  const reduce = useReducedMotion();
  const shell = cn("text-white shadow-[0_10px_24px_-8px_rgb(0_0_0/0.65)] ring-1 ring-white/10", attached ? "rounded-b-[20px]" : "mt-2 rounded-[22px]");
  return (
    <div className="relative flex h-40 flex-col items-center overflow-hidden" style={{ background: WALLPAPER }}>
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-5 bg-white/20 backdrop-blur-md" />
      <div aria-hidden="true" className="relative flex flex-col items-center">
        {doNotDisturb ? (
          <div className={cn(shell, "flex h-8 w-40 items-center justify-between px-3.5", !attached && "rounded-full")} style={{ background }}>
            <Moon className="size-3.5 text-violet-300" fill="currentColor" />
            <span className="grid h-4 min-w-4 place-items-center rounded-full bg-white/20 px-1 text-[9px] font-semibold">1</span>
          </div>
        ) : (
          <>
            <div className={cn(shell, "flex w-72 items-center gap-2.5 px-3 py-2.5")} style={{ background }}>
              <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-neutral-800">
                <Sparkles className="size-4 text-white" />
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block text-[10px] text-white/55">Lintel · {t("time.now")}</span>
                <span className="block truncate text-[12px] font-semibold">{t("notif.sampleTitle")}</span>
                <span className="block truncate text-[11px] text-white/60">{t("notif.sampleBody")}</span>
              </span>
            </div>
            {/* How long it stays open: the bar fills over the pop-up duration, then starts again. */}
            <span className="mt-1.5 h-[3px] w-24 overflow-hidden rounded-full bg-white/25">
              <motion.span
                key={seconds}
                className="block h-full origin-left rounded-full bg-white"
                initial={{ scaleX: reduce ? 1 : 0 }}
                animate={{ scaleX: 1 }}
                transition={reduce ? { duration: 0 } : { duration: seconds, ease: "linear", repeat: Infinity }}
              />
            </span>
          </>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-3 flex justify-center">{children}</div>
    </div>
  );
}
