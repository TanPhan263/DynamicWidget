import { monthGrid } from "./calendar";

describe("monthGrid", () => {
  it("has six full weeks starting on Sunday", () => {
    // November 2026 starts on a Sunday.
    const days = monthGrid(2026, 10, new Date(2026, 10, 9));
    expect(days).toHaveLength(42);
    expect(days[0]).toMatchObject({ date: 1, inMonth: true });
    expect(days.filter((d) => d.inMonth)).toHaveLength(30);
    expect(days.filter((d) => d.isToday).map((d) => d.date)).toEqual([9]);
  });

  it("pads with the previous month", () => {
    // January 2026 starts on a Thursday.
    const days = monthGrid(2026, 0, new Date(2000, 0, 1));
    expect(days.slice(0, 4).every((d) => !d.inMonth)).toBe(true);
    expect(days[0].date).toBe(28);
    expect(days[4]).toMatchObject({ date: 1, inMonth: true });
    expect(days.some((d) => d.isToday)).toBe(false);
  });
});
