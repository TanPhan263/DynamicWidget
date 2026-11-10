import { getSettings, sendMedia, sendNotification, setStatus, takeMediaCommand } from "./lintel.js";
import { shortHost, siteFor } from "./sites.js";

/** At most this many notifications per site per minute reach Lintel. */
const RATE_LIMIT = 12;
/** The same notification again within this time is a duplicate. */
const DUPLICATE_MS = 3000;
/** Lintel accepts icons up to 12 KiB as a data URL. */
const IMAGE_MAX = 11 * 1024;
/** How often Lintel is asked for a play, pause or skip for the media tab. */
const COMMAND_POLL_MS = 1000;
/** After the tab's last report, it can still be resumed for this long. */
const COMMAND_WINDOW_MS = 10 * 60_000;

/** The tab that last reported media, and when. */
let mediaTab = null;

const sent = new Map(); // host -> recent send times
const seen = new Map(); // notification key -> last time
const icons = new Map(); // host -> data URL, or null when there is none

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender.tab?.url) return;
  // Some web apps (Outlook among them) raise notifications from an iframe.
  // Those are named after the frame's own site, never the tab's.
  if (message?.type === "notification") forward(message, sender.url ?? sender.tab.url).catch(() => {});
  if (message?.type === "media" && sender.frameId === 0) {
    mediaTab = { id: sender.tab.id, at: Date.now() };
    forwardMedia(message, sender.tab.url).catch(() => {});
  }
});

// Each poll calls an extension API, which also keeps this worker alive
// while a tab can still be controlled.
setInterval(() => pollMediaCommand().catch(() => {}), COMMAND_POLL_MS);

async function pollMediaCommand() {
  if (!mediaTab || Date.now() - mediaTab.at > COMMAND_WINDOW_MS) return;
  const settings = await getSettings();
  if (!settings.enabled || !settings.token) return;
  const command = await takeMediaCommand(settings);
  if (command) await chrome.tabs.sendMessage(mediaTab.id, { type: "media-command", command }, { frameId: 0 });
}

function allowed(host, now) {
  const times = (sent.get(host) ?? []).filter((t) => now - t < 60_000);
  if (times.length >= RATE_LIMIT) return false;
  times.push(now);
  sent.set(host, times);
  return true;
}

function duplicate(key, now) {
  for (const [k, t] of seen) if (now - t > 60_000) seen.delete(k);
  const last = seen.get(key);
  seen.set(key, now);
  return last !== undefined && now - last < DUPLICATE_MS;
}

async function forward(message, tabUrl) {
  const settings = await getSettings();
  if (!settings.enabled || !settings.token) return;
  let url;
  try {
    url = new URL(tabUrl);
  } catch {
    return;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return;
  const host = url.hostname;
  if (settings.muted.includes(host)) return;

  const title = String(message.title ?? "").trim().slice(0, 120);
  const body = String(message.body ?? "").trim().slice(0, 500);
  if (!title) return;
  const now = Date.now();
  if (duplicate(`${host}\n${message.tag || title}\n${body}`, now) || !allowed(host, now)) return;

  const site = siteFor(host);
  const status = await sendNotification(settings, {
    title,
    body: body || undefined,
    app: site?.name ?? shortHost(host),
    accent: site?.accent,
    image: (await iconFor(url)) ?? undefined,
  });
  await setStatus(status);
}

/** What a tab plays, with the site's name and icon. */
async function forwardMedia(message, tabUrl) {
  const settings = await getSettings();
  if (!settings.enabled || !settings.token) return;
  const url = new URL(tabUrl);
  if (settings.muted.includes(url.hostname)) return;
  const playing = message.playing === true;
  await setStatus(
    await sendMedia(settings, {
      title: String(message.title ?? "").slice(0, 200),
      artist: String(message.artist ?? "").slice(0, 200),
      app: siteFor(url.hostname)?.name ?? shortHost(url.hostname),
      image: playing ? ((await iconFor(url)) ?? undefined) : undefined,
      playing,
    }),
  );
}

/** The site's icon as a small PNG data URL, cached per host. */
async function iconFor(url) {
  if (icons.has(url.hostname)) return icons.get(url.hostname);
  let icon = null;
  for (const size of [64, 32]) {
    try {
      icon = await faviconPng(url.href, size);
      if (icon && icon.length <= IMAGE_MAX) break;
      icon = null;
    } catch {
      icon = null;
    }
  }
  icons.set(url.hostname, icon);
  return icon;
}

async function faviconPng(pageUrl, size) {
  // Chromium serves the icon it already has for a page here.
  const src = new URL(chrome.runtime.getURL("/_favicon/"));
  src.searchParams.set("pageUrl", pageUrl);
  src.searchParams.set("size", String(size));
  const res = await fetch(src);
  if (!res.ok) return null;
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = new OffscreenCanvas(size, size);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, size, size);
  const png = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  let binary = "";
  for (const b of png) binary += String.fromCharCode(b);
  return `data:image/png;base64,${btoa(binary)}`;
}
