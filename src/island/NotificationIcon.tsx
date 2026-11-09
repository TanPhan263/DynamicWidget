import {
  Battery,
  Music2,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryWarning,
  Sparkles,
  Timer,
  Video,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { IslandNotification, NotificationSymbol } from "../shared/types";

const SYMBOLS: Record<NotificationSymbol, LucideIcon> = {
  battery: Battery,
  "battery-charging": BatteryCharging,
  "battery-full": BatteryFull,
  "battery-low": BatteryLow,
  "battery-warning": BatteryWarning,
  timer: Timer,
  sparkles: Sparkles,
  recording: Video,
  music: Music2,
};

/**
 * A rounded tile for a notification: a built-in vector icon for Islet's own
 * notifications, a website's icon, otherwise the sender's emoji or initial.
 */
export function NotificationIcon({ n, size = 36 }: { n: IslandNotification; size?: number }) {
  const Symbol = n.symbol ? SYMBOLS[n.symbol] : null;
  if (n.image) {
    // Site icons are drawn for light backgrounds.
    return (
      <span
        aria-hidden="true"
        className="grid shrink-0 place-items-center rounded-[28%] bg-white ring-1 ring-white/15 ring-inset"
        style={{ width: size, height: size }}
      >
        <img src={n.image} alt="" draggable={false} style={{ width: size * 0.62, height: size * 0.62 }} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-[28%] font-semibold text-white ring-1 ring-white/15 ring-inset",
        !n.accent && "bg-white/[0.14]",
      )}
      style={{ width: size, height: size, background: n.accent ?? undefined, fontSize: size * 0.46 }}
    >
      {Symbol ? <Symbol style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2} /> : (n.icon ?? n.app.slice(0, 1).toUpperCase())}
    </span>
  );
}
