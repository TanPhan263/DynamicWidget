import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Renders text such as "12:04" with each digit rolling in when it changes,
 * like a flip clock. Separators stay put.
 */
export function SlidingNumber({ value, className }: { value: string; className?: string }) {
  const chars = value.split("");
  return (
    <span className={cn("inline-flex tabular-nums", className)} aria-label={value}>
      {chars.map((c, i) => {
        // Key by position from the right so "9:59" → "10:00" keeps the
        // seconds digits in place.
        const slot = chars.length - i;
        if (!/\d/.test(c)) {
          return (
            <span key={`s${slot}`} aria-hidden="true">
              {c}
            </span>
          );
        }
        return (
          <span key={`d${slot}`} aria-hidden="true" className="relative inline-block overflow-hidden">
            <span className="invisible">0</span>
            {/* Digits are absolute already. "popLayout" would add a <style> tag per
                change, and WebKit rebuilds every style rule for each one. */}
            <AnimatePresence initial={false}>
              <motion.span
                key={c}
                className="absolute inset-0 text-center"
                // A whole `transform` (not `y`) lets Motion hand the roll to the
                // compositor; `y` is redrawn from script on every frame.
                initial={{ transform: "translateY(70%)", opacity: 0, filter: "blur(2px)" }}
                // No filter is left at rest: even blur(0px) keeps a GPU layer per digit.
                animate={{ transform: "translateY(0%)", opacity: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
                exit={{ transform: "translateY(-70%)", opacity: 0, filter: "blur(2px)" }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
              >
                {c}
              </motion.span>
            </AnimatePresence>
          </span>
        );
      })}
    </span>
  );
}
