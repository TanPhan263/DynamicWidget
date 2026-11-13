import { closestCenter, DndContext, KeyboardSensor, useSensor, useSensors, type Announcements } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CalendarClock,
  CalendarDays,
  Clock,
  CloudSun,
  Gauge,
  Hourglass,
  Image as ImageIcon,
  Music2,
  Newspaper,
  Plus,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  StickyNote,
  Timer,
  TrendingUp,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { FieldSafePointerSensor } from "@/lib/dnd";
import { cn } from "@/lib/utils";
import { DEFAULT_AMBIENT } from "../island/ambient";
import { WIDGET_COLUMNS } from "../island/geometry";
import { t } from "../shared/i18n";
import { Slider } from "@/components/ui/slider";
import { ALL_WIDGETS, clampSpan, DEFAULT_TILE_COLOR, DEFAULT_TILE_OPACITY, lookVars, SMALL, widgetLabel, type WidgetId, type WidgetLook, type WidgetSpan } from "../shared/types";
import { Row } from "./layout";
import { dropWidget, toggleWidget } from "./widgetOrder";

type Sizes = Partial<Record<WidgetId, WidgetSpan>>;

const ICONS: Record<WidgetId, LucideIcon> = {
  clock: Clock,
  calendar: CalendarDays,
  timer: Timer,
  system: Gauge,
  notes: StickyNote,
  actions: Zap,
  stocks: TrendingUp,
  media: Music2,
  weather: CloudSun,
  controls: SlidersHorizontal,
  news: Newspaper,
  events: CalendarClock,
  countdowns: Hourglass,
};

/** Every size a widget can take, columns × rows. */
const SPANS: WidgetSpan[] = [1, 2].flatMap((rows) => [1, 2, 3].map((cols) => ({ cols, rows })));
const spanName = (s: WidgetSpan) => `${s.cols} × ${s.rows}`;

interface Props {
  enabled: WidgetId[];
  sizes: Sizes;
  /** The open panel's background (CSS), from the theme. */
  backdrop: (ambient: string) => string;
  onChange: (widgets: WidgetId[]) => void;
  onSizesChange: (sizes: Sizes) => void;
  looks: Partial<Record<WidgetId, WidgetLook>>;
  onLooksChange: (looks: Partial<Record<WidgetId, WidgetLook>>) => void;
  /** Pictures behind single widgets, as data URLs. */
  pictures: Partial<Record<WidgetId, string>>;
  onPicture: (id: WidgetId, file: File) => void;
  onRemovePicture: (id: WidgetId) => void;
  /** Settings shown under the size when that widget is picked. */
  settings?: Partial<Record<WidgetId, () => ReactNode>>;
}

function Tile({ id, span, look, picture, selected, configurable, onSelect, onHide }: { id: WidgetId; span: WidgetSpan; look?: WidgetLook; picture?: string; selected: boolean; configurable: boolean; onSelect: () => void; onHide: () => void }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id });
  const Icon = ICONS[id];
  const vars = useMemo(() => lookVars(look, picture), [look, picture]);
  return (
    <div
      ref={setNodeRef}
      style={{ gridColumn: `span ${span.cols}`, gridRow: `span ${span.rows}`, transform: CSS.Translate.toString(transform), transition }}
      className={cn("group relative", isDragging && "z-10 opacity-80")}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t("widgets.reorder", { name: widgetLabel(id) })}
        aria-pressed={selected}
        onClick={onSelect}
        style={{ ...vars, ...(vars["--card"] && { background: "var(--card)" }) }}
        className={cn(
          "flex size-full cursor-grab touch-none flex-col justify-between rounded-[14px] bg-black/30 p-2.5 text-left text-white ring-1 ring-white/[0.08] backdrop-blur-md transition-shadow outline-none ring-inset focus-visible:ring-2 focus-visible:ring-white/70",
          // Real white: a custom text color recolors Tailwind white inside the tile.
          selected && "ring-2 ring-[#fff]",
          isDragging && "cursor-grabbing shadow-xl",
        )}
      >
        <span className="flex justify-between">
          <Icon className="size-4 text-white/80" aria-hidden="true" />
          {/* Picking the tile shows its settings below. */}
          {configurable && <Settings2 className="size-3.5 text-white/45" aria-hidden="true" />}
        </span>
        <span className="flex items-end justify-between gap-2">
          <span className="truncate text-[12px] font-medium">{widgetLabel(id)}</span>
          <span className="text-[10px] text-white/50 tabular-nums">{spanName(span)}</span>
        </span>
      </button>
      <button
        type="button"
        aria-label={t("widgets.hide", { name: widgetLabel(id) })}
        title={t("widgets.hide", { name: widgetLabel(id) })}
        onClick={onHide}
        className="absolute -top-1.5 -right-1.5 hidden size-5 place-items-center rounded-full bg-white text-black shadow outline-none group-focus-within:grid group-hover:grid focus-visible:grid focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3" strokeWidth={3} aria-hidden="true" />
      </button>
    </div>
  );
}

