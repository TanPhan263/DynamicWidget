import { Bell, BellRing, Inbox, LayoutGrid, Mic, Moon, Music2, Pause, Settings, SkipBack, SkipForward, Timer, Video, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { clockParts, formatDuration, formatPercent, formatPrice, relativeTime, shortSymbol } from "../shared/format";
import type {
  BatteryInfo,
  IslandNotification,
  MediaCommand,
  NowPlaying,
  Quote,
  Settings as SettingsData,
  SystemStats,
  WidgetId,
  WidgetSpan,
} from "../shared/types";
import { ISLAND_SPRING, PADDING, WING, type Shape } from "./geometry";
import type { Tab } from "./islandState";
import { MusicBars } from "./MusicBars";
import { NotificationIcon } from "./NotificationIcon";
import { SlidingNumber } from "./SlidingNumber";
import type { TimerApi } from "./useTimer";
import { WidgetGrid } from "./WidgetGrid";
import { changeTone, TILE, Widget, type MediaApi, type QuickActionsApi, type StocksApi } from "./widgets/Widgets";

const iconButton =
  "grid size-7 shrink-0 place-items-center rounded-full text-white/60 transition-colors outline-none hover:bg-white/[0.10] hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 active:scale-95";

function BatteryGlyph({ b }: { b: BatteryInfo }) {
  const charging = b.state === "charging";
  const low = b.percent <= 20 && !charging;
  return (
    <span className={cn("inline-flex items-center gap-1.5", charging && "text-emerald-400", low && "text-red-400")}>
      {Math.round(b.percent)}%
      <span className="relative h-2.5 w-5 rounded-[3px] border-[1.5px] border-current p-px opacity-90" aria-hidden="true">
        <span className="block h-full rounded-[1px] bg-current" style={{ width: `${b.percent}%` }} />
        <span className="absolute top-1/2 -right-[3.5px] h-1 w-[1.5px] -translate-y-1/2 rounded-r-sm bg-current" />
      </span>
    </span>
  );
}

/** Slides content in from the side it sits on. */
function Side({ children, from }: { children: ReactNode; from: "left" | "right" }) {
  return (
    <motion.span
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
      initial={{ opacity: 0, x: from === "left" ? -6 : 6, filter: "blur(4px)" }}
      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      {children}
    </motion.span>
  );
}

interface CompactProps {
  shape: Shape;
  wings: boolean;
  /** When the running screen recording started, in Unix milliseconds. */
  recordingSince: number | null;
  onStopRecording: () => void;
  /** The quote pinned to the island, if any. */
  pinned: Quote | null;
  /** While sound plays: what plays if known; `bars` is false when the bars sit below the island. */
  music: {
    colors: [string, string];
    flipped: boolean;
    bars: boolean;
    nowPlaying: NowPlaying | null;
    showTitle: boolean;
    onCommand: (command: MediaCommand) => void;
    /** The pointer is over the buttons, so hovering must not open the panel. */
    onControlsHover: (over: boolean) => void;
  } | null;
  timer: TimerApi;
  unread: number;
  now: Date;
  settings: SettingsData;
  stats: SystemStats;
}

/**
 * The resting island. Over a notch only the wings can show anything (the
 * notch itself has no pixels). Elsewhere activities fill the pill, and some
 * styles show a clock and battery when idle; the Dynamic Island stays empty.
 */
export function Compact({ shape, wings, recordingSince, onStopRecording, pinned, music, timer, unread, now, settings, stats }: CompactProps) {
  let kind = "idle";
  let left: ReactNode = null;
  let right: ReactNode = null;
  let middle: ReactNode = null;
  if (recordingSince !== null) {
    kind = "recording";
    left = (
      <button
        type="button"
        aria-label="Stop recording"
        title="Stop recording"
        className="grid size-5 place-items-center rounded-full outline-none hover:bg-white/[0.14] focus-visible:ring-2 focus-visible:ring-white/40"
        onClick={(e) => {
          e.stopPropagation();
          onStopRecording();
        }}
      >
        <motion.span
          className="size-2.5 rounded-full bg-red-500"
          animate={{ opacity: [1, 0.35, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
      </button>
    );
    right = (
      <span className="text-red-400">
        {/* Elapsed time counts whole seconds up, unlike the timer's countdown. */}
        <SlidingNumber value={formatDuration(Math.floor(Math.max(0, now.getTime() - recordingSince) / 1000) * 1000)} />
      </span>
    );
  } else if (timer.state.status !== "idle") {
    kind = "timer";
    const paused = timer.state.status === "paused";
    left = <Timer className={cn("size-4 text-amber-400", paused && "opacity-50")} aria-hidden="true" />;
    right = (
      <span className={cn("text-amber-400", paused && "opacity-50")}>
        <SlidingNumber value={formatDuration(timer.remaining)} />
      </span>
    );
  } else if (unread > 0) {
    kind = "unread";
    left = <BellRing className="size-4" aria-hidden="true" />;
    right = (
      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white px-1.5 text-[11px] font-semibold text-black">
        {unread > 99 ? "99+" : unread}
      </span>
    );
  } else if (music) {
    kind = "playing";
    const image = music.nowPlaying?.image;
    left = image ? (
      <img src={image} alt="" width={18} height={18} className="size-[18px] rounded-[5px] bg-white object-contain p-px" />
    ) : (
      <Music2 className="size-4" style={{ color: music.colors[1] }} aria-hidden="true" />
    );
    right = music.bars ? <MusicBars count={4} height={14} colors={music.colors} flipped={music.flipped} /> : null;
    const np = music.nowPlaying;
    if (music.showTitle && np) {
      const button = (label: string, command: MediaCommand, icon: ReactNode) => (
        <button
          type="button"
          aria-label={label}
          disabled={!np.controls}
          className="grid size-5 place-items-center rounded-full text-white/85 outline-none hover:bg-white/[0.16] hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 active:scale-90 disabled:pointer-events-none disabled:opacity-35"
          onClick={(e) => {
            // The island itself opens the panel on click.
            e.stopPropagation();
            music.onCommand(command);
          }}
        >
          {icon}
        </button>
      );
      middle = (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <motion.span
            key={np.title}
            className="min-w-0 flex-1 truncate text-center font-medium"
            title={np.artist ? `${np.title} · ${np.artist}` : np.title}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={ISLAND_SPRING}
          >
            {np.title}
            {np.artist && <span className="text-white/70"> · {np.artist}</span>}
          </motion.span>
          {/* Shown even when the player can't be controlled (a website on macOS), greyed out. */}
          <div
            className="flex shrink-0 items-center gap-0.5"
            title={np.controls ? undefined : `Control it in ${np.app}`}
            onPointerEnter={() => music.onControlsHover(true)}
            onPointerLeave={() => music.onControlsHover(false)}
          >
            {button("Previous track", "previous", <SkipBack className="size-3" fill="currentColor" aria-hidden="true" />)}
            {button("Pause", "play-pause", <Pause className="size-3.5" fill="currentColor" aria-hidden="true" />)}
            {button("Next track", "next", <SkipForward className="size-3" fill="currentColor" aria-hidden="true" />)}
          </div>
        </div>
      );
    }
  } else if (pinned) {
    kind = `stock-${pinned.symbol}`;
    // Beside a notch the wings are narrow, so the price is left out.
    left = (
      <span className="tabular-nums">
        {shortSymbol(pinned.symbol)}
        {!shape.hugsNotch && <SlidingNumber value={formatPrice(pinned.price)} className="ml-1.5 font-medium text-white/85" />}
      </span>
    );
    right = (
      <span className={cn("tabular-nums", changeTone(pinned))}>
        {pinned.change > 0 ? "▲" : pinned.change < 0 ? "▼" : ""}
        {formatPercent(pinned.changePercent).replace(/^[+\u2212]/, "")}
      </span>
    );
  } else if (shape.idleInfo) {
    const { time, period } = clockParts(now, settings.use24HourClock);
    left = (
      <span className="tabular-nums">
        {time}
        {period && <span className="ml-0.5 text-[10px] text-white/70">{period}</span>}
      </span>
    );
    right = stats.battery ? <BatteryGlyph b={stats.battery} /> : null;
  }

  // Green for the camera, orange for the microphone, as phones show them.
  const camera = stats.cameraInUse;
  const microphone = stats.microphoneInUse;
  if (camera || microphone) {
    if (kind === "idle" && !left) {
      kind = "privacy";
      left = camera ? <Video className="size-4 text-green-500" aria-hidden="true" /> : <Mic className="size-4 text-orange-400" aria-hidden="true" />;
    }
    right = (
      <>
        {right}
        <span className="flex items-center gap-1" role="status" aria-label={[camera && "Camera in use", microphone && "Microphone in use"].filter(Boolean).join(", ")}>
          {camera && <span className="size-1.5 rounded-full bg-green-500" title="Camera in use" />}
          {microphone && <span className="size-1.5 rounded-full bg-orange-400" title="Microphone in use" />}
        </span>
      </>
    );
  }

  const leftNode = left && (
    <Side key={`l-${kind}`} from="left">
      {left}
    </Side>
  );
  const rightNode = right && (
    <Side key={`r-${kind}`} from="right">
      {right}
    </Side>
  );

  return (
    <div className="flex items-center text-xs font-semibold" style={{ height: shape.compactHeight }}>
      {shape.hugsNotch ? (
        <>
          <motion.div
            className="flex items-center justify-start overflow-hidden pl-3.5"
            initial={false}
            animate={{ width: wings ? WING : 0 }}
            transition={ISLAND_SPRING}
          >
            <AnimatePresence initial={false}>{wings && leftNode}</AnimatePresence>
          </motion.div>
          <div className="shrink-0" style={{ width: shape.compactWidth }} />
          <motion.div
            className="flex items-center justify-end overflow-hidden pr-3.5"
            initial={false}
            animate={{ width: wings ? WING : 0 }}
            transition={ISLAND_SPRING}
          >
            <AnimatePresence initial={false}>{wings && rightNode}</AnimatePresence>
          </motion.div>
        </>
      ) : (
        <div className="flex w-full items-center justify-between gap-3 px-3.5">
          <AnimatePresence initial={false} mode="wait">
            {leftNode}
          </AnimatePresence>
          {middle}
          <AnimatePresence initial={false} mode="wait">
            {rightNode}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

interface PeekProps {
  n: IslandNotification;
  topInset: number;
  now: number;
  onDismiss: () => void;
}

/** Pages on this computer are named by their host ("localhost"), which says nothing; leave it out. */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;

export function Peek({ n, topInset, now, onDismiss }: PeekProps) {
  return (
    <div className="flex h-full items-center gap-3 pr-3 pl-4" style={{ paddingTop: topInset }}>
      <NotificationIcon n={n} size={38} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 text-[11px]">
          {!LOCAL_HOST.test(n.app) && <span className="font-medium text-white/60">{n.app}</span>}
          <span className="text-white/35">{relativeTime(n.createdAt, now)}</span>
        </div>
        <div className="truncate text-[13px] font-semibold tracking-tight">{n.title}</div>
        {n.body && <div className="truncate text-xs text-white/60">{n.body}</div>}
      </div>
      <button
        type="button"
        className={iconButton}
        aria-label="Dismiss"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

interface ExpandedProps {
  topInset: number;
  tab: Tab;
  onTab: (t: Tab) => void;
  settings: SettingsData;
  notifications: IslandNotification[];
  stats: SystemStats;
  timer: TimerApi;
  now: Date;
  onToggleDnd: () => void;
  onSettings: () => void;
  onDismiss: (id: number) => void;
  onClearAll: () => void;
  onReorder: (widgets: WidgetId[]) => void;
  onResize: (id: WidgetId, span: WidgetSpan, done: boolean) => void;
  onDragging: (dragging: boolean) => void;
  appFor: (id: WidgetId) => string | null;
  onOpenApp: (id: WidgetId) => void;
  actions: QuickActionsApi;
  stocks: StocksApi;
  media: MediaApi;
  /** The panel's background (CSS), from the theme; seen through the tiles. */
  backdrop: string;
  /** The widgets are taller than the screen allows, so they scroll. */
  scroll: boolean;
}

const TABS: { id: Tab; label: string; icon: typeof Bell }[] = [
  { id: "widgets", label: "Widgets", icon: LayoutGrid },
  { id: "notifications", label: "Notifications", icon: Bell },
];

export function Expanded(p: ExpandedProps) {
  const count = p.notifications.length;
  return (
    <div className="relative isolate flex h-full flex-col gap-2.5 p-3.5" style={{ paddingTop: p.topInset + PADDING }}>
      {/* Panel backdrop, seen through the tiles. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={{ background: p.backdrop }} />
      <header className="flex h-[30px] shrink-0 items-center justify-between">
        <div className="flex gap-0.5 rounded-full bg-white/[0.06] p-0.5 ring-1 ring-white/[0.06] ring-inset" role="tablist">
          {TABS.map((t) => {
            const active = p.tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => p.onTab(t.id)}
                className={cn(
                  "relative inline-flex h-[26px] items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                  active ? "text-white" : "text-white/50 hover:text-white/80",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="island-tab"
                    className="absolute inset-0 rounded-full bg-white/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_1px_4px_rgba(0,0,0,0.3)]"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                )}
                <span className="relative">{t.label}</span>
                {t.id === "notifications" && count > 0 && (
                  <span className="relative grid h-4 min-w-4 place-items-center rounded-full bg-white/90 px-1 text-[10px] font-semibold text-black tabular-nums">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            className={cn(iconButton, p.settings.doNotDisturb && "bg-violet-400/20 text-violet-300 hover:bg-violet-400/30 hover:text-violet-200")}
            aria-pressed={p.settings.doNotDisturb}
            aria-label="Do Not Disturb"
            title={p.settings.doNotDisturb ? "Do Not Disturb is on" : "Do Not Disturb"}
            onClick={p.onToggleDnd}
          >
            <Moon className="size-3.5" fill={p.settings.doNotDisturb ? "currentColor" : "none"} />
          </button>
          <button type="button" className={iconButton} aria-label="Settings" title="Settings" onClick={p.onSettings}>
            <Settings className="size-3.5" />
          </button>
        </div>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={p.tab}
          className="flex min-h-0 flex-1 flex-col"
          initial={{ opacity: 0, x: p.tab === "notifications" ? 12 : -12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ type: "spring", stiffness: 420, damping: 36 }}
        >
          {p.tab === "widgets" ? (
            p.settings.widgets.length > 0 ? (
              <WidgetGrid
                widgets={p.settings.widgets}
                sizes={p.settings.widgetSizes}
                onReorder={p.onReorder}
                onResize={p.onResize}
                onDragging={p.onDragging}
                appFor={p.appFor}
                onOpen={p.onOpenApp}
                scroll={p.scroll}
                render={(id, span) => (
                  <Widget id={id} span={span} now={p.now} use24={p.settings.use24HourClock} timer={p.timer} stats={p.stats}
                    actions={p.actions}
                    stocks={p.stocks}
                    media={p.media}
                  />
                )}
              />
            ) : (
              <Empty icon={LayoutGrid} title="No widgets">
                <button type="button" className="h-7 rounded-full bg-white px-3.5 text-xs font-medium text-black hover:bg-white/90" onClick={p.onSettings}>
                  Choose widgets
                </button>
              </Empty>
            )
          ) : (
            <NotificationList
              notifications={p.notifications}
              now={p.now.getTime()}
              onDismiss={p.onDismiss}
              onClearAll={p.onClearAll}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Empty({ icon: Icon, title, children }: { icon: typeof Bell; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <span className={cn("grid size-12 place-items-center rounded-2xl", TILE)}>
        <Icon className="size-5 text-white/70" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <div className="mt-1 text-sm font-medium tracking-tight">{title}</div>
      {children}
    </div>
  );
}

function NotificationList({
  notifications,
  now,
  onDismiss,
  onClearAll,
}: {
  notifications: IslandNotification[];
  now: number;
  onDismiss: (id: number) => void;
  onClearAll: () => void;
}) {
  if (notifications.length === 0) {
    return (
      <Empty icon={Inbox} title="No notifications" />
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <ul className="thin-scroll flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        <AnimatePresence initial={false}>
          {notifications.map((n) => (
            <motion.li
              key={n.id}
              layout
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
              className={cn("flex items-start gap-3 p-3", TILE)}
            >
              <NotificationIcon n={n} size={34} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5 text-[11px]">
                  {!LOCAL_HOST.test(n.app) && <span className="font-medium text-white/60">{n.app}</span>}
                  <span className="text-white/35">{relativeTime(n.createdAt, now)}</span>
                </div>
                <div className="truncate text-[13px] font-semibold tracking-tight">{n.title}</div>
                {n.body && <div className="line-clamp-2 text-xs text-white/60">{n.body}</div>}
              </div>
              <button type="button" className={cn(iconButton, "size-6")} aria-label={`Dismiss ${n.title}`} onClick={() => onDismiss(n.id)}>
                <X className="size-3" />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <button
        type="button"
        className="self-end rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-white/60 ring-1 ring-white/[0.06] transition-colors ring-inset hover:bg-white/[0.12] hover:text-white"
        onClick={onClearAll}
      >
        Clear all
      </button>
    </div>
  );
}
