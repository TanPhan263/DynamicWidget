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