/** A small picture of a size on the three-column grid. */
function SpanPicture({ span }: { span: WidgetSpan }) {
  return (
    <span aria-hidden="true" className="grid grid-cols-3 grid-rows-2 gap-[2px]">
      {Array.from({ length: 6 }, (_, i) => {
        const on = i % 3 < span.cols && Math.floor(i / 3) < span.rows;
        return <span key={i} className={cn("size-2 rounded-[2px]", on ? "bg-current" : "bg-current opacity-20")} />;
      })}
    </span>
  );
}

/**
 * The open panel as it will look: widgets as tiles at their real sizes on the
 * three-column grid. Drag a tile to move it, pick one to change its size, or
 * take it off; hidden widgets wait underneath to be added back.
 */
export function WidgetPanelEditor({ enabled, sizes, looks, pictures, backdrop, onChange, onSizesChange, onLooksChange, onPicture, onRemovePicture, settings = {} }: Props) {
  const pictureInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<WidgetId | null>(null);
  const selected = picked && enabled.includes(picked) ? picked : (enabled[0] ?? null);
  const hidden = ALL_WIDGETS.filter((w) => !enabled.includes(w));
  // The slider previews on the tile while dragging and saves on release.
  const [opacityDraft, setOpacityDraft] = useState<number | null>(null);
  const look = (selected && looks[selected]) || {};
  const opacity = opacityDraft ?? look.opacity ?? DEFAULT_TILE_OPACITY;
  const setLook = (patch: WidgetLook) => selected && onLooksChange({ ...looks, [selected]: { ...look, ...patch } });
  const spanOf = (id: WidgetId) => sizes[id] ?? SMALL;
  const sensors = useSensors(
    useSensor(FieldSafePointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const label = (id: unknown) => widgetLabel(id as WidgetId);
  const position = (id: unknown) => enabled.indexOf(id as WidgetId) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("dnd.pickedUp", { name: label(active.id), pos: position(active.id), count: enabled.length }),
    onDragOver: ({ active, over }) => (over ? t("dnd.over", { name: label(active.id), pos: position(over.id) }) : undefined),
    onDragEnd: ({ active, over }) => (over ? t("dnd.dropped", { name: label(active.id), pos: position(over.id) }) : undefined),
    onDragCancel: ({ active }) => t("dnd.cancelled", { name: label(active.id) }),
  };

  return (
    <div>
      <div className="p-4" style={{ background: backdrop(DEFAULT_AMBIENT) }}>
        {enabled.length === 0 ? (
          <p className="grid h-24 place-items-center text-[13px] text-white/60">{t("widgets.empty")}</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            accessibility={{ announcements }}
            onDragEnd={({ active, over }) => {
              if (over && active.id !== over.id) onChange(dropWidget(enabled, active.id as WidgetId, over.id as WidgetId));
            }}
          >
            <SortableContext items={enabled} strategy={rectSortingStrategy}>
              {/* The same grid as the panel's: sparse auto-placement, in order. */}
              <div className="grid auto-rows-[68px] gap-2" style={{ gridTemplateColumns: `repeat(${WIDGET_COLUMNS}, minmax(0, 1fr))` }}>
                {enabled.map((id) => (
                  <Tile
                    key={id}
                    id={id}
                    span={spanOf(id)}
                    picture={pictures[id]}
                    look={id === selected && opacityDraft !== null ? { ...looks[id], opacity: opacityDraft } : looks[id]}
                    selected={id === selected}
                    configurable={id in settings}
                    onSelect={() => setPicked(id)}
                    onHide={() => onChange(toggleWidget(enabled, id))}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
        {selected && (
          <Row label={widgetLabel(selected)} description={t("widgets.sizeHint")}>
            <div role="radiogroup" aria-label={t("widgets.size", { name: widgetLabel(selected) })} className="flex flex-wrap justify-end gap-1.5">
              {SPANS.map((s) => {
                const on = spanOf(selected).cols === s.cols && spanOf(selected).rows === s.rows;
                return (
                  <button
                    key={spanName(s)}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={spanName(s)}
                    title={spanName(s)}
                    onClick={() => onSizesChange({ ...sizes, [selected]: clampSpan(s.cols, s.rows) })}
                    className={cn(
                      "grid size-9 place-items-center rounded-lg text-muted-foreground ring-1 ring-black/10 transition-shadow outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:ring-white/10",
                      on && "text-foreground ring-2 ring-foreground dark:ring-foreground",
                    )}
                  >
                    <SpanPicture span={s} />
                  </button>
                );
              })}
            </div>
          </Row>
        )}
        {selected && (
          <>
            <Row label={t("widgets.style")} description={t("widgets.styleHint")}>
              <div className="flex h-9 items-center gap-1 rounded-full border bg-background px-1 shadow-xs">
                <label title={t("widgets.color")} className={swatch}>
                  <span aria-hidden="true" className="size-full rounded-full ring-1 ring-black/10 ring-inset dark:ring-white/15" style={{ background: look.background ?? DEFAULT_TILE_COLOR }} />
                  <input
                    type="color"
                    aria-label={t("widgets.colorOf", { name: widgetLabel(selected) })}
                    value={look.background ?? DEFAULT_TILE_COLOR}
                    onChange={(e) => setLook({ background: e.target.value })}
                    className={hiddenInput}
                  />
                </label>
                <label title={t("widgets.text")} className={swatch}>
                  {/* An "A" in the text color on the card's color: a preview of both. */}
                  <span
                    aria-hidden="true"
                    className="grid size-full place-items-center rounded-full text-[13px] font-bold ring-1 ring-black/10 ring-inset dark:ring-white/15"
                    style={{ background: look.background ?? DEFAULT_TILE_COLOR, color: look.text ?? "#ffffff" }}
                  >
                    A
                  </span>
                  <input
                    type="color"
                    aria-label={t("widgets.textOf", { name: widgetLabel(selected) })}
                    value={look.text ?? "#ffffff"}
                    onChange={(e) => setLook({ text: e.target.value })}
                    className={hiddenInput}
                  />
                </label>
                <span className="relative">
                  <button
                    type="button"
                    title={t("theme.picture")}
                    aria-label={t("widgets.pictureOf", { name: widgetLabel(selected) })}
                    onClick={() => pictureInput.current?.click()}
                    className={cn(iconButton, "overflow-hidden bg-cover bg-center")}
                    style={pictures[selected] ? { backgroundImage: `url("${pictures[selected]}")` } : undefined}
                  >
                    {!pictures[selected] && <ImageIcon className="size-4" aria-hidden="true" />}
                  </button>
                  {pictures[selected] && (
                    <button
                      type="button"
                      title={t("common.remove")}
                      aria-label={`${t("common.remove")}: ${t("widgets.pictureOf", { name: widgetLabel(selected) })}`}
                      onClick={() => onRemovePicture(selected)}
                      className="absolute -top-1 -right-1 grid size-3.5 place-items-center rounded-full bg-foreground text-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="size-2.5" strokeWidth={3} aria-hidden="true" />
                    </button>
                  )}
                  <input
                    ref={pictureInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    tabIndex={-1}
                    aria-hidden="true"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onPicture(selected, file);
                      e.target.value = "";
                    }}
                  />
                </span>
                <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
                <Slider
                  title={t("widgets.opacity")}
                  aria-label={t("widgets.opacityOf", { name: widgetLabel(selected) })}
                  className="w-20"
                  min={0}
                  max={100}
                  step={1}
                  value={[opacity]}
                  onValueChange={([v]) => setOpacityDraft(v)}
                  onValueCommit={([v]) => {
                    setOpacityDraft(null);
                    setLook({ opacity: v });
                  }}
                />
                <span className="w-8 text-right text-[12px] text-muted-foreground tabular-nums">{opacity}%</span>
                {looks[selected] && (
                  <>
                    <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
                    <button
                      type="button"
                      title={t("widgets.colorReset")}
                      aria-label={t("widgets.colorReset")}
                      onClick={() => {
                        const { [selected]: _, ...rest } = looks;
                        onLooksChange(rest);
                      }}
                      className={iconButton}
                    >
                      <RotateCcw className="size-3.5" aria-hidden="true" />
                    </button>
                  </>
                )}
              </div>
            </Row>
          </>
        )}
        {/* Keyed so a half-typed entry does not carry over to another widget. */}
        {selected && settings[selected] && <Fragment key={selected}>{settings[selected]()}</Fragment>}
        <div className="space-y-2.5 px-4 py-3.5">
          <div className="text-[13px] font-medium">{t("widgets.add")}</div>
          {hidden.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">{t("widgets.allShown")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {hidden.map((id) => {
                const Icon = ICONS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    aria-label={t("widgets.show", { name: widgetLabel(id) })}
                    onClick={() => {
                      onChange(toggleWidget(enabled, id));
                      setPicked(id);
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-background pr-3 pl-2.5 text-[13px] font-medium shadow-xs transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Plus className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <Icon className="size-3.5" aria-hidden="true" />
                    {widgetLabel(id)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A round 28 px control inside the style bar. */
const iconButton =
  "grid size-7 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
/** A color swatch; the real color input lies invisibly on top, so the system picker opens on click and keyboard focus still works. */
const swatch = "relative grid size-7 cursor-pointer place-items-center rounded-full p-0.5 outline-none hover:bg-accent focus-within:ring-2 focus-within:ring-ring";
const hiddenInput = "absolute inset-0 size-full cursor-pointer opacity-0";
