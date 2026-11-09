import {
  Calculator,
  CalendarDays,
  Camera,
  Coffee,
  Cpu,
  FolderDown,
  Lock,
  Moon,
  Pause,
  Pin,
  Play,
  StickyNote,
  Timer as TimerIcon,
  TrendingUp,
  Video,
  VolumeX,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { clockParts, formatBytes, formatDuration, formatMinutes, formatPercent, formatPrice } from "../../shared/format";
import {
  errorMessage,
  MAX_ISLAND_STOCKS,
  type Quote,
  type QuickAction,
  type QuoteState,
  type SystemStats,
  type WidgetId,
  type WidgetSpan,
} from "../../shared/types";
import { SlidingNumber } from "../SlidingNumber";
import type { TimerApi } from "../useTimer";
import { monthGrid } from "./calendar";

/** Widgets fade up one after another when the panel opens. */
export const widgetItem = {
  hidden: { opacity: 0, y: 8, filter: "blur(4px)" },
  shown: { opacity: 1, y: 0, filter: "blur(0px)" },
};

function Card({
  title,
  icon: Icon,
  children,
  className,
}: {
  title?: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      variants={widgetItem}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-2xl bg-white/[0.08] p-3 ring-1 ring-white/10 ring-inset",
        className,
      )}
    >
      {title && (
        <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-white/70">
          {Icon && <Icon className="size-3.5" aria-hidden="true" />}
          {title}
        </h3>
      )}
      {children}
    </motion.section>
  );
}

/** Sizes and layouts below adapt to how many cells a widget covers. */
type SpanProps = { span?: WidgetSpan };
const isWide = (span?: WidgetSpan) => (span?.cols ?? 1) >= 2;
const isTall = (span?: WidgetSpan) => (span?.rows ?? 1) >= 2;

const CLOCK_SIZE = { small: "text-[38px]", wide: "text-[56px]", tall: "text-[56px]", large: "text-[88px]" };

