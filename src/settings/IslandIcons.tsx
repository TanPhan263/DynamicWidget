import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  useDroppable,
  useSensor,
  useSensors,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FieldSafePointerSensor } from "@/lib/dnd";
import { cn } from "@/lib/utils";
import { StatGauge, statLabel } from "../island/Gauge";
import { fitSides, iconSlots, SIDE_SLOTS, slotsOf, type Shape } from "../island/geometry";
import { t } from "../shared/i18n";
import { ISLAND_STATS, MAX_ISLAND_ICONS, type IslandIcons, type IslandStat, type SystemStats } from "../shared/types";
import { useWeather } from "../island/widgets/Widgets";

type Zone = "left" | "right" | "tray";
export type Zones = Record<Zone, IslandStat[]>;

const ZONES: Zone[] = ["left", "right", "tray"];

/** A bright, desktop-like wallpaper that any island theme stands out on. */
export const WALLPAPER =
  "radial-gradient(120% 140% at 15% 0%, #60a5fa 0%, transparent 55%), radial-gradient(120% 140% at 85% 10%, #c084fc 0%, transparent 55%), linear-gradient(160deg, #2563eb 0%, #7c3aed 55%, #f472b6 100%)";

/** The tray holds the `available` icons not on the island yet. */
export const zonesOf = (icons: IslandIcons, available: readonly IslandStat[] = ISLAND_STATS): Zones => ({
  ...icons,
  tray: available.filter((s) => !icons.left.includes(s) && !icons.right.includes(s)),
});

const full = (z: Zones) => z.left.length + z.right.length >= MAX_ISLAND_ICONS;

const zoneOf = (zones: Zones, id: UniqueIdentifier): Zone | undefined =>
  ZONES.includes(id as Zone) ? (id as Zone) : ZONES.find((z) => zones[z].includes(id as IslandStat));

/**
 * Moves `id` to where `over` (an icon or an empty zone) is, across zones or
 * within one. `split` (around a notch) keeps each side to what its wing fits.
 */
export function moveIcon(zones: Zones, id: IslandStat, over: UniqueIdentifier, split = false): Zones {
  const from = zoneOf(zones, id);
  const to = zoneOf(zones, over);
  // A full island takes no more from the tray.
  if (!from || !to || (from === "tray" && to !== "tray" && full(zones))) return zones;
  if (split && to !== "tray" && from !== to && slotsOf(zones[to]) + iconSlots(id) > SIDE_SLOTS) return zones;
  if (from === to) {
    const list = zones[to];
    const at = list.indexOf(over as IslandStat);
    return at < 0 ? zones : { ...zones, [to]: arrayMove(list, list.indexOf(id), at) };
  }
  const target = zones[to].filter((s) => s !== id);
  const at = target.indexOf(over as IslandStat);
  target.splice(at < 0 ? target.length : at, 0, id);
  return { ...zones, [from]: zones[from].filter((s) => s !== id), [to]: target };
}

/** Draws an icon with its live value. */
type Draw = (id: IslandStat) => ReactNode;

/** An icon on the dark island look, in the island or the tray. */
function Chip({ id, draw }: { id: IslandStat; draw: Draw }) {
  return <span className="inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-full bg-black px-0.5 text-white">{draw(id)}</span>;
}

function Item({ id, zone, draw, disabled, onClick }: { id: IslandStat; zone: Zone; draw: Draw; disabled?: boolean; onClick: () => void }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, disabled });
  const placed = zone !== "tray";
  const label = t(placed ? "general.islandIconsRemove" : "general.islandIconsAdd", { name: statLabel(id) });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group relative cursor-grab touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isDragging && "opacity-30",
        !placed && "inline-flex h-8 items-center gap-2 border bg-background pr-3 pl-[3px] text-[13px] font-medium shadow-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <Chip id={id} draw={draw} />
      {placed ? (
        <span className="absolute -top-1 -right-1 hidden size-3.5 place-items-center rounded-full bg-white text-black group-hover:grid group-focus-visible:grid">
          <X className="size-2.5" strokeWidth={3} aria-hidden="true" />
        </span>
      ) : (
        statLabel(id)
      )}
    </button>
  );
}

/** One side of the island: a drop zone that keeps its icons in order. */
function Wing({ zone, label, zones, draw, dragging, onClick }: { zone: "left" | "right"; label: string; zones: Zones; draw: Draw; dragging: boolean; onClick: (id: IslandStat) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: zone });
  const icons = zones[zone];
  return (
    <SortableContext id={zone} items={icons} strategy={horizontalListSortingStrategy}>
      <div
        ref={setNodeRef}
        role="group"
        aria-label={label}
        className={cn(
          "m-1.5 flex min-w-[96px] items-center justify-center gap-1.5 rounded-xl px-2 transition-colors",
          dragging && "bg-white/[0.08] ring-1 ring-white/30 ring-inset",
          isOver && "bg-white/[0.16] ring-white/70",
        )}
      >
        {icons.map((id) => (
          <Item key={id} id={id} zone={zone} draw={draw} onClick={() => onClick(id)} />
        ))}
        {icons.length === 0 && <span aria-hidden="true" className="size-[22px] rounded-full border border-dashed border-white/45" />}
      </div>
    </SortableContext>
  );
}

