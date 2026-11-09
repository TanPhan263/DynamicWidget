import { useCallback, useEffect, useState } from "react";
import { pushNotification } from "../shared/commands";
import { formatDuration } from "../shared/format";
import * as timer from "./widgets/timer";

/** A short two-tone chime. Silent if audio is unavailable. */
function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {
    // No audio output; the notification is enough.
  }
}

/**
 * The island's single countdown. It lives at the island level so the
 * compact view can show it as a live activity while the panel is closed.
 */
export function useTimer() {
  const [state, setState] = useState<timer.TimerState>(timer.IDLE);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (state.status !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [state.status]);

  useEffect(() => {
    if (!timer.isFinished(state, now)) return;
    setState(timer.IDLE);
    chime();
    pushNotification(
      {
        title: "Timer finished",
        body: `${formatDuration(state.status === "running" ? state.duration : 0)} is up`,
        app: "Timer",
        accent: "#f59e0b",
      },
      "timer",
    ).catch(() => {});
  }, [state, now]);

  const start = useCallback((ms: number) => {
    const t = Date.now();
    setNow(t);
    setState(timer.start(ms, t));
  }, []);
  const pause = useCallback(() => setState((s) => timer.pause(s, Date.now())), []);
  const resume = useCallback(() => {
    const t = Date.now();
    setNow(t);
    setState((s) => timer.resume(s, t));
  }, []);
  const reset = useCallback(() => setState(timer.IDLE), []);

  return {
    state,
    remaining: timer.remaining(state, now),
    progress: timer.progress(state, now),
    start,
    pause,
    resume,
    reset,
  };
}

export type TimerApi = ReturnType<typeof useTimer>;
