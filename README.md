# Islet

A Dynamic Island-style notification center for macOS and Windows. An island sits at the top center of your screen and shows notifications, live activities and quick widgets.

Choose its style in Settings:

| Style | Looks like |
|---|---|
| Notch | Hangs from the top edge of the screen, around the notch on MacBooks |
| Dynamic Island | A floating black capsule just below the top edge, empty until something happens, like on iPhone |

The closed island (with notifications) and the open panel each have a size slider, 50–150% for the island and 80–150% for the panel, and the island resizes live while you drag one. The notch itself keeps its size.

- **Notifications** pop out of the island for a few seconds, then wait in the Notifications tab. Do Not Disturb keeps them quiet.
- **Live activities** show beside the island while it is closed: a running timer, the unread count, and music bars while any app plays sound (music, videos, calls). A green dot shows while an app uses the camera and an orange one while it uses the microphone (CoreMediaIO and CoreAudio on macOS, the privacy settings' usage records on Windows).
- **Widgets** in the open panel: Clock, Calendar, Timer, System (CPU, memory, battery), Notes, Stocks, Now playing, Weather (today plus the next two days from wttr.in, which finds your city from your IP address), Controls (a control center: Wi-Fi, Bluetooth, airplane mode, dark mode, night light, energy saver, and volume and brightness sliders) and Quick actions (Record screen, Screenshot, Keep awake, Do Not Disturb, Mute, Lock, Calculator, Downloads). Click a card to open the matching app (Calendar, Clock, Activity Monitor or Task Manager, Notes or Sticky Notes, Weather). Drag a card to move it and drag its bottom-right corner to resize it (1–3 columns by 1–2 rows, snapping to the grid). Settings has the same controls. With the keyboard, focus a card's grip and use Space and the arrow keys to move it, or focus its corner handle and use the arrow keys to resize it.
- **Screen recording**: Record screen records the main display to the Desktop on macOS, with the cursor and clicks. A red dot and the elapsed time sit beside the island while it runs; click the dot to stop, and the movie is shown in Finder. macOS asks once for Screen Recording permission. On Windows the button opens Snipping Tool, which records from its toolbar.
- **Now playing**: music bars spring to new heights while sound plays. Settings → Now playing puts the bars in the island or below it. The title always stays inside the island: in the middle of it, or, beside a notch, popping up once for each new track. Settings also turns them upside down, and colors them with a preset gradient or two colors of your own. Titles come from Spotify and Apple Music on macOS (macOS asks once to let Islet control each), from any app that shows in the Windows volume flyout on Windows (Spotify, Media Player, browsers and others), and from websites through the browser extension (`POST /v1/media`, extension only). With the title in the middle of the island, previous, pause and next buttons sit beside it (hovering them doesn't open the panel). The Now playing widget shows the cover, title and artist with previous, play/pause and next buttons, and keeps the last track after a pause so it can be resumed. The buttons work for Spotify and Music on macOS, for every app on Windows, and for websites through the extension (it collects each press within about a second, and uses the site's own player controls, or the page's video or audio). Covers come from Spotify (downloaded once per track), Apple Music and Windows' media sessions.
- **Controls** replaces a trip to the system's control center. It shows only what your system can do:
  - **macOS:** Wi-Fi, Bluetooth, dark mode, Night Shift, Low Power Mode (its button opens Battery settings, because only an administrator can switch it), volume, and the built-in screen's brightness. Turning on dark mode the first time asks to let Islet control System Events.
  - **Windows:** Wi-Fi, Bluetooth, airplane mode (it switches every radio), dark mode, energy saver (its button opens Battery saver settings), volume, and the built-in screen's brightness. Windows has no public switch for Night light, so it isn't shown.
  - Bluetooth, brightness and Night Shift on macOS use the private system frameworks that Control Center itself uses.
- **Quick actions**: Keep awake stops the display and computer from sleeping until you turn it off or quit Islet. Lock sleeps the display on macOS, which locks it when your Mac asks for the password after sleep, and locks the PC on Windows. Mute toggles the sound output.
- **Stocks**: the Stocks widget follows up to 8 symbols as written on Yahoo Finance (AAPL, VNM.VN, BTC-USD, ^GSPC, EURUSD=X) with price, today's change and, on wider cards, a sparkline. Click a row to open its quote page, or its pin to show it on the island. Up to 3 symbols can be on the island; the closed island shows one at a time, 4 seconds each, with its price and change. Settings → Widgets → Stocks adds and removes symbols and has the same On island toggle on each row. Prices stream live from Yahoo Finance over a WebSocket while the widget is shown or a symbol is on the island; names, the previous close and the sparkline come from Yahoo's chart data every 5 minutes (every minute if the stream is unreachable). Yahoo's free data may be delayed for some exchanges. Vietnamese stocks (`.VN`, any of HOSE, HNX or UPCoM) skip Yahoo: their price comes from VPS every 3 seconds and their sparkline from VNDirect's 1-minute bars.
- **Website notifications**: the Islet browser extension forwards notifications from Gmail, Slack, Facebook, Discord and any other site.
- **Local API**: scripts and tools on your computer can send notifications.
- **Battery alerts**: charger plugged in or removed, fully charged, 20% and 10%.

Hover over the island (or click it, if you prefer) to open it. `Cmd/Ctrl+Shift+Space` opens and closes it from anywhere, and `Esc` closes it. Clicks pass through everywhere outside the island, so the menu bar and your apps keep working.

## Sending notifications

```sh
curl -X POST http://127.0.0.1:47821/v1/notify \
  -H 'Content-Type: application/json' \
  -d '{"title":"Build passed","body":"main · 2m 14s","app":"CI","icon":"✅","accent":"#16a34a"}'
```

| Field | |
|---|---|
| `title` | Required, up to 120 characters |
| `body` | Optional, up to 500 characters |
| `app` | Sender name shown above the title (default "Script") |
| `icon` | An emoji or up to 4 characters |
| `accent` | Icon background, hex color |
| `image` | A small picture instead of the icon: a base64 PNG, JPEG, WebP or GIF data URL, up to 12 KiB |

`GET /v1/health` checks that Islet is running. `GET /v1/media/command` (extension only) hands over a waiting play, pause or skip for the playing tab. The server listens on `127.0.0.1` only. It refuses requests from web pages (any `Origin` header other than a browser extension's) and requests whose `Host` isn't the loopback address, and it only accepts a JSON content type. Requests from a browser extension must carry the pairing token (`Authorization: Bearer <token>`). You can change the port or turn the API off in Settings.

## Website notifications

The extension in [extension/](extension/) works in Chrome, Edge, Brave, Arc and other Chromium browsers (version 111 or later).

1. Open the browser's extensions page (`chrome://extensions`) and turn on Developer mode.
2. Click Load unpacked and choose the extension folder. Islet Settings → Browser → Show folder opens it.
3. Click the Islet icon in the toolbar, paste the pairing token from Settings → Browser and click Connect.

The extension watches for pages calling the browser's Notification API and sends each notification, with the site's name and icon, to Islet. It never changes what the page or the browser does. Things to know:

- A site sends notifications only after you allow them for it in the browser, and only while it's open in a tab. Push notifications that arrive with every tab of the site closed don't reach Islet.
- To avoid seeing each notification twice, turn off the browser's notifications in System Settings → Notifications (macOS) or Settings → System → Notifications (Windows). Sites still think they may notify, so Islet keeps getting them.
- The popup can pause forwarding, or stop it for the current site.
- Each site can send at most 12 notifications a minute, and repeats within 3 seconds are dropped.
- Settings → Browser → Generate new token disconnects every browser that uses the old token.
- Desktop apps, such as the Steam or Slack apps, use the system's own notifications, which the extension can't see.

Islet doesn't mirror other apps' system notifications. macOS has no public API for reading them, and on Windows the notification listener API needs a packaged (MSIX) app.

## Development

Requirements: Node 20+, Rust 1.85+, and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```sh
npm install
npm run tauri dev        # run the app with hot reload
npm test                 # frontend tests (Vitest)
cd src-tauri && cargo test   # Rust tests
npm run tauri build      # installers: .app/.dmg on macOS, .msi/NSIS .exe on Windows
npm run icons            # regenerate app and tray icons
```

On first launch the Settings window opens with a short welcome. After that, Islet runs from the menu bar (macOS) or tray (Windows). Closing Settings only hides it; use **Quit Islet** in the menu to exit. The island steps aside while a full-screen app, game, video or presentation is in front (press the shortcut to bring it up anyway), and while it's hidden Islet stops watching the pointer.

## Design

The interface follows shadcn/ui: Tailwind CSS v4 with shadcn's neutral OKLCH theme in light and dark (`src/styles/globals.css`), Radix primitives wrapped as shadcn-style components (`src/components/ui`), Lucide icons and the Geist font. Motion (Framer Motion) drives the island: a spring morphs its shape, content cross-fades with a blur, widgets stagger in and digits roll. All motion respects the system's Reduce Motion setting.

The look is "glass and depth". The open panel fades from black to graphite, with a faint wash of the playing album's color at the bottom (indigo when nothing plays), and the widget tiles are dark glass over a soft blur of the background. Numbers are large and light; labels are small uppercase captions. The weather tile glows in the sky's color, and the Now playing tile is tinted by its own blurred cover. On macOS the Settings sidebar uses the system's own translucent sidebar material, under an overlay title bar. Settings → General → Theme switches the panel's background between Graphite (default), Black, Midnight, Aurora, Ember, Slate, Transparent (nearly clear, so the desktop shows through, with frosted widget tiles) and Picture, your own photos (JPEG, PNG or WebP): one for the wide panel and, optionally, one for the thin floating island, which otherwise borrows the panel's. Picking Picture shows a place for each (panel and island) with a Choose button; after choosing a file you frame it in the exact shape it fills (a 4:3 panel or a thin pill for the island) by dragging and zooming. They're saved next to the settings file and darkened so text stays readable; with the Dynamic Island style the closed island takes the theme's color too (the Notch style stays black to match the notch, except with Picture, where the island picture shows around the notch).

## How it works

The island is a single transparent, always-on-top window (1000×800 CSS px) pinned to the top center of the primary display. On macOS it sits one level above the menu bar. The page draws the island inside that window and reports the island's rectangle to the core (the whole window while a widget is being dragged, so the drag survives leaving the panel). A Rust thread polls the pointer about 30 times a second and turns click-through off only while the pointer is over that rectangle. A click-through window receives no mouse events, so the same thread sends hover to the page as an event. When the panel closes while it has keyboard focus, focus returns to the app you were using.

```text
src/
  island/                The island page: state machine, geometry, views, widgets
  settings/              The Settings window
  shared/                Types, IPC wrappers, events and formatting shared by both pages
  components/ui/         shadcn-style components (Button, Switch, Card, Slider, ...)
  styles/globals.css     Tailwind and theme tokens
  lib/                   cn() helper and system theme hook
src-tauri/src/
  core/
    island.rs            Window placement, pointer polling, click-through and hover
    notifications.rs     Notification history and input validation
    http_api.rs          Local notification API
    system_monitor.rs    CPU, memory, battery and battery alerts
    settings_service.rs  Versioned settings file with atomic saves
    shortcut_service.rs  Global shortcut
  platform/              macOS (AppKit) and Windows (Win32): window level, notch, focus
  actions.rs             Intents shared by the tray, shortcut, API and commands
  commands.rs            IPC commands
  tray.rs                Menu-bar / tray menu
```
