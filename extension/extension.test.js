import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { shortHost, siteFor } from "./sites.js";

const pageScript = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.js"), "utf8");

function installFakeNotification(permission) {
  const shown = [];
  class FakeNotification {
    static permission = permission;
    constructor(title, options) {
      this.title = title;
      shown.push([title, options]);
    }
  }
  window.Notification = FakeNotification;
  return shown;
}

function reports() {
  const got = [];
  document.addEventListener("lintel:notification", (e) => got.push(JSON.parse(e.detail)));
  return got;
}

describe("page.js", () => {
  it("reports notifications the page shows and still shows them", () => {
    const shown = installFakeNotification("granted");
    const got = reports();
    window.eval(pageScript);
    const n = new window.Notification("New mail", { body: "Lunch?", tag: "t1", icon: "x.png" });
    expect(n).toBeInstanceOf(window.Notification);
    expect(n.title).toBe("New mail");
    expect(shown).toHaveLength(1);
    expect(got).toEqual([{ title: "New mail", body: "Lunch?", tag: "t1" }]);
    expect(window.Notification.permission).toBe("granted");
  });

  it("stays quiet without notification permission", () => {
    installFakeNotification("default");
    const got = reports();
    window.eval(pageScript);
    new window.Notification("Hi");
    expect(got).toEqual([]);
  });

  it("reports service worker notifications shown from the page", async () => {
    installFakeNotification("granted");
    const show = vi.fn(() => Promise.resolve());
    window.ServiceWorkerRegistration = class {};
    window.ServiceWorkerRegistration.prototype.showNotification = show;
    const got = reports();
    window.eval(pageScript);
    await new window.ServiceWorkerRegistration().showNotification("Ping", { body: 42 });
    expect(show).toHaveBeenCalledWith("Ping", { body: 42 });
    expect(got).toEqual([{ title: "Ping", body: "", tag: "" }]);
  });
});

describe("page.js media", () => {
  it("reports what plays every few seconds", () => {
    vi.useFakeTimers();
    installFakeNotification("granted");
    const got = [];
    document.addEventListener("lintel:media", (e) => got.push(JSON.parse(e.detail)));
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: { playbackState: "playing", metadata: { title: "Lofi beats", artist: "Chill" } },
    });
    window.eval(pageScript);
    vi.advanceTimersByTime(3000);
    expect(got.at(-1)).toEqual({ title: "Lofi beats", artist: "Chill", playing: true });
    navigator.mediaSession.playbackState = "paused";
    vi.advanceTimersByTime(6000);
    // A stop is reported once, not every tick.
    expect(got.filter((m) => !m.playing)).toHaveLength(1);
    vi.useRealTimers();
  });
});

describe("page.js media commands", () => {
  const command = (c) => document.dispatchEvent(new CustomEvent("lintel:media-command", { detail: c }));

  it("uses the page's own Media Session handlers", () => {
    const set = vi.fn();
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: { playbackState: "playing", metadata: null, setActionHandler: set },
    });
    window.eval(pageScript);
    const next = vi.fn();
    navigator.mediaSession.setActionHandler("nexttrack", next);
    // The page's own call still reaches the browser.
    expect(set).toHaveBeenCalledWith("nexttrack", next);
    command("next");
    expect(next).toHaveBeenCalledWith({ action: "nexttrack" });
  });

  it("pauses and resumes the media element when the page has no handlers", () => {
    Object.defineProperty(navigator, "mediaSession", { configurable: true, value: undefined });
    document.body.innerHTML = "<video></video>";
    const video = document.querySelector("video");
    let paused = false;
    Object.defineProperty(video, "paused", { configurable: true, get: () => paused });
    video.pause = vi.fn(() => (paused = true));
    video.play = vi.fn(() => {
      paused = false;
      return Promise.resolve();
    });
    window.eval(pageScript);
    command("play-pause");
    expect(video.pause).toHaveBeenCalled();
    command("play-pause");
    expect(video.play).toHaveBeenCalled();
    // Unknown commands do nothing. (Each test's eval adds a listener, so count deltas.)
    const [pauses, plays] = [video.pause.mock.calls.length, video.play.mock.calls.length];
    command("rm -rf");
    expect([video.pause.mock.calls.length, video.play.mock.calls.length]).toEqual([pauses, plays]);
  });
});

describe("sites.js", () => {
  it("names known sites, subdomains included", () => {
    expect(siteFor("mail.google.com")?.name).toBe("Gmail");
    expect(siteFor("app.slack.com")?.name).toBe("Slack");
    expect(siteFor("www.facebook.com")?.name).toBe("Facebook");
    expect(siteFor("notfacebook.com")).toBeNull();
    expect(shortHost("www.example.com")).toBe("example.com");
  });
});

describe("auto-pairing", () => {
  function fakeChrome({ reply, token = "" }) {
    const store = { token };
    globalThis.chrome = {
      storage: {
        local: {
          get: async (keys) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
          set: async (v) => Object.assign(store, v),
        },
      },
      runtime: {
        sendNativeMessage: vi.fn(async () => {
          if (reply instanceof Error) throw reply;
          return reply;
        }),
      },
    };
    return store;
  }

  it("saves the token and port Lintel hands over", async () => {
    const store = fakeChrome({ reply: { token: "abc123", port: 50000 } });
    const { pairedSettings } = await import("./lintel.js");
    const settings = await pairedSettings();
    expect(settings).toMatchObject({ token: "abc123", port: 50000 });
    expect(store.token).toBe("abc123");
    expect(chrome.runtime.sendNativeMessage).toHaveBeenCalledWith("app.lintel.bridge", { type: "pair" });
  });

  it("keeps a token it already has and falls back when Lintel can't be reached", async () => {
    fakeChrome({ reply: { token: "new" }, token: "kept" });
    const { autoPair, pairedSettings } = await import("./lintel.js");
    expect((await pairedSettings()).token).toBe("kept");
    expect(chrome.runtime.sendNativeMessage).not.toHaveBeenCalled();
    fakeChrome({ reply: new Error("Specified native messaging host not found.") });
    expect(await autoPair()).toBe(false);
  });
});

describe("background.js", () => {
  async function loadWorker() {
    const store = { token: "old", port: 47821 };
    const on = {};
    const listener = (name) => ({ addListener: (fn) => (on[name] = fn) });
    globalThis.chrome = {
      storage: {
        local: {
          get: async (keys) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
          set: async (v) => Object.assign(store, v),
        },
        session: { set: async () => {} },
      },
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
      runtime: {
        onMessage: listener("message"),
        onInstalled: listener("installed"),
        onStartup: listener("startup"),
        sendNativeMessage: vi.fn(async () => ({ token: "new", port: 50000 })),
      },
    };
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.resetModules();
    await import("./background.js");
    return { store, on };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("asks Lintel for the current token and port on load, even with one saved", async () => {
    const { store, on } = await loadWorker();
    on.installed();
    await settle();
    expect(store).toMatchObject({ token: "new", port: 50000 });
  });

  it("ignores a stop from a tab other than the playing one", async () => {
    const { on } = await loadWorker();
    const media = (id, playing) =>
      on.message({ type: "media", title: "x", playing }, { tab: { id, url: "https://a.example/" }, frameId: 0 });
    media(1, true);
    await settle();
    const sends = fetch.mock.calls.length;
    media(2, false);
    await settle();
    expect(fetch.mock.calls.length).toBe(sends);
    media(1, false);
    await settle();
    expect(fetch.mock.calls.length).toBe(sends + 1);
  });
});
