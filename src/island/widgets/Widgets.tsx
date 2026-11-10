import {
  Bluetooth,
  Calculator,
  Camera,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Coffee,
  Contrast,
  FolderDown,
  Leaf,
  Lock,
  Moon,
  Music2,
  Pause,
  Pin,
  Plane,
  Play,
  SkipBack,
  SkipForward,
  Sun,
  Sunset,
  Video,
  Volume2,
  VolumeX,
  Wifi,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Slider } from "radix-ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { clockParts, formatBytes, formatDuration, formatMinutes, formatPercent, formatPrice, formatVolume, shortSymbol } from "../../shared/format";
import {
  errorMessage,
  MAX_ISLAND_STOCKS,
  type ControlChange,
  type Controls,
  type ControlToggle,
  type MediaCommand,
  type NowPlaying,
  type Quote,
  type QuickAction,
  type QuoteState,
  type SystemStats,
  type Weather,
  type WidgetId,
  type WidgetSpan,
} from "../../shared/types";
import { getControls, getWeather, setControl } from "../../shared/commands";
import { getLanguage, t, type MessageKey } from "../../shared/i18n";
import { SlidingNumber } from "../SlidingNumber";
import type { TimerApi } from "../useTimer";
import { monthGrid } from "./calendar";

/** Widgets fade up one after another when the panel opens. */
export const widgetItem = {
  hidden: { opacity: 0, y: 8, filter: "blur(4px)" },
  shown: { opacity: 1, y: 0, filter: "blur(0px)" },
};

/** Card label: quiet text, no icon, so the content leads. */
export const LABEL = "text-[10px] font-semibold tracking-[0.12em] text-white/40 uppercase";

/** Glass tile: a dark layer under a faint white tint, over a soft blur of the background, keeps widgets readable over any theme or picture. */
export const TILE =
  "tile rounded-[18px] bg-black/30 bg-[linear-gradient(rgb(255_255_255/0.05),rgb(255_255_255/0.05))] ring-1 ring-white/[0.07] ring-inset shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] backdrop-blur-md";

/** Round glass button used for controls inside tiles. */
const GLASS_BUTTON =
  "bg-white/[0.07] ring-1 ring-white/[0.06] ring-inset transition-colors outline-none hover:bg-white/[0.14] focus-visible:ring-2 focus-visible:ring-white/40 active:scale-[0.96]";

function Card({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <motion.section
      variants={widgetItem}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className={cn(
        "relative isolate flex min-w-0 flex-col overflow-hidden p-3",
        TILE,
        className,
      )}
    >
      {title && <h3 className={cn("mb-2", LABEL)}>{title}</h3>}
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
      <div className={cn("flex items-baseline gap-1 leading-none font-light tracking-tight", size)}>
        <SlidingNumber value={time} />
        {period && <span className="text-xs font-medium tracking-normal text-white/45">{period}</span>}
      </div>
      <div className={cn("text-xs", wide && !tall && "pb-1 text-right", tall && "text-sm")}>
        <div className="text-[13px] font-medium">{now.toLocaleDateString(getLanguage(), { weekday: "long" })}</div>
        <div className="text-white/45">{now.toLocaleDateString(getLanguage(), { month: "long", day: "numeric", year: "numeric" })}</div>
      </div>
    </Card>
  );
}

/** One-letter weekday names from Sunday, in the current language (7 Jan 2024 was a Sunday). */
const weekdays = () => Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + i).toLocaleDateString(getLanguage(), { weekday: "narrow" }));

