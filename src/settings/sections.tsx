import { Check, Copy, Eye, EyeOff, FolderOpen, Minus, MousePointer2, Pin, Plus, Pointer, RefreshCw, Send, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ShortcutInput } from "@/components/ShortcutInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { openExtensionFolder, replaceBrowserToken, resetSettings, sendTestNotification } from "../shared/commands";
import {
  API_PORT_RANGE,
  ISLAND_SIZE_RANGE,
  MAX_ISLAND_STOCKS,
  MAX_SYMBOLS,
  normalizeSymbol,
  PANEL_SIZE_RANGE,
  NOTIFICATION_SECONDS_RANGE,
  type BarsPosition,
  type ExpandTrigger,
  type MusicBarsSettings,
  type UiSnapshot,
} from "../shared/types";
import { BAR_PRESETS, MusicBars } from "../island/MusicBars";
import { Row, RowCard, Section } from "./layout";
import { StylePicker } from "./StylePicker";
import type { SnapshotApi } from "./useSnapshot";
import { WidgetList } from "./WidgetList";

interface Props {
  snap: UiSnapshot;
  api: SnapshotApi;
}

/** While the slider is dragged, the island follows at most this often. */
const LIVE_RESIZE_MS = 80;
const SIZE_STEP = 5;

interface SizeSliderProps {
  /** What is resized, for the controls' accessible names. */
  label: string;
  range: readonly [number, number];
  value: number;
  onChange: (size: number) => void;
}

/**
 * A volume-style bar for a size. The island resizes live while the thumb
 * moves, so the result shows on screen before letting go.
 */
function SizeSlider({ label, range, value, onChange }: SizeSliderProps) {
  const [min, max] = range;
  const [size, setSize] = useState(value);
  const dragging = useRef(false);
  const lastSent = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Saves echo back while dragging; only take outside changes when idle.
  useEffect(() => {
    if (!dragging.current) setSize(value);
  }, [value]);
  useEffect(() => () => clearTimeout(pending.current), []);

  const send = (v: number) => {
    clearTimeout(pending.current);
    lastSent.current = Date.now();
    onChange(v);
  };
  const preview = (v: number) => {
    dragging.current = true;
    setSize(v);
    clearTimeout(pending.current);
    const wait = LIVE_RESIZE_MS - (Date.now() - lastSent.current);
    if (wait <= 0) send(v);
    else pending.current = setTimeout(() => send(v), wait);
  };
  const commit = (v: number) => {
    dragging.current = false;
    setSize(v);
    if (v !== value) send(v);
  };
  const nudge = (d: number) => commit(Math.min(max, Math.max(min, size + d)));

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="icon-sm" aria-label={`Smaller ${label}`} disabled={size <= min} onClick={() => nudge(-SIZE_STEP)}>
        <Minus aria-hidden="true" />
      </Button>
      <Slider
        aria-label={`${label} size`}
        className="w-40"
        min={min}
        max={max}
        step={1}
        value={[size]}
        onValueChange={([v]) => preview(v)}
        onValueCommit={([v]) => commit(v)}
      />
      <Button variant="ghost" size="icon-sm" aria-label={`Larger ${label}`} disabled={size >= max} onClick={() => nudge(SIZE_STEP)}>
        <Plus aria-hidden="true" />
      </Button>
      <button
        type="button"
        title="Reset to 100%"
        aria-label={`${label} ${size}%, reset to 100%`}
        onClick={() => commit(100)}
        className="w-11 rounded-md py-1 text-right text-sm text-muted-foreground tabular-nums outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {size}%
      </button>
    </div>
  );
}

