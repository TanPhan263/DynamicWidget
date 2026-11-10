import { clockParts, formatBytes, formatDuration, formatMinutes, formatPercent, formatPrice, formatVolume, relativeTime } from "./format";

describe("clock", () => {
  it("formats 12- and 24-hour time", () => {
    const d = new Date(2026, 10, 9, 0, 5);
    expect(clockParts(d, false)).toEqual({ time: "12:05", period: "AM" });
    expect(clockParts(new Date(2026, 10, 9, 13, 7), false)).toEqual({ time: "1:07", period: "PM" });
    expect(clockParts(new Date(2026, 10, 9, 9, 7), true)).toEqual({ time: "09:07", period: "" });
  });
});

describe("formatDuration", () => {
  it("rounds up partial seconds and adds hours when needed", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(1)).toBe("0:01");
    expect(formatDuration(59_001)).toBe("1:00");
    expect(formatDuration(25 * 60_000)).toBe("25:00");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("relativeTime", () => {
  it("uses short units", () => {
    const now = 1_000_000_000;
    expect(relativeTime(now - 30_000, now)).toBe("now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d");
    expect(relativeTime(now + 10_000, now)).toBe("now");
  });
});

describe("sizes and minutes", () => {
  it("formats bytes", () => {
    expect(formatBytes(512 * 1024 ** 2)).toBe("512 MB");
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
    expect(formatBytes(16 * 1024 ** 3)).toBe("16 GB");
  });

  it("formats minutes", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(135)).toBe("2 h 15 min");
  });
});

describe("prices", () => {
  it("keeps sensible precision", () => {
    expect(formatPrice(342.371)).toBe((342.37).toLocaleString(undefined, { minimumFractionDigits: 2 }));
    expect(formatVolume(47_499_490)).toBe((47_499_490).toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 }));
    expect(formatPrice(74328.77)).toBe((74329).toLocaleString());
    expect(formatPrice(0.04123)).toBe((0.0412).toLocaleString(undefined, { minimumFractionDigits: 4 }));
  });

  it("signs percentages with a real minus", () => {
    expect(formatPercent(1.254)).toBe("+1.25%");
    expect(formatPercent(-0.4)).toBe("−0.40%");
    expect(formatPercent(0)).toBe("0.00%");
  });
});

it("shortens symbols to how people read them", async () => {
  const { shortSymbol } = await import("./format");
  expect(shortSymbol("^VINDEX.VN")).toBe("VINDEX");
  expect(shortSymbol("FPT.VN")).toBe("FPT");
  expect(shortSymbol("0700.HK")).toBe("0700");
  expect(shortSymbol("BRK.B")).toBe("BRK.B");
  expect(shortSymbol("BTC-USD")).toBe("BTC-USD");
  expect(shortSymbol("^GSPC")).toBe("GSPC");
});
