import { Check, FolderOpen, GalleryHorizontal, List, Minus, MousePointer2, Pin, Plus, Pointer, Send, X } from "lucide-react";
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
import { getEvents, getNews, openExtensionFolder, sendTestNotification, setBackgroundImage, setWidgetImage } from "../shared/commands";
import {
  API_PORT_RANGE,
  errorMessage,
  ISLAND_STATS,
  ISLAND_SIZE_RANGE,
  MAX_ISLAND_STOCKS,
  MAX_SYMBOLS,
  normalizeSymbol,
  normalizeFeedUrl,
  MAX_FEEDS,
  MAX_CALENDARS,
  MAX_COUNTDOWNS,
  normalizeCalendarUrl,
  type NewsView,
  PANEL_SIZE_RANGE,
  NOTIFICATION_SECONDS_RANGE,
  type BackgroundSlot,
  type ExpandTrigger,
  type UiSnapshot,
  SMALL,
  type WidgetId,
} from "../shared/types";
import { Row, RowCard, Section } from "./layout";
import { StylePicker, styleDescription } from "./StylePicker";
import { AppearancePreview } from "./AppearancePreview";
import { NotificationPreview } from "./NotificationPreview";
import { ThemePicker } from "./ThemePicker";
import { readPicture, useBackgroundImages, useWidgetImages } from "../shared/background";
import { CropDialog } from "./CropDialog";
import { widgetAspect } from "./crop";
import { IslandIconsEditor } from "./IslandIcons";
import { MusicBarsSettingsCard } from "./MusicBarsSettings";
import { themeLook } from "../shared/themes";
import { shapeFor } from "../island/geometry";
import { Card } from "@/components/ui/card";
import { getLanguage, LANGUAGES, t, type LanguageSetting } from "../shared/i18n";
import type { SnapshotApi } from "./useSnapshot";
import { WidgetPanelEditor } from "./WidgetPanelEditor";

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
      <Button variant="ghost" size="icon-sm" aria-label={t("size.smaller", { name: label })} disabled={size <= min} onClick={() => nudge(-SIZE_STEP)}>
        <Minus aria-hidden="true" />
      </Button>
      <Slider
        aria-label={t("size.slider", { name: label })}
        className="w-40"
        min={min}
        max={max}
        step={1}
        value={[size]}
        onValueChange={([v]) => preview(v)}
        onValueCommit={([v]) => commit(v)}
      />
      <Button variant="ghost" size="icon-sm" aria-label={t("size.larger", { name: label })} disabled={size >= max} onClick={() => nudge(SIZE_STEP)}>
        <Plus aria-hidden="true" />
      </Button>
      <button
        type="button"
        title={t("size.resetTitle")}
        aria-label={t("size.reset", { name: label, size })}
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
  const pictures = useBackgroundImages();
  // A chosen picture waiting to be framed.
  const [crop, setCrop] = useState<{ slot: BackgroundSlot; src: string } | null>(null);
  const isMac = snap.platform === "macos";
  return (
    <div className="space-y-8">
      <Section title={t("general.appearance")} description={t("general.styleDesc")}>
        <Card className="overflow-hidden">
          <AppearancePreview style={s.islandStyle} theme={s.theme} pictures={pictures} islandSize={s.islandSize} panelSize={s.panelSize} />
          <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
            <Row label={t("general.style")} description={styleDescription(s.islandStyle, snap.layout.notch !== null)}>
              <StylePicker value={s.islandStyle} hasNotch={snap.layout.notch !== null} onChange={(islandStyle) => api.update({ islandStyle })} />
            </Row>
            <div className="space-y-3 px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium">{t("general.theme")}</span>
                <span className="text-[13px] text-muted-foreground">{t(`theme.${s.theme}`)}</span>
              </div>
              <ThemePicker
                value={s.theme}
                onChange={(theme) => api.update({ theme })}
                pictures={pictures}
                onPicture={(slot, file) => {
                  readPicture(file)
                    .then((src) => setCrop({ slot, src }))
                    .catch((e: unknown) => api.setError(errorMessage(e)));
                }}
                onRemovePicture={(slot) => {
                  setBackgroundImage(slot, null).catch((e: unknown) => api.setError(errorMessage(e)));
                }}
              />
            </div>
            <Row label={t("general.islandSize")} description={t("general.islandSizeDesc")}>
              <SizeSlider label={t("size.island")} range={ISLAND_SIZE_RANGE} value={s.islandSize} onChange={(islandSize) => api.update({ islandSize })} />
            </Row>
            <Row label={t("general.panelSize")} description={t("general.panelSizeDesc")}>
              <SizeSlider label={t("size.panel")} range={PANEL_SIZE_RANGE} value={s.panelSize} onChange={(panelSize) => api.update({ panelSize })} />
            </Row>
          </div>
        </Card>
        {crop && (
          <CropDialog
            slot={crop.slot}
            src={crop.src}
            onCancel={() => setCrop(null)}
            onError={(message) => {
              setCrop(null);
              api.setError(message);
            }}
            onSave={(image) => {
              setCrop(null);
              setBackgroundImage(crop.slot, image)
                .then(() => api.update({ theme: "picture" }))
                .catch((e: unknown) => api.setError(errorMessage(e)));
            }}
          />
        )}
      </Section>

      <Section title={t("general.islandStats")} description={t("general.islandStatsDesc")}>
        <Card className="overflow-hidden">
          <IslandIconsEditor
            icons={s.islandIcons}
            available={ISLAND_STATS.filter((x) => x !== "mail" || snap.platform === "macos")}
            stats={snap.stats}
            use24={s.use24HourClock}
            shape={shapeFor(snap.layout, s.islandStyle)}
            background={
              // As on the island: hanging from the top edge it stays black to merge with the notch, unless it shows a picture.
              shapeFor(snap.layout, s.islandStyle).attached && s.theme !== "picture"
                ? "#000"
                : themeLook(s.theme).island(pictures.island ?? pictures.panel)
            }
            onChange={(islandIcons) => api.update({ islandIcons })}
          />
        </Card>
      </Section>

      <Section title={t("general.interaction")}>
        <RowCard>
          <Row label={t("general.openOn")} description={t("general.openOnDesc")}>
            <ToggleGroup
              type="single"
              aria-label={t("general.openOn")}
              value={s.expandTrigger}
              onValueChange={(v) => v && api.update({ expandTrigger: v as ExpandTrigger })}
            >
              <ToggleGroupItem value="hover" aria-label={t("general.hover")}>
                <MousePointer2 aria-hidden="true" />
                {t("general.hover")}
              </ToggleGroupItem>
              <ToggleGroupItem value="click" aria-label={t("general.click")}>
                <Pointer aria-hidden="true" />
                {t("general.click")}
              </ToggleGroupItem>
            </ToggleGroup>
          </Row>
          <Row label={t("general.shortcut")} description={t("general.shortcutDesc")} htmlFor="shortcut">
            <ShortcutInput id="shortcut" value={s.toggleShortcut} isMac={isMac} onChange={(toggleShortcut) => api.update({ toggleShortcut })} />
          </Row>
        </RowCard>
      </Section>
      <Section title={t("general.system")}>
        <RowCard>
          <Row label={t("general.language")} description={t("general.languageDesc")} htmlFor="language">
            <select
              id="language"
              value={s.language}
              onChange={(e) => api.update({ language: e.target.value as LanguageSetting })}
              className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="system">{t("general.languageSystem")}</option>
              {Object.entries(LANGUAGES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t("general.clock24")} htmlFor="clock24">
            <Switch id="clock24" checked={s.use24HourClock} onCheckedChange={(use24HourClock) => api.update({ use24HourClock })} />
          </Row>
          <Row label={t("general.login")} htmlFor="login">
            <Switch id="login" checked={s.startAtLogin} onCheckedChange={(startAtLogin) => api.update({ startAtLogin })} />
          </Row>
        </RowCard>
      </Section>
    </div>
  );
}

