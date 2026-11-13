import { BatteryCharging, BatteryMedium, Cpu, HardDrive, Mail, MemoryStick, Plug } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { clockParts } from "../shared/format";
import { getLanguage, t, type MessageKey } from "../shared/i18n";
import type { IslandStat, SystemStats, Weather } from "../shared/types";
import { degrees, weatherIcon } from "./widgets/Widgets";

/**
 * Frosted glass behind each icon: it blurs whatever is behind it, such as a
 * background picture, so the icon stays readable.
 */
const FROST = "rounded-full bg-white/[0.14] shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.2)] backdrop-blur-md";

/** Share of the ring the gauge uses; the gap at the bottom holds the icon. */
const GAUGE_ARC = 0.75;

/**
 * A round gauge like the iPhone Lock Screen's: an open ring that fills with
 * the value, the number inside, and a tiny icon in the gap at the bottom.
 */
function Gauge({ icon: Icon, label, percent, tone }: { icon: typeof Cpu; label: string; percent: number; tone?: string }) {
  const p = Math.min(100, Math.max(0, Math.round(percent)));
  const ring = { cx: 11, cy: 11, r: 9.5, fill: "none", strokeWidth: 2.2, strokeLinecap: "round", pathLength: 1, transform: "rotate(135 11 11)" } as const;
  return (
    <span role="img" aria-label={`${label} ${p}%`} title={`${label} ${p}%`} className={cn("relative grid size-[22px] shrink-0 place-items-center p-px", FROST, tone)}>
      <svg viewBox="0 0 22 22" className="absolute inset-px size-5" aria-hidden="true">
        <circle {...ring} stroke="currentColor" strokeOpacity={0.22} strokeDasharray={`${GAUGE_ARC} 1`} />
        <circle {...ring} stroke="currentColor" strokeDasharray={`${GAUGE_ARC * (p / 100)} 1`} className="transition-[stroke-dasharray] duration-500" />
      </svg>
      <span className="-mt-px text-[8.5px] leading-none font-semibold tracking-tight tabular-nums">{p}</span>
      <Icon className="absolute -bottom-px left-1/2 size-[7px] -translate-x-1/2" strokeWidth={3} aria-hidden="true" />
    </span>
  );
}

/**
 * The Lock Screen's other round widget: a soft filled disc with a symbol, and
 * a short value under it when there is one.
 */
function Disc({ icon: Icon, label, value, tone }: { icon: typeof Cpu; label: string; value?: string; tone?: string }) {
  return (
    <span
      role="img"
      aria-label={value ? `${label} ${value}` : label}
      title={value ? `${label} ${value}` : label}
      className={cn("flex size-[22px] shrink-0 flex-col items-center justify-center gap-px p-px", FROST)}
    >
      <Icon className={cn(value ? "size-[9px]" : "size-3", tone)} strokeWidth={2.5} aria-hidden="true" />
      {value && <span className="text-[7.5px] leading-none font-semibold tracking-tight tabular-nums">{value}</span>}
    </span>
  );
}

const busy = (p: number) => (p >= 80 ? "text-amber-400" : undefined);
const share = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0);

const LABELS: Record<IslandStat, MessageKey> = {
  cpu: "system.cpu",
  memory: "system.memory",
  disk: "system.disk",
  battery: "system.battery",
  weather: "widget.weather",
  mail: "system.mail",
  date: "system.date",
  time: "system.time",
};
export const statLabel = (id: IslandStat) => t(LABELS[id]);

/** The round icon for one computer state, with its live value. */
interface StatProps {
  id: IslandStat;
  stats: SystemStats;
  weather: Weather | null;
  now: Date;
  use24: boolean;
}

export function StatGauge({ id, stats, weather, now, use24 }: StatProps): ReactNode {
  const label = statLabel(id);
  switch (id) {
    case "cpu":
      return <Gauge icon={Cpu} label={label} percent={stats.cpuPercent} tone={busy(stats.cpuPercent)} />;
    case "memory": {
      const p = share(stats.memoryUsed, stats.memoryTotal);
      return <Gauge icon={MemoryStick} label={label} percent={p} tone={busy(p)} />;
    }
    case "disk": {
      const p = share(stats.diskUsed, stats.diskTotal);
      return <Gauge icon={HardDrive} label={label} percent={p} tone={p >= 90 ? "text-red-400" : busy(p)} />;
    }
    case "battery": {
      const b = stats.battery;
      // A desktop runs on mains power, so it shows the plug.
      if (!b) return <Disc icon={Plug} label={t("system.pluggedIn")} tone="text-emerald-400" />;
      const charging = b.state === "charging";
      return (
        <Gauge
          icon={charging ? BatteryCharging : BatteryMedium}
          label={label}
          percent={b.percent}
          tone={charging ? "text-emerald-400" : b.percent <= 20 ? "text-red-400" : undefined}
        />
      );
    }
    case "weather": {
      if (!weather) return <Disc icon={weatherIcon(116).icon} label={label} value="–" />;
      const look = weatherIcon(weather.code);
      return <Disc icon={look.icon} label={`${label}: ${weather.description}`} value={degrees(weather.tempC)} tone={look.color} />;
    }
    case "date": {
      // Like the Lock Screen calendar: the weekday in red over the day of the month.
      const weekday = new Intl.DateTimeFormat(getLanguage(), { weekday: "short" }).format(now).replace(/\.$/, "");
      const full = new Intl.DateTimeFormat(getLanguage(), { dateStyle: "full" }).format(now);
      return (
        <span role="img" aria-label={full} title={full} className={cn("flex size-[22px] shrink-0 flex-col items-center justify-center p-px leading-none", FROST)}>
          <span className="max-w-[18px] truncate text-[6px] font-bold tracking-wide text-red-400 uppercase">{weekday}</span>
          <span className="text-[10px] font-semibold tabular-nums">{now.getDate()}</span>
        </span>
      );
    }
    case "time": {
      const { time, period } = clockParts(now, use24);
      return (
        <span role="img" aria-label={`${label} ${time}${period && ` ${period}`}`} className={cn("shrink-0 px-1 py-[5px] text-[12px] leading-none font-semibold whitespace-nowrap tabular-nums", FROST)}>
          {time}
          {period && <span className="ml-0.5 text-[8px] text-white/70">{period}</span>}
        </span>
      );
    }
    case "mail": {
      const n = stats.mailUnread;
      return <Disc icon={Mail} label={label} value={n === null ? "–" : n > 99 ? "99+" : String(n)} tone={n ? "text-sky-400" : undefined} />;
    }
  }
}
