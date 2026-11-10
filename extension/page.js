// Runs in the page's own JavaScript world, the only place that sees the
// page call the Notification API. It reports what the page shows and
// changes nothing about whether or how the browser shows it.
(() => {
  const EVENT = "islet:notification";

  const report = (title, options) => {
    try {
      // Without permission the browser shows nothing, so neither does Islet.
      if (window.Notification?.permission !== "granted") return;
      const o = options && typeof options === "object" ? options : {};
      const detail = JSON.stringify({
        title: String(title ?? ""),
        body: typeof o.body === "string" ? o.body : "",
        tag: typeof o.tag === "string" ? o.tag : "",
      });
      document.dispatchEvent(new CustomEvent(EVENT, { detail }));
    } catch {
      // Never break the page.
    }
  };

  // `new Notification(title, options)`
  const Native = window.Notification;
  if (typeof Native === "function") {
    window.Notification = new Proxy(Native, {
      construct(target, args, newTarget) {
        report(args[0], args[1]);
        return Reflect.construct(target, args, newTarget);
      },
    });
  }

  // What the page plays: Media Session (YouTube, Spotify, Netflix and most
  // players set it), else the page title while a <video>/<audio> plays.
  const elementPlaying = () =>
    [...document.querySelectorAll("video, audio")].some((m) => !m.paused && !m.muted && m.readyState > 2);
  // Starts as "stopped", so pages that never play send nothing.
  let lastMedia = JSON.stringify({ title: "", artist: "", playing: false });
  // Only the tab's top page reports media; the worker ignores frames anyway.
  if (window === window.top) setInterval(() => {
    try {
      const session = navigator.mediaSession;
      const playing = session?.playbackState !== "paused" && (elementPlaying() || session?.playbackState === "playing");
      const meta = session?.metadata;
      const detail = JSON.stringify({
        title: playing ? meta?.title || document.title : "",
        artist: playing ? meta?.artist || "" : "",
        playing,
      });
      // Repeated while playing so Islet knows the tab is still there; a stop is sent once.
      if (!playing && detail === lastMedia) return;
      lastMedia = detail;
      document.dispatchEvent(new CustomEvent("islet:media", { detail }));
    } catch {
      // Never break the page.
    }
  }, 3000);

  // Islet's play, pause and skip buttons. The page's own Media Session
  // handlers do it best (they keep its UI in step), so they are kept here as
  // the page sets them; otherwise the <video>/<audio> element is used.
  const handlers = {};
  const session = navigator.mediaSession;
  if (window === window.top && typeof session?.setActionHandler === "function") {
    const set = session.setActionHandler.bind(session);
    session.setActionHandler = (action, handler) => {
      handlers[action] = handler;
      return set(action, handler);
    };
  }
  const run = (action, fallback) => {
    const handler = handlers[action];
    if (typeof handler === "function") handler({ action });
    else fallback?.();
  };
  if (window === window.top) document.addEventListener("islet:media-command", (e) => {
    try {
      const all = [...document.querySelectorAll("video, audio")];
      const playing = all.find((m) => !m.paused);
      if (e.detail === "play-pause") {
        if (playing) run("pause", () => playing.pause());
        else run("play", () => (all.find((m) => m.currentTime > 0) ?? all[0])?.play()?.catch(() => {}));
      } else if (e.detail === "next") {
        run("nexttrack");
      } else if (e.detail === "previous") {
        run("previoustrack", () => {
          if (playing) playing.currentTime = 0;
        });
      }
    } catch {
      // Never break the page.
    }
  });

  // `registration.showNotification(title, options)` called from the page.
  const proto = window.ServiceWorkerRegistration?.prototype;
  const show = proto?.showNotification;
  if (typeof show === "function") {
    proto.showNotification = function showNotification(title, options) {
      report(title, options);
      return show.call(this, title, options);
    };
  }
})();
