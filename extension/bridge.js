// Runs in the extension's isolated world and passes what page.js reports to
// the background worker. The worker takes the site from the frame's own URL,
// so a page can only ever send notifications under its own name.
document.addEventListener("islet:notification", (e) => {
  if (typeof e.detail !== "string" || e.detail.length > 4000) return;
  let n;
  try {
    n = JSON.parse(e.detail);
  } catch {
    return;
  }
  chrome.runtime
    .sendMessage({ type: "notification", title: n.title, body: n.body, tag: n.tag })
    .catch(() => {});
});

document.addEventListener("islet:media", (e) => {
  if (typeof e.detail !== "string" || e.detail.length > 2000) return;
  let m;
  try {
    m = JSON.parse(e.detail);
  } catch {
    return;
  }
  chrome.runtime
    .sendMessage({ type: "media", title: m.title, artist: m.artist, playing: m.playing === true })
    .catch(() => {});
});
