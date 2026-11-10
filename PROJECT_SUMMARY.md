# Islet: rebuild specification

This document describes Islet in enough detail to rebuild it from scratch without the original source. It covers the stack, configuration, data model, IPC contract, behavior and native platform tricks, along with the exact constants. When it gives a number, use that number.

Islet is a Dynamic Island-style notification center for macOS and Windows. A black island sits at the top center of the primary display. It shows notifications, live activities (timer, unread count, music, screen recording, stocks) and an open panel of widgets. The app lives in the menu bar (macOS) or the tray (Windows), has a Settings window, a local HTTP API for scripts, and a Chromium extension that forwards website notifications and now-playing info.

---

## 1. Tech stack

| Layer | Choice |
|---|---|
| Shell | Tauri 2 (`tauri` 2.12, features `tray-icon`, `image-png`, `macos-private-api`) |
| Tauri plugins | `tauri-plugin-global-shortcut` 2.4, `tauri-plugin-autostart` 2.7 (macOS LaunchAgent), `tauri-plugin-log` 2.10 |
| Backend | Rust 2021, MSRV 1.85. Crates: `serde`/`serde_json`, `thiserror` 2, `log`, `tiny_http` 0.12 (API server), `getrandom` 0.3 (token), `ureq` 2 with `native-tls` (Yahoo chart), `tungstenite` 0.30 with `native-tls` (Yahoo stream), `base64` 0.22, `chrono` 0.4 (clock feature only), `sysinfo` 0.40, `starship-battery` 0.12 |
| macOS native | `objc2` 0.6, `objc2-app-kit` 0.3 (features NSWindow, NSRunningApplication, NSWorkspace, NSResponder, NSScreen, NSGraphics, objc2-core-foundation), `core-graphics` 0.25, CoreAudio over raw FFI |
| Windows native | `windows` 0.62 (Foundation_Collections, Media_Control, Win32_Foundation, Media_Audio, Media_Audio_Endpoints, System_Com, System_Power, System_Shutdown, UI_Input_KeyboardAndMouse, UI_WindowsAndMessaging) |
| Frontend | React 19.2, TypeScript 5.9 (strict), Vite 7, two HTML entry points |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui-style components on `radix-ui` 1.8, `class-variance-authority`, `clsx` + `tailwind-merge` (`cn()`), `lucide-react` icons, Geist and Geist Mono variable fonts (`@fontsource-variable/*`) |
| Animation | `motion` 14 (Framer Motion, imported from `motion/react`) |
| Drag and drop | `@dnd-kit/core` 6.3, `sortable` 10, `modifiers` 9, `utilities` 3.2 |
| Tests | Vitest 3 + jsdom + Testing Library (frontend), `cargo test` (Rust), plain Node test for the extension |
| Extension | Plain JS, Manifest V3, Chromium 111+ |

Release profile: `codegen-units = 1`, `lto = true`, `opt-level = "s"`, `panic = "unwind"`, `strip = true`.

The crate is named `islet`, its lib `islet_lib` (`crate-type = ["staticlib","cdylib","rlib"]`), and `main.rs` calls `islet_lib::run()`. Add `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`.

## 2. Project layout

```text
index.html                 Settings page entry   → src/settings/main.tsx
island.html                Island page entry     → src/island/main.tsx (<html class="dark">)
vite.config.ts             two inputs (settings, island), alias @ → src, port 1420 strict, ignore src-tauri in watch
src/
  shared/                  types.ts, commands.ts (invoke wrappers), events.ts, format.ts
  island/                  Island.tsx, views.tsx, geometry.ts, islandState.ts, WidgetGrid.tsx,
                           MusicBars.tsx, SlidingNumber.tsx, NotificationIcon.tsx, useTimer.ts,
                           island.css, widgets/{Widgets.tsx, timer.ts, calendar.ts}
  settings/                App.tsx, sections.tsx, layout.tsx, StylePicker.tsx, WidgetList.tsx,
                           useSnapshot.ts, widgetOrder.ts
  components/ui/           alert, badge, button, card, input, kbd, label, separator, slider, switch, toggle-group
  components/ShortcutInput.tsx
  features/shortcuts/accelerator.ts
  lib/                     utils.ts (cn), theme.ts (system dark mode), dnd.ts (FieldSafePointerSensor)
  styles/globals.css
  test/                    setup.ts, tauriMock.ts
src-tauri/
  src/lib.rs main.rs state.rs actions.rs commands.rs tray.rs errors.rs quick_actions.rs
  src/core/                geometry island notifications http_api pairing settings_service
                           shortcut_service system_monitor media market
  src/platform/            adapter.rs (trait), mod.rs, generic.rs, macos/{mod,island,displays,audio,media}.rs,
                           windows/{mod,island,displays,audio}.rs
  tauri.conf.json  capabilities/default.json  icons/
extension/                 manifest.json page.js bridge.js background.js islet.js sites.js popup.{html,css,js}
scripts/                   generate-icons.mjs, prune-icons.mjs
```

npm scripts: `dev` (vite), `build` (`tsc --noEmit && vite build`), `test` (`vitest run`), `tauri`, and `icons` (`node scripts/generate-icons.mjs && tauri icon src-tauri/icons/source.png && node scripts/prune-icons.mjs`).

tsconfig: target ES2021, `moduleResolution: bundler`, `jsx: react-jsx`, strict, `noUnusedLocals`/`noUnusedParameters`, paths `@/*` → `./src/*`, types `vitest/globals`, `@testing-library/jest-dom`, `node`.

## 3. Tauri configuration

`tauri.conf.json`:
- productName `Islet`, version `0.1.0`, identifier `app.islet.desktop`.
- build: `beforeDevCommand: npm run dev`, `devUrl: http://localhost:1420`, `beforeBuildCommand: npm run build`, `frontendDist: ../dist`.
- `app.macOSPrivateApi: true` (needed for a transparent window), `withGlobalTauri: false`.
- Window `island`: url `island.html`, 1000×800, `decorations:false`, `transparent:true`, `shadow:false`, `resizable:false`, `alwaysOnTop:true`, `skipTaskbar:true`, `visibleOnAllWorkspaces:true`, `acceptFirstMouse:true`, `focus:false`, `visible:false`.
- Window `settings`: url `index.html`, title "Islet Settings", 880×640, min 600×480, `visible:false`, `center:true`, resizable.
- CSP: `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ipc: http://ipc.localhost`.
- bundle: targets `app, dmg, nsis, msi`; category Utility; `resources: { "../extension/": "extension/" }` so the extension ships inside the app; icons 32x32, 128x128, 128x128@2x, icns, ico; macOS `minimumSystemVersion: 12.0`; Windows `webviewInstallMode: downloadBootstrapper`.

`capabilities/default.json`: windows `["island","settings"]`, permissions `["core:default"]` only. Shortcuts, autostart and window placement are all driven from Rust.

## 4. Startup and app lifecycle (`lib.rs`)

1. Register plugins. Log goes to the log dir (file `islet`) and stdout at Info level, with a 1 MiB max file and `RotationStrategy::KeepOne`. Also register global-shortcut and autostart (`MacosLauncher::LaunchAgent`).
2. In `setup`:
   - On macOS, set `ActivationPolicy::Accessory` (no Dock icon).
   - `config_dir = app.path().app_config_dir()`. Load settings from `config_dir/settings.json` and the pairing token from `config_dir/browser-token`.
   - Build `Arc<AppState>` and `app.manage()` it.
   - Register the shortcut: try the saved one. If it fails and differs from the default, fall back to the default. Record the message as `last_error` and emit `shortcut-conflict`. The message suffix is either "The default shortcut is active instead." or "Use the menu-bar/tray icon to open the island."
   - Create the tray, apply the API server, then spawn the island engine, system monitor and market threads.
   - Closing the Settings window calls `prevent_close()` and hides it instead.
   - If `onboardingCompleted` is false, show Settings.
3. Register all IPC commands (see §7).
4. In the run loop, `ExitRequested` with `code: None` is answered with `prevent_exit()`, so the app keeps living in the tray. `RunEvent::Exit` sets `quitting = true`.
5. Quit (tray menu): set `quitting`, stop the API, turn off Keep awake, stop any recording (which lets the movie finish writing), then `app.exit(0)`. Every background thread loops until `quitting` is true.

### Shared state (`state.rs`)

`AppState` holds:
- `inner: Mutex<Inner>`.
- `adapter: Box<dyn PlatformAdapter>`, plus the settings store and the token store.
- Separate mutexes for `shortcuts`, `api` (`ApiServer`), `keep_awake` and `recorder`.

`Inner` holds:
- `settings`, `notifications` (`NotificationCenter`), `stats`, `layout` (`IslandLayout`).
- `island_rect: Option<Rect>`, `island_hidden`, `island_summoned` (the shortcut or tray asked for the island; cleared whenever no full-screen app is in front), `previous_foreground: Option<i64>`.
- `last_error`, `warnings: Vec<String>`, `quitting`, `browser_token`.
- `web_media: Option<(Option<NowPlaying>, Instant)>` and `quotes: BTreeMap<String, QuoteState>`.

Lock rule: never call a Tauri API that waits on the main thread while holding the `inner` lock. That covers window and monitor queries, shortcut registration and menu building. Recover from a poisoned mutex with `unwrap_or_else(|e| e.into_inner())`.

`snapshot()` builds the `UiSnapshot` (§6). It reads the API status, Keep awake and the recording start time first, each under its own lock, then takes the inner lock.

### Actions (`actions.rs`)

Each action mutates state under the lock, then emits events and refreshes the tray after the lock is released. `notify_ui` emits `state-changed` and rebuilds the tray menu, and must be called without holding the lock.

