import { checkConnection, getSettings, sendNotification, setStatus } from "./islet.js";
import { shortHost } from "./sites.js";

const $ = (id) => document.getElementById(id);

const LABELS = {
  ok: "Connected",
  unpaired: "Not paired",
  offline: "Islet not running",
  error: "Error",
};

function showStatus(status) {
  const el = $("status");
  el.textContent = LABELS[status] ?? "Checking…";
  el.className = `badge ${status}`;
  // Pairing is the only thing to do until it works.
  $("pair").hidden = status === "ok";
  $("test").disabled = status !== "ok";
}

async function refresh() {
  const status = await checkConnection(await getSettings());
  await setStatus(status);
  showStatus(status);
}

async function currentHost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab?.url ?? "");
    return url.protocol === "https:" || url.protocol === "http:" ? url.hostname : null;
  } catch {
    return null;
  }
}

async function init() {
  const settings = await getSettings();
  $("token").value = settings.token;
  $("port").value = String(settings.port);
  $("enabled").checked = settings.enabled;

  $("save").addEventListener("click", async () => {
    const port = Number($("port").value);
    await chrome.storage.local.set({
      token: $("token").value.trim(),
      port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : 47821,
    });
    await refresh();
  });
  $("token").addEventListener("keydown", (e) => e.key === "Enter" && $("save").click());

  $("enabled").addEventListener("change", (e) => chrome.storage.local.set({ enabled: e.target.checked }));

  const host = await currentHost();
  if (host) {
    $("site-row").hidden = false;
    $("site").textContent = shortHost(host);
    $("site-enabled").checked = !settings.muted.includes(host);
    $("site-enabled").addEventListener("change", async (e) => {
      const { muted } = await getSettings();
      const rest = muted.filter((h) => h !== host);
      await chrome.storage.local.set({ muted: e.target.checked ? rest : [...rest, host] });
    });
  }

  $("test").addEventListener("click", async () => {
    const status = await sendNotification(await getSettings(), {
      title: "Browser connected",
      body: "Website notifications will show up here.",
      app: "Islet extension",
    });
    await setStatus(status);
    showStatus(status);
  });

  await refresh();
}

init();