export function ClockWidget({ now, use24, span }: { now: Date; use24: boolean } & SpanProps) {
  const { time, period } = clockParts(now, use24);
  const wide = isWide(span);
  const tall = isTall(span);
  const size = CLOCK_SIZE[tall ? (wide ? "large" : "tall") : wide ? "wide" : "small"];
  return (
    <Card className={cn("justify-between", wide && !tall && "flex-row items-end")}>
      <div className={cn("flex items-baseline gap-1 leading-none font-semibold tracking-tight", size)}>
        <SlidingNumber value={time} />
        {period && <span className="text-sm font-medium tracking-normal text-white/70">{period}</span>}
      </div>
      <div className={cn("text-xs", wide && !tall && "pb-1 text-right", tall && "text-sm")}>
        <div className="font-medium">{now.toLocaleDateString(undefined, { weekday: "long" })}</div>
        <div className="text-white/70">{now.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</div>
      </div>
    </Card>
  );
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function MonthGrid({ now, big }: { now: Date; big?: boolean }) {
  const days = monthGrid(now.getFullYear(), now.getMonth(), now);
  return (
    <div
      className={cn("grid grid-cols-7 text-center tabular-nums", big ? "auto-rows-[26px] text-xs" : "auto-rows-[14px] text-[9.5px]")}
      role="grid"
      aria-label="This month"
    >
      {WEEKDAYS.map((d, i) => (
        <span key={`h${i}`} className="font-medium text-white/65">
          {d}
        </span>
      ))}
      {days.map((d, i) => (
        <span
          key={i}
          className={cn(
            "mx-auto grid place-items-center rounded-full",
            big ? "size-[22px]" : "size-[14px]",
            !d.inMonth && "text-white/50",
            d.isToday && "bg-white font-semibold text-black",
          )}
        >
          {d.date}
        </span>
      ))}
    </div>
  );
}

export function CalendarWidget({ now, span }: { now: Date } & SpanProps) {
  const month = now.toLocaleDateString(undefined, { month: "long" });
  const tall = isTall(span);
  if (isWide(span)) {
    // Today's date large on the left, the month beside it.
    return (
      <Card className="flex-row gap-4 px-3 py-2">
        <div className="flex w-24 shrink-0 flex-col justify-center">
          <div className="text-[11px] font-medium text-red-400 uppercase">{now.toLocaleDateString(undefined, { weekday: "long" })}</div>
          <div className="text-5xl leading-none font-semibold tracking-tight tabular-nums">{now.getDate()}</div>
          <div className="mt-1 text-xs text-white/70">
            {month} {now.getFullYear()}
          </div>
        </div>
        <div className="flex flex-1 flex-col justify-center">
          <MonthGrid now={now} big={tall} />
        </div>
      </Card>
    );
  }
  return (
    <Card className="px-2.5 py-2">
      <div className="mb-0.5 flex items-center gap-1.5 px-0.5 text-[11px] font-medium text-white/70">
        <CalendarDays className="size-3.5" aria-hidden="true" />
        {month}
      </div>
      <div className="flex flex-1 flex-col justify-center">
        <MonthGrid now={now} big={tall} />
      </div>
    </Card>
  );
}

const PRESETS = [1, 5, 15, 25];

function Ring({ progress }: { progress: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg className="size-full -rotate-90" viewBox="0 0 80 80" aria-hidden="true">
      <circle cx="40" cy="40" r={r} fill="none" strokeWidth="5" className="stroke-amber-400/15" />
      <motion.circle
        cx="40"
        cy="40"
        r={r}
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        className="stroke-amber-400"
        strokeDasharray={c}
        animate={{ strokeDashoffset: c * progress }}
        transition={{ duration: 0.25, ease: "linear" }}
      />
    </svg>
  );
}

const roundButton =
  "grid size-8 place-items-center rounded-full bg-amber-400/15 text-amber-400 transition-colors hover:bg-amber-400/25 active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60";

export function TimerWidget({ timer, span }: { timer: TimerApi } & SpanProps) {
  const { state } = timer;
  const wide = isWide(span);
  const tall = isTall(span);
  if (state.status === "idle") {
    return (
      <Card title="Timer" icon={TimerIcon}>
        <div className={cn("grid flex-1 content-center gap-1.5", wide && !tall ? "grid-cols-4" : "grid-cols-2", tall && "[&>button]:h-12")}>
          {PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              className="h-8 rounded-lg bg-white/[0.10] text-xs font-medium transition-colors outline-none hover:bg-white/[0.16] focus-visible:ring-2 focus-visible:ring-white/40 active:scale-[0.97]"
              onClick={() => timer.start(m * 60_000)}
            >
              {m} min
            </button>
          ))}
        </div>
      </Card>
    );
  }
  const running = state.status === "running";
  return (
    <Card className={cn("items-center gap-2", tall ? "flex-col justify-center gap-4" : "flex-row", wide && "justify-center gap-6")}>
      <div className={cn("relative shrink-0", tall ? "size-[150px]" : "size-[92px]")}>
        <Ring progress={timer.progress} />
        <span className="absolute inset-0 grid place-items-center text-base font-semibold text-amber-400">
          <SlidingNumber value={formatDuration(timer.remaining)} />
        </span>
      </div>
      <div className={cn("flex gap-2", !tall && "flex-col")}>
        <button type="button" className={roundButton} onClick={running ? timer.pause : timer.resume} aria-label={running ? "Pause" : "Resume"}>
          {running ? <Pause className="size-3.5" fill="currentColor" /> : <Play className="size-3.5" fill="currentColor" />}
        </button>
        <button type="button" className={roundButton} onClick={timer.reset} aria-label="Cancel timer">
          <X className="size-3.5" />
        </button>
      </div>
    </Card>
  );
}

function Meter({ label, value, detail, tone }: { label: string; value: number; detail: string; tone?: "good" | "bad" }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="flex justify-between gap-2 text-[11px] font-medium whitespace-nowrap">
        <span>{label}</span>
        <span className="truncate text-white/70">{detail}</span>
      </div>
      <div
        className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.14]"
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <motion.div
          className={cn("h-full rounded-full bg-white/85", tone === "good" && "bg-emerald-400", tone === "bad" && "bg-red-400")}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        />
      </div>
    </div>
  );
}

export function SystemWidget({ stats }: { stats: SystemStats }) {
  const mem = stats.memoryTotal > 0 ? (stats.memoryUsed / stats.memoryTotal) * 100 : 0;
  const b = stats.battery;
  let batteryDetail = "";
  if (b) {
    batteryDetail = `${Math.round(b.percent)}%`;
    if (b.state === "charging") batteryDetail += " · charging";
    else if (b.minutesRemaining && b.state === "discharging") batteryDetail += ` · ${formatMinutes(b.minutesRemaining)}`;
  }
  return (
    <Card title="System" icon={Cpu}>
      <div className="flex flex-1 flex-col justify-center gap-2.5">
        <Meter label="CPU" value={stats.cpuPercent} detail={`${Math.round(stats.cpuPercent)}%`} />
        <Meter label="Memory" value={mem} detail={`${formatBytes(stats.memoryUsed)} / ${formatBytes(stats.memoryTotal)}`} />
        {b && (
          <Meter
            label="Battery"
            value={b.percent}
            detail={batteryDetail}
            tone={b.state === "charging" || b.state === "full" ? "good" : b.percent <= 20 ? "bad" : undefined}
          />
        )}
      </div>
    </Card>
  );
}

