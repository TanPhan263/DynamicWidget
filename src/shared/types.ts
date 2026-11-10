// Mirrors the serialized Rust types. Field names are camelCase on both sides.

export type ExpandTrigger = "hover" | "click";
export type IslandStyle = "notch" | "island";
/** Which background a picture is for: the wide open panel or the thin floating island. */
export type BackgroundSlot = "panel" | "island";

export type IslandTheme = "graphite" | "black" | "midnight" | "aurora" | "ember" | "slate" | "glass" | "picture";
/** Grid cells a widget covers: 1–3 columns, 1–2 rows. */
export interface WidgetSpan {
  cols: number;
  rows: number;
}

export const WIDGET_MAX_COLS = 3;
export const WIDGET_MAX_ROWS = 2;
export const SMALL: WidgetSpan = { cols: 1, rows: 1 };

export function clampSpan(cols: number, rows: number): WidgetSpan {
  return {
    cols: Math.min(WIDGET_MAX_COLS, Math.max(1, Math.round(cols))),
    rows: Math.min(WIDGET_MAX_ROWS, Math.max(1, Math.round(rows))),
  };
}
export type WidgetId = "clock" | "calendar" | "timer" | "system" | "notes" | "actions" | "stocks" | "media" | "weather";

/** One-tap system actions in the Quick actions widget. */
export type QuickAction = "keep-awake" | "screenshot" | "mute" | "lock" | "calculator" | "downloads" | "record";

/** The system app each widget opens when clicked, or null where there is none. */
export function widgetAppName(id: WidgetId, platform: Platform): string | null {
  if (platform === "macos") {
    const apps: Record<WidgetId, string | null> = {
      clock: "Clock",
      calendar: "Calendar",
      timer: "Clock",
      system: "Activity Monitor",
      notes: "Notes",
      actions: null,
      stocks: null,
      media: null,
      weather: "Weather",
    };
    return apps[id];
  }
  if (platform === "windows") {
    const apps: Record<WidgetId, string | null> = {
      clock: "Clock",
      calendar: "Calendar",
      timer: "Clock",
      system: "Task Manager",
      notes: "Sticky Notes",
      actions: null,
      stocks: null,
      media: null,
      weather: "Weather",
    };
    return apps[id];
  }
  return null;
}

export const ALL_WIDGETS: readonly WidgetId[] = ["clock", "calendar", "timer", "system", "notes", "actions", "stocks", "media", "weather"];

export const WIDGET_LABELS: Record<WidgetId, string> = {
  clock: "Clock",
  calendar: "Calendar",
  timer: "Timer",
  system: "System",
  notes: "Notes",
  actions: "Quick actions",
  stocks: "Stocks",
  media: "Now playing",
  weather: "Weather",
};

/** The Weather widget's data, from wttr.in by way of the core. */
export interface Weather {
  place: string;
  tempC: number;
  feelsLikeC: number;
  /** wttr.in (WWO) condition code. */
  code: number;
  description: string;
  days: { date: string; highC: number; lowC: number; code: number }[];
}

/** Most symbols the Stocks widget follows. */
export const MAX_SYMBOLS = 8;
/** Most symbols shown on the closed island. */
export const MAX_ISLAND_STOCKS = 3;

/** Upper-cases a ticker symbol, or returns null when it is not one. Mirrors the Rust check. */
export function normalizeSymbol(input: string): string | null {
  const s = input.trim().toUpperCase();
  return /^[A-Z0-9.\-^=]{1,15}$/.test(s) ? s : null;
}

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  currency: string;
  /** Today's prices, oldest first. */
  points: number[];
  /** Shares traded today, when the source reports it. */
  volume: number | null;
  updatedAt: number;
}

/** The latest result for one symbol; a failed refresh keeps the last quote. */
export interface QuoteState {
  symbol: string;
  quote: Quote | null;
  error: string | null;
}

export interface Settings {
  schemaVersion: number;
  expandTrigger: ExpandTrigger;
  islandStyle: IslandStyle;
  /** Background of the open panel and the floating island; see shared/themes. */
  theme: IslandTheme;
  /** Closed island and notification scale in percent, within ISLAND_SIZE_RANGE. */
  islandSize: number;
  /** Open panel scale in percent, within PANEL_SIZE_RANGE. */
  panelSize: number;
  toggleShortcut: string;
  notificationSeconds: number;
  doNotDisturb: boolean;
  widgets: WidgetId[];
  /** Widgets missing here cover one cell. */
  widgetSizes: Partial<Record<WidgetId, WidgetSpan>>;
  /** Ticker symbols the Stocks widget follows, in order. */
  stocks: string[];
  /** Symbols from `stocks` the closed island takes turns showing, at most MAX_ISLAND_STOCKS. */
  islandStocks: string[];
  musicBars: MusicBarsSettings;
  use24HourClock: boolean;
  batteryAlerts: boolean;
  apiEnabled: boolean;
  apiPort: number;
  startAtLogin: boolean;
  onboardingCompleted: boolean;
}

