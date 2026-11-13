import { t, type LanguageSetting } from "./i18n";

// Mirrors the serialized Rust types. Field names are camelCase on both sides.

export type ExpandTrigger = "hover" | "click";
export type IslandStyle = "notch" | "island";
/** Which background a picture is for: the wide open panel or the thin floating island. */
export type BackgroundSlot = "panel" | "island";

export type IslandTheme = "graphite" | "black" | "midnight" | "aurora" | "ember" | "slate" | "transparent" | "picture";
/** How one widget's card looks. Mirrors the Rust `WidgetLook`. */
export interface WidgetLook {
  /** #rrggbb */
  background?: string;
  /** #rrggbb */
  text?: string;
  /** How opaque the background is, 0–100. */
  opacity?: number;
}

/** The card's dark glass base, used when only the opacity is changed. */
export const DEFAULT_TILE_COLOR = "#1c1c20";
export const DEFAULT_TILE_OPACITY = 70;

/** Darkens a widget picture so text stays readable when no color is picked over it. */
const PICTURE_VEIL = "rgb(0 0 0 / 0.35)";

/**
 * CSS variables for a look: `--card` is the card background (color, picture
 * or both), and `--color-white` recolors every Tailwind white (text-white/40
 * and the like) inside, keeping their shades; `--widget-text` is the same
 * color, for accents.
 */
export function lookVars(look: WidgetLook = {}, picture?: string | null): Record<string, string> {
  const vars: Record<string, string> = {};
  const tint =
    look.background || look.opacity !== undefined
      ? `color-mix(in srgb, ${look.background ?? DEFAULT_TILE_COLOR} ${look.opacity ?? DEFAULT_TILE_OPACITY}%, transparent)`
      : null;
  if (picture) {
    // The color, if any, lies over the picture as a veil; the opacity sets how much shows through.
    const veil = tint ?? PICTURE_VEIL;
    vars["--card"] = `linear-gradient(${veil}, ${veil}), url("${picture}") center / cover`;
  } else if (tint) {
    vars["--card"] = tint;
  }
  if (look.text) {
    vars["--color-white"] = look.text;
    vars["--widget-text"] = look.text;
    // Text with no color class of its own inherits the color already worked out above the card, so set it here too.
    vars.color = look.text;
  }
  return vars;
}

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
/** A computer state the closed island can show as a mini icon. */
export type IslandStat = "time" | "date" | "cpu" | "memory" | "disk" | "battery" | "weather" | "mail";
/** The icons on each side of the closed island, in order. */
export interface IslandIcons {
  left: IslandStat[];
  right: IslandStat[];
}
export const ISLAND_STATS: readonly IslandStat[] = ["time", "date", "cpu", "memory", "disk", "battery", "weather", "mail"];
/** The island has room for this many icons in all. */
export const MAX_ISLAND_ICONS = 4;

export type WidgetId = "clock" | "calendar" | "timer" | "system" | "notes" | "actions" | "stocks" | "media" | "weather" | "controls" | "news" | "events" | "countdowns";

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
      controls: null,
      news: null,
      events: null,
      countdowns: null,
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
      controls: null,
      news: null,
      events: null,
      countdowns: null,
    };
    return apps[id];
  }
  return null;
}

export const ALL_WIDGETS: readonly WidgetId[] = ["clock", "calendar", "timer", "system", "notes", "actions", "stocks", "media", "weather", "controls", "news", "events", "countdowns"];

/** A widget's name in the current language. */
export const widgetLabel = (id: WidgetId): string => t(`widget.${id}`);

/** The Controls widget's state; null where this system can't read or set it. */
export interface Controls {
  wifi: boolean | null;
  /** The joined network, when the system says. */
  wifiName: string | null;
  bluetooth: boolean | null;
  airplane: boolean | null;
  /** 0 to 1. */
  volume: number | null;
  muted: boolean | null;
  /** Built-in screen, 0 to 1. */
  brightness: number | null;
  darkMode: boolean | null;
  /** Night light on Windows, Night Shift on macOS. */
  nightLight: boolean | null;
  /** Energy saver on Windows, Low Power Mode on macOS; switching opens its settings. */
  energySaver: boolean | null;
}