const NOTES_KEY = "islet.notes";

function readNotes(): string {
  try {
    return localStorage.getItem(NOTES_KEY) ?? "";
  } catch {
    return "";
  }
}

export function NotesWidget() {
  const [text, setText] = useState(readNotes);
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(NOTES_KEY, text);
      } catch {
        // Storage unavailable; the note lives until the island reloads.
      }
    }, 300);
    return () => clearTimeout(id);
  }, [text]);
  return (
    <Card title="Notes" icon={StickyNote}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Jot something down…"
        aria-label="Quick note"
        spellCheck={false}
        className="flex-1 resize-none bg-transparent text-xs leading-relaxed text-white outline-none placeholder:text-white/55"
      />
    </Card>
  );
}

/** System actions, plus Do Not Disturb, which Islet handles itself. */
export type WidgetAction = QuickAction | "do-not-disturb";

export interface QuickActionsApi {
  keepAwake: boolean;
  recording: boolean;
  doNotDisturb: boolean;
  /** Resolves to a toggle's new state when it is known; rejects with a message. */
  run: (action: WidgetAction) => Promise<boolean | null>;
}

const QUICK_ACTIONS: { id: WidgetAction; label: string; icon: LucideIcon }[] = [
  { id: "record", label: "Record screen", icon: Video },
  { id: "screenshot", label: "Screenshot", icon: Camera },
  { id: "keep-awake", label: "Keep awake", icon: Coffee },
  { id: "do-not-disturb", label: "Do Not Disturb", icon: Moon },
  { id: "mute", label: "Mute", icon: VolumeX },
  { id: "lock", label: "Lock", icon: Lock },
  { id: "calculator", label: "Calculator", icon: Calculator },
  { id: "downloads", label: "Downloads", icon: FolderDown },
];

/** Lit colors for toggles that are on; recording is red, like the system's. */
const ON_STYLE: Partial<Record<WidgetAction, string>> = {
  record: "bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300",
  "do-not-disturb": "bg-violet-400/20 text-violet-300 hover:bg-violet-400/30 hover:text-violet-200",
};

