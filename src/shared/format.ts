// Formatting helpers shared by the island and Settings pages.

import { getLanguage, t } from "./i18n";

const pad = (n: number) => String(n).padStart(2, "0");

/** "9:05" or "09:05" (24-hour), plus the period for 12-hour clocks. */
export function clockParts(d: Date, use24: boolean): { time: string; period: string } {
  const h = d.getHours();
  const m = pad(d.getMinutes());
  if (use24) return { time: `${pad(h)}:${m}`, period: "" };
  // "PM", "午後", "CH"…: the day period as the current language writes it.
  const period = new Intl.DateTimeFormat(getLanguage(), { hour: "numeric", hour12: true })
    .formatToParts(d)
    .find((p) => p.type === "dayPeriod")?.value;
  return { time: `${h % 12 || 12}:${m}`, period: period ?? (h < 12 ? "AM" : "PM") };
}

/** A price with sensible precision: "342.37", "74,328" or "0.0412". */
/** A symbol as people read it: "^VINDEX.VN" → "VINDEX", "0700.HK" → "0700". Share classes like "BRK.B" stay. */
export function shortSymbol(symbol: string): string {
  return symbol.replace(/^\^/, "").replace(/\.[A-Z]{2,3}$/, "");
}

export function formatPrice(price: number): string {
  const digits = Math.abs(price) >= 10_000 ? 0 : Math.abs(price) >= 1 ? 2 : 4;
  return price.toLocaleString(getLanguage(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** "47.5M" or "622K": volume in the locale's short form. */
export function formatVolume(v: number): string {
  return v.toLocaleString(getLanguage(), { notation: "compact", maximumFractionDigits: 1 });
}

/** "+1.25%" or "−0.40%", with a real minus sign. */
export function formatPercent(p: number): string {
  const v = Math.abs(p).toFixed(2);
  return p > 0 ? `+${v}%` : p < 0 ? `\u2212${v}%` : `${v}%`;
}

/** "4:07", "12:30" or "1:02:03" from milliseconds, rounding up so a timer never shows 0:00 early. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Short age of a notification: "now", "5m", "3h", "2d". */
export function relativeTime(then: number, now: number): string {
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (s < 60) return t("time.now");
  if (s < 3600) return t("time.minutes", { n: Math.floor(s / 60) });
  if (s < 86400) return t("time.hours", { n: Math.floor(s / 3600) });
  return t("time.days", { n: Math.floor(s / 86400) });
}

export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  // Other languages write their own units ("3時間 20分", "3 Std., 20 Min.").
  if (getLanguage() !== "en") {
    const unit = (n: number, u: "hour" | "minute") =>
      new Intl.NumberFormat(getLanguage(), { style: "unit", unit: u, unitDisplay: "short" }).format(n);
    if (min < 60) return unit(min, "minute");
    return m ? `${unit(h, "hour")} ${unit(m, "minute")}` : unit(h, "hour");
  }
  if (min < 60) return `${min} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
