// Countdown timer as plain data, so it survives re-renders and is easy to
// test. Times are wall-clock milliseconds (Date.now()).

export type TimerState =
  | { status: "idle" }
  | { status: "running"; duration: number; endsAt: number }
  | { status: "paused"; duration: number; remaining: number };

export const IDLE: TimerState = { status: "idle" };

export function start(duration: number, now: number): TimerState {
  return { status: "running", duration, endsAt: now + duration };
}

export function pause(t: TimerState, now: number): TimerState {
  if (t.status !== "running") return t;
  return { status: "paused", duration: t.duration, remaining: Math.max(0, t.endsAt - now) };
}

export function resume(t: TimerState, now: number): TimerState {
  if (t.status !== "paused") return t;
  return { status: "running", duration: t.duration, endsAt: now + t.remaining };
}

export function remaining(t: TimerState, now: number): number {
  switch (t.status) {
    case "running":
      return Math.max(0, t.endsAt - now);
    case "paused":
      return t.remaining;
    default:
      return 0;
  }
}

/** Fraction of the duration that has elapsed, 0..1. */
export function progress(t: TimerState, now: number): number {
  if (t.status === "idle" || t.duration <= 0) return 0;
  return 1 - remaining(t, now) / t.duration;
}

export function isFinished(t: TimerState, now: number): boolean {
  return t.status === "running" && now >= t.endsAt;
}