export function QuickActionsWidget({ api, span }: { api: QuickActionsApi } & SpanProps) {
  // The system does not report mute changes, so this is what Islet last set.
  const [muted, setMuted] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 2500);
    return () => clearTimeout(id);
  }, [error]);
  const wide = isWide(span);
  const tall = isTall(span);
  const labeled = wide || tall;

  const run = (action: WidgetAction) => {
    api
      .run(action)
      .then((state) => action === "mute" && setMuted(state))
      .catch((e: unknown) => setError(errorMessage(e)));
  };

  return (
    <Card title={error ?? "Quick actions"} icon={Zap}>
      <div className="grid flex-1 auto-rows-fr grid-cols-4 gap-1.5">
        {QUICK_ACTIONS.map((a) => {
          const on: Partial<Record<WidgetAction, boolean>> = {
            "keep-awake": api.keepAwake,
            record: api.recording,
            "do-not-disturb": api.doNotDisturb,
            mute: muted === true,
          };
          const pressed = on[a.id];
          const label = a.id === "record" && api.recording ? "Stop recording" : a.label;
          return (
            <button
              key={a.id}
              type="button"
              aria-label={label}
              aria-pressed={a.id === "record" ? undefined : pressed}
              title={label}
              onClick={() => run(a.id)}
              className={cn(
                "flex min-h-0 flex-col items-center justify-center gap-1 rounded-lg bg-white/[0.10] text-white/90 transition-colors outline-none hover:bg-white/[0.16] hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 active:scale-[0.97]",
                pressed && (ON_STYLE[a.id] ?? "bg-amber-400/20 text-amber-300 hover:bg-amber-400/30 hover:text-amber-200"),
              )}
            >
              <a.icon className={tall ? "size-5" : "size-4"} aria-hidden="true" />
              {labeled && <span className="truncate px-0.5 text-[11px] leading-none font-medium">{label}</span>}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/** Green for up, red for down, like a market board. */
export function changeTone(q: Quote): string {
  return q.change > 0 ? "text-emerald-400" : q.change < 0 ? "text-red-400" : "text-white/80";
}

/** Today's prices as a line, with the previous close as a faint baseline. */
function Sparkline({ q, className }: { q: Quote; className?: string }) {
  const values = [...q.points, q.previousClose];
  if (q.points.length < 2) return <span className={className} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 100;
  const h = 32;
  const y = (v: number) => h - ((v - min) / span) * (h - 4) - 2;
  const line = q.points.map((v, i) => `${((i / (q.points.length - 1)) * w).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-6", changeTone(q), className)} aria-hidden="true">
      <line x1="0" x2={w} y1={y(q.previousClose)} y2={y(q.previousClose)} stroke="currentColor" strokeOpacity="0.25" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export interface StocksApi {
  quotes: QuoteState[];
  /** Symbols shown on the closed island. */
  pinned: string[];
  onOpen: (symbol: string) => void;
  /** Shows a symbol on the island, or takes it off. */
  onTogglePin: (symbol: string) => void;
}

export function StocksWidget({ api, span }: { api: StocksApi } & SpanProps) {
  const { quotes, pinned, onOpen, onTogglePin } = api;
  const full = pinned.length >= MAX_ISLAND_STOCKS;
  const wide = isWide(span);
  const tall = isTall(span);
  // One row per symbol that fits the card.
  const rows = quotes.slice(0, tall ? 7 : 3);
  return (
    <Card title="Stocks" icon={TrendingUp} className="px-2 pb-2">
      {rows.length === 0 ? (
        <p className="px-1 text-xs text-white/65">Add symbols in Settings → Widgets.</p>
      ) : (
        <ul className="flex flex-1 flex-col justify-start gap-0.5">
          {rows.map(({ symbol, quote, error }) => {
            const on = pinned.includes(symbol);
            return (
            <li key={symbol} className="group/row flex items-center gap-0.5">
              <button
                type="button"
                title={quote ? `${quote.name} · open quote` : (error ?? "Loading…")}
                aria-label={
                  quote
                    ? `${symbol} ${formatPrice(quote.price)} ${quote.currency}, ${formatPercent(quote.changePercent)}`
                    : `${symbol}, ${error ?? "loading"}`
                }
                onClick={() => onOpen(symbol)}
                className="flex h-[26px] min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left text-[11px] transition-colors outline-none hover:bg-white/[0.10] focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold">{symbol}</span>
                  {wide && quote && <span className="ml-1.5 text-white/65">{quote.name}</span>}
                </span>
                {wide && quote && <Sparkline q={quote} className="w-20 shrink-0" />}
                {quote ? (
                  <>
                    {/* Live ticks roll the digits that changed. */}
                    <SlidingNumber value={formatPrice(quote.price)} className="shrink-0" />
                    <span className={cn("w-[52px] shrink-0 text-right font-medium tabular-nums", changeTone(quote))}>
                      {formatPercent(quote.changePercent)}
                    </span>
                  </>
                ) : (
                  <span className="shrink-0 text-white/55">{error ? "—" : "…"}</span>
                )}
              </button>
              <button
                type="button"
                aria-pressed={on}
                aria-label={`Show ${symbol} on island`}
                disabled={!on && full}
                title={
                  on
                    ? "Shown on the island; click to remove"
                    : full
                      ? `The island shows up to ${MAX_ISLAND_STOCKS}`
                      : "Show on island"
                }
                onClick={() => onTogglePin(symbol)}
                className={cn(
                  "grid size-[18px] shrink-0 place-items-center rounded text-white/65 opacity-0 transition-opacity outline-none group-hover/row:opacity-100 hover:bg-white/[0.14] hover:text-white focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-white/65",
                  on && "text-amber-300 opacity-100 hover:text-amber-200",
                )}
              >
                <Pin className="size-3" fill={on ? "currentColor" : "none"} aria-hidden="true" />
              </button>
            </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function Widget({
  id,
  span,
  now,
  use24,
  timer,
  stats,
  actions,
  stocks,
}: {
  id: WidgetId;
  span?: WidgetSpan;
  now: Date;
  use24: boolean;
  timer: TimerApi;
  stats: SystemStats;
  actions: QuickActionsApi;
  stocks: StocksApi;
}) {
  switch (id) {
    case "clock":
      return <ClockWidget now={now} use24={use24} span={span} />;
    case "calendar":
      return <CalendarWidget now={now} span={span} />;
    case "timer":
      return <TimerWidget timer={timer} span={span} />;
    case "system":
      return <SystemWidget stats={stats} />;
    case "notes":
      return <NotesWidget />;
    case "actions":
      return <QuickActionsWidget api={actions} span={span} />;
    case "stocks":
      return <StocksWidget api={stocks} span={span} />;
  }
}