function MonthGrid({ now, big }: { now: Date; big?: boolean }) {
  const days = monthGrid(now.getFullYear(), now.getMonth(), now);
  return (
    <div
      className={cn("grid grid-cols-7 text-center tabular-nums", big ? "auto-rows-[30px] text-xs" : "auto-rows-[14px] text-[9.5px]")}
      role="grid"
      aria-label={t("calendar.thisMonth")}
    >
      {weekdays().map((d, i) => (
        <span key={`h${i}`} className="text-[0.85em] font-medium text-white/35">
          {d}
        </span>
      ))}
      {days.map((d, i) => (
        <span
          key={i}
          className={cn(
            "mx-auto grid place-items-center rounded-full",
            big ? "size-[22px]" : "size-[14px]",
            !d.inMonth && "text-white/30",
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
  const month = now.toLocaleDateString(getLanguage(), { month: "long" });
  const tall = isTall(span);
  if (isWide(span)) {
    // Today's date large on the left, the month beside it.
    return (
      <Card className="flex-row gap-4 px-3 py-2">
        <div className="flex w-24 shrink-0 flex-col justify-start">
          <div className="text-[11px] font-medium text-red-400 uppercase">{now.toLocaleDateString(getLanguage(), { weekday: "long" })}</div>
          <div className="text-5xl leading-none font-light tracking-tight tabular-nums">{now.getDate()}</div>
          <div className="mt-1 text-xs text-white/45">
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
      <div className={cn("mb-1 px-0.5", LABEL)}>{month}</div>
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
      <Card title={t("widget.timer")}>
        <div className={cn("grid flex-1 content-center gap-1.5", wide && !tall ? "grid-cols-4" : "grid-cols-2", tall && "[&>button]:h-12")}>
          {PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              className={cn("flex h-8 items-baseline justify-center gap-0.5 rounded-full pt-1.5", GLASS_BUTTON)}
              aria-label={t("timer.minutes", { n: m })}
              onClick={() => timer.start(m * 60_000)}
            >
              <span className="text-[13px] font-medium tabular-nums">{m}</span>
              <span className="text-[10px] text-white/45">{t("timer.min")}</span>
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
        <span className="absolute inset-0 grid place-items-center text-lg font-light text-amber-300 tabular-nums">
          <SlidingNumber value={formatDuration(timer.remaining)} />
        </span>
      </div>
      <div className={cn("flex gap-2", !tall && "flex-col")}>
        <button type="button" className={roundButton} onClick={running ? timer.pause : timer.resume} aria-label={running ? t("timer.pause") : t("timer.resume")}>
          {running ? <Pause className="size-3.5" fill="currentColor" /> : <Play className="size-3.5" fill="currentColor" />}
        </button>
        <button type="button" className={roundButton} onClick={timer.reset} aria-label={t("timer.cancel")}>
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
        <span className="text-white/55">{label}</span>
        <span className="truncate font-normal tabular-nums">{detail}</span>
      </div>
      <div
        className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/[0.08]"
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <motion.div
          className={cn("h-full rounded-full bg-gradient-to-r from-white/60 to-white", tone === "good" && "bg-emerald-400", tone === "bad" && "bg-red-400")}
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
    if (b.state === "charging") batteryDetail += ` · ${t("system.charging")}`;
    else if (b.minutesRemaining && b.state === "discharging") batteryDetail += ` · ${formatMinutes(b.minutesRemaining)}`;
  }
  return (
    <Card title={t("widget.system")}>
      <div className="flex flex-1 flex-col justify-center gap-2.5">
        <Meter label={t("system.cpu")} value={stats.cpuPercent} detail={`${Math.round(stats.cpuPercent)}%`} />
        <Meter label={t("system.memory")} value={mem} detail={`${formatBytes(stats.memoryUsed)} / ${formatBytes(stats.memoryTotal)}`} />
        {b && (
          <Meter
            label={t("system.battery")}
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
    <Card title={t("widget.notes")}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("notes.placeholder")}
        aria-label={t("notes.label")}
        spellCheck={false}
        className="flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-white/90 outline-none placeholder:text-white/30"
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

const QUICK_ACTIONS: { id: WidgetAction; label: MessageKey; icon: LucideIcon }[] = [
  { id: "record", label: "actions.record", icon: Video },
  { id: "screenshot", label: "actions.screenshot", icon: Camera },
  { id: "keep-awake", label: "actions.keepAwake", icon: Coffee },
  { id: "do-not-disturb", label: "common.doNotDisturb", icon: Moon },
  { id: "mute", label: "actions.mute", icon: VolumeX },
  { id: "lock", label: "actions.lock", icon: Lock },
  { id: "calculator", label: "actions.calculator", icon: Calculator },
  { id: "downloads", label: "actions.downloads", icon: FolderDown },
];

/** Lit colors for toggles that are on; recording is red, like the system's. */
const ON_STYLE: Partial<Record<WidgetAction, string>> = {
  record: "bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300",
  "do-not-disturb": "bg-violet-400/20 text-violet-300 hover:bg-violet-400/30 hover:text-violet-200",
};

/** An error that clears itself after a moment. */
function useFlashError() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 2500);
    return () => clearTimeout(id);
  }, [error]);
  return [error, setError] as const;
}

/** Failures float over a widget's buttons for a moment instead of a heading. */
function FloatingError({ error }: { error: string | null }) {
  return (
    <AnimatePresence>
      {error && (
        <motion.p
          role="status"
          className="absolute inset-x-3 bottom-2.5 truncate rounded-full bg-black/80 px-3 py-1 text-center text-[11px] text-red-300 ring-1 ring-white/10 backdrop-blur"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
        >
          {error}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

export function QuickActionsWidget({ api, span }: { api: QuickActionsApi } & SpanProps) {
  // The system does not report mute changes, so this is what Islet last set.
  const [muted, setMuted] = useState<boolean | null>(null);
  const [error, setError] = useFlashError();
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
    <Card className="justify-center">
      <div className={cn("grid flex-1 grid-cols-4 place-items-center gap-2", labeled && "auto-rows-fr")}>
        {QUICK_ACTIONS.map((a) => {
          const on: Partial<Record<WidgetAction, boolean>> = {
            "keep-awake": api.keepAwake,
            record: api.recording,
            "do-not-disturb": api.doNotDisturb,
            mute: muted === true,
          };
          const pressed = on[a.id];
          const label = a.id === "record" && api.recording ? t("island.stopRecording") : t(a.label);
          return (
            <button
              key={a.id}
              type="button"
              aria-label={label}
              aria-pressed={a.id === "record" ? undefined : pressed}
              onClick={() => run(a.id)}
              className={cn(
                "flex min-h-0 flex-col items-center justify-center gap-1 text-white/80 hover:text-white",
                GLASS_BUTTON,
                labeled ? "size-full rounded-2xl" : "size-10 rounded-full",
                pressed && (ON_STYLE[a.id] ?? "bg-amber-400/20 text-amber-300 hover:bg-amber-400/30 hover:text-amber-200"),
              )}
            >
              <a.icon className={tall ? "size-5" : "size-[18px]"} strokeWidth={1.75} aria-hidden="true" />
              {labeled && <span className="truncate px-0.5 text-[11px] leading-none font-medium">{label}</span>}
            </button>
          );
        })}
      </div>
      <FloatingError error={error} />
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
  // Only the full-width card has room for volume.
  const large = (span?.cols ?? 1) >= 3;
  // One row per symbol that fits the card.
  const rows = quotes.slice(0, tall ? 7 : 3);
  return (
    <Card title={t("widget.stocks")} className="px-2 pb-2">
      {rows.length === 0 ? (
        <p className="px-1 text-xs text-white/65">{t("stocksWidget.empty")}</p>
      ) : (
        <ul className="flex flex-1 flex-col justify-start divide-y divide-white/[0.05]">
          {rows.map(({ symbol, quote, error }) => {
            const on = pinned.includes(symbol);
            return (
            <li key={symbol} className="group/row flex items-center gap-0.5">
              <button
                type="button"
                title={quote ? t("stocksWidget.openQuote", { name: quote.name }) : (error ?? t("common.loading"))}
                aria-label={
                  quote
                    ? `${symbol} ${formatPrice(quote.price)} ${quote.currency}, ${formatPercent(quote.changePercent)}`
                    : `${symbol}, ${error ?? t("stocksWidget.loading")}`
                }
                onClick={() => onOpen(symbol)}
                className="flex h-[27px] min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left text-[11px] transition-colors outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold">{shortSymbol(symbol)}</span>
                  {wide && quote && <span className="ml-1.5 text-white/40">{quote.name}</span>}
                </span>
                {wide && quote && <Sparkline q={quote} className="w-20 shrink-0" />}
                {large && quote && (
                  <span title={t("stocksWidget.volume")} className="w-11 shrink-0 text-right tabular-nums text-white/65">
                    {quote.volume != null ? formatVolume(quote.volume) : "—"}
                  </span>
                )}
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
                aria-label={t("stocks.showOnIsland", { symbol })}
                disabled={!on && full}
                title={
                  on
                    ? t("stocksWidget.shown")
                    : full
                      ? t("stocks.islandLimit", { n: MAX_ISLAND_STOCKS })
                      : t("stocksWidget.show")
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

export interface MediaApi {
  /** What plays now, or what played last while paused. */
  track: NowPlaying | null;
  playing: boolean;
  onCommand: (command: MediaCommand) => void;
}

const MEDIA_BUTTON =
  "grid size-8 place-items-center rounded-full text-white/85 transition-colors outline-none hover:bg-white/[0.14] hover:text-white active:scale-95 focus-visible:ring-2 focus-visible:ring-white/40 disabled:pointer-events-none disabled:opacity-35";
/** The bigger middle button, filled like a play key. */
const MEDIA_MAIN = "size-10 bg-white text-black hover:bg-white/90 hover:text-black";

export function MediaWidget({ api, span }: { api: MediaApi } & SpanProps) {
  const { track, playing, onCommand } = api;
  if (!track) {
    return (
      <Card title={t("widget.media")}>
        <p className="text-xs text-white/65">{t("media.nothing")}</p>
      </Card>
    );
  }
  const art = isWide(span) || isTall(span) ? 56 : 40;
  const off = !track.controls;
  return (
    <Card className="justify-between gap-2">
      {/* The cover, blown up and blurred, tints the whole tile. */}
      {track.image && (
        <img src={track.image} alt="" aria-hidden="true" className="absolute inset-0 -z-10 size-full scale-150 object-cover opacity-45 blur-2xl saturate-150" />
      )}
      <div className="flex min-w-0 items-center gap-2.5">
        {track.image ? (
          <img src={track.image} alt="" width={art} height={art} className="shrink-0 rounded-lg bg-white/10 object-cover shadow-[0_6px_16px_rgba(0,0,0,0.45)]" style={{ width: art, height: art }} />
        ) : (
          <span className="grid shrink-0 place-items-center rounded-lg bg-white/10" style={{ width: art, height: art }}>
            <Music2 className="size-5 text-white/70" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold" title={track.title}>
            {track.title}
          </p>
          <p className="truncate text-[11px] text-white/55">{track.artist || track.app}</p>
        </div>
      </div>
      {/* A website's player is out of reach on macOS; its tab has the controls. */}
      <div className="flex items-center justify-center gap-3" title={off ? t("island.controlIn", { app: track.app }) : undefined}>
        <button type="button" aria-label={t("media.previous")} disabled={off} className={MEDIA_BUTTON} onClick={() => onCommand("previous")}>
          <SkipBack className="size-4" fill="currentColor" aria-hidden="true" />
        </button>
        <button type="button" aria-label={playing ? t("media.pause") : t("media.play")} disabled={off} className={cn(MEDIA_BUTTON, MEDIA_MAIN)} onClick={() => onCommand("play-pause")}>
          {playing ? (
            <Pause className="size-5" fill="currentColor" aria-hidden="true" />
          ) : (
            <Play className="size-5" fill="currentColor" aria-hidden="true" />
          )}
        </button>
        <button type="button" aria-label={t("media.next")} disabled={off} className={MEDIA_BUTTON} onClick={() => onCommand("next")}>
          <SkipForward className="size-4" fill="currentColor" aria-hidden="true" />
        </button>
      </div>
    </Card>
  );
}

/** wttr.in (WWO) condition codes, grouped into the icons there are. */
export function weatherIcon(code: number): { icon: LucideIcon; color: string; tint: string } {
  if (code === 113) return { icon: Sun, color: "text-amber-300", tint: "251 191 36" };
  if (code === 116) return { icon: CloudSun, color: "text-amber-200", tint: "253 186 116" };
  if (code === 119 || code === 122) return { icon: Cloud, color: "text-white/80", tint: "148 163 184" };
  if ([143, 248, 260].includes(code)) return { icon: CloudFog, color: "text-white/70", tint: "148 163 184" };
  if (code === 200 || (code >= 386 && code <= 395)) return { icon: CloudLightning, color: "text-yellow-300", tint: "167 139 250" };
  if ([179, 182, 185, 227, 230, 281, 284, 311, 314, 317, 320, 323, 326, 329, 332, 335, 338, 350, 362, 365, 368, 371, 374, 377].includes(code))
    return { icon: CloudSnow, color: "text-sky-100", tint: "224 242 254" };
  if ([176, 263, 266, 293, 296, 353].includes(code)) return { icon: CloudDrizzle, color: "text-sky-300", tint: "56 189 248" };
  return { icon: CloudRain, color: "text-sky-400", tint: "14 165 233" };
}

const WEATHER_REFRESH_MS = 15 * 60 * 1000;
const degrees = (c: number) => `${Math.round(c)}°`;

function WeatherWidget({ span }: SpanProps) {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      getWeather()
        .then((w) => {
          if (!live || !w) return;
          setWeather(w);
          setError(null);
        })
        .catch((e) => live && setError(errorMessage(e)));
    load();
    const id = setInterval(load, WEATHER_REFRESH_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  if (!weather) {
    return (
      <Card title={t("widget.weather")}>
        <p className="text-xs text-white/65">{error ?? t("common.loading")}</p>
      </Card>
    );
  }
  const now = weatherIcon(weather.code);
  const today = weather.days[0];
  const wide = isWide(span);
  const tall = isTall(span);
  // Today is already up top.
  const nextDays = weather.days.slice(1);
  return (
    <Card className={cn("gap-3", wide && !tall ? "flex-row" : "flex-col")}>
      {/* The sky's color glows in from the corner. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{ background: `radial-gradient(90% 90% at 100% 0%, rgb(${now.tint} / 0.28), transparent 70%)` }}
      />
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[42px] leading-none font-extralight tracking-tight tabular-nums">{degrees(weather.tempC)}</span>
          <now.icon className={cn("size-6 shrink-0", now.color)} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium" title={weather.description}>
            {weather.description}
          </p>
          <p className="truncate text-[11px] text-white/50">
            {today && `${t("weather.highLow", { high: degrees(today.highC), low: degrees(today.lowC) })} · `}
            {weather.place || t("weather.feels", { temp: degrees(weather.feelsLikeC) })}
          </p>
        </div>
      </div>
      {(wide || tall) && nextDays.length > 0 && (
        <ul className={cn("flex text-[11px] tabular-nums", wide && !tall ? "items-end gap-4" : "justify-between")} aria-label={t("weather.nextDays")}>
          {nextDays.map((d) => {
            const day = weatherIcon(d.code);
            return (
              <li key={d.date} className="flex flex-col items-center gap-1">
                <span className="text-white/50">
                  {/* Noon keeps the date on its own day in every time zone. */}
                  {new Date(`${d.date}T12:00:00`).toLocaleDateString(getLanguage(), { weekday: "short" })}
                </span>
                <day.icon className={cn("size-4", day.color)} aria-hidden="true" />
                <span>
                  {degrees(d.highC)} <span className="text-white/45">{degrees(d.lowC)}</span>
                </span>
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
  media,
}: {
  id: WidgetId;
  span?: WidgetSpan;
  now: Date;
  use24: boolean;
  timer: TimerApi;
  stats: SystemStats;
  actions: QuickActionsApi;
  stocks: StocksApi;
  media: MediaApi;
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
    case "media":
      return <MediaWidget api={media} span={span} />;
    case "weather":
      return <WeatherWidget span={span} />;
    case "controls":
      return <ControlsWidget span={span} />;
  }
}

/** How often the controls re-read the system while the panel is open. */
const CONTROLS_REFRESH_MS = 3000;

/** `short` fits under a small tile. */
const TOGGLES: { id: ControlToggle; key: keyof Controls; label: MessageKey; short?: MessageKey; icon: LucideIcon; on: string }[] = [
  { id: "wifi", key: "wifi", label: "controls.wifi", icon: Wifi, on: "bg-sky-500 text-white hover:bg-sky-400" },
  { id: "bluetooth", key: "bluetooth", label: "controls.bluetooth", icon: Bluetooth, on: "bg-sky-500 text-white hover:bg-sky-400" },
  { id: "airplane", key: "airplane", label: "controls.airplane", short: "controls.airplaneShort", icon: Plane, on: "bg-orange-500 text-white hover:bg-orange-400" },
  { id: "dark-mode", key: "darkMode", label: "controls.darkMode", icon: Contrast, on: "bg-white text-black hover:bg-white/90" },
  { id: "night-light", key: "nightLight", label: "controls.nightLight", icon: Sunset, on: "bg-amber-400 text-black hover:bg-amber-300" },
  { id: "energy-saver", key: "energySaver", label: "controls.energySaver", short: "controls.energySaverShort", icon: Leaf, on: "bg-emerald-500 text-white hover:bg-emerald-400" },
];

const CONTROL_KEYS: Record<ControlChange["control"], keyof Controls> = {
  wifi: "wifi",
  bluetooth: "bluetooth",
  airplane: "airplane",
  "dark-mode": "darkMode",
  "night-light": "nightLight",
  "energy-saver": "energySaver",
  volume: "volume",
  brightness: "brightness",
};

/**
 * The system's controls, re-read every few seconds. Changes show at once and
 * go to the core one at a time, newest per control, so a dragged slider
 * ends where it was let go.
 */
function useControls(onError: (message: string) => void) {
  const [controls, setControls] = useState<Controls | null>(null);
  const pending = useRef(new Map<ControlChange["control"], ControlChange>());
  const sending = useRef(false);

  const load = () => {
    if (sending.current || pending.current.size) return;
    getControls()
      .then((c) => !sending.current && !pending.current.size && setControls(c))
      .catch(() => {});
  };
  useEffect(() => {
    load();
    const id = setInterval(load, CONTROLS_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const send = () => {
    const next = pending.current.values().next().value;
    if (sending.current || !next) return;
    pending.current.delete(next.control);
    sending.current = true;
    setControl(next)
      .then((c) => !pending.current.size && setControls(c))
      .catch((e: unknown) => {
        onError(errorMessage(e));
        pending.current.clear();
        sending.current = false;
        load();
      })
      .finally(() => {
        sending.current = false;
        send();
      });
  };
  const change = (c: ControlChange) => {
    setControls((prev) => prev && { ...prev, [CONTROL_KEYS[c.control]]: c.value });
    pending.current.set(c.control, c);
    send();
  };
  return [controls, change] as const;
}

/** A thick capsule slider with its icon inside, like the system's own. */
function LevelSlider({ label, icon: Icon, value, big, onChange }: { label: string; icon: LucideIcon; value: number; big?: boolean; onChange: (v: number) => void }) {
  return (
    <Slider.Root
      min={0}
      max={1}
      step={0.01}
      value={[value]}
      onValueChange={([v]) => onChange(v)}
      className={cn(
        "relative flex w-full cursor-pointer touch-none items-center rounded-full select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white/40",
        big ? "h-8" : "h-6",
      )}
    >
      <Slider.Track className="relative h-full grow overflow-hidden rounded-full bg-white/[0.08] ring-1 ring-white/[0.06] ring-inset">
        <Slider.Range className="absolute h-full bg-white/90" />
      </Slider.Track>
      {/* The thumb is the fill's edge; it stays for keyboard and screen readers. */}
      <Slider.Thumb aria-label={label} className="block h-full w-0 outline-none" />
      {/* Difference blending keeps the icon visible over the white fill and the dark track. */}
      <Icon
        className={cn("pointer-events-none absolute text-white mix-blend-difference", big ? "left-3 size-4" : "left-2 size-3.5")}
        strokeWidth={2}
        aria-hidden="true"
      />
    </Slider.Root>
  );
}

type ToggleDef = (typeof TOGGLES)[number];

/**
 * A switch: a square icon tile, the same with its name below, or a pill with
 * its name and state, depending on the room.
 */
function ToggleTile({
  def,
  on,
  state,
  look,
  size = "size-10",
  onClick,
}: {
  def: ToggleDef;
  on: boolean;
  state: string;
  look: "icon" | "named" | "pill";
  /** The round button's size, for `icon` and `named`. */
  size?: string;
  onClick: () => void;
}) {
  if (look === "named") {
    return (
      <div className="flex min-w-0 flex-col items-center gap-1">
        <button
          type="button"
          aria-label={t(def.label)}
          aria-pressed={on}
          title={`${t(def.label)}: ${state}`}
          onClick={onClick}
          className={cn("grid shrink-0 place-items-center rounded-full text-white/75 hover:text-white", size, GLASS_BUTTON, on && def.on)}
        >
          <def.icon className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
        </button>
        <span className="w-full truncate text-center text-[10px] leading-tight text-white/55">{t(def.short ?? def.label)}</span>
      </div>
    );
  }
  if (look === "icon") {
    return (
      <button
        type="button"
        aria-label={t(def.label)}
        aria-pressed={on}
        title={`${t(def.label)}: ${state}`}
        onClick={onClick}
        className={cn("grid shrink-0 place-items-center justify-self-center rounded-full text-white/75 hover:text-white", size, GLASS_BUTTON, on && def.on)}
      >
        <def.icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-label={t(def.label)}
      aria-pressed={on}
      onClick={onClick}
      className={cn("flex min-w-0 items-center gap-2 rounded-2xl p-1.5 pr-2.5 text-left", GLASS_BUTTON)}
    >
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-full bg-white/[0.08] text-white/75", on && def.on)}>
        <def.icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12px] leading-tight font-medium text-white/90">{t(def.label)}</span>
        <span className="block truncate text-[10px] leading-tight text-white/45">{state}</span>
      </span>
    </button>
  );
}

/** Wi-Fi, Bluetooth and the other system switches, plus volume and brightness. */
export function ControlsWidget({ span }: SpanProps) {
  const [error, setError] = useFlashError();
  const [controls, change] = useControls(setError);
  const tall = isTall(span);
  const wide = isWide(span);

  if (!controls) {
    return (
      <Card>
        <p className="text-xs text-white/65">Loading…</p>
      </Card>
    );
  }
  const toggles = TOGGLES.filter((def) => controls[def.key] !== null).map((def) => {
    const on = controls[def.key] === true;
    const state = def.id === "wifi" && on && controls.wifiName ? controls.wifiName : on ? t("common.on") : t("common.off");
    return { def, on, state };
  });
  const tiles = (look: "icon" | "named" | "pill", size?: string) =>
    toggles.map(({ def, on, state }) => (
      <ToggleTile key={def.id} def={def} on={on} state={state} look={look} size={size} onClick={() => change({ control: def.id, value: !on })} />
    ));
  const volume = controls.volume;
  const brightness = controls.brightness;
  const sliders = (big: boolean) =>
    (volume !== null || brightness !== null) && (
      <div className={cn("flex flex-col justify-center", big ? "gap-2.5" : "gap-1.5")}>
        {volume !== null && (
          <LevelSlider
            label={t("controls.volume")}
            icon={controls.muted || volume === 0 ? VolumeX : Volume2}
            value={volume}
            big={big}
            onChange={(v) => change({ control: "volume", value: v })}
          />
        )}
        {brightness !== null && (
          <LevelSlider label={t("controls.brightness")} icon={Sun} value={brightness} big={big} onChange={(v) => change({ control: "brightness", value: v })} />
        )}
      </div>
    );

  return (
    <Card className={tall ? "justify-center gap-4" : "gap-2.5"}>
      {tall && wide ? (
        // Big: pills with names and state, sliders below, kept together in the middle.
        <>
          <div className="grid grid-cols-3 gap-2">{tiles("pill")}</div>
          {sliders(true)}
        </>
      ) : tall ? (
        // Narrow and tall: named tiles in threes, sliders below.
        <>
          <div className="grid grid-cols-3 gap-x-2 gap-y-2.5">{tiles("named", "size-11")}</div>
          {sliders(true)}
        </>
      ) : wide ? (
        // Short and wide: icon tiles on the left, sliders on the right.
        <div className="flex flex-1 gap-3">
          <div className="grid flex-1 grid-cols-3 content-center gap-2">{tiles("icon", "size-10")}</div>
          <div className="flex flex-1 flex-col justify-center">{sliders(true)}</div>
        </div>
      ) : (
        <>
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${toggles.length}, minmax(0, 1fr))` }}>
            {/* Five fit across a single-column tile at this size. */}
            {tiles("icon", "size-[30px]")}
          </div>
          <div className="mt-auto">{sliders(false)}</div>
        </>
      )}
      <FloatingError error={error} />
    </Card>
  );
}