export function GeneralSection({ snap, api }: Props) {
  const s = snap.settings;
  const isMac = snap.platform === "macos";
  return (
    <div className="space-y-8">
      <Section title="Style" description="How the island looks at the top of your screen.">
        <StylePicker
          value={s.islandStyle}
          hasNotch={snap.layout.notch !== null}
          onChange={(islandStyle) => api.update({ islandStyle })}
        />
        <RowCard>
          <Row label="Island size" description="The closed island and notifications. The notch itself keeps its size.">
            <SizeSlider label="Island" range={ISLAND_SIZE_RANGE} value={s.islandSize} onChange={(islandSize) => api.update({ islandSize })} />
          </Row>
          <Row label="Panel size" description="The open panel with notifications and widgets.">
            <SizeSlider label="Panel" range={PANEL_SIZE_RANGE} value={s.panelSize} onChange={(panelSize) => api.update({ panelSize })} />
          </Row>
        </RowCard>
      </Section>

      <Section title="Behavior">
        <RowCard>
          <Row label="Open the island on" description="Hover opens the panel as soon as the pointer rests on the island.">
            <ToggleGroup
              type="single"
              aria-label="Open the island on"
              value={s.expandTrigger}
              onValueChange={(v) => v && api.update({ expandTrigger: v as ExpandTrigger })}
            >
              <ToggleGroupItem value="hover" aria-label="Hover">
                <MousePointer2 aria-hidden="true" />
                Hover
              </ToggleGroupItem>
              <ToggleGroupItem value="click" aria-label="Click">
                <Pointer aria-hidden="true" />
                Click
              </ToggleGroupItem>
            </ToggleGroup>
          </Row>
          <Row label="Keyboard shortcut" description="Opens or closes the island from any app." htmlFor="shortcut">
            <ShortcutInput id="shortcut" value={s.toggleShortcut} isMac={isMac} onChange={(toggleShortcut) => api.update({ toggleShortcut })} />
          </Row>
          <Row label="24-hour clock" htmlFor="clock24">
            <Switch id="clock24" checked={s.use24HourClock} onCheckedChange={(use24HourClock) => api.update({ use24HourClock })} />
          </Row>
          <Row label="Start at login" htmlFor="login">
            <Switch id="login" checked={s.startAtLogin} onCheckedChange={(startAtLogin) => api.update({ startAtLogin })} />
          </Row>
        </RowCard>
      </Section>
    </div>
  );
}

export function NotificationsSection({ snap, api }: Props) {
  const s = snap.settings;
  const [seconds, setSeconds] = useState(s.notificationSeconds);
  const [sent, setSent] = useState(false);
  useEffect(() => setSeconds(s.notificationSeconds), [s.notificationSeconds]);
  useEffect(() => {
    if (!sent) return;
    const id = setTimeout(() => setSent(false), 1800);
    return () => clearTimeout(id);
  }, [sent]);

  return (
    <div className="space-y-8">
      <Section title="Delivery">
        <RowCard>
          <Row label="Do Not Disturb" description="Notifications are kept in the list, but the island stays closed." htmlFor="dnd">
            <Switch id="dnd" checked={s.doNotDisturb} onCheckedChange={(doNotDisturb) => api.update({ doNotDisturb })} />
          </Row>
          <Row label="Show each notification for" description={`${seconds} seconds`} htmlFor="seconds">
            <Slider
              id="seconds"
              aria-label="Show each notification for"
              className="w-44"
              min={NOTIFICATION_SECONDS_RANGE[0]}
              max={NOTIFICATION_SECONDS_RANGE[1]}
              step={1}
              value={[seconds]}
              onValueChange={([v]) => setSeconds(v)}
              onValueCommit={([v]) => api.update({ notificationSeconds: v })}
            />
          </Row>
          <Row label="Battery alerts" description="Charger connected or removed, fully charged, and low battery." htmlFor="battery">
            <Switch id="battery" checked={s.batteryAlerts} onCheckedChange={(batteryAlerts) => api.update({ batteryAlerts })} />
          </Row>
        </RowCard>
      </Section>

      <Section title="Try it" description="Sends a sample notification to the island.">
        <Button
          variant="outline"
          onClick={() =>
            api.run(async () => {
              await sendTestNotification();
              setSent(true);
            })
          }
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={sent ? "sent" : "send"}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="inline-flex items-center gap-2"
            >
              {sent ? <Check aria-hidden="true" /> : <Send aria-hidden="true" />}
              {sent ? "Sent" : "Send test notification"}
            </motion.span>
          </AnimatePresence>
        </Button>
      </Section>
    </div>
  );
}

