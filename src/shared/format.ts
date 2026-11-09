// Formatting helpers shared by the island and Settings pages.

const pad = (n: number) => String(n).padStart(2, "0");

/** "9:05" or "09:05" (24-hour), plus the period for 12-hour clocks. */
export function clockParts(d: Date, use24: boolean): { time: string; period: string } {
  const h = d.getHours();
  const m = pad(d.getMinutes());
  if (use24) return { time: `${pad(h)}:${m}`, period: "" };
  return { time: `${h % 12 || 12}:${m}`, period: h < 12 ? "AM" : "PM" };
}

/** A price with sensible precision: "342.37", "74,328" or "0.0412". */
export function formatPrice(price: number): string {
  const digits = Math.abs(price) >= 10_000 ? 0 : Math.abs(price) >= 1 ? 2 : 4;
  return price.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
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
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
