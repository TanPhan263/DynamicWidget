import type { UiSnapshot } from "../shared/types";

// Shared fakes for `@tauri-apps/api`. Tests call `vi.mock` with these and
// drive core events through `emit`.

type Listener = (e: { payload: unknown }) => void;
const listeners = new Map<string, Set<Listener>>();
export const invoked: { cmd: string; args?: unknown }[] = [];
let snapshot: UiSnapshot;

export function baseSnapshot(): UiSnapshot {
  return {
    settings: {
      schemaVersion: 1,
      expandTrigger: "hover",
      islandStyle: "notch",
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
      case "open_extension_folder":
        return "/Applications/Islet.app/Contents/Resources/extension";
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
