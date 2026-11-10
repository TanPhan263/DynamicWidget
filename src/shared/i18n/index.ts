import { useSyncExternalStore } from "react";
import { de } from "./de";
import { en, type MessageKey, type Messages } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { ja } from "./ja";
import { ko } from "./ko";
import { vi } from "./vi";
import { zh } from "./zh";

export type { MessageKey } from "./en";

/** Each language with its own name for itself, as the picker lists it. */
export const LANGUAGES = {
  en: "English",
  zh: "简体中文",
  vi: "Tiếng Việt",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
} as const;

export type Language = keyof typeof LANGUAGES;
/** The saved choice: a language, or "system" to follow the computer. */
export type LanguageSetting = Language | "system";

const MESSAGES: Record<Language, Messages> = { en, zh, vi, ja, ko, es, fr, de };

/** The language to show for a saved choice; "system" maps the system's to one we have, else English. */
export function resolveLanguage(setting: string | undefined, system: readonly string[] = navigator.languages ?? [navigator.language]): Language {
  if (setting && setting in LANGUAGES) return setting as Language;
  for (const tag of system) {
    const base = tag.toLowerCase().split("-")[0];
    if (base in LANGUAGES) return base as Language;
  }
  return "en";
}

let current: Language = resolveLanguage("system");
const listeners = new Set<() => void>();

/** Switches the whole page; components using `useLanguage` redraw. */
export function setLanguage(lang: Language) {
  if (lang === current) return;
  current = lang;
  document.documentElement.lang = lang;
  for (const l of listeners) l();
}

export const getLanguage = () => current;

/** The current language; subscribing makes the component redraw when it changes. */
export function useLanguage(): Language {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

/** The text for `key` in the current language, with `{name}` values filled in. */
export function t(key: MessageKey, values?: Record<string, string | number>): string {
  let text: string = MESSAGES[current][key] ?? en[key];
  if (values) for (const [k, v] of Object.entries(values)) text = text.replaceAll(`{${k}}`, String(v));
  return text;
}

/** Text with a React element in place of `{slot}`, as [before, after]. */
export function tSplit(key: MessageKey, slot: string): [string, string] {
  const [before, after = ""] = t(key).split(`{${slot}}`);
  return [before, after];
}