function Tray({ zones, draw, onClick }: { zones: Zones; draw: Draw; onClick: (id: IslandStat) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: "tray" });
  return (
    <SortableContext id="tray" items={zones.tray} strategy={horizontalListSortingStrategy}>
      <div
        ref={setNodeRef}
        role="group"
        aria-label={t("general.islandIconsTray")}
        className={cn("flex min-h-12 flex-wrap items-center gap-2 rounded-lg px-4 py-2 transition-colors", isOver && "bg-accent")}
      >
        {zones.tray.map((id) => (
          <Item key={id} id={id} zone="tray" draw={draw} disabled={full(zones)} onClick={() => onClick(id)} />
        ))}
        {zones.tray.length === 0 && <span className="text-[13px] text-muted-foreground">{t("general.islandIconsEmpty")}</span>}
        {zones.tray.length > 0 && full(zones) && (
          <span className="text-[13px] text-muted-foreground">{t("general.islandIconsMax", { n: MAX_ISLAND_ICONS })}</span>
        )}
      </div>
    </SortableContext>
  );
}

/**
 * The closed island drawn as it looks at the top of the screen. Icons are
 * dragged from the tray onto either side of the notch, along it to reorder,
 * and back off to remove. A click adds or removes one too.
 */
export function IslandIconsEditor({
  icons,
  available,
  stats,
  use24,
  shape,
  background,
  onChange,
}: {
  icons: IslandIcons;
  /** Icons this computer can show. */
  available: readonly IslandStat[];
  stats: SystemStats;
  use24: boolean;
  /** The real island's shape: only around a notch are there two sides. */
  shape: Shape;
  /** The real island's background (CSS), from the theme. */
  background: string;
  onChange: (icons: IslandIcons) => void;
}) {
  const split = shape.hugsNotch;
  // Without a notch the island shows all its icons in one centered row: the left list, then the right.
  const asShown = (i: IslandIcons): IslandIcons => (split ? fitSides(i) : { left: [...i.left, ...i.right], right: [] });
  const { weather } = useWeather();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  const draw: Draw = (id) => <StatGauge id={id} stats={stats} weather={weather} now={now} use24={use24} />;
  const [zones, setZones] = useState(() => zonesOf(asShown(icons), available));
  const [active, setActive] = useState<IslandStat | null>(null);
  // A drag that ends over its own icon would also click it.
  const justDragged = useRef(false);
  const key = `${icons.left.join()}|${icons.right.join()}|${split}`;
  useEffect(() => {
    if (!active) setZones(zonesOf(asShown(icons), available));
    // Follow saved changes unless a drag is moving icons around.
  }, [key]);
  const sensors = useSensors(
    useSensor(FieldSafePointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const commit = (z: Zones) => {
    setZones(z);
    onChange({ left: z.left, right: z.right });
  };
  const click = (id: IslandStat) => {
    if (justDragged.current) return;
    const z = zones;
    if (z.tray.includes(id)) {
      if (full(z)) return;
      const fits = (side: "left" | "right") => !split || slotsOf(z[side]) + iconSlots(id) <= SIDE_SLOTS;
      const side = z.left.length < z.right.length && fits("left") ? "left" : fits("right") ? "right" : fits("left") ? "left" : null;
      if (!side) return;
      commit({ ...z, tray: z.tray.filter((s) => s !== id), [side]: [...z[side], id] });
    } else commit({ left: z.left.filter((s) => s !== id), right: z.right.filter((s) => s !== id), tray: ISLAND_STATS.filter((s) => s === id || z.tray.includes(s)) });
  };
  const endDrag = () => {
    setActive(null);
    justDragged.current = true;
    setTimeout(() => (justDragged.current = false));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => setActive(active.id as IslandStat)}
      onDragOver={({ active, over }) => {
        // Crossing into another zone moves the icon there at once, so the island makes room.
        if (over && zoneOf(zones, active.id) !== zoneOf(zones, over.id)) setZones(moveIcon(zones, active.id as IslandStat, over.id, split));
      }}
      onDragEnd={({ active, over }) => {
        endDrag();
        commit(over ? moveIcon(zones, active.id as IslandStat, over.id, split) : zones);
      }}
      onDragCancel={() => {
        endDrag();
        setZones(zonesOf(asShown(icons), available));
      }}
    >
      {/* A strip of desktop, menu bar and all, with the island as it really sits: hanging from the top edge, or floating below it. */}
      <div className="relative flex justify-center overflow-hidden rounded-t-xl pb-8" style={{ background: WALLPAPER }}>
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-6 bg-white/20 shadow-[0_1px_0_rgb(255_255_255/0.15)] backdrop-blur-md" />
        <div
          className={cn(
            "relative flex h-[46px] items-stretch shadow-[0_8px_24px_-6px_rgb(0_0_0/0.55)] ring-1 ring-white/15",
            shape.attached ? "rounded-b-[18px]" : "mt-8 rounded-full",
          )}
          style={{ background }}
        >
          <Wing zone="left" label={split ? t("general.left") : t("general.islandStats")} zones={zones} draw={draw} dragging={active !== null} onClick={click} />
          {split && (
            <>
              <div aria-hidden="true" className="grid w-28 place-items-center">
                <span className="size-1.5 rounded-full bg-white/20" />
              </div>
              <Wing zone="right" label={t("general.right")} zones={zones} draw={draw} dragging={active !== null} onClick={click} />
            </>
          )}
        </div>
      </div>
      <Tray zones={zones} draw={draw} onClick={click} />
      <DragOverlay dropAnimation={null}>{active && <Chip id={active} draw={draw} />}</DragOverlay>
    </DndContext>
  );
}
