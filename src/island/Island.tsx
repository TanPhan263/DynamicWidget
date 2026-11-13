import { AnimatePresence, motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  clearNotifications,
  dismissNotification,
  getSnapshot,
  mediaControl,
  openSettings,
  openStockPage,
  openWidgetApp,
  runQuickAction,
  saveSettings,
  releaseFocus,
  setDoNotDisturb,
  setIslandRect,
  setUiLanguage,
} from "../shared/commands";
import { listenAll } from "../shared/events";
import { MAX_ISLAND_STOCKS, PANEL_SIZE_RANGE, widgetAppName, type IslandStat, type Settings, type UiSnapshot, type WidgetId, type WidgetSpan } from "../shared/types";
import {
  contentShape,
  expandedHeight,
  ISLAND_CLOSE_SPRING,
  ISLAND_SPRING,
  islandScale,
  fitSides,
  islandBox,
  shapeFor,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
  widgetRows,
  type View,
} from "./geometry";
import { initialState, reduce, viewOf } from "./islandState";
import { useTimer } from "./useTimer";
import { useBackgroundImages, useWidgetImages } from "../shared/background";
import { themeLook } from "../shared/themes";
import { useAmbient } from "./ambient";
import { MusicBars } from "./MusicBars";
import { useWeather } from "./widgets/Widgets";
import { Compact, Expanded, Peek } from "./views";
import { resolveLanguage, setLanguage, useLanguage } from "../shared/i18n";
import type { WidgetAction } from "./widgets/Widgets";

/** Hover must last this long before the panel opens, so crossing the island on the way to the menu bar does nothing. */
const HOVER_IN_MS = 120;
/** And the pointer may leave this long before it closes. */
const HOVER_OUT_MS = 280;
/** How long each pinned stock stays on the closed island. */
const STOCK_TURN_MS = 4000;
/** Radius of the notch style's flared top corners, closed and open. */
const EAR = 8;
const EAR_BIG = 14;
const CLOSES_PANEL = new Set<WidgetAction>(["screenshot", "lock", "calculator", "downloads", "record"]);

/**
 * The current time, changed once a minute (every second with `seconds`).
 * Keeping the same Date between changes lets React skip redrawing the island.
 */
function useNow(seconds: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNow((prev) => (seconds || Math.floor(d.getTime() / 60_000) !== Math.floor(prev.getTime() / 60_000) ? d : prev));
    }, 1000);
    return () => clearInterval(id);
  }, [seconds]);
  return now;
}

/**
 * One view's content, laid out at its own size and scaled to the island's
 * live width. It fits the shell at every moment of a morph, however often
 * the morph is interrupted, so the island never shows content sticking out
 * of it or an empty black shape.
 */
function ViewLayer({
  width,
  height,
  shellWidth,
  children,
}: {
  width: number;
  height: number;
  shellWidth: MotionValue<number>;
  children: ReactNode;
}) {
  const scale = useTransform(shellWidth, (w) => (w > 0 ? Math.min(1.5, Math.max(0.15, w / width)) : 1));
  return (
    <motion.div
      // Centered with a negative margin rather than a transform, for the
      // same reason as the island itself.
      className="absolute top-0 left-1/2"
      style={{ width, height, marginLeft: -width / 2, scale, transformOrigin: "50% 0%" }}
      initial={{ opacity: 0, filter: "blur(6px)" }}
      // No filter is left at rest: one would stop the island icons' frosted blur from reaching the background.
      animate={{ opacity: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
      exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.2, ease: "easeIn" } }}
      transition={{ duration: 0.16 }}
    >
      {children}
    </motion.div>
  );
}

