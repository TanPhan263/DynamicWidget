// Display names and accent colors for well-known sites. Any other site is
// shown by its host name.
export const SITES = [
  { hosts: ["mail.google.com"], name: "Gmail", accent: "#ea4335" },
  { hosts: ["calendar.google.com"], name: "Google Calendar", accent: "#1a73e8" },
  { hosts: ["chat.google.com"], name: "Google Chat", accent: "#00ac47" },
  { hosts: ["meet.google.com"], name: "Google Meet", accent: "#00897b" },
  { hosts: ["outlook.live.com", "outlook.office.com", "outlook.office365.com"], name: "Outlook", accent: "#0078d4" },
  { hosts: ["mail.yahoo.com"], name: "Yahoo Mail", accent: "#6001d2" },
  { hosts: ["mail.proton.me"], name: "Proton Mail", accent: "#6d4aff" },
  { hosts: ["slack.com"], name: "Slack", accent: "#4a154b" },
  { hosts: ["discord.com"], name: "Discord", accent: "#5865f2" },
  { hosts: ["teams.microsoft.com", "teams.live.com"], name: "Teams", accent: "#5b5fc7" },
  { hosts: ["facebook.com"], name: "Facebook", accent: "#0866ff" },
  { hosts: ["messenger.com"], name: "Messenger", accent: "#0866ff" },
  { hosts: ["instagram.com"], name: "Instagram", accent: "#e1306c" },
  { hosts: ["web.whatsapp.com"], name: "WhatsApp", accent: "#25d366" },
  { hosts: ["web.telegram.org"], name: "Telegram", accent: "#229ed9" },
  { hosts: ["zalo.me"], name: "Zalo", accent: "#0068ff" },
  { hosts: ["steamcommunity.com", "steampowered.com"], name: "Steam", accent: "#1b2838" },
  { hosts: ["x.com", "twitter.com"], name: "X", accent: "#000000" },
  { hosts: ["linkedin.com"], name: "LinkedIn", accent: "#0a66c2" },
  { hosts: ["reddit.com"], name: "Reddit", accent: "#ff4500" },
  { hosts: ["youtube.com"], name: "YouTube", accent: "#ff0000" },
  { hosts: ["github.com"], name: "GitHub", accent: "#24292f" },
  { hosts: ["notion.so"], name: "Notion", accent: "#000000" },
];

/** The known site for a host name, matching subdomains too. */
export function siteFor(host) {
  return SITES.find((s) => s.hosts.some((h) => host === h || host.endsWith(`.${h}`))) ?? null;
}

/** "www.example.com" → "example.com" */
export function shortHost(host) {
  return host.replace(/^www\./, "");
}
