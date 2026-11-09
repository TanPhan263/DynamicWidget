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
  document.addEventListener("islet:notification", (e) => got.push(JSON.parse(e.detail)));
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
    document.addEventListener("islet:media", (e) => got.push(JSON.parse(e.detail)));
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

describe("sites.js", () => {
  it("names known sites, subdomains included", () => {
    expect(siteFor("mail.google.com")?.name).toBe("Gmail");
    expect(siteFor("app.slack.com")?.name).toBe("Slack");
    expect(siteFor("www.facebook.com")?.name).toBe("Facebook");
    expect(siteFor("notfacebook.com")).toBeNull();
    expect(shortHost("www.example.com")).toBe("example.com");
  });
});
