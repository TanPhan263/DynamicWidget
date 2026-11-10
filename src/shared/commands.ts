import { invoke } from "@tauri-apps/api/core";
import type {
  BackgroundSlot,
  ControlChange,
  Controls,
  IslandNotification,
  MediaCommand,
  NotificationInput,
  NowPlaying,
  NotificationSymbol,
  QuickAction,
  Settings,
  UiSnapshot,
  Weather,
  WidgetId,
} from "./types";

// Thin typed wrappers over the Rust commands. Pages never manage windows
// themselves; they only send intent to the core.

export const getSnapshot = () => invoke<UiSnapshot>("get_snapshot");

export const saveSettings = (settings: Settings) => invoke<UiSnapshot>("save_settings", { settings });

export const resetSettings = () => invoke<UiSnapshot>("reset_settings");

/** The language the pages show, so the tray menu and system notifications match. */
export const setUiLanguage = (language: string) => invoke<void>("set_ui_language", { language });

export const completeOnboarding = () => invoke<UiSnapshot>("complete_onboarding");

export const dismissError = () => invoke<UiSnapshot>("dismiss_error");

export const setIslandRect = (rect: { x: number; y: number; width: number; height: number }) =>
  invoke<void>("set_island_rect", { rect });

export const releaseFocus = () => invoke<void>("release_focus");

export const pushNotification = (input: NotificationInput, symbol?: NotificationSymbol) =>
  invoke<IslandNotification>("push_notification", { input, symbol: symbol ?? null });

export const sendTestNotification = () => invoke<IslandNotification>("send_test_notification");

export const dismissNotification = (id: number) => invoke<void>("dismiss_notification", { id });

export const clearNotifications = () => invoke<void>("clear_notifications");

export const setDoNotDisturb = (enabled: boolean) => invoke<UiSnapshot>("set_do_not_disturb", { enabled });

export const openSettings = () => invoke<void>("open_settings");

/** Opens the system app that goes with a widget, such as Calendar. */
export const openWidgetApp = (widget: WidgetId) => invoke<void>("open_widget_app", { widget });

/** Runs a quick action; toggles resolve to their new state when it is known. */
export const runQuickAction = (action: QuickAction) => invoke<boolean | null>("run_quick_action", { action });

/** Plays, pauses or skips on the player the Now playing widget shows. */
export const mediaControl = (track: NowPlaying, command: MediaCommand) =>
  invoke<void>("media_control", { player: track.app, command, browser: track.browser });

/** A background picture as a data URL, or null. */
export const getBackgroundImage = (slot: BackgroundSlot) => invoke<string | null>("get_background_image", { slot });

/** Saves a JPEG or PNG data URL as a background picture, or removes it with null. */
export const setBackgroundImage = (slot: BackgroundSlot, image: string | null) =>
  invoke<void>("set_background_image", { slot, image });

/** Wi-Fi, Bluetooth, volume and the other switches, as the system has them now. */
export const getControls = () => invoke<Controls>("get_controls");

/** Switches one control; resolves to all of them afterwards. */
export const setControl = (change: ControlChange) => invoke<Controls>("set_control", { change });

/** Today's weather; the core asks wttr.in at most every 15 minutes. */
export const getWeather = () => invoke<Weather>("get_weather");

/** Opens a symbol's quote page in the browser. */
export const openStockPage = (symbol: string) => invoke<void>("open_stock_page", { symbol });

export const replaceBrowserToken = () => invoke<UiSnapshot>("replace_browser_token");

/** Opens the browser extension's folder and returns its path. */
export const openExtensionFolder = () => invoke<string>("open_extension_folder");