export function NotificationsSection({ snap, api }: Props) {
  const s = snap.settings;
  const pictures = useBackgroundImages();
  const shape = shapeFor(snap.layout, s.islandStyle);
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
      <Section title={t("notif.delivery")}>
        <Card className="overflow-hidden">
          <NotificationPreview
            attached={shape.attached}
            background={shape.attached && s.theme !== "picture" ? "#000" : themeLook(s.theme).island(pictures.island ?? pictures.panel)}
            seconds={seconds}
            doNotDisturb={s.doNotDisturb}
          >
            <button
              type="button"
              title={t("notif.testDesc")}
              className="inline-flex h-7 items-center gap-1.5 rounded-full bg-black/35 px-3 text-xs font-medium text-white ring-1 ring-white/20 backdrop-blur-md transition-colors outline-none hover:bg-black/50 focus-visible:ring-2 focus-visible:ring-white [&_svg]:size-3.5"
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
                  className="inline-flex items-center gap-1.5"
                >
                  {sent ? <Check aria-hidden="true" /> : <Send aria-hidden="true" />}
                  {sent ? t("notif.sent") : t("notif.send")}
                </motion.span>
              </AnimatePresence>
            </button>
          </NotificationPreview>
          <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
            <Row label={t("common.doNotDisturb")} description={t("notif.dndDesc")} htmlFor="dnd">
              <Switch id="dnd" checked={s.doNotDisturb} onCheckedChange={(doNotDisturb) => api.update({ doNotDisturb })} />
            </Row>
            <Row label={t("notif.duration")} htmlFor="seconds">
              <div className="flex items-center gap-3">
                <Slider
                  id="seconds"
                  aria-label={t("notif.duration")}
                  className="w-44"
                  min={NOTIFICATION_SECONDS_RANGE[0]}
                  max={NOTIFICATION_SECONDS_RANGE[1]}
                  step={1}
                  value={[seconds]}
                  onValueChange={([v]) => setSeconds(v)}
                  onValueCommit={([v]) => api.update({ notificationSeconds: v })}
                />
                <span className="w-16 text-right text-sm text-muted-foreground tabular-nums">{t("notif.seconds", { n: seconds })}</span>
              </div>
            </Row>
            <Row label={t("notif.battery")} description={t("notif.batteryDesc")} htmlFor="battery">
              <Switch id="battery" checked={s.batteryAlerts} onCheckedChange={(batteryAlerts) => api.update({ batteryAlerts })} />
            </Row>
          </div>
        </Card>
      </Section>
      <ConnectionsSection snap={snap} api={api} />
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
    if (!symbol) return setProblem(t("stocks.badSymbol"));
    if (stocks.includes(symbol)) return setProblem(t("stocks.duplicate", { symbol }));
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
    <>
      <p className="px-4 py-3 text-[13px] text-muted-foreground">{t("stocks.desc", { max: MAX_SYMBOLS, island: MAX_ISLAND_STOCKS })}</p>
      {stocks.length > 0 && (
        <ul className="divide-y">
          {stocks.map((symbol) => {
            const q = snap.quotes.find((x) => x.symbol === symbol);
            const shown = islandStocks.includes(symbol);
            return (
              <li key={symbol} className="flex items-center gap-3 py-2.5 pr-3 pl-4 text-sm">
                <span className="w-20 font-mono text-xs font-medium">{symbol}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {q?.quote ? `${q.quote.name} · ${q.quote.price.toLocaleString()} ${q.quote.currency}` : (q?.error ?? t("common.loading"))}
                </span>
                <Button
                  variant={shown ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={shown}
                  aria-label={t("stocks.showOnIsland", { symbol })}
                  disabled={!shown && islandFull}
                  title={!shown && islandFull ? t("stocks.islandLimit", { n: MAX_ISLAND_STOCKS }) : undefined}
                  onClick={() => toggleIsland(symbol)}
                  className={cn("h-7 text-xs", !shown && "text-muted-foreground")}
                >
                  <Pin aria-hidden="true" fill={shown ? "currentColor" : "none"} />
                  {t("stocks.onIsland")}
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={t("stocks.remove", { symbol })} onClick={() => remove(symbol)}>
                  <X aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="space-y-2 px-4 py-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input
            aria-label={t("stocks.addLabel")}
            placeholder={full ? t("stocks.full", { n: MAX_SYMBOLS }) : t("stocks.placeholder")}
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
            {t("common.add")}
          </Button>
        </form>
        {problem && (
          <p id="stock-problem" role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}
      </div>
    </>
  );
}

export function WidgetsSection({ snap, api }: Props) {
  const pictures = useBackgroundImages();
  const widgetPictures = useWidgetImages();
  // A chosen widget picture waiting to be framed to its card.
  const [crop, setCrop] = useState<{ id: WidgetId; src: string } | null>(null);
  return (
    <div className="space-y-8">
      <Section
        title={t("widgets.layout")}
        description={t("widgets.desc")}
      >
        <Card className="overflow-hidden">
          <WidgetPanelEditor
            enabled={snap.settings.widgets}
            sizes={snap.settings.widgetSizes}
            backdrop={(ambient) => themeLook(snap.settings.theme).panel(ambient, pictures.panel)}
            onChange={(widgets) => api.update({ widgets })}
            onSizesChange={(widgetSizes) => api.update({ widgetSizes })}
            looks={snap.settings.widgetLooks}
            onLooksChange={(widgetLooks) => api.update({ widgetLooks })}
            pictures={widgetPictures}
            onPicture={(id, file) => {
              readPicture(file)
                .then((src) => setCrop({ id, src }))
                .catch((e: unknown) => api.setError(errorMessage(e)));
            }}
            onRemovePicture={(id) => {
              setWidgetImage(id, null).catch((e: unknown) => api.setError(errorMessage(e)));
            }}
            settings={{
              stocks: () => <StocksEditor snap={snap} api={api} />,
              news: () => <NewsEditor snap={snap} api={api} />,
              events: () => <EventsEditor snap={snap} api={api} />,
              countdowns: () => <CountdownsEditor snap={snap} api={api} />,
            }}
          />
        </Card>
        {crop && (
          <CropDialog
            slot="widget"
            aspect={widgetAspect(snap.settings.widgetSizes[crop.id] ?? SMALL)}
            src={crop.src}
            onCancel={() => setCrop(null)}
            onError={(message) => {
              setCrop(null);
              api.setError(message);
            }}
            onSave={(image) => {
              setCrop(null);
              setWidgetImage(crop.id, image).catch((e: unknown) => api.setError(errorMessage(e)));
            }}
          />
        )}
      </Section>
    </div>
  );
}

type LinkStatus = { url: string; title: string | null; error: string | null };

/** Web addresses a widget reads, each with its name or why it failed, and a field to add one. */
function LinkList({
  kind,
  links,
  max,
  normalize,
  load,
  onChange,
}: {
  /** Which widget's text to use. */
  kind: "news" | "events";
  links: string[];
  max: number;
  normalize: (input: string) => string | null;
  /** How each link is doing, from the core. */
  load: () => Promise<LinkStatus[]>;
  onChange: (links: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<LinkStatus[]>([]);
  const full = links.length >= max;
  const key = links.join("\n");
  useEffect(() => {
    if (!key) return;
    let live = true;
    load()
      .then((s) => live && s && setStatus(s))
      .catch(() => {});
    return () => {
      live = false;
    };
    // `load` is a new function each render; the links are what matter.
  }, [key]);

  const add = () => {
    const url = normalize(draft);
    if (!url) return setProblem(t(`${kind}.badUrl`));
    if (links.includes(url)) return setProblem(t(`${kind}.duplicate`));
    setProblem(null);
    setDraft("");
    onChange([...links, url]);
  };

  return (
    <>
    {links.length > 0 && (
      <ul className="divide-y">
        {links.map((url) => {
          const s = status.find((f) => f.url === url);
          return (
            <li key={url} className="flex items-center gap-3 py-2.5 pr-3 pl-4 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{s?.title ?? url}</span>
                <span className={cn("block truncate text-xs", s?.error ? "text-destructive" : "text-muted-foreground")}>
                  {s?.error ?? (s ? url : t("common.loading"))}
                </span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t(`${kind}.remove`, { name: s?.title ?? url })}
                onClick={() => onChange(links.filter((f) => f !== url))}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
    )}
    <div className="space-y-2 px-4 py-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input
          aria-label={t(`${kind}.addLabel`)}
          placeholder={full ? t(`${kind}.full`, { n: max }) : t(`${kind}.placeholder`)}
          value={draft}
          disabled={full}
          spellCheck={false}
          inputMode="url"
          aria-invalid={problem !== null}
          aria-describedby={problem ? `${kind}-problem` : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setProblem(null);
          }}
        />
        <Button type="submit" variant="outline" disabled={full || !draft.trim()}>
          <Plus aria-hidden="true" />
          {t("common.add")}
        </Button>
      </form>
      {problem && (
        <p id={`${kind}-problem`} role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </div>
    </>
  );
}

/** The addresses the News widget reads, and how it shows them. */
function NewsEditor({ snap, api }: Props) {
  return (
    <>
      <p className="px-4 py-3 text-[13px] text-muted-foreground">{t("news.desc", { max: MAX_FEEDS })}</p>
      <Row label={t("news.view")} description={t("news.viewDesc")}>
        <ToggleGroup
          type="single"
          aria-label={t("news.view")}
          value={snap.settings.newsView}
          onValueChange={(v) => v && api.update({ newsView: v as NewsView })}
        >
          <ToggleGroupItem value="list" aria-label={t("news.list")}>
            <List aria-hidden="true" />
            {t("news.list")}
          </ToggleGroupItem>
          <ToggleGroupItem value="slides" aria-label={t("news.slides")}>
            <GalleryHorizontal aria-hidden="true" />
            {t("news.slides")}
          </ToggleGroupItem>
        </ToggleGroup>
      </Row>
      <LinkList
        kind="news"
        links={snap.settings.newsFeeds}
        max={MAX_FEEDS}
        normalize={normalizeFeedUrl}
        load={() => getNews().then((n) => n.feeds)}
        onChange={(newsFeeds) => api.update({ newsFeeds })}
      />
    </>
  );
}

/** The calendar links the Events widget reads. */
function EventsEditor({ snap, api }: Props) {
  return (
    <>
      <p className="px-4 py-3 text-[13px] text-muted-foreground">{t("events.desc", { max: MAX_CALENDARS })}</p>
      <LinkList
        kind="events"
        links={snap.settings.calendarLinks}
        max={MAX_CALENDARS}
        normalize={normalizeCalendarUrl}
        load={() => getEvents().then((e) => e.calendars)}
        onChange={(calendarLinks) => api.update({ calendarLinks })}
      />
    </>
  );
}

/** The days the Countdowns widget counts down to. */
function CountdownsEditor({ snap, api }: Props) {
  const list = snap.settings.countdowns;
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const full = list.length >= MAX_COUNTDOWNS;
  const show = (date: string) => {
    const [y, m, d] = date.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(getLanguage(), { dateStyle: "medium" });
  };
  return (
    <>
      <p className="px-4 py-3 text-[13px] text-muted-foreground">{t("countdowns.desc", { max: MAX_COUNTDOWNS })}</p>
      {list.length > 0 && (
        <ul className="divide-y">
          {list.map((c, i) => (
            <li key={`${i}${c.name}`} className="flex items-center gap-3 py-2.5 pr-3 pl-4 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.name}</span>
                <span className="block text-xs text-muted-foreground">{show(c.date)}</span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("countdowns.remove", { name: c.name })}
                onClick={() => api.update({ countdowns: list.filter((_, j) => j !== i) })}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          api.update({ countdowns: [...list, { name: name.trim(), date }] });
          setName("");
          setDate("");
        }}
      >
        <Input
          aria-label={t("countdowns.nameLabel")}
          placeholder={full ? t("countdowns.full", { n: MAX_COUNTDOWNS }) : t("countdowns.namePlaceholder")}
          value={name}
          maxLength={60}
          disabled={full}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          type="date"
          aria-label={t("countdowns.dateLabel")}
          className="w-40 shrink-0"
          value={date}
          disabled={full}
          onChange={(e) => setDate(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={full || !name.trim() || !date}>
          <Plus aria-hidden="true" />
          {t("common.add")}
        </Button>
      </form>
    </>
  );
}

export function NowPlayingSection({ snap, api }: Props) {
  const bars = snap.settings.musicBars;
  return (
    <div className="space-y-8">
      <Section title={t("music.title")} description={t("music.desc")}>
        <MusicBarsSettingsCard bars={bars} onChange={(patch) => api.update({ musicBars: { ...bars, ...patch } })} />
      </Section>
    </div>
  );
}

/**
 * The browser extension pairs by itself, so this is only the API it talks
 * through and where to load the extension from.
 */
function ConnectionsSection({ snap, api }: Props) {
  const s = snap.settings;
  const [port, setPort] = useState(String(s.apiPort));
  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => setPort(String(s.apiPort)), [s.apiPort]);

  const applyPort = () => {
    const n = Number(port);
    if (n !== s.apiPort) api.update({ apiPort: n }).then((ok) => ok || setPort(String(s.apiPort)));
  };

  return (
    <Section title={t("browser.title")} description={t("browser.desc")}>
      <RowCard>
        <Row label={t("api.enabled")} htmlFor="api">
          <div className="flex items-center gap-3">
            {snap.api.running ? (
              <Badge variant="success">
                <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                {t("api.connected")}
              </Badge>
            ) : (
              <Badge variant="warning">{snap.api.error ? t("api.portUnavailable") : t("common.off")}</Badge>
            )}
            <Switch id="api" checked={s.apiEnabled} onCheckedChange={(apiEnabled) => api.update({ apiEnabled })} />
          </div>
        </Row>
        <Row label={t("api.port")} description={`${API_PORT_RANGE[0]}–${API_PORT_RANGE[1]}`} htmlFor="port">
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
        <Row
          label={t("browser.folder")}
          description={folder ? <span className="font-mono text-xs break-all">{folder}</span> : t("browser.folderDesc")}
        >
          <Button variant="outline" size="sm" onClick={() => api.run(async () => setFolder(await openExtensionFolder()))}>
            <FolderOpen aria-hidden="true" />
            {t("browser.showFolder")}
          </Button>
        </Row>
      </RowCard>
    </Section>
  );
}

export function AboutSection({ snap }: Pick<Props, "snap">) {
  return (
    <Section title={t("about.app")}>
      <RowCard>
        <Row label={t("about.version")}>
          <span className="font-mono text-sm text-muted-foreground">{snap.version}</span>
        </Row>
        <Row label={t("about.file")} description={<span className="font-mono text-xs break-all">{snap.settingsPath}</span>}>
          <span />
        </Row>
      </RowCard>
    </Section>
  );
}