/** The symbols the Stocks widget follows, and which ones the island shows. */
function StocksEditor({ snap, api }: Props) {
  const { stocks, islandStocks } = snap.settings;
  const islandFull = islandStocks.length >= MAX_ISLAND_STOCKS;
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const full = stocks.length >= MAX_SYMBOLS;

  const add = () => {
    const symbol = normalizeSymbol(draft);
    if (!symbol) return setProblem("Use a ticker symbol such as AAPL, BTC-USD or VNM.VN");
    if (stocks.includes(symbol)) return setProblem(`${symbol} is already in the list`);
    setProblem(null);
    setDraft("");
    api.update({ stocks: [...stocks, symbol] });
  };
  const remove = (symbol: string) =>
    api.update({ stocks: stocks.filter((s) => s !== symbol), islandStocks: islandStocks.filter((s) => s !== symbol) });
  const toggleIsland = (symbol: string) =>
    api.update({
      islandStocks: islandStocks.includes(symbol) ? islandStocks.filter((s) => s !== symbol) : [...islandStocks, symbol],
    });

  return (
    <Section
      title="Stocks"
      description={`Symbols as written on Yahoo Finance: stocks (AAPL, VNM.VN), crypto (BTC-USD), indexes (^GSPC) and currencies (EURUSD=X). Up to ${MAX_SYMBOLS}, with prices streaming live. Show up to ${MAX_ISLAND_STOCKS} on the island, which takes turns showing them while closed.`}
    >
      <RowCard>
        {stocks.length > 0 && (
          <ul className="divide-y">
            {stocks.map((symbol) => {
              const q = snap.quotes.find((x) => x.symbol === symbol);
              const shown = islandStocks.includes(symbol);
              return (
                <li key={symbol} className="flex items-center gap-3 py-2.5 pr-3 pl-5 text-sm">
                  <span className="w-20 font-mono text-xs font-medium">{symbol}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {q?.quote ? `${q.quote.name} · ${q.quote.price.toLocaleString()} ${q.quote.currency}` : (q?.error ?? "Loading…")}
                  </span>
                  <Button
                    variant={shown ? "secondary" : "ghost"}
                    size="sm"
                    aria-pressed={shown}
                    aria-label={`Show ${symbol} on island`}
                    disabled={!shown && islandFull}
                    title={!shown && islandFull ? `The island shows up to ${MAX_ISLAND_STOCKS}` : undefined}
                    onClick={() => toggleIsland(symbol)}
                    className={cn("h-7 text-xs", !shown && "text-muted-foreground")}
                  >
                    <Pin aria-hidden="true" fill={shown ? "currentColor" : "none"} />
                    On island
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${symbol}`} onClick={() => remove(symbol)}>
                    <X aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="space-y-2 px-5 py-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <Input
              aria-label="Add symbol"
              placeholder={full ? `Up to ${MAX_SYMBOLS} symbols` : "Add symbol, e.g. TSLA"}
              value={draft}
              disabled={full}
              spellCheck={false}
              autoCapitalize="characters"
              aria-invalid={problem !== null}
              aria-describedby={problem ? "stock-problem" : undefined}
              onChange={(e) => {
                setDraft(e.target.value);
                setProblem(null);
              }}
              className="font-mono uppercase placeholder:font-sans placeholder:normal-case"
            />
            <Button type="submit" variant="outline" disabled={full || !draft.trim()}>
              <Plus aria-hidden="true" />
              Add
            </Button>
          </form>
          {problem && (
            <p id="stock-problem" role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
        </div>
      </RowCard>
    </Section>
  );
}

export function WidgetsSection({ snap, api }: Props) {
  return (
    <div className="space-y-8">
      <Section
        title="Widgets"
        description="Shown in the open island, three cells per row. Size is columns × rows. In the island, drag a card to move it and drag its corner to resize it."
      >
        <RowCard>
          <WidgetList
            enabled={snap.settings.widgets}
            sizes={snap.settings.widgetSizes}
            onChange={(widgets) => api.update({ widgets })}
            onSizesChange={(widgetSizes) => api.update({ widgetSizes })}
          />
        </RowCard>
      </Section>
      <StocksEditor snap={snap} api={api} />
    </div>
  );
}

export function NowPlayingSection({ snap, api }: Props) {
  const bars = snap.settings.musicBars;
  const set = (patch: Partial<MusicBarsSettings>) => api.update({ musicBars: { ...bars, ...patch } });
  const same = (a: [string, string], b: [string, string]) => a[0] === b[0] && a[1] === b[1];
  return (
    <div className="space-y-8">
      <Section
        title="Music bars"
        description="Bars bounce beside the island while any app plays sound: music, videos, calls. Titles come from Spotify and Apple Music (macOS asks once to let Islet control each) and from websites through the Islet browser extension."
      >
        <div
          className={cn(
            "flex h-28 flex-col items-center justify-center gap-2 rounded-xl border bg-neutral-950",
            !bars.enabled && "opacity-40",
          )}
          aria-hidden="true"
        >
          <MusicBars count={24} height={36} barWidth={5} colors={bars.colors} flipped={bars.flipped} />
        </div>
        <RowCard>
          <Row label="Show music bars" htmlFor="bars-on">
            <Switch id="bars-on" checked={bars.enabled} onCheckedChange={(enabled) => set({ enabled })} />
          </Row>
          <Row label="Position" description="Below the island, the title shows under the bars.">
            <ToggleGroup
              type="single"
              aria-label="Position"
              value={bars.position}
              onValueChange={(v) => v && set({ position: v as BarsPosition })}
            >
              <ToggleGroupItem value="inside">In the island</ToggleGroupItem>
              <ToggleGroupItem value="below">Below the island</ToggleGroupItem>
            </ToggleGroup>
          </Row>
          <Row label="Upside down" description="Bars hang down instead of standing up." htmlFor="bars-flipped">
            <Switch id="bars-flipped" checked={bars.flipped} onCheckedChange={(flipped) => set({ flipped })} />
          </Row>
          <Row label="Show the title" description="Shows the title in the island next to the bars. With a notch, each new track pops up once instead." htmlFor="bars-title">
            <Switch id="bars-title" checked={bars.showTitle} onCheckedChange={(showTitle) => set({ showTitle })} />
          </Row>
          <Row label="Colors" description="A preset, or your own: the first color is at the base, the second at the tips.">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {BAR_PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  title={p.name}
                  aria-label={p.name}
                  aria-pressed={same(p.colors, bars.colors)}
                  onClick={() => set({ colors: p.colors })}
                  className="size-6 rounded-full ring-1 ring-border ring-offset-2 ring-offset-background outline-none aria-pressed:ring-2 aria-pressed:ring-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ background: `linear-gradient(to top, ${p.colors[0]}, ${p.colors[1]})` }}
                />
              ))}
              <input
                type="color"
                aria-label="Base color"
                value={bars.colors[0]}
                onChange={(e) => set({ colors: [e.target.value, bars.colors[1]] })}
                className="size-7 cursor-pointer rounded-md border bg-transparent"
              />
              <input
                type="color"
                aria-label="Tip color"
                value={bars.colors[1]}
                onChange={(e) => set({ colors: [bars.colors[0], e.target.value] })}
                className="size-7 cursor-pointer rounded-md border bg-transparent"
              />
            </div>
          </Row>
        </RowCard>
      </Section>
    </div>
  );
}

/** A button that copies text and says so for a moment. */
function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => setCopied(true))
          .catch(() => {});
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

const STEPS = [
  "Open the extensions page in Chrome, Edge, Brave or Arc (chrome://extensions) and turn on Developer mode.",
  "Click Load unpacked and choose the extension folder.",
  "Click the Islet icon in the browser toolbar, paste the pairing token and click Connect.",
];

export function BrowserSection({ snap, api }: Props) {
  const [shown, setShown] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const token = snap.browserToken;
  const isMac = snap.platform === "macos";
  return (
    <div className="space-y-8">
      <Section
        title="Website notifications"
        description="The Islet browser extension shows notifications from Gmail, Slack, Facebook, Discord and any other site you allow to notify in the browser."
      >
        {!snap.settings.apiEnabled && (
          <p role="alert" className="text-sm text-amber-600 dark:text-amber-400">
            The extension talks to Islet over the local API. Turn the API on to use it.
          </p>
        )}
        <RowCard>
          <ol className="divide-y text-sm">
            {STEPS.map((step, i) => (
              <li key={step} className="flex gap-3 px-5 py-3">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium tabular-nums">
                  {i + 1}
                </span>
                <span className="text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
          <Row
            label="Extension folder"
            description={folder ? <span className="font-mono text-xs break-all">{folder}</span> : "Load this folder in step 2."}
          >
            <Button variant="outline" size="sm" onClick={() => api.run(async () => setFolder(await openExtensionFolder()))}>
              <FolderOpen aria-hidden="true" />
              Show folder
            </Button>
          </Row>
          <Row label="Pairing token" description="Only the extension holding this token can send to Islet.">
            <div className="flex items-center gap-2">
              <code className="w-[18.5rem] truncate rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs select-text" aria-label="Pairing token">
                {token ? (shown ? token : "•".repeat(token.length)) : "Unavailable"}
              </code>
              <Button variant="ghost" size="icon-sm" aria-label={shown ? "Hide token" : "Show token"} onClick={() => setShown(!shown)}>
                {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
              <CopyButton text={token} />
            </div>
          </Row>
          <Row label="New token" description="Unpairs browsers that use the current token. Paste the new one into each of them.">
            <Button variant="outline" size="sm" onClick={() => api.run(replaceBrowserToken)}>
              <RefreshCw aria-hidden="true" />
              New token
            </Button>
          </Row>
        </RowCard>
        <p className="text-sm text-muted-foreground">
          Notifications reach Islet only while the site is open in a tab. To skip the browser's own pop-ups, turn off
          notifications for the browser in {isMac ? "System Settings → Notifications" : "Settings → System → Notifications"};
          sites keep sending them to Islet.
        </p>
      </Section>
    </div>
  );
}

function curlExample(base: string, isWindows: boolean): string {
  const body = '{"title":"Build passed","body":"main · 2m 14s","app":"CI"}';
  if (isWindows) {
    return `Invoke-RestMethod -Method Post -Uri ${base}/v1/notify \`\n  -ContentType 'application/json' \`\n  -Body '${body}'`;
  }
  return `curl -X POST ${base}/v1/notify \\\n  -H 'Content-Type: application/json' \\\n  -d '${body}'`;
}

const FIELDS: [string, string][] = [
  ["title", "Required. Up to 120 characters."],
  ["body", "Optional text, up to 500 characters."],
  ["app", "Sender name shown above the title. Defaults to “Script”."],
  ["icon", "An emoji or up to 4 characters."],
  ["accent", "Icon background as a hex color, like #16a34a."],
];

export function ApiSection({ snap, api }: Props) {
  const s = snap.settings;
  const [port, setPort] = useState(String(s.apiPort));
  const [copied, setCopied] = useState(false);
  useEffect(() => setPort(String(s.apiPort)), [s.apiPort]);
  const base = snap.api.url ?? `http://127.0.0.1:${s.apiPort}`;
  const example = curlExample(base, snap.platform === "windows");

  const applyPort = () => {
    const n = Number(port);
    if (n !== s.apiPort) api.update({ apiPort: n }).then((ok) => ok || setPort(String(s.apiPort)));
  };

  return (
    <div className="space-y-8">
      <Section title="Local API" description="Lets scripts and tools on this computer send notifications. Web pages are refused.">
        <RowCard>
          <Row label="Enabled" htmlFor="api">
            <Switch id="api" checked={s.apiEnabled} onCheckedChange={(apiEnabled) => api.update({ apiEnabled })} />
          </Row>
          <Row label="Port" description={`${API_PORT_RANGE[0]}–${API_PORT_RANGE[1]}`} htmlFor="port">
            <Input
              id="port"
              type="number"
              className="w-28 font-mono"
              min={API_PORT_RANGE[0]}
              max={API_PORT_RANGE[1]}
              value={port}
              disabled={!s.apiEnabled}
              onChange={(e) => setPort(e.target.value)}
              onBlur={applyPort}
              onKeyDown={(e) => e.key === "Enter" && applyPort()}
            />
          </Row>
          <Row label="Status">
            {snap.api.running ? (
              <Badge variant="success">
                <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                Listening on {snap.api.url}
              </Badge>
            ) : (
              <Badge variant="warning">{snap.api.error ? "Port unavailable" : "Off"}</Badge>
            )}
          </Row>
        </RowCard>
      </Section>

      <Section title="Send a notification">
        <div className="relative rounded-xl border bg-neutral-950 text-neutral-100 dark:bg-black/40">
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 h-7 text-neutral-400 hover:bg-white/10 hover:text-white"
            onClick={() => {
              navigator.clipboard
                .writeText(example)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
                .catch(() => {});
            }}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <pre className="overflow-x-auto p-4 pr-24 font-mono text-xs leading-relaxed whitespace-pre-wrap select-text">{example}</pre>
        </div>
        <RowCard>
          <dl className="divide-y text-sm">
            {FIELDS.map(([name, help]) => (
              <div key={name} className="grid grid-cols-[5rem_1fr] gap-4 px-5 py-2.5">
                <dt>
                  <code className="font-mono text-xs">{name}</code>
                </dt>
                <dd className="text-muted-foreground">{help}</dd>
              </div>
            ))}
          </dl>
        </RowCard>
        <p className="text-sm text-muted-foreground">
          Health check: <code className="font-mono text-xs">GET {base}/v1/health</code>
        </p>
      </Section>
    </div>
  );
}

export function AboutSection({ snap, api }: Props) {
  const [confirming, setConfirming] = useState(false);
  return (
    <Section title="About">
      <RowCard>
        <Row label="Version">
          <span className="font-mono text-sm text-muted-foreground">{snap.version}</span>
        </Row>
        <Row label="Settings file" description={<span className="font-mono text-xs break-all">{snap.settingsPath}</span>}>
          <span />
        </Row>
        <Row label="Reset settings" description="Restores every setting to its default.">
          {confirming ? (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setConfirming(false);
                  api.run(resetSettings);
                }}
              >
                Reset all settings
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
              Reset…
            </Button>
          )}
        </Row>
      </RowCard>
    </Section>
  );
}