export type ControlToggle = "wifi" | "bluetooth" | "airplane" | "dark-mode" | "night-light" | "energy-saver";
export type ControlLevel = "volume" | "brightness";
export type ControlChange = { control: ControlToggle; value: boolean } | { control: ControlLevel; value: number };

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

/** Most feeds the News widget follows. Mirrors the Rust limit. */
export const MAX_FEEDS = 8;

/** Adds `https://` to a bare address; null when it still is not a web link. Mirrors the Rust check. */
export function normalizeFeedUrl(input: string): string | null {
  const s = input.trim();
  const url = s.includes("://") ? s : `https://${s}`;
  return /^https?:\/\/\S+$/i.test(url) ? url : null;
}

/** A headline from one of the followed feeds. */
export interface NewsItem {
  title: string;
  link: string;
  /** The feed's name. */
  source: string;
  /** Unix milliseconds, when the feed dates it. */
  published: number | null;
  /** Short plain-text summary. */
  description: string | null;
  /** An https picture. */
  image: string | null;
}

/** How the News widget shows headlines: a scrolling list, or one story at a time that moves on by itself. */
export type NewsView = "list" | "slides";

export interface News {
  /** Newest first. */
  items: NewsItem[];
  /** How each followed address is doing, in settings order. */
  feeds: { url: string; title: string | null; error: string | null }[];
}

/** Most calendar links the Events widget reads. Mirrors the Rust limit. */
export const MAX_CALENDARS = 8;

/** Turns `webcal://` into `https://`, then checks it like a feed address. Mirrors the Rust check. */
export function normalizeCalendarUrl(input: string): string | null {
  const s = input.trim();
  return normalizeFeedUrl(/^webcal:\/\//i.test(s) ? `https://${s.slice(9)}` : s);
}

/** One event, or one occurrence of a repeating one, from a calendar link. */
export interface CalendarEvent {
  /** Empty when the calendar gives no title. */
  title: string;
  /** Unix milliseconds; all-day events start at local midnight. */
  start: number;
  end: number;
  allDay: boolean;
  location: string | null;
  /** The calendar's name. */
  calendar: string;
}

export interface Events {
  /** The next 30 days, soonest first. */
  events: CalendarEvent[];
  /** How each calendar link is doing, in settings order. */
  calendars: { url: string; title: string | null; error: string | null }[];
}

/** A day the Countdowns widget counts down to. */
export interface Countdown {
  name: string;
  /** YYYY-MM-DD. */
  date: string;
}

/** Most days the Countdowns widget follows. Mirrors the Rust limit. */
export const MAX_COUNTDOWNS = 8;

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
  /** "system" follows the computer; see shared/i18n. */
  language: LanguageSetting;
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
  /** Per-widget card colors; widgets missing here keep the glass look. */
  widgetLooks: Partial<Record<WidgetId, WidgetLook>>;
  /** Ticker symbols the Stocks widget follows, in order. */
  stocks: string[];
  /** Symbols from `stocks` the closed island takes turns showing, at most MAX_ISLAND_STOCKS. */
  islandStocks: string[];
  /** Feed or site addresses the News widget reads, at most MAX_FEEDS. */
  newsFeeds: string[];
  newsView: NewsView;
  /** Calendar (.ics) links the Events widget reads, at most MAX_CALENDARS. */
  calendarLinks: string[];
  countdowns: Countdown[];
  musicBars: MusicBarsSettings;
  use24HourClock: boolean;
  /** Icons the closed island shows while nothing else is going on. */
  islandIcons: IslandIcons;
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

/** Built-in icons for notifications Lintel raises itself. */
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
  /** The disk the system runs from. */
  diskUsed: number;
  diskTotal: number;
  /** Unread mail; null when no mail app runs or the island does not show it. */
  mailUnread: number | null;
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
  /** Lintel can play, pause and skip it. */
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
