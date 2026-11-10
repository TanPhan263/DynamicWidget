import type { Controls, UiSnapshot } from "../shared/types";

// Shared fakes for `@tauri-apps/api`. Tests call `vi.mock` with these and
// drive core events through `emit`.

type Listener = (e: { payload: unknown }) => void;
const listeners = new Map<string, Set<Listener>>();
export const invoked: { cmd: string; args?: unknown }[] = [];
let snapshot: UiSnapshot;
let background: Record<string, string | null> = {};

/** A Mac's controls: no airplane mode. */
export const MOCK_CONTROLS: Controls = {
  wifi: true,
  wifiName: "Home",
  bluetooth: false,
  airplane: null,
  volume: 0.5,
  muted: false,
  brightness: 0.7,
  darkMode: true,
  nightLight: false,
  energySaver: false,
};
let controls: Controls = MOCK_CONTROLS;
const CONTROL_KEYS: Record<string, keyof Controls> = {
  wifi: "wifi",
  bluetooth: "bluetooth",
  airplane: "airplane",
  volume: "volume",
  brightness: "brightness",
  "dark-mode": "darkMode",
  "night-light": "nightLight",
  "energy-saver": "energySaver",
};

/** A background picture the fake core has saved. */
export function setMockBackground(slot: "panel" | "island", image: string | null) {
  background[slot] = image;
}

export function baseSnapshot(): UiSnapshot {
  return {
    settings: {
      schemaVersion: 1,
      expandTrigger: "hover",
      islandStyle: "notch",
      theme: "graphite",
      language: "en",
      islandSize: 100,
      panelSize: 100,
      toggleShortcut: "CommandOrControl+Shift+Space",
      notificationSeconds: 5,
      doNotDisturb: false,
      widgets: ["clock", "calendar", "timer", "system", "notes"],
      widgetSizes: {},
      stocks: ["AAPL", "BTC-USD"],
      islandStocks: [],
      musicBars: { enabled: true, position: "inside", flipped: false, colors: ["#ffffff", "#ffffff"], showTitle: true },
      use24HourClock: false,
      batteryAlerts: true,
      apiEnabled: true,
      apiPort: 47821,
      startAtLogin: false,
      onboardingCompleted: true,
    },
    notifications: [],
    stats: {
      cpuPercent: 12,
      memoryUsed: 8 * 1024 ** 3,
      memoryTotal: 16 * 1024 ** 3,
      battery: { percent: 80, state: "discharging", minutesRemaining: 200 },
      audioPlaying: false,
      cameraInUse: false,
      microphoneInUse: false,
      nowPlaying: null,
    },
    layout: { platform: "macos", notch: { width: 200, height: 37 }, menuBarHeight: 37 },
    api: { running: true, url: "http://127.0.0.1:47821", error: null },
    islandHidden: false,
    lastError: null,
    warnings: [],
    platform: "macos",
    version: "0.1.0",
    settingsPath: "/tmp/settings.json",
    browserToken: "0123456789abcdef0123456789abcdef",
    keepAwake: false,
    recordingSince: null,
    quotes: [
      {
        symbol: "AAPL",
        quote: {
          symbol: "AAPL",
          name: "Apple Inc.",
          price: 342.37,
          previousClose: 344.17,
          change: -1.8,
          changePercent: -0.523,
          currency: "USD",
          points: [344, 341, 343, 342.37],
          volume: 47_499_490,
          updatedAt: 1,
        },
        error: null,
      },
      { symbol: "BTC-USD", quote: null, error: "offline" },
    ],
  };
}

export function resetMock(snap: UiSnapshot = baseSnapshot()) {
  snapshot = snap;
  background = {};
  controls = MOCK_CONTROLS;
  listeners.clear();
  invoked.length = 0;
}

export function emit(event: string, payload: unknown = null) {
  listeners.get(event)?.forEach((l) => l({ payload }));
}

export const coreModule = {
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    invoked.push({ cmd, args });
    switch (cmd) {
      case "get_snapshot":
        return snapshot;
      case "save_settings":
        snapshot = { ...snapshot, settings: args!.settings as UiSnapshot["settings"] };
        return snapshot;
      case "replace_browser_token":
        snapshot = { ...snapshot, browserToken: "fedcba9876543210fedcba9876543210" };
        return snapshot;
      case "set_do_not_disturb":
        snapshot = { ...snapshot, settings: { ...snapshot.settings, doNotDisturb: args!.enabled as boolean } };
        return snapshot;
      case "run_quick_action":
        if (args!.action === "keep-awake") {
          snapshot = { ...snapshot, keepAwake: !snapshot.keepAwake };
          return snapshot.keepAwake;
        }
        if (args!.action === "record") {
          snapshot = { ...snapshot, recordingSince: snapshot.recordingSince ? null : Date.now() };
          return snapshot.recordingSince !== null;
        }
        return args!.action === "mute" ? true : null;
      case "get_controls":
        return controls;
      case "set_control": {
        const { control, value } = args!.change as { control: string; value: boolean | number };
        controls = { ...controls, [CONTROL_KEYS[control]]: value };
        return controls;
      }
      case "get_weather":
        return {
          place: "Hanoi",
          tempC: 29.6,
          feelsLikeC: 33,
          code: 176,
          description: "Patchy rain nearby",
          days: [
            { date: "2026-11-10", highC: 32, lowC: 24, code: 176 },
            { date: "2026-11-11", highC: 31, lowC: 25, code: 113 },
            { date: "2026-11-12", highC: 28, lowC: 23, code: 116 },
          ],
        };
      case "get_background_image":
        return background[args!.slot as string] ?? null;
      case "set_background_image":
        background[args!.slot as string] = (args!.image as string | null) ?? null;
        emit("background-changed", { slot: args!.slot, image: background[args!.slot as string] });
        return undefined;
      case "open_extension_folder":
        return "/Applications/Lintel.app/Contents/Resources/extension";
      default:
        return undefined;
    }
  },
};

export const eventModule = {
  listen: async (event: string, cb: Listener) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(cb);
    return () => listeners.get(event)?.delete(cb);
  },
};