export const NOTIFICATION_SECONDS_RANGE = [2, 30] as const;
export const ISLAND_SIZE_RANGE = [50, 150] as const;
/** The open panel gets cramped below 80%. */
export const PANEL_SIZE_RANGE = [80, 150] as const;
export const API_PORT_RANGE = [1024, 65535] as const;

export type NotificationSource = "api" | "system" | "widget" | "browser";

/** Built-in icons for notifications Islet raises itself. */
export type NotificationSymbol =
  | "battery"
  | "battery-charging"
  | "battery-full"
  | "battery-low"
  | "battery-warning"
  | "timer"
  | "sparkles"
  | "recording"
  // Only the island uses this one, for the title of what plays.
  | "music";

export interface IslandNotification {
  id: number;
  title: string;
  body: string;
  app: string;
  icon: string | null;
  /** A small raster data URL, such as a website's icon. */
  image: string | null;
  symbol: NotificationSymbol | null;
  accent: string | null;
  source: NotificationSource;
  /** Unix time in milliseconds. */
  createdAt: number;
}

export interface NotificationInput {
  title: string;
  body?: string;
  app?: string;
  icon?: string;
  accent?: string;
  image?: string;
}

export type PowerState = "charging" | "discharging" | "full" | "not-charging" | "unknown";

export interface BatteryInfo {
  percent: number;
  state: PowerState;
  minutesRemaining: number | null;
}

export interface SystemStats {
  cpuPercent: number;
  memoryUsed: number;
  memoryTotal: number;
  battery: BatteryInfo | null;
  /** Some app is playing sound, such as music or a video. */
  audioPlaying: boolean;
  /** Some app has a camera open. */
  cameraInUse: boolean;
  /** Some app is recording from a microphone. */
  microphoneInUse: boolean;
  /** What is playing, when a website or player says. */
  nowPlaying: NowPlaying | null;
}

export interface NowPlaying {
  title: string;
  artist: string;
  /** The player or website, such as "Spotify" or "YouTube". */
  app: string;
  image: string | null;
  /** Islet can play, pause and skip it. */
  controls: boolean;
  /** A website reported it; its buttons go through the extension. */
  browser: boolean;
}

export type MediaCommand = "play-pause" | "next" | "previous";

export type BarsPosition = "inside" | "below";

export interface MusicBarsSettings {
  enabled: boolean;
  position: BarsPosition;
  /** Bars hang down instead of standing up. */
  flipped: boolean;
  /** Gradient from the bars' base to their tips. */
  colors: [string, string];
  showTitle: boolean;
}

export interface IslandLayout {
  platform: Platform;
  notch: { width: number; height: number } | null;
  menuBarHeight: number;
}

export interface ApiStatus {
  running: boolean;
  url: string | null;
  error: string | null;
}

export type Platform = "macos" | "windows" | "other";

export interface UiSnapshot {
  settings: Settings;
  notifications: IslandNotification[];
  stats: SystemStats;
  layout: IslandLayout;
  api: ApiStatus;
  islandHidden: boolean;
  lastError: string | null;
  warnings: string[];
  platform: Platform;
  version: string;
  settingsPath: string;
  /** Pasted into the browser extension to pair it. */
  browserToken: string;
  /** The Keep awake quick action is on. */
  keepAwake: boolean;
  /** When the running screen recording started, in Unix milliseconds. */
  recordingSince: number | null;
  /** Quotes for `settings.stocks`, in the same order. */
  quotes: QuoteState[];
}

export interface AppError {
  code: string;
  message: string;
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as AppError).message);
  return String(e);
}

/** Client-side checks that mirror the Rust validation, for instant feedback. */
export function validateSettings(s: Settings): string | null {
  if (!s.toggleShortcut.trim()) return "The shortcut cannot be empty";
  if (!Number.isInteger(s.apiPort) || s.apiPort < API_PORT_RANGE[0] || s.apiPort > API_PORT_RANGE[1]) {
    return `Port must be a whole number from ${API_PORT_RANGE[0]} to ${API_PORT_RANGE[1]}`;
  }
  return null;
}