- **`toggle_island`** (shortcut and tray "Open Island"): un-hides the island if it was hidden, records the foreground app, focuses the island window, then emits `island-toggle` to the island window.
- **`release_focus`**: re-activates the recorded foreground app.
- **`push_notification(input, symbol, source)`**: validates via `NotificationCenter::push`, then emits `notification` (the new item) and `notifications-changed` (the full list).
- **`send_test_notification`**: title "Hello from Islet", body "Notifications from scripts, timers and your battery show up here.", app "Islet", accent `#171717`, symbol `sparkles`, source system.
- **`set_do_not_disturb`**: persists, then emits `settings-changed` and `state-changed`.
- **`set_island_hidden`**: not persisted.
- **`replace_browser_token`**: writes a new token and calls `notify_ui`.
- **`extension_dir`**: in debug builds, `CARGO_MANIFEST_DIR/../extension`; otherwise `resource_dir/extension`. It must contain `manifest.json`.
- **`open_with_system`**: `open` on macOS, `explorer` on Windows, `xdg-open` elsewhere.
- **`open_widget_app`** opens the system app that goes with a widget from a fixed list. The page never names a program.
  - macOS: Clock and Timer → `/System/Applications/Clock.app` (exists only on macOS 13+, so error if it's missing), Calendar → `Calendar.app`, System → `Utilities/Activity Monitor.app`, Notes → `Notes.app`.
  - Windows: Clock and Timer → `explorer ms-clock:`, Calendar → `explorer outlookcal:`, System → `taskmgr`, Notes → `explorer shell:AppsFolder\Microsoft.MicrosoftStickyNotes_8wekyb3d8bbwe!App`.
  - Actions and Stocks have no app.
- **`apply_api`**: starts, stops or moves the server to match the settings. A busy port becomes `last_error`, not a crash.

### Errors (`errors.rs`)

`AppError` is a thiserror enum. Its variants map to these codes:

| Variant | Code |
|---|---|
| `Validation` | `validation` |
| `Settings` | `settings` |
| `Shortcut` | `shortcut` |
| `Platform` | `platform` |
| `Api` | `api` |
| `Autostart` | `autostart` |
| `Io` (from `std::io::Error`) | `io` |
| `Tauri` (from `tauri::Error`) | `internal` |

It serializes as `{ code, message }`. The frontend's `errorMessage(e)` reads `.message`.

## 5. Settings (`core/settings_service.rs`)

The settings are stored in `settings.json` (pretty JSON, camelCase), currently `schemaVersion` 1.

| Field | Type | Default | Rules |
|---|---|---|---|
| schemaVersion | u32 | 1 | |
| expandTrigger | `"hover"`\|`"click"` | hover | |
| islandStyle | `"notch"`\|`"island"` | notch | alias `"auto"` loads as notch |
| theme | `"graphite"`\|`"black"`\|`"midnight"`\|`"aurora"`\|`"ember"`\|`"slate"`\|`"glass"`\|`"picture"` | graphite | unknown names load as graphite (`#[serde(other)]` on the last variant) |
| islandSize | percent | 100 | clamp 50–150. Also accepts the old names `"small"`=88, `"medium"`=100, `"large"`=112 |
| panelSize | percent | 100 | clamp 80–150. Missing in old files → copy islandSize |
| toggleShortcut | string | `CommandOrControl+Shift+Space` | trimmed, non-empty, must parse as a Tauri accelerator |
| notificationSeconds | u32 | 5 | clamp 2–30 |
| doNotDisturb | bool | false | |
| widgets | WidgetId[] | all 9 in order (clock, calendar, timer, system, notes, actions, stocks, media, weather) | deduplicated, keeping first occurrences |
| widgetSizes | map WidgetId→{cols,rows} | {} | cols 1–3, rows 1–2. Old names: `"wide"`=2×1, others 1×1 |
| stocks | string[] | `["AAPL","NVDA","BTC-USD"]` | normalized, distinct, max 8 |
| islandStocks | string[] | [] | must be in `stocks`, distinct, max 3. Old field `islandStock` (a string) migrates to a list |
| musicBars | object | see below | colors normalized to `#rrggbb`, falling back to white |
| use24HourClock | bool | false | |
| batteryAlerts | bool | true | |
| apiEnabled | bool | true | |
| apiPort | u16 | 47821 | clamp 1024–65535 |
| startAtLogin | bool | false | |
| onboardingCompleted | bool | false | |

`musicBars` defaults: `{ enabled: true, position: "inside" | "below" (inside), flipped: false, colors: ["#ffffff","#ffffff"], showTitle: true }`.

WidgetId values, in order: `clock`, `calendar`, `timer`, `system`, `notes`, `actions`, `stocks`, `media` (no app to open).

`normalize_color` accepts `#rgb` or `#rrggbb` (trimmed) and returns lowercase `#rrggbb`, or nothing.

The struct uses `#[serde(default)]`, so missing fields take defaults.

- **`validate`** (for UI saves) rejects a wrong schemaVersion and an empty shortcut. It trims the shortcut, deduplicates widgets, clamps numbers and cleans stocks.
- **`sanitize`** (for disk loads) never fails. It replaces bad values with defaults and forces the version.
- **`migrate(doc)`** runs on raw JSON:
  - Version 1 applies `split_panel_size` and `list_island_stock`.
  - Version 0 or missing sets the version to 1, then applies both.
  - A newer version is an error.
- **Load:**
  - A missing file gives defaults.
  - An unreadable file gives defaults plus a warning.
  - If the stored version wasn't 1, keep a backup copy as `settings.v{N}-{unixSecs}.json` and warn "Settings were migrated; a backup was kept".
  - If sanitizing changed anything, warn "Some settings were out of range and were corrected".
  - A parse failure backs the file up as `settings.invalid-{ts}.json`, loads defaults, and warns with the backup's file name.
- **Save** is atomic: write `settings.json.tmp`, fsync, then rename.

**Applying a save** (`apply_settings` in commands.rs):
1. Validate the settings and parse the shortcut.
2. If the shortcut changed, re-register it. On failure, emit `shortcut-conflict` and return the error.
3. If start-at-login changed, enable or disable autolaunch. On failure, roll the shortcut back and return an `Autostart` error.
4. Save the file, store the settings, and clear `last_error`.
5. If the API settings changed, call `apply_api`.
6. Emit `settings-changed` and call `notify_ui`.

`reset_settings` applies the defaults with `onboardingCompleted: true`. The pairing token is in its own file, so a reset doesn't unpair the browser.

## 6. Data types shared by Rust and TS (camelCase JSON)

```ts
type NotificationSource = "api" | "system" | "widget" | "browser";
type NotificationSymbol = "battery"|"battery-charging"|"battery-full"|"battery-low"|"battery-warning"|"timer"|"sparkles"|"recording"|"music"; // "music" is island-only
interface IslandNotification { id: number; title: string; body: string; app: string; icon: string|null;
  image: string|null; symbol: NotificationSymbol|null; accent: string|null; source: NotificationSource; createdAt: number /*unix ms*/ }
interface NotificationInput { title: string; body?: string; app?: string; icon?: string; accent?: string; image?: string } // deny unknown fields
type PowerState = "charging"|"discharging"|"full"|"not-charging"|"unknown";
interface BatteryInfo { percent: number; state: PowerState; minutesRemaining: number|null }
interface NowPlaying { title: string; artist: string; app: string; image: string|null }
interface SystemStats { cpuPercent: number; memoryUsed: number; memoryTotal: number; battery: BatteryInfo|null; audioPlaying: boolean; cameraInUse: boolean; microphoneInUse: boolean; nowPlaying: NowPlaying|null }
interface IslandLayout { platform: "macos"|"windows"|"other"; notch: {width:number;height:number}|null; menuBarHeight: number }
interface ApiStatus { running: boolean; url: string|null; error: string|null }
interface Quote { symbol; name; price; previousClose; change; changePercent; currency: string; points: number[]; updatedAt: number }
interface QuoteState { symbol: string; quote: Quote|null; error: string|null }
interface UiSnapshot { settings; notifications: IslandNotification[] /*newest first*/; stats; layout; api: ApiStatus;
  islandHidden: boolean; lastError: string|null; warnings: string[]; platform; version: string; settingsPath: string;
  browserToken: string; keepAwake: boolean; recordingSince: number|null; quotes: QuoteState[] /*same order as settings.stocks*/ }
type QuickAction = "keep-awake"|"screenshot"|"mute"|"lock"|"calculator"|"downloads"|"record";
```

The frontend mirrors the constants: `NOTIFICATION_SECONDS_RANGE [2,30]`, `ISLAND_SIZE_RANGE [50,150]`, `PANEL_SIZE_RANGE [80,150]`, `API_PORT_RANGE [1024,65535]`, `MAX_SYMBOLS 8`, `MAX_ISLAND_STOCKS 3`, `WIDGET_MAX_COLS 3`, `WIDGET_MAX_ROWS 2`.

- `shortSymbol` (format.ts): drops a leading `^` and a 2–3 letter exchange suffix (`^VINDEX.VN` → VINDEX, `0700.HK` → 0700; `BRK.B` stays). Used for the pinned stock on the island and the Stocks widget rows.
- `normalizeSymbol`: trim, uppercase, and match `/^[A-Z0-9.\-^=]{1,15}$/`.
- `validateSettings` (client side): the shortcut can't be empty, and the port must be an integer within range.
- `widgetAppName(id, platform)` gives the name shown in tooltips. macOS: Clock, Calendar, Clock, Activity Monitor, Notes, Weather. Windows: Clock, Calendar, Clock, Task Manager, Sticky Notes, Weather (`/System/Applications/Weather.app`, `msnweather:`). Actions, Stocks and Media get null.
- `WIDGET_LABELS`: Clock, Calendar, Timer, System, Notes, Quick actions, Stocks, Now playing, Weather.
- **MediaWidget** (`media`): `MediaApi { track, playing, onCommand }`. `Island` keeps `recentTrack`, the last non-null `nowPlaying`. It passes `track = nowPlaying ?? recentTrack` and `playing = nowPlaying !== null`, so a paused track stays and can be resumed. The card shows a cover (40 px, or 56 px when wide or tall; Music2 placeholder), the title (13 px semibold) and the artist (or the app), plus Previous / Play-Pause / Next buttons (`size-8` round, filled icons). The buttons are disabled when `!controls`, with the tooltip "Control it in {app}". With no track it says "Nothing has played yet."
- **WeatherWidget** (`weather`): calls `getWeather()` on mount and every 15 min. Until data arrives it shows "Loading…" or the error. Laid out like the Clock card: the rounded temperature at 38 px top left with the condition icon (`size-6`) top right; at the bottom, the description (12 px medium) and, in white/50, `H {high}° L {low}° · {place}` for today (or "Feels {n}°" without a place). When wide or tall it adds `<ul aria-label="Next days">`: per later day, the short weekday (date parsed at local noon), its icon and `high° low°`. `weatherIcon(code)` maps wttr.in (WWO) codes: 113 Sun, 116 CloudSun, 119/122 Cloud, 143/248/260 CloudFog, 200 and 386–395 CloudLightning, the snow/sleet/ice codes CloudSnow, 176/263/266/293/296/353 CloudDrizzle, anything else CloudRain. °C only.

## 7. IPC commands and events

All commands are `async` (so they run off the main thread) and return `AppResult`.

| Command | Args | Returns |
|---|---|---|
| get_snapshot | | UiSnapshot |
| save_settings | settings | UiSnapshot |
| reset_settings | | UiSnapshot |
| complete_onboarding | | UiSnapshot |
| dismiss_error | | UiSnapshot (clears lastError and warnings) |
| set_island_rect | rect {x,y,width,height} | (). Rejects values that aren't finite or are negative. Clamps x and width to 1000, y and height to 6000 (`MAX_WINDOW_HEIGHT`) |
| release_focus | | () |
| push_notification | input, symbol? | Notification (source = widget) |
| send_test_notification | | Notification |
| dismiss_notification | id | () |
| clear_notifications | | () |
| set_do_not_disturb | enabled | UiSnapshot |
| open_settings | | () (unminimize, show, focus) |
| open_widget_app | widget | () |
| run_quick_action | action | `bool \| null` (the toggle's new state when known) |
| get_weather | – | `Weather { place, tempC, feelsLikeC, code, description, days: [{date, highC, lowC, code}] }` from `core/weather.rs`: `GET https://wttr.in/?format=j1` through `market::agent()`, place found by IP. Reads `current_condition[0]` (`temp_C`, `FeelsLikeC`, `weatherCode`, `weatherDesc[0]`), `nearest_area[0].areaName[0]`, and each `weather[]` day (`date`, `maxtempC`, `mintempC`, the code of the `1200` hour or else the first). Cached 15 min in a static; on failure it returns the last reading, else an error |
| get_background_image | slot: "panel"\|"island" | `Option<String>`: the slot's picture as a `data:image/jpeg|png;base64,` URL, from `core/background.rs` (`background.img` for the panel, kept from the single-picture version, and `background-island.img`, next to settings.json; type sniffed from magic bytes) |
| set_background_image | slot, image: string\|null | (). Decodes a `data:image/...;base64,` URL (max 3 MB, JPEG or PNG magic bytes only, else a Validation error), writes `background.img`, or deletes it for null; then emits `background-changed` with `{ slot, image }` (image a data URL or null) |
| open_stock_page | symbol | () opens `https://finance.yahoo.com/quote/{url_symbol}` |
| replace_browser_token | | UiSnapshot |
| open_extension_folder | | string (the path, after opening it) |

`url_symbol` replaces `^` with `%5E` and `=` with `%3D`.

Events from Rust, with their payloads:

| Event | Payload |
|---|---|
| `notification` | IslandNotification |
| `notifications-changed` | list |
| `settings-changed` | Settings |
| `state-changed` | null |
| `shortcut-conflict` | string |
| `system-stats` | SystemStats |
| `island-hover` | bool (sent to the island window only) |
| `island-layout` | IslandLayout |
| `island-toggle` | null (island only) |
| `quotes-changed` | QuoteState[] |

`listenAll(handlers)` subscribes to every listed event and returns a cleanup function. That function also unlistens subscriptions that resolve after cleanup.

## 8. Notifications (`core/notifications.rs`)

The history lives in memory as a `VecDeque`, newest first, capped at 50. IDs increase from 1. The history isn't persisted.

`push` validates and trims every input, so the UI can trust what it renders:

- **`clean(s, max)`** collapses all whitespace (newlines included) to single spaces. If the result is longer than `max` characters, it cuts it to `max-1` characters and adds `…`.
- **Title:** `clean` to 120 characters. An empty title is rejected with "A notification needs a title".
- **Body:** `clean` to 500 characters, defaulting to "".
- **App:** `clean` to 40 characters. The default depends on the source: api → "Script", browser → "Website", system and widget → "Islet".
- **Icon:** trimmed, first 4 characters (an emoji or letters).
- **Accent:** normalized hex. Anything invalid is rejected with `"X" is not a hex color like #22c55e`.
- **Image:** at most 12 KiB, and must be `data:image/{png|jpeg|webp|gif};base64,` followed by non-empty `[A-Za-z0-9+/=]`. SVG is refused because it can carry scripts.

## 9. Local HTTP API (`core/http_api.rs`)

`tiny_http` binds `127.0.0.1:{port}` only, on a thread named `islet-api`. Stopping the server calls `server.unblock()`, then joins the thread. If the port is busy, the error message is "Port {port} is unavailable ({e}). Choose another port in Settings."

The routing logic is a pure function, `route(ApiRequest{method,url,host,origin,authorization,content_type,body}, port, token)`, so it's unit-testable without sockets. It checks, in order:

1. **Origin:** if an `Origin` header is present and isn't a browser extension (`chrome-extension://`, `moz-extension://`, `safari-web-extension://`), return 403 "Browser requests are not accepted".
2. **Host:** it must be `127.0.0.1`, `localhost`, or either with `:{port}` (case-insensitive). Otherwise return 403 "Use http://127.0.0.1 to reach the Islet API". This blocks DNS rebinding.
3. **Auth:** `Authorization: Bearer <t>`.
   - The token matches (constant-time) → source `browser`.
   - No Authorization header and no Origin → source `api` (scripts).
   - Anything else → 401 "Not paired. Copy the token from Islet Settings → Browser into the extension".
4. **Path**, ignoring `?` and `#`:
   - `GET /v1/health` → 200 `{ ok:true, app:"islet", version, paired }`.
   - `POST /v1/notify` and `POST /v1/media`:
     - The content type must start with `application/json`, else 415.
     - The body must be at most 16 KiB, else 413. Over-long bodies aren't even read.
     - `/v1/media` requires source browser, else 401 "Only the paired browser extension reports media".
     - A body that doesn't parse returns 400 with "Invalid notification: …" or "Invalid media: …".
     - A successful notify returns 201 `{ok:true,id}`. A successful media report returns 200 `{ok:true}`. A sink error returns 400 `{ok:false,error}`.
   - The wrong method on a known path → 405. An unknown path → 404 "Not found. Use POST /v1/notify".

All responses are JSON. The token is read per request through a closure, so a new token applies without a restart.

**Pairing token** (`core/pairing.rs`): 16 random bytes from `getrandom`, written as 32 lowercase hex characters to the file `browser-token`. The file is written atomically (tmp, fsync, rename), with mode 0600 on Unix. On load, an invalid or missing token is replaced with a new one. `matches` is constant-time (XOR fold) and is false when the expected token is invalid.

## 10. Island window engine (`core/island.rs`)

The island is one transparent window, 1000 CSS px wide and as tall as the display (it starts at 800 and `place` stretches it), larger than the island ever gets. It's pinned to the top center of the primary display. Clicks pass through everywhere except the island's own rectangle.

The engine thread `islet-island` ticks every 30 ms while the island is visible. While it's hidden it parks for up to 1 s (`IDLE_POLL`); `island::wake()` (called by `toggle_island` and `set_island_hidden`) unparks it at once. Each tick is wrapped in `catch_unwind`, so a panic is logged and the loop continues.

1. **Every 2 s**, look up the primary display (or the first available one). Its `DisplayGeometry` is the bounds in native units plus `units_per_css_px` (1.0 on macOS, the scale factor on Windows). If the display changed:
   - Compute `top_center_origin(1000)`: `x = round(bounds.x + (bounds.width - 1000*u)/2)`, `y = bounds.y`.
   - Call `adapter.place_island`.
   - Read `adapter.island_layout`, store it, and emit `island-layout`.
2. **Full screen, every 1 s:** `adapter.full_screen()` returns `Option<bool>`. `None` (Islet itself in front) keeps the last answer; `Some(false)` also clears `island_summoned`.
   - macOS: the frontmost app (not Islet) has an on-screen layer-0 window (CGWindowListCopyWindowInfo, on-screen only, no desktop elements) whose bounds match `CGDisplay::main().bounds()` within 1 pt. No permission needed.
   - Windows: `SHQueryUserNotificationState()` is QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN or QUNS_PRESENTATION_MODE.
3. **Sync visibility:** the island should be visible when `!hidden && (!full_screen || summoned)` and it has been placed. Show it with `adapter.show_island` (which must not steal focus). Hide it with `window.hide()` and clear hover.
4. **Hover:** take the rect the page reported, grow it by 4 CSS px on every side (`outset`), and convert it to native units: `origin + r*u`. Test the pointer position against it (half-open rect).
   - When the hover state changes, call `set_ignore_cursor_events(!inside)` and emit `island-hover` to the island window.
   - On entering, record the current foreground app (a token), so focus can be handed back later.

At startup the engine calls `prepare_island` and `set_ignore_cursor_events(true)`.

Rust `Rect` has `right`, `bottom`, `is_empty`, `contains` (half-open, false when empty) and `outset`.

## 11. Platform adapter (`platform/adapter.rs`)

```rust
trait PlatformAdapter: Send + Sync {
  fn monitor_geometry(&self, &Monitor) -> (Rect, f64);   // bounds in global native units, units per CSS px
  fn pointer_position(&self) -> AppResult<Point>;
  fn prepare_island(&self, &WebviewWindow);
  fn place_island(&self, &WebviewWindow, origin: Point, &DisplayGeometry);
  fn show_island(&self, &WebviewWindow);                  // without taking focus
  fn island_layout(&self, &AppHandle) -> IslandLayout;
  fn foreground_token(&self) -> Option<i64>;              // None if it's Islet itself
  fn restore_foreground(&self, &AppHandle, token: i64);
  fn audio_playing(&self) -> bool;
  fn full_screen(&self) -> Option<bool>;           // None while Islet is in front
  fn camera_in_use(&self) -> bool;
  fn microphone_in_use(&self) -> bool;
  fn now_playing(&self) -> Option<NowPlaying>;
}
```

`create_adapter()` picks `MacAdapter`, `WindowsAdapter` or `GenericAdapter`. `platform_name()` returns `macos`, `windows` or `other`.

### macOS

All AppKit calls run on the main thread via `app.run_on_main_thread`, casting `window.ns_window()` to `&NSWindow`.

- **Geometry:** `monitor.position()` and `size()` converted to logical units with that monitor's scale factor. That gives global points. Units per CSS px is 1.0.
- **Pointer:** `CGEvent::new(CGEventSource::new(CombinedSessionState)).location()`. This is cheap and needs no permission.
- **prepare:**
  - `setLevel(NSMainMenuWindowLevel + 1)`, one level above the menu bar.
  - `setCollectionBehavior(CanJoinAllSpaces | Stationary | FullScreenAuxiliary | IgnoresCycle)`.
  - `setHasShadow(false)`, `setHidesOnDeactivate(false)`, `setAnimationBehavior(None)`.
- **place:** `set_size(Logical 1000 × display.bounds.height)`, then `set_position(Logical origin)`.
- **show:** `orderFrontRegardless()`. This shows the window without activating Islet or making it key.
- **layout:** run on the main thread and wait up to 2 s for the answer. On the first `NSScreen`:
  - `menuBarHeight` = frame top minus visibleFrame top. If that's 0 (an auto-hidden menu bar), use 24.
  - If `safeAreaInsets().top > 0`, the screen has a notch. Its width is the frame width minus the widths of `auxiliaryTopLeftArea` and `auxiliaryTopRightArea`. Its height is the top inset, and `menuBarHeight` becomes that inset.
- **Foreground:** `NSWorkspace.sharedWorkspace().frontmostApplication().processIdentifier()`, ignoring Islet's own pid. Restore with `NSRunningApplication::runningApplicationWithProcessIdentifier(pid).activateWithOptions(empty)`.
- **Audio playing:** raw CoreAudio FFI, `AudioObjectGetPropertyData`. Read the system object (1) property `dOut` (the default output device, global scope `glob`), then that device's `gone` property (kAudioDevicePropertyDeviceIsRunningSomewhere). Nonzero means playing. Known limit: an app that holds the device open while paused counts as playing.
- **Now playing:** check Spotify (`com.spotify.client`, process `Spotify`) then Music (`com.apple.Music`, process `Music`). Only ask a player that's running (`pgrep -xq <process>`), so the query never launches it. Run `osascript -e 'tell application id "<id>" to if player state is playing then return (name of current track) & tab & (artist of current track)'`. Parse the answer as `title<TAB>artist`. macOS asks the person once for Automation permission per player.

### Windows

Win32 calls run on the main thread via `window.hwnd()`.

- **Geometry:** physical pixels in virtual-screen coordinates (which can be negative). Units per CSS px is the monitor's scale factor. Tauri makes the process per-monitor DPI aware v2.
- **Pointer:** `GetCursorPos`.
- **prepare / show:** set the extended style `WS_EX_TOOLWINDOW | WS_EX_TOPMOST`, minus `WS_EX_APPWINDOW`, so the window is hidden from Alt+Tab and the taskbar. It stays activatable so the Notes widget can type. Show with `ShowWindow(SW_SHOWNOACTIVATE)`, then `SetWindowPos(HWND_TOPMOST, …, SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE|SWP_SHOWWINDOW)`.
- **place:** `SetWindowPos(HWND_TOPMOST, x, y, round(1000*scale), round(bounds.height), SWP_NOACTIVATE)`, called twice. The first move can trigger `WM_DPICHANGED` on a monitor with a different DPI. The second call makes the size exact.
- **Layout:** no notch (`IslandLayout::initial()`).
- **Foreground:** the `GetForegroundWindow` HWND, unless it belongs to Islet's own process. Restore with `SetForegroundWindow` after checking `IsWindow`.
- **Audio playing:** COM `IMMDeviceEnumerator` → `GetDefaultAudioEndpoint(eRender, eMultimedia)` → `IAudioMeterInformation::GetPeakValue()`. A peak above 0.001 counts as playing.
- **Now playing:** none (websites still report it through the extension).

### Generic (other OS)

Compiles only. The pointer returns an error, so the island never receives clicks, and placement sets a physical position.

## 12. System monitor (`core/system_monitor.rs`)

Thread `islet-system`, every 2 s:
- **CPU and memory:** `sysinfo::System`: `refresh_cpu_usage`, `refresh_memory`, `global_cpu_usage`, `used_memory`, `total_memory`.
- **Battery:** `starship_battery::Manager`. Use the first battery with a finite state of charge and `energy_full > 0`. Desktop Macs report a phantom battery with a NaN charge, which this check skips.
  - State mapping: Charging → charging; Discharging or Empty → discharging; Full → full; Paused → not-charging; anything else → unknown.
  - `minutesRemaining` is time to full while charging and time to empty while discharging, rounded. Zero is dropped.
  - Percent is clamped to 0–100.
- **Audio:** `audioPlaying = adapter.audio_playing()`.
- **Camera and microphone:** `cameraInUse = adapter.camera_in_use()`, `microphoneInUse = adapter.microphone_in_use()`. No permission needed on either OS.
  - macOS camera: CoreMediaIO, any device in `kCMIOHardwarePropertyDevices` ('dev#') with `kCMIODevicePropertyDeviceIsRunningSomewhere` ('gone') set.
  - macOS microphone: on macOS 14+, any process in `kAudioHardwarePropertyProcessObjectList` ('prs#') with `kAudioProcessPropertyIsRunningInput` ('piri'). Older systems fall back to 'gone' on the default input device ('dIn '), which also counts a headset that is only playing.
  - Windows: `HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\{webcam|microphone}`. Each app subkey (and each subkey of `NonPackaged`, for desktop programs) is in use when `LastUsedTimeStart > 0` and `LastUsedTimeStop == 0` (REG_QWORD).
- **Now playing:** a website's report wins if it's under 8 s old (`WEB_FRESH`) and something is playing. Otherwise, while audio plays, ask `adapter.now_playing()`. Asking starts a process, so it only happens when sound is playing.
- **Battery events** (if `batteryAlerts` is on), comparing the previous and current sample:
  - Neither state is unknown, and on-power changes: plugged in or unplugged. "On power" means charging, full or not-charging.
  - Charging → full: Full.
  - Not on power, and the percent crossed 20 or 10 (`prev > t && cur <= t`): Low(t). Only the lowest threshold crossed in one step is reported.
- Store the stats and emit `system-stats`.

Battery notifications (app "Battery", source system):

| Event | Title | Body | Symbol | Accent |
|---|---|---|---|---|
| PluggedIn | Charging | `{pct}% · power connected` | battery-charging | #22c55e |
| Unplugged | On battery | `{pct}% remaining` | battery | #737373 |
| Full | Fully charged | You can unplug the charger | battery-full | #22c55e |
| Low(20) | Battery at 20% | Connect a charger soon | battery-low | #f59e0b |
| Low(10) | Battery at 10% | Connect a charger soon | battery-warning | #ef4444 |

## 13. Media from the browser (`core/media.rs`)

**Controls and covers:** `NowPlaying.controls: bool` and `NowPlaying.browser: bool`. Website reports have `controls: true, browser: true`; desktop players have `controls: true, browser: false`. When `browser` is set, the command `media_control(player, command, browser)` doesn't call the adapter. Instead it stores `web_command = (command, now)`, and the extension collects it from `GET /v1/media/command`: extension origin plus token only, otherwise 401; other methods get 405; the reply is `{ok, command: "play-pause"|"next"|"previous"|null}`. Taking it clears it, and a command older than 10 s is dropped (`WEB_COMMAND_FRESH`). `ApiServer::apply` takes a `CommandSource` closure for this.

**Extension side:** the background worker records `mediaTab = {id, at}` on every top-frame media report. Every 1000 ms, while the last report is under 10 minutes old, it calls `takeMediaCommand`; each poll's `chrome.storage` read also keeps the worker alive. It sends `{type: "media-command", command}` to that tab (frameId 0). `bridge.js` accepts only the three commands and dispatches `islet:media-command`. `page.js` (top frame) wraps `navigator.mediaSession.setActionHandler` to keep the page's handlers. For play-pause it calls `pause` (or `el.pause()`) when an element is playing, otherwise `play` (or `.play()` on the element with `currentTime > 0`, else the first one). For next it calls `nexttrack`. For previous it calls `previoustrack`, falling back to `currentTime = 0`. `MediaCommand` is `play-pause | next | previous`. The command `media_control(player, command)` calls `adapter.media_control`:
- macOS: `tell application id {id} to playpause | next track | previous track`. Only Spotify and Music are allowed; anything else is a Validation error.
- Windows: the session whose `app_from_aumid` equals `player`, else `GetCurrentSession()`, then `TryTogglePlayPauseAsync` / `TrySkipNextAsync` / `TrySkipPreviousAsync`. A `false` result is an error.
- Generic: a Platform error.

Covers become `image` as `data:` URLs, because the CSP allows only `'self' data:` images. Each platform caches by track in a `static Mutex`, so a cover is read once. The cap is 300 KiB.
- Spotify's script appends `& tab & (artwork url of current track)`, and `parse_player` returns `(NowPlaying, Option<https url>)`. The cover is fetched with `market::agent()` and must have an `image/*` content type.
- On Windows it's `props.Thumbnail().OpenReadAsync().join()`, then the `Size`, then a `DataReader` over `GetInputStreamAt(0)`, then `LoadAsync` and `ReadBytes`. The `ContentType` comes from the stream, defaulting to image/png.
- Music has no artwork URL. Instead, one AppleScript per track writes `raw data of artwork 1 of current track` to `temp_dir()/islet-music-cover`. Islet reads the file, deletes it, sniffs PNG (`\x89PNG`) or JPEG (`FF D8 FF`), and drops anything else.

**Windows desktop players (`platform/windows/media.rs`):** `CoInitializeEx(MTA)`, then `GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.join()`. Take the first session from `GetSessions()` whose `GetPlaybackInfo().PlaybackStatus() == Playing`, then `TryGetMediaPropertiesAsync()?.join()` → `Title`, `Artist`. The app name comes from `app_from_aumid(SourceAppUserModelId)`: take the part after the last `!` or `\`, drop `.exe`, then map known ids (spotify→Spotify, chrome→Chrome, msedge→Edge, firefox, brave, opera, microsoft.zunemusic / microsoft.media.player→Media Player, vlc→VLC, itunes, applemusic→Apple Music, matching the whole name or a `.name` suffix). Otherwise keep the name as-is, or use "Media" when it's empty. `track(app, title, artist)` cleans these like `parse_player` does. No permission is needed, and it isn't asked while the sound is silent.

`MediaInput { title, artist?, app?, image?, playing }` (deny unknown fields).

`now_playing()` returns:
- None when not playing or when the cleaned title is empty.
- Otherwise `NowPlaying` with the title and artist cleaned to 120 characters and the app cleaned to 40 (default "Browser"). The image goes through the same check as notification images.

The media sink stores `(now_playing, Instant::now())` in `web_media`. The extension repeats its report every 3 s while playing, so a report older than 8 s is stale.

## 14. Stocks (`core/market.rs`)

Prices come from Yahoo Finance's public data, with no key. Quotes are only fetched while they're needed: when the Stocks widget is enabled or `islandStocks` isn't empty. The wanted symbols are `settings.stocks`.

**Symbols:** trim and uppercase, 1–15 characters, `[A-Z0-9.-^=]` (examples: AAPL, BRK-B, VNM.VN, ^GSPC, EURUSD=X, BTC-USD).

**Poller** (thread `islet-market`, ticks every 500 ms):
- A round is due when the symbol list changed, or when it's been longer than the interval:
  - 20 s after a failed round.
  - 300 s while the stream is connected.
  - 60 s otherwise.
- Each round fetches every symbol from `https://query1.finance.yahoo.com/v8/finance/chart/{url_symbol}?interval=5m&range=1d`.
  - Use a ureq agent with a 10 s timeout, native-tls, and User-Agent `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Islet`.
  - A 404 body still gets parsed, because Yahoo explains unknown symbols there.
  - A network error becomes "offline? …".
- Parse the response:
  - `chart.error.description` → an error.
  - `result[0].meta`: `regularMarketPrice` (required, finite), previous close = `chartPreviousClose` or `previousClose` (finite and > 0, else the price), currency, name = `shortName` or `longName` or the symbol.
  - Points: `indicators.quote[0].close`, dropping nulls and non-finite values, downsampled to at most 60 (every `ceil(n/60)`th value, always keeping the last).
  - `change = price - prevClose`, `changePercent = change / prevClose * 100`.
- Merge into `QuoteState`. On success, if a streamed price is under 300 s old, keep the streamed price (the chart's lags), then clear the error. On failure, keep the old quote and set the error.
- Emit `quotes-changed` with `quote_list()`, which lists every followed symbol in order and fills missing ones as empty.

**Streamer** (thread `islet-market-stream`):
**Vietnamese stocks (`.VN`):** never sent to Yahoo, since Yahoo's data for them is delayed. The streamer subscribes only to the wanted symbols that aren't `.VN`.
- Price: `GET https://bgapidatafeed.vps.com.vn/getliststockdata/{CODE1,CODE2}` (codes without `.VN`) returns a JSON array of rows `{sym, lastPrice, r, ...}`, priced in thousands of dong. Multiply by 1000; `r` (the reference price) is the previous close; when `lastPrice` is 0 (no trade yet), use `r`. Drop rows with no positive `r`. An unknown code returns `[]` → error "not found on HOSE, HNX or UPCoM".
- Indexes: `^NAME.VN` with NAME in VNINDEX/VINDEX (VPS code 10, bars VNINDEX), VN30 (11), HNX/HNXINDEX (02, bars HNX), HNX30 (12), UPCOM/UPCOMINDEX (03, bars UPCOM). `GET https://bgapidatafeed.vps.com.vn/getlistindexdetail/{codes}` → rows `{mc, cIndex, oIndex, vol}`: current value, reference, volume in shares. Points, no ×1000, empty currency.
- Volume: `Quote.volume: number | null`. Comes from Yahoo `meta.regularMarketVolume`, VPS stock `lot × 10` or VPS index `vol`; Yahoo stream ticks leave it alone. The Stocks widget shows it (compact, e.g. "47.5M", `w-11`, before the price) only at 3 columns wide.
- HTTP agent: `timeout_connect` 2 s, because one of VPS's two IPs never answers.
- Live: thread `islet-market-vn` polls VPS every 3 s for all wanted `.VN` symbols in one request and applies each row as a tick to existing entries (marking them streamed), then emits `quotes-changed`.
- Chart round: `fetch` for a `.VN` symbol makes the quote from VPS (name = code, currency VND), plus a sparkline from `GET https://dchart-api.vndirect.com.vn/dchart/history?resolution=1&symbol={CODE}&from={now-14d}&to={now}` → `{t:[unix s], c:[closes in thousands], s}`. Keep only the bars whose day in UTC+7 equals the last bar's day, ×1000, downsampled to 60. A failed bar fetch just leaves the sparkline empty.

- Connect a WebSocket to `wss://streamer.finance.yahoo.com/?version=2` with a 1 s read timeout on the TCP stream, so the loop can notice quitting and symbol changes.
- Send `{"subscribe":[symbols]}` and set the shared `streaming` flag.
- Each text message is JSON `{message: base64}`, and the base64 is a protobuf `PricingData`. Decode it by hand:
  - Field 1 (wire type 2) is the symbol string.
  - Field 2 (wire type 5, float32 little-endian) is the price.
  - Field 15 (wire type 5) is the previous close.
  - Skip other fields by wire type: 0 varint, 1 eight bytes, 2 length-delimited, 5 four bytes. Any other wire type → drop the message.
  - The price must be finite and > 0.
- Apply each tick: create the quote if needed, update the previous close if valid, then call `set_price`.
  - `set_price` recomputes the change, sets the last sparkline point to the price, and sets `updatedAt`.
  - If the previous close is ≤ 0, it becomes the price.
- Emit updates batched at most every 300 ms. Ping every 30 s.
- Return Ok when the symbols change or the app quits. On error, clear the `streaming` flag and retry with exponential backoff from 2 s, capped at 60 s.

## 15. Global shortcut (`core/shortcut_service.rs`)

`parse` uses `Shortcut::from_str`, with the error "Shortcut "X" is invalid: …".

`apply` is transactional:
- If the new shortcut has the same id as the current one, do nothing.
- Otherwise unregister the old one and register the new one with `on_shortcut`. The handler runs `toggle_island` on `ShortcutState::Pressed`.
- If registering fails, re-register the old shortcut and return "Shortcut is unavailable (it may be used by another app): …".

## 16. Quick actions (`quick_actions.rs`)

| Action | macOS | Windows |
|---|---|---|
| keep-awake (toggle) | spawn `caffeinate -d -i -w <own pid>` (it also exits when Islet does). On = child still running | a thread calls `SetThreadExecutionState(ES_CONTINUOUS|ES_SYSTEM_REQUIRED|ES_DISPLAY_REQUIRED)` and blocks on a channel. Dropping the sender ends it and resets to `ES_CONTINUOUS` |
| screenshot | `open /System/Applications/Utilities/Screenshot.app` | `explorer ms-screenclip:` |
| mute (toggle) | `osascript`: `set m to not (output muted of (get volume settings))`, `set volume output muted m`, `return m`. "true"/"false" → state. Anything else → error "this sound output cannot be muted" | `keybd_event(VK_VOLUME_MUTE)` down and up. Returns null (the direction is unknown) |
| lock | `pmset displaysleepnow` (locks when a password is required after sleep) | `LockWorkStation()` |
| calculator | `open /System/Applications/Calculator.app` | `calc` |
| downloads | open `download_dir()` with the system | same |
| record (toggle) | see below | `explorer ms-screenclip:` (Snipping Tool records from its toolbar) |

Keep awake calls `notify_ui` after toggling, so the snapshot's `keepAwake` updates.

**macOS screen recording:**
- **Start:**
  - Run `screencapture -v -C -k -x "<Desktop>/Screen Recording %Y-%m-%d at %H.%M.%S.mov"`, using the local time via chrono.
  - Wait 400 ms. If the process has already exited, the permission is missing: return the error "Allow Islet in System Settings → Privacy & Security → Screen Recording".
  - Record the start time in ms. `since()` returns it while the child is running.
  - Call `notify_ui`.
- **Stop:**
  - Take the recording out of the mutex and release the lock first. Writing the movie takes seconds, and every snapshot needs that lock.
  - Run `kill -INT <pid>` and poll for the process to exit, every 50 ms for up to 5 s. If it hasn't exited, kill it and return the error "the recording did not finish".
  - Reveal the file with `open -R <path>`.
  - Push a notification: title "Screen recording saved", body "Desktop · {file name}", app "Islet", accent #dc2626, symbol `recording`, source system.

## 17. Tray (`tray.rs`)

The tray has id `islet`. Its icon is a template image, embedded: `icons/tray.png` normally and `icons/tray-dnd.png` while Do Not Disturb is on. The tooltip is "Islet", or "Islet: Do Not Disturb". Left click shows the menu.

Menu items, in order:
- "Open Island" followed by four spaces and the shortcut label.
- "Do Not Disturb" (check item).
- "Hide Island" (check item).
- Separator.
- "Send Test Notification".
- A disabled item showing the API status: "API: {url}", "API: port unavailable" or "API: off".
- Separator.
- "Settings…".
- Separator.
- "Quit Islet".

`shortcut_label` turns accelerator parts into labels:
- macOS: CommandOrControl/Cmd/Command/Super/Meta → ⌘, Control → ⌃, Alt/Option → ⌥, Shift → ⇧, joined with no separator.
- Other platforms: CommandOrControl/Control → Ctrl, Super/Meta/Cmd → Win, Alt, Shift, joined with `+`.

Every `notify_ui` call rebuilds the menu (so the check marks stay correct), the icon and the tooltip.

## 18. Island page: geometry (`src/island/geometry.ts`)

Constants (CSS px):

| Constant | Value |
|---|---|
| Window size | 1000 × display height (800 until placed) |
| `WING` | 64 |
| `TITLE_WIDTH` | 40 |
| `CONTROLS_WIDTH` | 60 (added whenever the title is pinned) |
| `EXPANDED_WIDTH` | 640 |
| `PEEK_WIDTH` | 420 |
| `PEEK_BODY` | 72 |
| `WIDGET_COLUMNS` | 3 |
| `CARD_HEIGHT` | 132 |
| `GAP` | 10 |
| `PADDING` | 14 |
| `HEADER` | 30 |
| `MAX_VISIBLE_ROWS` | 3 |
| Bar width (no notch) | 190 |
| Edge height (Windows / other) | 32 |
| Capsule | gap 6, 196 × 36 |

Springs:
- `ISLAND_SPRING = {type:"spring", stiffness:380, damping:30, mass:0.9}` (a slight overshoot).
- `ISLAND_CLOSE_SPRING = {stiffness:560, damping:46, mass:0.8}` (no overshoot when closing).

`View = "compact" | "peek" | "expanded"`.

`Shape { attached, hugsNotch, idleInfo, topInset, compactWidth, compactHeight, top }`:
- **Style `island`:** `{attached:false, hugsNotch:false, idleInfo:false, topInset:0, 196, 36, top: (notch?.height ?? 0) + 6}`. On a notched Mac, the capsule sits just below the notch.
- **Style `notch` with a notch:** `{attached:true, hugsNotch:true, idleInfo:false, topInset:notch.height, compactWidth:notch.width, compactHeight:notch.height, top:0}`.
- **Style `notch` without a notch:** `{attached:true, hugsNotch:false, idleInfo:true, topInset:0, compactWidth:190, compactHeight: macOS ? max(menuBarHeight, 24) : 32, top:0}`.

Other helpers:
- **`islandScale(percent, range = ISLAND_SIZE_RANGE)`** clamps the percent and divides by 100. A non-finite value counts as 100.
- **`widgetRows(spans)`** simulates CSS grid's sparse auto-placement on 3 columns. Each widget goes to the first spot at or after the previous one where it fits, and the function returns the number of rows used (at least 1).
- **`expandedHeight(shape, rows, scale, screenHeight = ∞)`** is `h(n) = topInset + (PADDING + HEADER + GAP + n*CARD_HEIGHT + (n-1)*GAP + PADDING) * scale` for the largest `n ≤ rows` (at least 1) with `h(n) ≤ screenHeight - shape.top - SCREEN_MARGIN` (`SCREEN_MARGIN = 16`). There is no fixed row cap: the panel grows to the bottom of the screen, stops at the last whole row that fits so no row is cut off, and the rest scroll. The page passes the island window's real height (`useViewportHeight`: `window.innerHeight`, updated on resize; macOS can keep the window a menu bar short of the display, so the display's height is not used) to `islandBox` as `screenHeight`, and the grid scrolls when the uncapped height exceeds the capped one.
- **`contentShape(shape, scale)`** divides `topInset` by the scale. When the shape hugs the notch, it also divides `compactWidth` and `compactHeight`, because the notch has a fixed physical size while the content is zoomed.

`islandBox(shape, view, {wings, rows, scale, title})` returns `{x, y, width, height, topRadius, bottomRadius}`:
- **expanded:** width `640*s`, height from `expandedHeight`.
- **peek:** width `420*s`, height `topInset + 72*s`.
- **compact:**
  - Base width is `compactWidth` when hugging the notch (the notch never scales), else `compactWidth*s`.
  - Add `2*64*s` if the wings are showing, and `40*s` (title) plus `60*s` (buttons) if the title is pinned.
  - Height is `compactHeight` when hugging, else `compactHeight*s`.
- Round the width and height. `x = round((1000 - width)/2)`, `y = shape.top`.
- **Radii:**
  - Attached: the bottom radius is `20*s` for the big views (peek and expanded), else `min(12, height/2)`. The top radius is 0.
  - Floating: the bottom radius is `22*s` for the big views, else `height/2`. The top radius equals the bottom radius.

## 19. Island page: state machine (`islandState.ts`)

State: `{ hover, pinned, tab: "widgets"|"notifications", peek: Notification|null, queue: Notification[], unread }`.

`viewOf(s, trigger)` is `expanded` when the panel is pinned or (hovered and the trigger is hover). Otherwise it's `peek` when there's a peek, else `compact`.

"Opened" means the panel has been opened, which shows every notification. Opening sets the tab if one was given, sets `peek` to null, empties `queue` and sets `unread` to 0.

| Action | Result |
|---|---|
| hover(h, trigger) | sets hover. If `h` is true, the trigger is hover and the panel isn't pinned, the panel counts as opened |
| toggle | if pinned, unpin. Otherwise pin and open |
| open(tab?) | pin and open on that tab |
| close | unpin |
| tab(t) | set the tab |
| notify(n, dnd, trigger) | if expanded, unread = 0 and nothing else. Otherwise unread + 1. With DND on, stop there. If there's no peek, it becomes the peek. Otherwise it joins the queue |
| media(n, dnd, trigger) | if DND is off, there's no peek and the view isn't expanded, it becomes the peek. It doesn't touch unread |
| peek-done | the next queued item becomes the peek |
| dismissed(id) | remove it from the queue. If it was the peek, promote the next queued item |

## 20. Island page: `Island.tsx`

On mount, load the snapshot and subscribe to events:
- `notification` dispatches `notify` with the current DND and trigger, read through a ref so the subscription is made once.
- `notifications-changed`, `settings-changed`, `system-stats`, `quotes-changed` and `island-layout` patch the snapshot.
- `state-changed` reloads the snapshot.
- `island-toggle` dispatches `toggle`.
- `island-hover` is debounced. A hover-in waits 120 ms before dispatching and a hover-out waits 280 ms. This way, crossing the island on the way to the menu bar does nothing.

Other behavior:
- **Peek timer:** a peek lasts `notificationSeconds` seconds, then dispatches `peek-done`. The timer is paused while the island is hovered.
- **Closing:** Escape or window blur dispatches `close`. When the view leaves `expanded` while `document.hasFocus()`, call `releaseFocus()`.
- **Pinned stocks:** these are the quotes for `islandStocks` that have data. With 2 or more, rotate one every 4000 ms.
- **Music:**
  - `playing` is true when the bars are enabled and (audio is playing or `nowPlaying` is set).
  - "Bars inside" means playing with position inside. "Bars below" means playing with position below.
  - The title is pinned when the bars are inside or below, showTitle is on, nowPlaying is set, the shape doesn't hug the notch, nothing is recording, the timer is idle and unread is 0.
- **Island media buttons:** beside the pinned title (same row), always shown: Previous / Pause / Next. When `!nowPlaying.controls` they're disabled (`opacity-35`), with the tooltip "Control it in {app}". These are `size-5` round buttons with 12–14 px filled icons, and each click calls `stopPropagation` so the island doesn't open. While the pointer is over them, `overControls` blocks the hover-open timer. Leaving them while the island is still hovered schedules the open again.
- **Wings** show when recording, the timer is running or paused, unread > 0, the bars are inside, a pinned stock is showing, or the camera or microphone is in use.
- **Track peek:** when the track changes (key `app\ntitle`), showTitle is on and the shape hugs the notch, dispatch `media`. The synthetic notification has a negative id (`-Date.now()`), symbol `music` and source `browser`. There's no room beside a notch to show the title, so it peeks once instead.
- **Resize preview:** while a widget's corner is dragged, `sizePreview` overrides that widget's span, so the rows and panel height follow live.
- **Scale:** `panelSize` within 80–150 when expanded, `islandSize` within 50–150 otherwise.
- **Hit area:** call `setIslandRect` whenever the box changes. While a widget is being dragged or resized, report the whole window (0, 0, 1000, screenHeight), so the drag survives the pointer leaving the panel.
- **Saving widget changes:** order, sizes and `islandStocks` changed from the island are saved immediately and optimistically. On error, reload the snapshot.
- **Quick actions:** do-not-disturb calls `setDoNotDisturb`. Others call `runQuickAction`. screenshot, lock, calculator, downloads and record also close the panel.
- **Dismissing:** dispatch `dismissed`. Only call the backend when the id is > 0.

Rendering:
- **Shell:** a `motion.div` with classes `island absolute inset-x-0 mx-auto overflow-hidden bg-black text-white`.
  - Center it with layout, not a transform. WebKit can paint a layer for a frame before applying its transform, which flashes the island in the window's corner.
  - Animate `top`, `width`, `height`, the four corner radii, and `scale` (1.04 when hovered and not expanded), with `transformOrigin "50% 0%"`.
  - Use the close spring for compact and the open spring otherwise.
  - Floating islands get `ring-1 ring-white/[0.09]`. The big views get `shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_24px_60px_rgba(0,0,0,0.55)]` (a top-edge highlight plus a deep drop shadow). A floating compact island gets `shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_6px_18px_rgba(0,0,0,0.3)]`.
  - Clicking a view that isn't expanded opens the panel, on the notifications tab when the view was peek.
  - Track the shell's live width in a `useMotionValue`.
- **Ears** (attached shapes only): a separate pointer-events-none layer that mirrors the shell's spring and hover scale. It's `box.width + 2*ear*scale` wide and `ear*scale` tall, with `ear` = 8 compact and 14 big. Two square spans use `radial-gradient(circle farthest-side at 0 100%, transparent 96%, #000 100%)` (mirrored for the right side) to form concave corners that flare into the screen edge.
- **View layer:** inside `AnimatePresence`, keyed by view.
  - Each view is laid out at its own final box size, centered with `left:50%` and `marginLeft:-w/2`.
  - Its scale is `clamp(shellWidth/width, 0.15, 1.5)` with origin at the top, so the content fits the shell at every moment of a morph.
  - It enters from `opacity 0, blur 6px` to `opacity 1, blur 0` over 0.16 s, and exits to `opacity 0, blur 4px` over 0.2 s easeIn.
  - Inside it, a div is sized `box/scale` with CSS `zoom: scale`. Content is laid out at 100% and zoomed, which keeps text crisp at every size.
- **Bars below:** in compact view with the bars below, draw them under the island (outside its rect, so clicks pass through).
  - Position: `top = y + height + 3*scale`, width `box.width*0.8`, column gap `6*scale`. Don't zoom this layer, because WebKit zooms `top` too.
  - 24 bars, `22*scale` tall, row width `box.width*0.6`, bar width `w = max(1, row/24*0.4)`, gap `(row - 24w)/23` (MusicBars takes a `gap` prop, default 2), with a drop shadow.
  - Bars only. The title is never drawn outside the island: it's pinned in the compact island's middle, or it peeks beside a notch. When the bars are below, `Compact` gets `music.bars = false`, so it shows the icon and title without the wing bars.
  - Animate in from `opacity 0, y -6, blur 4px` with the island spring.

## 21. Island views (`views.tsx`)

The icon button style is `size-7 rounded-full text-white/80 hover:bg-white/[0.14] focus-visible:ring-2 ring-white/40 active:scale-95`.

**Compact.** Content priority, first match wins:

1. **Recording:** on the left, a red dot (`size-2.5 bg-red-500`) pulsing opacity 1 → 0.35 → 1 over 1.6 s, inside a stop button (aria "Stop recording", `stopPropagation`). On the right, the elapsed time counting up in whole seconds, in red-400, as a SlidingNumber.
2. **Timer** running or paused: an amber-400 Timer icon on the left and the remaining time on the right. Both are dimmed to 50% while paused.
3. **Unread:** a BellRing icon on the left. On the right, a white pill with black text showing the count, "99+" above 99.
4. **Music:** on the left, the now-playing image (18 px, rounded, white background) or a Music2 icon in tip color. On the right, 4 MusicBars 14 px tall. In the middle, when the title is pinned, the title and ` · artist` in white/70, truncated, sliding in from y 4.
5. **Pinned stock:** on the left, the symbol, plus the price as a SlidingNumber unless the shape hugs the notch. On the right, ▲ or ▼ and the absolute percent, emerald-400 up or red-400 down.
6. **Idle info** (bar without a notch): on the left, the clock with AM/PM at 10 px in white/70. On the right, a battery glyph: the percent and a small outlined battery, emerald while charging and red at 20% or below while not charging.

The Dynamic Island capsule shows nothing when idle.

**Camera and microphone dots**, added on top of whichever of the above shows: at the end of the right side, a `size-1.5` green-500 dot for the camera and an orange-400 dot for the microphone (`role="status"`, aria "Camera in use, Microphone in use"). If nothing else shows on the left, the kind becomes `privacy` with a green Video or orange Mic icon there. Either flag also turns the wings on.

Left and right items slide in from their side (`x ∓6`, blur 4px, spring 400/30), keyed by kind.
- **Hugging the notch:** the left wing animates its width between 0 and 64 (padding-left 14), then a spacer the notch's width, then the right wing (padding-right 14).
- **Otherwise:** `flex justify-between gap-3 px-3.5`. Text is 12 px semibold.

**Peek.** Padding-top is `topInset`. A 38 px NotificationIcon, then a column: app (white/90) and relative time on one line at 11 px white/70, the title at 13 px semibold (truncated), and the body at 12 px white/75 (truncated). An X dismiss button with `stopPropagation` at the end.

**Expanded.** Padding 14, with padding-top `topInset + 14`.
- **Header** (30 px tall):
  - **Themes (`src/shared/themes.ts`):** `THEMES[id] = { label, island(picture), panel(ambient, picture) }`, both returning CSS backgrounds; the island shell uses `style.background`. `panel` is the expanded view's backdrop and always starts `#000` at the top (it meets the notch). `island` colors the shell (`backgroundColor`) only for floating shapes; attached (notch) shapes stay black, except with Picture. Graphite: the gradient below. Black: `#000`. Midnight: cover wash 0.12 over `#000 → #070b1a 40% → #0e1836`, island `#0a1024`. Aurora: teal `45 212 191 / 0.22` at 12% 90% and violet `167 139 250 / 0.24` at 92% 70% over `#000 → #05080b`, island `#061114`. Ember: amber `251 146 60 / 0.24` from below over `#000 → #120a06 55% → #1f0f08`, island `#160b06`. Slate: cover wash 0.12 over `#000 → #1a1b20 35% → #25272e`, island `#1c1d22`. Glass: `#000 → rgb(0 0 0 / 0.3) 12% → rgb(0 0 0 / 0.25)`, island `rgb(0 0 0 / 0.4)`; while open, the shell (normally `bg-black`) is made transparent so the desktop shows through. Picture: with a saved picture, the panel is `linear-gradient(180deg, #000 0%, rgb(0 0 0 / 0.6) 14%, rgb(0 0 0 / 0.35) 55%, rgb(0 0 0 / 0.5) 100%), url("<data URL>") center / cover no-repeat, #000` and the floating island is its picture under a flat `rgb(0 0 0 / 0.45)` layer. The island uses the island picture, else the panel picture. Without a panel picture it looks exactly like Graphite. `themeLook(id)` falls back to Graphite.
  - **Background pictures:** two slots, `"panel"` and `"island"` (`BackgroundSlot`), because the wide panel and the thin capsule need different crops. `useBackgroundImages()` (`src/shared/background.ts`) returns `{ panel, island }`: it calls `get_background_image` for each slot on mount and listens for `background-changed` (`{ slot, image }`). Both the island and Settings use it.
  - **Ambient glow ("glass + depth"):** the expanded view is `relative isolate`; its first child is an absolute `-z-10` layer whose background is `themeLook(settings.theme).panel(ambient)`; for Graphite that is: `radial-gradient(90% 55% at 50% 110%, rgb(ambient / 0.14), transparent 70%)` over `linear-gradient(180deg, #000 0%, #0b0b0d 45%, #111114 100%)`. The top stays pure black so it meets the notch; the cover's color is only a faint wash rising from the bottom. `ambient` comes from `useAmbient(image)` (`island/ambient.ts`): the cover of the playing (or last) track drawn onto an 8×8 canvas and averaged, then `lift`ed so its brightest channel is at least 140, keeping the hue. With no cover it's `DEFAULT_AMBIENT` = indigo `99 102 241`. The island window can't blur the desktop, so the tiles' `backdrop-blur-xl` blurs this glow instead.
  - A segmented tab list (`bg-white/[0.06] ring-1 ring-white/[0.06] rounded-full p-0.5`) with text-only tabs Widgets and Notifications (count badge `bg-white/90`, 10 px). Inactive tabs are white/50. The active tab has a sliding `layoutId` pill, `bg-white/[0.12]` with an inset top highlight and a small shadow, spring 500/38. The header's icon buttons are white/60, hover `bg-white/[0.10]`.
  - On the right: a DND moon button (violet when on, filled icon) and a Settings button.
- **Body:** tab content cross-fades (x ±12, spring 420/36).
  - **Widgets tab:** the WidgetGrid. It scrolls when there are more than 3 rows. With no widgets, show the "No widgets" empty state and a "Choose widgets" button that opens Settings.
  - **Notifications tab:** a list of `TILE` cards (padding 12). Each card has a 34 px icon, the app (white/60 medium) and time (white/35), the title (13 px semibold, tight), the body (white/60) clamped to 2 lines, and an X button. "Clear all" is a small glass pill. Items animate in from y -8 and exit to x 24. A "Clear all" button sits at the bottom right.
  - **Empty states** show the icon (stroke 1.5) in a 48 px `TILE` square. "Choose widgets" is a white pill with black text.
  - **Empty notifications:** "You're all caught up", plus "Scripts can send notifications to `{apiUrl}/v1/notify`" when the API is on.
- `relativeTime`: "now" under 60 s, then "Nm", "Nh", "Nd".

**NotificationIcon:** a rounded tile with 28% radius.
- With an image: a white background, the image at 62% of the tile.
- Otherwise: the accent color as background (or white/14), showing the symbol's Lucide icon at 50%, else the icon text, else the first letter of the app, uppercase.
- Symbol icons: battery → Battery, battery-charging → BatteryCharging, battery-full → BatteryFull, battery-low → BatteryLow, battery-warning → BatteryWarning, timer → Timer, sparkles → Sparkles, recording → Video, music → Music2.

**SlidingNumber:** splits the string into characters keyed by their position from the right, so "9:59" → "10:00" keeps the seconds in place.
- Non-digits stay static.
- Each digit sits in a fixed slot (an invisible "0" for width). The new digit enters from `y 70%, opacity 0, blur 2px` and the old one exits to `y -70%`, spring 420/32.
- Don't use AnimatePresence `popLayout`: it adds a `<style>` tag per change, and WebKit rebuilds every style rule each time.

**MusicBars:**
- Presets: White `#fff/#fff`, Sunset `#f97316/#ec4899`, Ocean `#0ea5e9/#22d3ee`, Aurora `#22c55e/#a855f7`, Fire `#ef4444/#facc15`, Candy `#a855f7/#f472b6`.
- Every 140 ms, pick new heights: `max(0.15, arch * (0.25 + rand*0.75))`, where `arch = 0.55 + 0.45*sin(π(i+0.5)/count)` when count > 4, else 1. The middle bars reach highest, like a spectrum.
- Each bar is a rounded span of `barWidth` (default 3) with a 2 px gap, using `transform: scaleY(level)` with a CSS transition `140ms cubic-bezier(0.3,1.5,0.5,1)`. CSS runs on the compositor, while a JS spring per bar would cost a main-thread animation for every bar.
- The gradient runs base → tip. Flipped bars hang from the top.
- With reduced motion, the bars stay still.
- `role="img"`, aria-label "Playing sound".

## 22. Widgets (`widgets/Widgets.tsx`, `WidgetGrid.tsx`)

The card style is `TILE`: `rounded-[18px] bg-black/30` under a white/5 gradient tint, `ring-1 ring-white/[0.07] ring-inset` and an inset top highlight, plus `relative isolate p-3`. `backdrop-blur-md` (12 px) softens the panel's background or picture behind each tile, and the dark layer keeps text readable. (WidgetGrid's drag wrapper uses the same 18 px radius.) An optional title uses `LABEL`: 10 px semibold uppercase, tracking 0.12em, white/40, no icon. Controls inside tiles are `GLASS_BUTTON`: `bg-white/[0.07] ring-1 ring-white/[0.06]`, hover `bg-white/[0.14]`. Big numerals are light: Clock time `font-light` (AM/PM 12 px white/45), Calendar's wide date `font-light`, Weather `font-extralight` at 42 px, the running timer `text-lg font-light text-amber-300`.
- **Media tile:** when the track has a cover, the same image fills the tile behind the content (`-z-10 scale-150 object-cover opacity-45 blur-2xl saturate-150`), and the cover thumbnail gets a drop shadow. Play/Pause is a 40 px white circle with a black icon; skip buttons stay ghost; gap 12.
- **Weather tile:** a corner glow `radial-gradient(90% 90% at 100% 0%, rgb(tint / 0.28), transparent 70%)`, where `weatherIcon(code).tint` is amber for sun, orange for partly cloudy, slate for cloud and fog, violet for storms, pale blue for snow, sky for drizzle and rain.
- **Quick actions:** no heading and no hover tooltips (each button keeps its `aria-label`). Unlabeled buttons are 40 px circles (icons 18 px, stroke 1.75) centered in a 4-column grid with gap 8; labeled ones (wide or tall) fill their cells as `rounded-2xl`. An error floats for 2.5 s as a dark pill (`role="status"`, red-300 text) at the bottom of the tile.
- **Stocks:** rows are 27 px with `divide-y divide-white/[0.05]` hairlines; the company name is white/40.
- **System meters:** label white/55, value white, a 3 px track `bg-white/[0.08]` with a `from-white/60 to-white` gradient fill.
- **Notes:** 13 px text at white/90, placeholder white/30. Cards stagger in from `opacity 0, y 8, blur 4px` (stagger 0.04 s, delay 0.05 s, spring 380/30). A span is "wide" when cols ≥ 2 and "tall" when rows ≥ 2.

- **Clock:**
  - A SlidingNumber of the time, plus AM/PM. Font size: 38 px small, 56 px when wide or tall, 88 px when both.
  - The long weekday and the date (month, day, year).
  - Wide but not tall lays out as a row.
- **Calendar:**
  - `monthGrid` returns 42 days (6 weeks starting Sunday, so the grid height never changes), flagged `inMonth` and `isToday`.
  - Weekday headers S M T W T F S. Weekday headers are white/40. Today is a white circle with black text. Days outside the month are white/30.
  - Small: the month name and a mini grid (14 px rows). Wide: the weekday in red-400 uppercase, the date in 5xl, and "Month Year" on the left, with the grid on the right. Tall uses the big grid (30 px rows). The month name uses the `LABEL` style.
- **Timer:**
  - Idle: preset buttons for 1, 5, 15 and 25 min (a 4-column grid when wide but not tall). Each shows the number at 13 px semibold and "min" at 10 px white/50 on one baseline; the accessible name is "{n} min".
  - Running or paused: an SVG ring (r=34, stroke 5, amber-400 over amber-400/15, rotated -90°, `strokeDashoffset = c*progress`), with the remaining time inside. Pause or resume, and cancel, as amber round buttons.
  - The pure state is idle, running `{duration, endsAt}` or paused `{duration, remaining}`, using wall-clock ms.
  - `useTimer` ticks every 250 ms while running. On finish it goes idle, plays a chime (Web Audio: 880 Hz then 1320 Hz, 0.18 s apart, exponential gain envelope peaking at 0.2), and pushes a notification: "Timer finished" / "{duration} is up", app Timer, accent #f59e0b, symbol timer.
  - The timer lives at the island level, so the compact view can show it.
- **System:** meters for CPU, Memory ("used / total" via `formatBytes`) and Battery.
  - Battery detail: "N%", plus " · charging" or " · {minutes}".
  - The battery meter is green while charging or full, and red at 20% or below.
  - Meters are 1 px tall bars with spring-animated width and `role="meter"`.
- **Notes:** a textarea saved to `localStorage["islet.notes"]`, debounced by 300 ms, with try/catch. Placeholder "Jot something down…".
- **Quick actions:** a 4×2 grid. In order: Record screen (Video), Screenshot (Camera), Keep awake (Coffee), Do Not Disturb (Moon), Mute (VolumeX), Lock (Lock), Calculator (Calculator), Downloads (FolderDown).
  - Toggles that are on are lit: record in red, DND in violet, others amber. Mute shows the state Islet last set.
  - While recording, the Record label reads "Stop recording".
  - Labels show only when the card is wide or tall.
  - An error replaces the card title for 2.5 s.
- **Stocks:**
  - Shows 3 rows, or 7 when tall. Each row is a button that opens the quote page. It shows the symbol, the name and a sparkline when wide, the price as a SlidingNumber, and the percent colored by change.
  - The sparkline is a 100×32 SVG: a polyline of the points plus a dashed baseline at the previous close.
  - A pin button appears on hover. It toggles the symbol on the island, and is disabled when 3 are already pinned.
  - With no symbols: "Add symbols in Settings → Widgets."

**WidgetGrid:** `grid grid-cols-3 auto-rows-[132px] gap-2.5`. It scrolls only when needed: a zoomed panel can be a fraction of a pixel shorter than its rows, which would show a scrollbar.
- **Sorting:** dnd-kit with a `FieldSafePointerSensor` (distance 6). That sensor is a PointerSensor that ignores presses in textarea, input or `[data-no-drag]`. Add a KeyboardSensor with sortable coordinates, `closestCenter`, `restrictToParentElement` and `rectSortingStrategy`.
- **Accessibility:** screen-reader announcements for pick-up, move, drop and cancel.
- **Dragging:** the whole card drags with the pointer. A grip button (top right) is the keyboard handle. A dragged card scales to 1.04 with a big shadow.
- **Clicks:** clicking a card that wasn't just dragged, and not on an interactive element, opens its app. A "just dragged" ref stays set until the next task, because the release of a drag also fires a click.
- **Controls:** an ArrowUpRight "Open" button and the grip appear on hover or focus.
- **Corner resize handle:**
  - On pointer down, measure the grid. Scale = rect.width / offsetWidth, which absorbs the zoom. Cell = `(offsetWidth - 2*GAP)/3`, column unit = `(cell+GAP)*scale`, row unit = `(132+GAP)*scale`.
  - On pointer move, compute `clampSpan(cols + dx/colUnit, rows + dy/rowUnit)` and call `onResize(span, false)`.
  - On pointer up, call it with `true`. Pointer cancel reverts to the starting span.
  - Arrow keys resize by one cell.
  - While active, a white "C × R" pill shows.
- `dropWidget(list, active, over)` moves the active widget to the over widget's index.

## 23. Settings window

Settings follows the system appearance: `useSystemTheme` toggles the `.dark` class on `<html>` from `prefers-color-scheme`. Both pages wrap content in `<MotionConfig reducedMotion="user">`.

**Glass on macOS:** `src-tauri/tauri.macos.conf.json` repeats both windows (platform configs replace arrays) and gives Settings `transparent: true`, `titleBarStyle: "Overlay"`, `hiddenTitle: true` and `windowEffects: { effects: ["sidebar"], state: "followsWindowActiveState" }`. When `snap.platform === "macos"`, App adds `vibrant` to `<html>`, which makes `body` transparent, the sidebar `bg-transparent` with `pt-10` for the traffic lights, and adds `data-tauri-drag-region` on the sidebar, the brand row, and an 32 px strip at the top of the main area (capability `core:window:allow-start-dragging`). Windows keeps the normal frame.

**Depth:** the main area uses `bg-canvas` (light `oklch(0.975 0.002 286)`, dark `oklch(0.165 0.004 286)`) so cards (`border-black/[0.06]`, dark `border-white/[0.07]`, shadow `0 1px 2px /0.04, 0 4px 12px -6px /0.06`) sit above it. Section titles are 11 px semibold uppercase muted labels (tracking 0.08em); rows are `px-4 py-3.5` with 13 px label and description; RowCard hairlines are black/white 6%. The page title is 26 px semibold, tight.

**Layout:**
- **Sidebar:** 56 px wide, or 224 px (`sm:w-56`) when there's room. Hairline right border (6%). Nav items are 32 px tall, 13 px, `rounded-lg`; inactive text is foreground/65 with icons at foreground/50 (stroke 1.75); the active pill is `bg-black/[0.07]` (dark `bg-white/[0.09]`).
  - A brand mark: a miniature island, a 32 px square with a vertical neutral-700→black gradient, inset highlight and soft shadow, holding a black pill (white/15 ring) with a glowing emerald dot.
  - "Islet v{version}".
  - Nav items with a sliding `layoutId` highlight.
  - A Do Not Disturb switch at the bottom.
- **Main area:** `max-w-2xl`, with the tab title and description at the top.
- **First-run card:** while onboarding isn't complete, show a "Welcome to Islet" card with 4 bullets and a "Got it" button that calls `complete_onboarding`.
- **Alerts:** a dismissible destructive alert for the local error, the snapshot's `lastError` (dismissed via `dismiss_error`), and info alerts for warnings.
- **Section transitions:** opacity and y, 0.2 s.

**`useSnapshot`:**
- Loads the snapshot and reloads on `settings-changed` and `state-changed`. `shortcut-conflict` sets the error and reloads.
- `update(patch)` validates on the client, applies the change optimistically, then calls `saveSettings`. On error, it shows the message and reloads.
- `run(action)` adopts the result if it's a snapshot.

**Tabs:**
1. **General** ("Style, shortcut and startup.")
   - StylePicker: a Radix RadioGroup of two cards with miniature screen-top previews. "Notch" reads "Wraps around the notch" or "Hangs from the top edge of the screen". "Dynamic Island" reads "A floating capsule, like on iPhone". The chosen card gets a `foreground/60` border and an `accent/60` fill rather than a heavy ring.
   - **Theme** section (after Style): `ThemePicker`, a RadioGroup of eight swatches (`grid-cols-4 sm:grid-cols-8`), each a 56 px miniature panel in the theme's `panel(DEFAULT_AMBIENT)` with a tiny island pill in its `island` color and three faint tiles, labeled below; the chosen one gets a 2 px foreground ring with a canvas offset. The description says the closed island stays black with the Notch style, unless the theme is Picture: the island picture then fills the attached shape too (the hardware notch covers its middle). The Picture swatch shows the saved picture, or a dashed tile with an ImagePlus icon when there is none; choosing it selects Picture and shows the two picture rows (Panel, Island), each with an empty dashed thumbnail and a "Choose…" button until a picture is saved; the button opens a hidden file input (`image/jpeg,image/png,image/webp`). Removing a picture keeps Picture selected. A chosen file is read as a data URL (`readPicture`; blob URLs are blocked by the CSP) and opened in **CropDialog** (`src/settings/CropDialog.tsx`, a Radix Dialog titled "Frame the panel picture" / "Frame the island picture"):
     - The frame is 440 px wide with the slot's aspect (`CROP_ASPECT`: panel 4:3, island 8:1), drawn `rounded-[18px]` for the panel or `rounded-full` for the island, with a 2 px white ring. Around it (margin 20 px; 56 px above and below the island pill) the rest of the picture shows at 35% opacity.
     - The picture starts centered at zoom 1, where it just covers the frame (`displayScale = max(frameW/w, frameH/h) * zoom`). Drag (pointer capture) moves it, the wheel zooms by ×1.08 per step, the Zoom slider goes 1–4 (`MAX_ZOOM`), and the arrow keys move it 12 px when the stage (role "application") has focus. Zooming keeps the frame's center fixed (`zoomAround`), and every move is clamped so the picture always covers the frame (`clampOffset`).
     - "Use picture" draws `sourceRect(offset, frame, scale)` into a canvas `CROP_WIDTH` wide (panel 1600, island 1200) at the slot's aspect and exports JPEG 0.85, then `set_background_image(slot, …)` and `theme: "picture"`. Cancel or Esc closes without saving; a file that won't decode closes with an error.
     - The math lives in `src/settings/crop.ts` with unit tests. While Picture is selected with a panel picture, a card below lists two rows: "Panel picture" (a 64×40 thumbnail) and "Island picture" (a 64×16 capsule thumbnail showing the island picture or the borrowed panel one). Each has "Change…"; Remove appears for a slot that has its own picture. The island row's hint is "Uses the panel picture until you choose one.", or, with the Notch style, that it only shows with the Dynamic Island style. Removing the panel picture returns to Graphite; removing the island picture falls back to the panel's. Failures show in the Settings error alert.
   - Island size and Panel size SizeSliders. Each has −/+ buttons (step 5), a Radix slider (step 1), and a "N%" button that resets to 100%. While dragging, live updates are throttled to at most one every 80 ms, and echoes are ignored while dragging.
   - Open on Hover or Click (ToggleGroup).
   - The keyboard shortcut (ShortcutInput), a 24-hour clock switch, and Start at login.
2. **Notifications:** Do Not Disturb. "Show each notification for" as a 2–30 s slider that commits on release. Battery alerts. A "Send test notification" button that briefly shows "Sent" with a check.
3. **Now playing:**
   - A preview box (`bg-neutral-950`) with 24 bars, 36 px tall, bar width 5.
   - Show bars; position "In the island" or "Below the island"; Upside down; Show the title.
   - Colors: 6 preset swatches (gradient circles, `aria-pressed`) and two `<input type=color>` for the base and tip colors.
4. **Widgets:**
   - The WidgetList. Shown widgets come first and are sortable vertically (drag handle, or up/down buttons). Hidden widgets follow. Each row has a Switch, a label and a size `<select>` with 1×1, 2×1, 3×1, 1×2, 2×2, 3×2.
   - Toggling a widget on appends it to the end of the list.
   - The Stocks editor: a list of symbols with name, price and currency (or the error, or "Loading…"), an "On island" pin toggle (disabled at 3), and a remove button. Removing a symbol also takes it off the island.
   - An add form with validation messages: "Use a ticker symbol such as AAPL, BTC-USD or VNM.VN" and "{S} is already in the list". The field is disabled at 8 symbols.
5. **Browser:**
   - A warning if the API is off.
   - Three numbered setup steps.
   - An "Extension folder" row with a "Show folder" button, which displays the returned path.
   - The pairing token, masked with • and with show/hide and Copy.
   - A "New token" button.
   - A note on turning off the browser's own system notifications.
6. **API:**
   - Enabled switch.
   - Port number input, applied on blur or Enter, and reverted if the save is rejected.
   - Status badge: "Listening on {url}" (success) or "Port unavailable" / "Off" (warning).
   - A copyable example: curl on macOS and Linux, `Invoke-RestMethod` on Windows.
   - A field table for title, body, app, icon and accent, and the health check URL.
7. **About:** version, settings file path, and "Reset…" which asks for confirmation before "Reset all settings".

**ShortcutInput:** click to record, then press keys. Escape cancels. `captureAccelerator(e, isMac)` works like this:
- Modifier keys alone keep it pending.
- The key comes from `e.code`: `KeyA` → A, `Digit1` → 1, F1–F24, Space, Enter, Tab, Backspace, Delete, Insert, Home, End, PageUp, PageDown, the arrows, Minus, Equal, Comma, Period, Slash, Backquote, Semicolon, Quote, BracketLeft, BracketRight, Backslash.
- Modifiers on Mac: Meta → `CommandOrControl`, Ctrl → `Control`. On PC: Ctrl → `CommandOrControl`, Meta → `Super`. Then Alt, then Shift.
- No modifier, or Shift alone, is an error, because it would steal ordinary typing. The message asks to include ⌘, ⌃ or ⌥ (Mac) or Ctrl, Alt or Win (PC).
- `formatAccelerator` displays the result with Mac symbols (no separator) or PC names joined by `+`, and arrows as ↑↓←→.

**Theme** (`globals.css`):
- Tailwind v4 with `@custom-variant dark (&:is(.dark *))`.
- The shadcn neutral OKLCH tokens for `:root` and `.dark`, plus `--success` and `--warning`. Light: success `oklch(0.527 0.154 150.069)`, warning `oklch(0.555 0.163 48.998)`. Dark: success `oklch(0.792 0.209 151.711)`, warning `oklch(0.828 0.189 84.429)`.
- `--radius: 0.625rem`. Fonts: Geist Variable and Geist Mono Variable.
- Every button that isn't disabled gets a pointer cursor.

**Components:**
- Button variants: default, destructive, outline, secondary, ghost, link. Sizes: default `h-9`, sm `h-8`, lg `h-10`, icon `size-9`, icon-sm `size-8`.
- Badge variants: default, secondary, outline, plus `success` (`bg-success/12 text-success`) and `warning`.

**Island CSS:** html, body and #root are transparent, with `overflow:hidden` and `user-select:none` (except textarea and code). `.thin-scroll` sets `scrollbar-width: thin` with a `white/15` thumb.

## 24. Browser extension (`extension/`)

**Manifest V3:**
- Name Islet, `minimum_chrome_version` 111.
- Permissions `storage`, `favicon`, `activeTab`. Host permission `http://127.0.0.1/*`.
- The background service worker is a module.
- Two content scripts on all http and https pages, both with `document_start` and `all_frames`:
  - `page.js` in the MAIN world.
  - `bridge.js` in the isolated world.

- **page.js** (runs in the page's own world, the only place that sees the page call the Notification API):
  - Wrap `window.Notification` in a Proxy whose `construct` reports the call, and wrap `ServiceWorkerRegistration.prototype.showNotification` the same way.
  - Report only when `Notification.permission === "granted"`: dispatch `CustomEvent("islet:notification", {detail: JSON {title, body, tag}})`.
  - Never change behavior, and wrap everything in try/catch so the page never breaks.
  - In the top frame only, every 3 s, work out what's playing:
    - "Playing" means `mediaSession.playbackState !== "paused"` and (some `<video>` or `<audio>` is unpaused, unmuted and has `readyState > 2`, or the playback state is "playing").
    - The title is `metadata.title` or `document.title`.
  - Dispatch `islet:media` repeatedly while playing, and once when it stops.
- **bridge.js:** relays both events to the worker with `chrome.runtime.sendMessage`. It caps the detail at 4000 and 2000 characters and does a safe JSON parse.
- **background.js:**
  - The site comes from the sender frame's own URL (`sender.url`), so a page can only send notifications under its own name. Media is accepted from frameId 0 only.
  - Skip when forwarding is disabled, there's no token, the protocol isn't http(s), or the host is muted.
  - Title max 120 characters and body max 500. Skip an empty title.
  - Drop duplicates: the same `host\ntag-or-title\nbody` within 3 s (entries are pruned after 60 s).
  - Rate-limit to 12 per host per minute.
  - Name and accent come from `siteFor(host)`, else `shortHost` (strips `www.`).
  - The icon is the favicon from `chrome-extension://<id>/_favicon/?pageUrl=…&size=64` (fall back to 32), redrawn on an OffscreenCanvas to a PNG data URL. It must be at most 11 KiB. It's cached per host, including a null result.
  - Media payload: title and artist max 200 characters, app, image only while playing, and `playing`.
- **islet.js:**
  - `DEFAULTS {token:"", port:47821, enabled:true, muted:[]}` in `chrome.storage.local`.
  - Requests go to `http://127.0.0.1:{port}` with `Authorization: Bearer`.
  - Status is one of ok, unpaired, offline or error. It's stored in `chrome.storage.session`. The badge shows "!" unless the status is ok, amber for unpaired and red otherwise.
  - On a 400 with an image, `sendNotification` retries without the image, so a rejected icon doesn't cost the notification.
  - `checkConnection` calls `/v1/health` and needs `paired: true`.
- **sites.js** lists these sites (host → name, accent), matching subdomains too:
  - mail.google.com Gmail #ea4335; calendar.google.com Google Calendar #1a73e8; chat.google.com Google Chat #00ac47; meet.google.com Google Meet #00897b.
  - outlook.live.com, outlook.office.com, outlook.office365.com Outlook #0078d4; mail.yahoo.com Yahoo Mail #6001d2; mail.proton.me Proton Mail #6d4aff.
  - slack.com Slack #4a154b; discord.com Discord #5865f2; teams.microsoft.com, teams.live.com Teams #5b5fc7.
  - facebook.com Facebook #0866ff; messenger.com Messenger #0866ff; instagram.com Instagram #e1306c; web.whatsapp.com WhatsApp #25d366; web.telegram.org Telegram #229ed9; zalo.me Zalo #0068ff.
  - steamcommunity.com, steampowered.com Steam #1b2838; x.com, twitter.com X #000000; linkedin.com LinkedIn #0a66c2; reddit.com Reddit #ff4500.
  - youtube.com YouTube #ff0000; github.com GitHub #24292f; notion.so Notion #000000.
- **Popup:**
  - A header with the icon, "Islet" and a status badge: Connected, Not paired, Islet not running or Error.
  - The pairing section shows only until the status is ok: a hint, a password-type token field, a port field inside `<details>`, and Connect. Connect saves the token and port (the port must be an integer within 1024–65535, else 47821).
  - A "Forward notifications" switch and a "From {site}" switch for the current tab's host (which mutes or unmutes that host).
  - "Send test", enabled only when connected: "Browser connected" / "Website notifications will show up here." / app "Islet extension".

## 25. Icons (`scripts/generate-icons.mjs`)

The script uses no dependencies. It writes PNGs with a hand-rolled encoder (CRC32 plus `zlib.deflateSync`), supersampling each pixel.

- **`source.png`** (1024 px, 2× supersampling):
  - A slate rounded square (0.04–0.96, radius 0.2, color rgb 27,33,48).
  - A black pill (x 0.2–0.8, y 0.26–0.44) with a teal dot (rgb 45,212,191, centered at 0.3, 0.35, radius 0.042) and a light bar (x 0.47–0.7, y 0.335–0.365, rgb 235,238,243).
  - Two cards (rgb 52,62,84) at x 0.2–0.48 and 0.52–0.8, y 0.52–0.76, radius 0.06.
- **`tray.png`** (44 px, 8× supersampling): a black pill (x 0.06–0.94, y 0.3–0.7) with a transparent dot cut out at (0.26, 0.5), radius 0.09. It's a macOS template image, so black plus alpha only.
- **`tray-dnd.png`**: the same pill as an outline only (the inner pill 0.14–0.86 × 0.38–0.62 is cut out).

After that, `tauri icon source.png` generates the platform icon set, and `prune-icons.mjs` deletes the android and ios folders, `Square*` and `StoreLogo.png`.

## 26. Tests worth recreating

- **Rust:**
  - Rect half-open containment and outset.
  - Centering on a scaled secondary display: a 150% display at (2560, -200), 3840 wide, centering 720 CSS px → origin (3940, -200).
  - Window rect to native units.
  - API routing: Origin and Host checks, token, 415, 413, 404 and 405, media only for the paired extension.
  - Notification cleaning and validation.
  - Settings migration, sanitizing and legacy values.
  - Battery events.
  - The protobuf tick decoder and the chart parser.
  - Pairing token validity and `matches`.
  - An ignored macOS test that plays a sound with `afplay` and checks `output_running`.
- **Frontend:** the island state machine, geometry (`widgetRows` and box sizes), format helpers, calendar and timer, widget order helpers, accelerator capture and formatting, and an App and Island render using a mocked `@tauri-apps/api` (`src/test/tauriMock.ts`).
- **Extension:** `extension/extension.test.js`.

## 27. Build and run on a new computer

1. Install the prerequisites:
   - Node 20+.
   - Rust 1.85+ via rustup.
   - The Tauri 2 prerequisites: Xcode Command Line Tools on macOS; MSVC Build Tools and WebView2 on Windows.
2. Install and run:
   ```sh
   npm install
   npm run tauri dev            # hot reload, Vite on :1420
   npm test && (cd src-tauri && cargo test)
   npm run tauri build          # .app/.dmg on macOS, .msi/NSIS .exe on Windows
   ```
3. Load the extension: open `chrome://extensions`, turn on Developer mode, click Load unpacked and choose `extension/`. Then paste the token from Settings → Browser into the popup.
4. Data lives in the app config directory for `app.islet.desktop`, for example `~/Library/Application Support/app.islet.desktop/` on macOS. It holds `settings.json` and `browser-token`.
5. On first use, macOS asks for permissions:
   - Screen Recording, when you first record the screen.
   - Automation, for Spotify and for Music.

## 28. Known limits (deliberate shortcuts)

- On macOS, an app that keeps the audio device open while paused counts as playing.
- Islet doesn't mirror other apps' system notifications. macOS has no public API for reading them, and Windows needs a packaged MSIX app for the notification listener.
- Website push notifications arrive only while the site is open in a tab.
- Yahoo's free data may be delayed for some exchanges. Vietnamese `.VN` symbols avoid this (see Vietnamese stocks).
