import { IDLE, isFinished, pause, progress, remaining, resume, start } from "./timer";

describe("timer", () => {
  it("counts down from start", () => {
    const t = start(60_000, 1_000);
    expect(remaining(t, 1_000)).toBe(60_000);
    expect(remaining(t, 31_000)).toBe(30_000);
    expect(progress(t, 31_000)).toBeCloseTo(0.5);
    expect(isFinished(t, 60_999)).toBe(false);
    expect(isFinished(t, 61_000)).toBe(true);
    expect(remaining(t, 99_000)).toBe(0);
  });

  it("pauses and resumes without losing time", () => {
    let t = start(60_000, 0);
    t = pause(t, 20_000);
    expect(remaining(t, 50_000)).toBe(40_000);
    expect(isFinished(t, 1e9)).toBe(false);
    t = resume(t, 100_000);
    expect(remaining(t, 110_000)).toBe(30_000);
  });

  it("ignores pause/resume in the wrong state", () => {
    expect(pause(IDLE, 0)).toBe(IDLE);
    const running = start(1000, 0);
    expect(resume(running, 5)).toBe(running);
    expect(progress(IDLE, 0)).toBe(0);
  });
});
