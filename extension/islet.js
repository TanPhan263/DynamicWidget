// Talking to the Islet app on this computer. Shared by the worker and popup.

export const DEFAULTS = { token: "", port: 47821, enabled: true, muted: [] };

export async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}

/** "ok", "unpaired", "offline" or "error". */
export async function setStatus(status) {
  await chrome.storage.session.set({ status });
  await chrome.action.setBadgeText({ text: status === "ok" ? "" : "!" });
  await chrome.action.setBadgeBackgroundColor({ color: status === "unpaired" ? "#f59e0b" : "#ef4444" });
}

async function request(settings, path, init = {}) {
  return fetch(`http://127.0.0.1:${settings.port}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${settings.token}` },
  });
}

/** Checks that Islet is running and accepts the token. */
export async function checkConnection(settings) {
  if (!settings.token) return "unpaired";
  try {
    const res = await request(settings, "/v1/health");
    if (res.status === 401) return "unpaired";
    if (!res.ok) return "error";
    const body = await res.json();
    return body.paired ? "ok" : "unpaired";
  } catch {
    return "offline";
  }
}

/** Tells Islet what a tab plays; returns the resulting status. */
export async function sendMedia(settings, payload) {
  try {
    const res = await request(settings, "/v1/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 401) return "unpaired";
    return res.ok ? "ok" : "error";
  } catch {
    return "offline";
  }
}

/** Sends one notification and returns the resulting status. */
export async function sendNotification(settings, payload) {
  const post = (body) =>
    request(settings, "/v1/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    let res = await post(payload);
    // An icon Islet rejects should not cost the notification.
    if (res.status === 400 && payload.image) res = await post({ ...payload, image: undefined });
    if (res.status === 401) return "unpaired";
    return res.ok ? "ok" : "error";
  } catch {
    return "offline";
  }
}
