import { invoke } from "@tauri-apps/api/core";
import type {
  IslandNotification,
  NotificationInput,
  NotificationSymbol,
  QuickAction,
  Settings,
  UiSnapshot,
  WidgetId,
} from "./types";

// Thin typed wrappers over the Rust commands. Pages never manage windows
// themselves; they only send intent to the core.

export const getSnapshot = () => invoke<UiSnapshot>("get_snapshot");

export const saveSettings = (settings: Settings) => invoke<UiSnapshot>("save_settings", { settings });

export const resetSettings = () => invoke<UiSnapshot>("reset_settings");

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

/** Opens a symbol's quote page in the browser. */
export const openStockPage = (symbol: string) => invoke<void>("open_stock_page", { symbol });

export const replaceBrowserToken = () => invoke<UiSnapshot>("replace_browser_token");

/** Opens the browser extension's folder and returns its path. */
export const openExtensionFolder = () => invoke<string>("open_extension_folder");