/** The island window's height, which the open panel may grow to. */
function useViewportHeight(): number {
  const read = () => window.innerHeight || WINDOW_HEIGHT;
  const [height, setHeight] = useState(read);
  useEffect(() => {
    const onResize = () => setHeight(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return height;
}

export function Island() {
  const [snap, setSnap] = useState<UiSnapshot | null>(null);
  const [state, dispatch] = useReducer(reduce, initialState);
  const timer = useTimer();
  // Only the screen recording's elapsed time shows seconds.
  const now = useNow(snap?.recordingSince != null);

  // Event handlers read the latest settings through a ref so the
  // subscription is made once.
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Hovering the island's media buttons must not open the panel under them.
  const islandHovered = useRef(false);
  const overControls = useRef(false);
  const scheduleHover = (hover: boolean) => {
    clearTimeout(hoverTimer.current);
    const trigger = snapRef.current?.settings.expandTrigger ?? "hover";
    hoverTimer.current = setTimeout(
      () => {
        if (hover && overControls.current) return;
        dispatch({ type: "hover", hover, trigger });
      },
      hover ? HOVER_IN_MS : HOVER_OUT_MS,
    );
  };

  useEffect(() => {
    getSnapshot().then(setSnap).catch(() => {});
    const patch = (p: Partial<UiSnapshot>) => setSnap((s) => (s ? { ...s, ...p } : s));
    return listenAll({
      notification: (notification) => {
        const s = snapRef.current?.settings;
        dispatch({
          type: "notify",
          notification,
          doNotDisturb: s?.doNotDisturb ?? false,
          trigger: s?.expandTrigger ?? "hover",
        });
      },
      "notifications-changed": (notifications) => patch({ notifications }),
      "settings-changed": (settings) => patch({ settings }),
      "system-stats": (stats) => patch({ stats }),
      "quotes-changed": (quotes) => patch({ quotes }),
      "island-layout": (layout) => patch({ layout }),
      "state-changed": () => {
        getSnapshot().then(setSnap).catch(() => {});
      },
      "island-toggle": () => dispatch({ type: "toggle" }),
      "island-hover": (hover) => {
        islandHovered.current = hover;
        scheduleHover(hover);
      },
    });
  }, []);

  const settings = snap?.settings;
  // The island speaks the chosen language and tells the core, which writes
  // the tray menu and system notifications.
  const language = useLanguage();
  useEffect(() => setLanguage(resolveLanguage(settings?.language)), [settings?.language]);
  useEffect(() => {
    if (snap) setUiLanguage(language).catch(() => {});
  }, [language, !!snap]);
  const trigger = settings?.expandTrigger ?? "hover";
  const view: View = viewOf(state, trigger);

  // A notification peeks for the configured time, longer while hovered.
  const peekId = state.peek?.id;
  const peekSeconds = settings?.notificationSeconds ?? 5;
  useEffect(() => {
    if (peekId === undefined || state.hover) return;
    const id = setTimeout(() => dispatch({ type: "peek-done" }), peekSeconds * 1000);
    return () => clearTimeout(id);
  }, [peekId, peekSeconds, state.hover]);

  // Esc and clicking elsewhere close a pinned panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "close" });
    };
    const onBlur = () => dispatch({ type: "close" });
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Closing the panel while it has keyboard focus hands focus back to the
  // app the user was in.
  const prevView = useRef<View>(view);
  useEffect(() => {
    if (prevView.current === "expanded" && view !== "expanded" && document.hasFocus()) {
      releaseFocus().catch(() => {});
    }
    prevView.current = view;
  }, [view]);

  const layout = snap?.layout;
  const shape = layout ? shapeFor(layout, settings?.islandStyle ?? "notch") : null;
  const recordingSince = snap?.recordingSince ?? null;
  // The closed island takes turns showing the stocks pinned to it.
  const pinnedQuotes = (settings?.islandStocks ?? []).flatMap((s) => snap?.quotes.find((q) => q.symbol === s)?.quote ?? []);
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    if (pinnedQuotes.length < 2) return;
    const id = setInterval(() => setTurn((t) => t + 1), STOCK_TURN_MS);
    return () => clearInterval(id);
  }, [pinnedQuotes.length]);
  const pinned = pinnedQuotes.length > 0 ? pinnedQuotes[turn % pinnedQuotes.length] : null;
  // Music bars while sound plays: in the wings, or under the island.
  const bars = settings?.musicBars;
  const nowPlaying = snap?.stats.nowPlaying ?? null;
  // The widget keeps the last track after a pause, so it can be resumed.
  const [recentTrack, setRecentTrack] = useState(nowPlaying);
  useEffect(() => {
    if (nowPlaying) setRecentTrack(nowPlaying);
  }, [nowPlaying]);
  // The open panel glows in the color of the cover.
  const ambient = useAmbient((nowPlaying ?? recentTrack)?.image);
  const look = themeLook(settings?.theme);
  const pictures = useBackgroundImages();
  const widgetPictures = useWidgetImages();
  const islandPicture = pictures.island ?? pictures.panel;
  const pictureSize = useImageSize(islandPicture);
  const playing = !!bars?.enabled && ((snap?.stats.audioPlaying ?? false) || nowPlaying !== null);
  const barsInside = playing && bars?.position === "inside";
  const barsBelow = playing && bars?.position === "below";
  // The title always sits inside the island; only the bars may go below it.
  // Beside the notch there is no middle, so there the title only peeks.
  const titlePinned =
    (barsInside || barsBelow) &&
    !!bars?.showTitle &&
    nowPlaying !== null &&
    !!shape &&
    !shape.hugsNotch &&
    recordingSince === null &&
    timer.state.status === "idle" &&
    state.unread === 0;
  // Island icons take the slot nothing more important uses.
  const iconsFree =
    recordingSince === null && timer.state.status === "idle" && state.unread === 0 && !barsInside && !titlePinned && pinned === null;
  const shown = (list: IslandStat[] = []) => (iconsFree ? list : []);
  const placedSides = { left: shown(settings?.islandIcons.left), right: shown(settings?.islandIcons.right) };
  // Beside a notch they keep to the usual wings; a pill without one has room for them all.
  const gauges = shape?.hugsNotch ? fitSides(placedSides) : placedSides;
  const placed = settings?.islandIcons;
  const { weather } = useWeather(!!placed && [...placed.left, ...placed.right].includes("weather"));
  const wings =
    recordingSince !== null ||
    timer.state.status !== "idle" ||
    state.unread > 0 ||
    barsInside ||
    pinned !== null ||
    (!!shape?.hugsNotch && gauges.left.length + gauges.right.length > 0) ||
    !!snap?.stats.cameraInUse ||
    !!snap?.stats.microphoneInUse;

  // Over a notch there is no room for the title, so a new track peeks once.
  const track = nowPlaying ? `${nowPlaying.app}\n${nowPlaying.title}` : null;
  const lastTrack = useRef<string | null>(null);
  useEffect(() => {
    const s = snapRef.current?.settings;
    if (track && track !== lastTrack.current && nowPlaying && s?.musicBars.showTitle && shape?.hugsNotch) {
      dispatch({
        type: "media",
        notification: {
          // Negative ids are never in the core's history.
          id: -Date.now(),
          title: nowPlaying.title,
          body: nowPlaying.artist,
          app: nowPlaying.app,
          icon: null,
          image: nowPlaying.image,
          symbol: "music",
          accent: null,
          source: "browser",
          createdAt: Date.now(),
        },
        doNotDisturb: s.doNotDisturb,
        trigger: s.expandTrigger,
      });
    }
    lastTrack.current = track;
    // Only a new track peeks; the rest is read when it changes.
  }, [track]);
  // While a corner is being dragged the grid (and panel height) follow the
  // size under the pointer; it is saved on release.
  const [sizePreview, setSizePreview] = useState<{ id: WidgetId; span: WidgetSpan } | null>(null);
  const widgetSizes = sizePreview
    ? { ...settings?.widgetSizes, [sizePreview.id]: sizePreview.span }
    : (settings?.widgetSizes ?? {});
  const rows = widgetRows((settings?.widgets ?? []).map((id) => widgetSizes[id]));
  // The open panel and the closed island have their own sizes.
  const scale =
    view === "expanded"
      ? islandScale(settings?.panelSize ?? 100, PANEL_SIZE_RANGE)
      : islandScale(settings?.islandSize ?? 100);
  // The window's real height: macOS may keep it a menu bar short of the display.
  const screenHeight = useViewportHeight();
  // Rows past the bottom of the screen scroll inside the panel.
  const panelScrolls = !!shape && expandedHeight(shape, rows, scale) > expandedHeight(shape, rows, scale, screenHeight);
  const box = shape
    ? islandBox(shape, view, {
        wings,
        rows,
        scale,
        title: titlePinned,
        controls: titlePinned,
        screenHeight,
        // Camera and microphone dots join the icons, so then the usual width stays.
        icons: snap?.stats.cameraInUse || snap?.stats.microphoneInUse ? undefined : gauges,
      })
    : null;
  const inner = shape ? contentShape(shape, scale) : null;
  // A closed notch island with a picture: the picture runs on into the ears, so both place it
  // in pixels, covering the shell and its ears together, instead of each covering its own box.
  // `dx` is the element's left edge relative to the left ear's.
  const ear = (view !== "compact" ? EAR_BIG : EAR) * scale;
  const pictureAt =
    shape?.attached && box && view !== "expanded" && settings?.theme === "picture" && islandPicture && pictureSize
      ? (dx: number) => {
          const wide = box.width + 2 * ear;
          const s = Math.max(wide / pictureSize.width, box.height / pictureSize.height);
          const w = pictureSize.width * s;
          const h = pictureSize.height * s;
          return look.island(islandPicture, `${(wide - w) / 2 - dx}px ${(box.height - h) / 2}px / ${w}px ${h}px no-repeat`);
        }
      : null;
  const earStyle = (side: "left" | "right") => {
    const corner = `circle farthest-side at ${side === "left" ? 0 : 100}% 100%`;
    if (!pictureAt) return { background: `radial-gradient(${corner}, transparent 96%, #000 100%)` };
    const mask = `radial-gradient(${corner}, transparent 96%, #000 100%)`;
    return { background: pictureAt(side === "left" ? 0 : box!.width + ear), maskImage: mask, WebkitMaskImage: mask };
  };

  // Tell the core where the island is, so only that area takes clicks.
  // While a widget is being dragged the whole window keeps the pointer, so
  // the drag survives the pointer leaving the panel.
  const [dragging, setDragging] = useState(false);
  // The shell's live width as it springs; each view scales to it.
  const shellWidth = useMotionValue(0);

  const rectKey = dragging
    ? [0, 0, WINDOW_WIDTH, screenHeight].join(",")
    : box
      ? [box.x, box.y, box.width, box.height].join(",")
      : "";
  useEffect(() => {
    if (!rectKey) return;
    const [x, y, width, height] = rectKey.split(",").map(Number);
    setIslandRect({ x, y, width, height }).catch(() => {});
  }, [rectKey]);

  // Widget order and sizes changed from the island are saved right away.
  const saveWidgets = useCallback((patch: Partial<Pick<Settings, "widgets" | "widgetSizes" | "islandStocks">>) => {
    const current = snapRef.current;
    if (!current) return;
    const settings = { ...current.settings, ...patch };
    setSnap({ ...current, settings });
    saveSettings(settings).catch(() => getSnapshot().then(setSnap).catch(() => {}));
  }, []);
  const onReorder = useCallback((widgets: WidgetId[]) => saveWidgets({ widgets }), [saveWidgets]);
  const onResize = useCallback(
    (id: WidgetId, span: WidgetSpan, done: boolean) => {
      if (!done) {
        setSizePreview({ id, span });
        return;
      }
      setSizePreview(null);
      const sizes = snapRef.current?.settings.widgetSizes ?? {};
      saveWidgets({ widgetSizes: { ...sizes, [id]: span } });
    },
    [saveWidgets],
  );

  // Actions that bring up another app or the lock screen close the panel.
  const runAction = useCallback(async (action: WidgetAction) => {
    if (action === "do-not-disturb") {
      const next = await setDoNotDisturb(!snapRef.current?.settings.doNotDisturb);
      setSnap(next);
      return next.settings.doNotDisturb;
    }
    const result = await runQuickAction(action);
    if (CLOSES_PANEL.has(action)) dispatch({ type: "close" });
    return result;
  }, []);

  const onDismiss = useCallback((id: number) => {
    dispatch({ type: "dismissed", id });
    if (id > 0) dismissNotification(id).catch(() => {});
  }, []);

  if (!snap || !settings || !shape || !box || !inner) return null;

  const hovered = state.hover && view !== "expanded";
  const big = view !== "compact";
  const spring = view === "compact" ? ISLAND_CLOSE_SPRING : ISLAND_SPRING;
  return (
    <>
      {/* Notch style: concave "ears" that flare the island's top corners into
          the screen edge. Outside the shell, which clips its children, so this
          layer mirrors the shell's size, spring and hover scale. */}
      {shape.attached && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 mx-auto"
          style={{ transformOrigin: "50% 0%" }}
          initial={false}
          animate={{
            top: box.y,
            width: box.width + 2 * (big ? EAR_BIG : EAR) * scale,
            height: (big ? EAR_BIG : EAR) * scale,
            scale: hovered ? 1.04 : 1,
          }}
          transition={spring}
        >
          <span className="absolute inset-y-0 left-0 aspect-square" style={earStyle("left")} />
          <span className="absolute inset-y-0 right-0 aspect-square" style={earStyle("right")} />
        </motion.div>
      )}
      <motion.div
        className={cn(
          // Centered by layout, not a transform: WebKit can paint a layer for a
          // frame before applying its transform, which flashed the island in
          // the window's top-left corner.
          "island absolute inset-x-0 mx-auto overflow-hidden bg-black text-white",
          view,
          shape.attached ? "attached" : "floating ring-1 ring-white/[0.09]",
          view !== "expanded" && "cursor-pointer",
          big
            ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_24px_60px_rgba(0,0,0,0.55)]"
            : !shape.attached && "shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_6px_18px_rgba(0,0,0,0.3)]",
        )}
        // Transparent gives the tiles inside a frosted look (island.css).
        data-transparent={settings?.theme === "transparent" || undefined}
        style={{
          transformOrigin: "50% 0%",
          width: shellWidth,
          // Transparent clears the shell under the open panel so the desktop shows. The notch style stays
          // black to merge with the notch, unless the user chose a picture for it.
          background:
            view === "expanded" && settings?.theme === "transparent"
              ? "transparent"
              : shape.attached && settings?.theme !== "picture"
                ? undefined
                : (pictureAt?.(ear) ?? look.island(islandPicture)),
        }}
        initial={false}
        animate={{
          top: box.y,
          width: box.width,
          height: box.height,
          scale: hovered ? 1.04 : 1,
          borderTopLeftRadius: box.topRadius,
          borderTopRightRadius: box.topRadius,
          borderBottomLeftRadius: box.bottomRadius,
          borderBottomRightRadius: box.bottomRadius,
        }}
        transition={spring}
        onClick={
          view === "expanded"
            ? undefined
            : () => dispatch({ type: "open", tab: view === "peek" ? "notifications" : undefined })
        }
      >
        {/* Each view is laid out at its own final size and cross-fades with a
            blur while the shell springs between shapes. */}
        <AnimatePresence initial={false}>
          <ViewLayer key={view} width={box.width} height={box.height} shellWidth={shellWidth}>
            {/* Content is laid out at 100% and zoomed, which keeps text
                crisp at every island size. */}
            <div style={{ width: box.width / scale, height: box.height / scale, zoom: scale }}>
        {view === "compact" && (
          <Compact
            shape={inner}
            wings={wings}
            gauges={gauges}
            weather={weather}
            recordingSince={recordingSince}
            pinned={pinned}
            music={
              (barsInside || titlePinned) && bars
                ? {
                    colors: bars.colors,
                    flipped: bars.flipped,
                    bars: barsInside,
                    nowPlaying,
                    showTitle: titlePinned,
                    onCommand: (command) => {
                      if (nowPlaying) mediaControl(nowPlaying, command).catch(() => {});
                    },
                    onControlsHover: (over) => {
                      overControls.current = over;
                      // Leaving the buttons for the rest of the island opens it as usual.
                      if (!over && islandHovered.current) scheduleHover(true);
                    },
                  }
                : null
            }
            onStopRecording={() => {
              runQuickAction("record").catch(() => {});
            }}
            timer={timer}
            unread={state.unread}
            now={now}
            settings={settings}
            stats={snap.stats}
          />
        )}
        {view === "peek" && state.peek && (
          <Peek n={state.peek} topInset={inner.topInset} now={now.getTime()} onDismiss={() => onDismiss(state.peek!.id)} />
        )}
        {view === "expanded" && (
          <Expanded
            topInset={inner.topInset}
            widgetPictures={widgetPictures}
            tab={state.tab}
            onTab={(tab) => dispatch({ type: "tab", tab })}
            settings={sizePreview ? { ...settings, widgetSizes } : settings}
            notifications={snap.notifications}
            stats={snap.stats}
            timer={timer}
            now={now}
            onToggleDnd={() => {
              setDoNotDisturb(!settings.doNotDisturb).then(setSnap).catch(() => {});
            }}
            onSettings={() => {
              dispatch({ type: "close" });
              openSettings().catch(() => {});
            }}
            onDismiss={onDismiss}
            onReorder={onReorder}
            onResize={onResize}
            onDragging={setDragging}
            appFor={(id) => widgetAppName(id, snap.platform)}
            stocks={{
              quotes: snap.quotes,
              pinned: settings.islandStocks,
              onOpen: (symbol) => {
                dispatch({ type: "close" });
                openStockPage(symbol).catch(() => {});
              },
              onTogglePin: (symbol) => {
                const list = settings.islandStocks;
                saveWidgets({
                  islandStocks: list.includes(symbol)
                    ? list.filter((s) => s !== symbol)
                    : [...list, symbol].slice(0, MAX_ISLAND_STOCKS),
                });
              },
            }}
            backdrop={look.panel(ambient, pictures.panel)}
            scroll={panelScrolls}
            media={{
              track: nowPlaying ?? recentTrack,
              playing: nowPlaying !== null,
              onCommand: (command) => {
                const track = nowPlaying ?? recentTrack;
                if (track) mediaControl(track, command).catch(() => {});
              },
            }}
            actions={{
              keepAwake: snap.keepAwake,
              recording: recordingSince !== null,
              doNotDisturb: settings.doNotDisturb,
              run: runAction,
            }}
            onOpenApp={(id) => {
              dispatch({ type: "close" });
              openWidgetApp(id).catch(() => {});
            }}
            onClearAll={() => {
              clearNotifications().catch(() => {});
            }}
          />
        )}
            </div>
          </ViewLayer>
        </AnimatePresence>
      </motion.div>
      {/* Under the island: the bars only (the title stays inside), over whatever is on screen.
          Outside the island's rectangle, so clicks pass through it. */}
      <AnimatePresence>
        {barsBelow && bars && view === "compact" && (
          <motion.div
            key="below"
            className="pointer-events-none absolute inset-x-0 mx-auto flex flex-col items-center"
            // No zoom here: WebKit zooms `top` too, which lifted the row into the island.
            style={{ top: box.y + box.height + 3 * scale, width: box.width * 0.8, gap: 6 * scale }}
            initial={{ opacity: 0, y: -6, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(4px)", transition: { duration: 0.15 } }}
            transition={ISLAND_SPRING}
          >
            <span className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
              <MusicBars
                count={24}
                height={22 * scale}
                barWidth={Math.max(1, ((box.width * 0.6) / 24) * 0.4)}
                colors={bars.colors}
                flipped={bars.flipped}
              />
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** A picture's natural size once it loads, for placing it in pixels. */
function useImageSize(src: string | null) {
  const [size, setSize] = useState<{ src: string; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => setSize({ src, width: img.naturalWidth, height: img.naturalHeight });
    img.src = src;
  }, [src]);
  return size && size.src === src ? size : null;
}
