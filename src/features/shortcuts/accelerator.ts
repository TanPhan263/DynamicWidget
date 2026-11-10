import { t } from "@/shared/i18n";
// Converts keyboard events into Tauri accelerator strings
// ("CommandOrControl+Shift+P") and formats accelerators for display.

export interface KeyLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type CaptureResult =
  | { kind: "pending" } // only modifiers so far
  | { kind: "cancel" }
  | { kind: "error"; message: string }
  | { kind: "done"; accelerator: string };

const NAMED_CODES = new Set([
  "Space", "Enter", "Tab", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Minus", "Equal", "Comma", "Period", "Slash",
  "Backquote", "Semicolon", "Quote", "BracketLeft", "BracketRight", "Backslash",
]);

const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift", "OS", "AltGraph"]);

function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (NAMED_CODES.has(code)) return code;
  return null;
}

export function captureAccelerator(e: KeyLike, isMac: boolean): CaptureResult {
  if (MODIFIER_KEYS.has(e.key)) return { kind: "pending" };
  const anyModifier = e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;
  if (e.code === "Escape" && !anyModifier) return { kind: "cancel" };

  const key = keyFromCode(e.code);
  if (!key) return { kind: "error", message: t("shortcut.badKey") };

  const parts: string[] = [];
  if (isMac) {
    if (e.metaKey) parts.push("CommandOrControl");
    if (e.ctrlKey) parts.push("Control");
  } else {
    if (e.ctrlKey) parts.push("CommandOrControl");
    if (e.metaKey) parts.push("Super");
  }
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  // Shift alone would steal ordinary typing (capital letters, symbols).
  if (parts.length === 0 || (parts.length === 1 && parts[0] === "Shift")) {
    return {
      kind: "error",
      message: t("shortcut.needModifier", { keys: isMac ? `⌘, ⌃ ${t("shortcut.or")} ⌥` : `Ctrl, Alt ${t("shortcut.or")} Win` }),
    };
  }
  parts.push(key);
  return { kind: "done", accelerator: parts.join("+") };
}

const MAC_SYMBOLS: Record<string, string> = {
  commandorcontrol: "⌘", cmdorctrl: "⌘", commandorctrl: "⌘", cmdorcontrol: "⌘",
  command: "⌘", cmd: "⌘", super: "⌘", meta: "⌘",
  control: "⌃", ctrl: "⌃", alt: "⌥", option: "⌥", shift: "⇧",
};

const PC_NAMES: Record<string, string> = {
  commandorcontrol: "Ctrl", cmdorctrl: "Ctrl", commandorctrl: "Ctrl", cmdorcontrol: "Ctrl",
  control: "Ctrl", ctrl: "Ctrl", command: "Win", cmd: "Win", super: "Win", meta: "Win",
  alt: "Alt", option: "Alt", shift: "Shift",
};

const KEY_LABELS: Record<string, string> = {
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Backquote: "`",
  Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
};

export function formatAccelerator(accelerator: string, isMac: boolean): string {
  const tokens = accelerator.split("+").map((t) => t.trim()).filter(Boolean);
  const labels = tokens.map((t) => {
    const lower = t.toLowerCase();
    const mod = isMac ? MAC_SYMBOLS[lower] : PC_NAMES[lower];
    return mod ?? KEY_LABELS[t] ?? t;
  });
  return labels.join(isMac ? "" : "+");
}
