import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { baseSnapshot, emit, invoked, resetMock } from "../test/tauriMock";
import { Island } from "./Island";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/tauriMock")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/tauriMock")).eventModule);

const flush = () => act(async () => {});

describe("Island", () => {
  beforeEach(() => {
    resetMock();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it("starts compact around the notch and reports its rectangle", async () => {
    const { container } = render(<Island />);
    await flush();
    const island = container.querySelector(".island")!;
    expect(island).toHaveClass("compact");
    expect(invoked).toContainEqual({ cmd: "set_island_rect", args: { rect: { x: 400, y: 0, width: 200, height: 37 } } });
  });

  it("expands on hover and shows widgets", async () => {
    const { container } = render(<Island />);
    await flush();
    act(() => emit("island-hover", true));
    await act(async () => vi.advanceTimersByTime(200));
    expect(container.querySelector(".island")).toHaveClass("expanded");
    expect(screen.getByRole("tab", { name: /Widgets/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Timer")).toBeInTheDocument();
    expect(screen.getByLabelText("Quick note")).toBeInTheDocument();
    // Every widget can be picked up from the keyboard through its grip.
    expect(screen.getByRole("button", { name: "Move Clock" })).toHaveAttribute("aria-roledescription", "sortable");
    expect(screen.getAllByRole("button", { name: /^Move / })).toHaveLength(5);
  });

  it("peeks a new notification, then shrinks back", async () => {
    const { container } = render(<Island />);
    await flush();
    act(() =>
      emit("notification", {
        id: 1,
        title: "Build passed",
        body: "main",
        app: "CI",
        icon: null,
        image: null,
        symbol: null,
        accent: null,
        source: "api",
        createdAt: Date.now(),
      }),
    );
    expect(container.querySelector(".island")).toHaveClass("peek");
    expect(screen.getByText("Build passed")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(5_100));
    expect(container.querySelector(".island")).toHaveClass("compact");
    // The unread count stays beside the notch.
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("lays widgets out by their span and resizes from the corner handle", async () => {
    const snap = baseSnapshot();
    snap.settings.widgetSizes = { clock: { cols: 2, rows: 1 } };
    resetMock(snap);
    render(<Island />);
    await flush();
    act(() => emit("island-toggle"));
    const clockHandle = screen.getByRole("button", { name: /^Resize Clock, 2 by 1/ });
    expect(clockHandle.parentElement).toHaveStyle({ gridColumn: "span 2", gridRow: "span 1" });

    // Arrow keys resize from the keyboard and save right away.
    fireEvent.keyDown(screen.getByRole("button", { name: /^Resize Timer, 1 by 1/ }), { key: "ArrowDown" });
    await flush();
    let save = invoked.filter((c) => c.cmd === "save_settings").at(-1);
    expect(save?.args).toMatchObject({ settings: { widgetSizes: { clock: { cols: 2, rows: 1 }, timer: { cols: 1, rows: 2 } } } });

    // Dragging the corner snaps to whole cells and saves on release.
    const handle = screen.getByRole("button", { name: /^Resize Clock/ });
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 100 + 400, clientY: 100 + 200, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 100 + 400, clientY: 100 + 200, pointerId: 1 });
    await flush();
    save = invoked.filter((c) => c.cmd === "save_settings").at(-1);
    expect(save?.args).toMatchObject({ settings: { widgetSizes: { clock: { cols: 3, rows: 2 } } } });
  });

  it("opens the widget's app on click, but not from its controls", async () => {
    const { container } = render(<Island />);
    await flush();
    act(() => emit("island-toggle"));
    const opened = () => invoked.filter((c) => c.cmd === "open_widget_app").map((c) => c.args);

    // Buttons inside a widget keep their own job.
    fireEvent.click(screen.getByRole("button", { name: "5 min" }));
    fireEvent.click(screen.getByRole("button", { name: /^Resize Clock/ }));
    expect(opened()).toEqual([]);

    // A click elsewhere on the card opens the app and closes the panel.
    fireEvent.click(screen.getByLabelText("This month"));
    await flush();
    expect(opened()).toEqual([{ widget: "calendar" }]);
    expect(container.querySelector(".island")).toHaveClass("compact");

    act(() => emit("island-toggle"));
    fireEvent.click(await screen.findByRole("button", { name: "Open Activity Monitor" }));
    expect(opened()).toEqual([{ widget: "calendar" }, { widget: "system" }]);
  });

  it("plays, pauses and skips from the Now playing widget, and resumes after a pause", async () => {
    const snap = baseSnapshot();
    snap.settings.widgets = ["media"];
    resetMock(snap);
    render(<Island />);
    await flush();
    const song = { title: "Blinding Lights", artist: "The Weeknd", app: "Spotify", image: null, controls: true, browser: false };
    act(() => emit("system-stats", { ...snap.stats, audioPlaying: true, nowPlaying: song }));
    act(() => emit("island-toggle"));
    const sent = () => invoked.filter((c) => c.cmd === "media_control").map((c) => c.args);

    fireEvent.click(screen.getByRole("button", { name: "Next track" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(sent()).toEqual([
      { player: "Spotify", command: "next", browser: false },
      { player: "Spotify", command: "play-pause", browser: false },
    ]);

    // Paused: the core reports nothing, but the track stays to resume.
    act(() => emit("system-stats", { ...snap.stats, audioPlaying: false, nowPlaying: null }));
    expect(screen.getAllByText("Blinding Lights").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(sent().at(-1)).toEqual({ player: "Spotify", command: "play-pause", browser: false });
  });

  it("leaves a website's player to its tab where it can't be controlled", async () => {
    const snap = baseSnapshot();
    snap.settings.widgets = ["media"];
    resetMock(snap);
    render(<Island />);
    await flush();
    const site = { title: "Lofi beats", artist: "", app: "YouTube", image: null, controls: false, browser: true };
    act(() => emit("system-stats", { ...snap.stats, audioPlaying: true, nowPlaying: site }));
    act(() => emit("island-toggle"));
    expect(screen.getByRole("button", { name: "Pause" })).toBeDisabled();
    expect(screen.getAllByText("YouTube").length).toBeGreaterThan(0);
  });

  it("runs quick actions", async () => {
    const snap = baseSnapshot();
    snap.settings.widgets = ["actions"];
    snap.settings.widgetSizes = { actions: { cols: 2, rows: 1 } };
    resetMock(snap);
    const { container } = render(<Island />);
    await flush();
    act(() => emit("island-toggle"));
    const ran = () => invoked.filter((c) => c.cmd === "run_quick_action").map((c) => (c.args as { action: string }).action);

    // Keep awake shows its state from the core.
    const awake = screen.getByRole("button", { name: "Keep awake" });
    expect(awake).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(awake);
    await flush();
    act(() => emit("state-changed"));
    await flush();
    expect(screen.getByRole("button", { name: "Keep awake" })).toHaveAttribute("aria-pressed", "true");

    // Mute shows the state it set.
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    await flush();
    expect(screen.getByRole("button", { name: "Mute" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".island")).toHaveClass("expanded");

    // Opening another app closes the panel.
    fireEvent.click(screen.getByRole("button", { name: "Calculator" }));
    await flush();
    expect(ran()).toEqual(["keep-awake", "mute", "calculator"]);
    expect(container.querySelector(".island")).toHaveClass("compact");

    // Do Not Disturb is Islet's own toggle.
    act(() => emit("island-toggle"));
    // The header has the same toggle; the widget's tile comes last.
    await screen.findByRole("button", { name: "Keep awake" });
    fireEvent.click(screen.getAllByRole("button", { name: "Do Not Disturb" }).at(-1)!);
    await flush();
    expect(invoked).toContainEqual({ cmd: "set_do_not_disturb", args: { enabled: true } });
  });

  it("shows a running screen recording beside the island and stops it", async () => {
    resetMock({ ...baseSnapshot(), recordingSince: Date.now() - 65_000 });
    const { container } = render(<Island />);
    await flush();
    expect(container.querySelector(".island")).toHaveClass("compact");
    const stop = screen.getByRole("button", { name: "Stop recording" });
    expect(screen.getByLabelText("1:05")).toBeInTheDocument();
    fireEvent.click(stop);
    await flush();
    expect(invoked).toContainEqual({ cmd: "run_quick_action", args: { action: "record" } });
    // Stopping from the pill does not open the panel.
    expect(container.querySelector(".island")).toHaveClass("compact");
  });

  it("shows stock prices in the widget and opens a quote", async () => {
    const snap = baseSnapshot();
    snap.settings.widgets = ["stocks"];
    resetMock(snap);
    render(<Island />);
    await flush();
    act(() => emit("island-toggle"));
    const aapl = screen.getByRole("button", { name: /^AAPL 342\.37 USD, −0\.52%/ });
    expect(aapl).toHaveTextContent("−0.52%");
    // A symbol that failed to load says so instead of a price.
    expect(screen.getByRole("button", { name: "BTC-USD, offline" })).toBeInTheDocument();

    act(() =>
      emit("quotes-changed", [
        { ...snap.quotes[0], quote: { ...snap.quotes[0].quote!, price: 350, change: 5.83, changePercent: 1.69 } },
      ]),
    );
    expect(screen.getByRole("button", { name: /^AAPL 350\.00 USD, \+1\.69%/ })).toBeInTheDocument();

    // Each row can be shown on the island, and shown again to remove it.
    const pin = screen.getByRole("button", { name: "Show AAPL on island" });
    expect(pin).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(pin);
    await flush();
    let save = invoked.filter((c) => c.cmd === "save_settings").at(-1);
    expect(save?.args).toMatchObject({ settings: { islandStocks: ["AAPL"] } });
    expect(screen.getByRole("button", { name: "Show AAPL on island" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Show AAPL on island" }));
    await flush();
    save = invoked.filter((c) => c.cmd === "save_settings").at(-1);
    expect(save?.args).toMatchObject({ settings: { islandStocks: [] } });

    fireEvent.click(screen.getByRole("button", { name: /^AAPL 350/ }));
    await flush();
    expect(invoked).toContainEqual({ cmd: "open_stock_page", args: { symbol: "AAPL" } });
  });

  it("takes turns showing the stocks pinned to the closed island", async () => {
    const snap = baseSnapshot();
    snap.settings.islandStocks = ["AAPL", "BTC-USD"];
    snap.quotes[1] = {
      symbol: "BTC-USD",
      quote: { ...snap.quotes[0].quote!, symbol: "BTC-USD", name: "Bitcoin USD", price: 74328, change: 900, changePercent: 1.23 },
      error: null,
    };
    resetMock(snap);
    const { container } = render(<Island />);
    await flush();
    const island = container.querySelector(".island")!;
    expect(island).toHaveClass("compact");
    // Beside a notch only the symbol and the change fit.
    expect(island).toHaveTextContent("AAPL");
    expect(island).toHaveTextContent("▼0.52%");
    // The wings open so the notch does not hide it.
    const rects = invoked.filter((c) => c.cmd === "set_island_rect");
    expect((rects.at(-1)?.args as { rect: { width: number } }).rect.width).toBeGreaterThan(200);
    // Then the next one gets its turn.
    act(() => vi.advanceTimersByTime(4000));
    await flush();
    expect(island).toHaveTextContent("BTC-USD");
    expect(island).toHaveTextContent("▲1.23%");
  });

  it("shows music bars while sound plays", async () => {
    const { container } = render(<Island />);
    await flush();
    expect(screen.queryByRole("img", { name: "Playing sound" })).toBeNull();
    act(() => emit("system-stats", { ...baseSnapshot().stats, audioPlaying: true }));
    expect(screen.getByRole("img", { name: "Playing sound" })).toBeInTheDocument();
    expect(container.querySelector(".island")).toHaveClass("compact");
    act(() => emit("system-stats", { ...baseSnapshot().stats, audioPlaying: false }));
    await flush();
    expect(screen.queryByRole("img", { name: "Playing sound" })).toBeNull();
  });

  it("pops out the title of a new track once", async () => {
    const { container } = render(<Island />);
    await flush();
    const song = { title: "Blinding Lights", artist: "The Weeknd", app: "Spotify", image: null };
    act(() => emit("system-stats", { ...baseSnapshot().stats, audioPlaying: true, nowPlaying: song }));
    expect(container.querySelector(".island")).toHaveClass("peek");
    expect(container.querySelector(".island")).toHaveTextContent("Blinding Lights");
    // It is not a notification: nothing unread is added.
    act(() => vi.advanceTimersByTime(6000));
    await flush();
    expect(container.querySelector(".island")).toHaveClass("compact");
    // The same track again does not pop out again.
    act(() => emit("system-stats", { ...baseSnapshot().stats, audioPlaying: true, nowPlaying: song }));
    expect(container.querySelector(".island")).toHaveClass("compact");
    expect(screen.getByRole("img", { name: "Playing sound" })).toBeInTheDocument();
  });

  it("puts only the bars below the island; over a notch the title peeks inside", async () => {
    const snap = baseSnapshot();
    snap.settings.musicBars = { ...snap.settings.musicBars, position: "below", flipped: true };
    resetMock(snap);
    const { container } = render(<Island />);
    await flush();
    const song = { title: "Lofi beats", artist: "Chill", app: "YouTube", image: null };
    act(() => emit("system-stats", { ...snap.stats, audioPlaying: true, nowPlaying: song }));
    const island = container.querySelector(".island")!;
    expect(island).toHaveClass("peek");
    expect(island).toHaveTextContent("Lofi beats");
    // Every title on the page is inside the island.
    expect(screen.getAllByText("Lofi beats").every((el) => island.contains(el))).toBe(true);
    expect(screen.getByRole("img", { name: "Playing sound" })).not.toBeNull();
  });

  it("puts media buttons beside the pinned title, and hovering them keeps the island closed", async () => {
    const snap = baseSnapshot();
    snap.layout = { platform: "windows", notch: null, menuBarHeight: 0 };
    snap.settings.islandStyle = "island";
    resetMock(snap);
    const { container } = render(<Island />);
    await flush();
    const song = { title: "Lofi beats", artist: "Chill", app: "Spotify", image: null, controls: true, browser: false };
    act(() => emit("system-stats", { ...snap.stats, audioPlaying: true, nowPlaying: song }));
    const island = container.querySelector(".island")!;
    const next = within(island as HTMLElement).getByRole("button", { name: "Next track" });

    // Over the buttons, hovering does not open the panel.
    fireEvent.pointerOver(next);
    act(() => emit("island-hover", true));
    act(() => vi.advanceTimersByTime(500));
    expect(island).toHaveClass("compact");

    fireEvent.click(next);
    expect(island).toHaveClass("compact");
    expect(invoked).toContainEqual({ cmd: "media_control", args: { player: "Spotify", command: "next", browser: false } });

    // A player Islet can't control keeps its buttons, greyed out.
    act(() => emit("system-stats", { ...snap.stats, audioPlaying: true, nowPlaying: { ...song, app: "coursera.org", controls: false } }));
    expect(within(island as HTMLElement).getByRole("button", { name: "Pause" })).toBeDisabled();
    act(() => emit("system-stats", { ...snap.stats, audioPlaying: true, nowPlaying: song }));

    // Moving on to the rest of the island opens it as usual.
    fireEvent.pointerOut(next);
    act(() => vi.advanceTimersByTime(500));
    expect(container.querySelector(".island")).toHaveClass("expanded");
  });

  it("pins the title inside a floating island while the bars sit below", async () => {
    const snap = baseSnapshot();
    snap.layout = { platform: "windows", notch: null, menuBarHeight: 0 };
    snap.settings.islandStyle = "island";
    snap.settings.musicBars = { ...snap.settings.musicBars, position: "below" };
    resetMock(snap);
    const { container } = render(<Island />);
    await flush();
    const song = { title: "Lofi beats", artist: "Chill", app: "YouTube", image: null };
    act(() => emit("system-stats", { ...snap.stats, audioPlaying: true, nowPlaying: song }));
    const island = container.querySelector(".island")!;
    expect(island).toHaveClass("compact");
    expect(island).toHaveTextContent("Lofi beats");
    expect(screen.getAllByText("Lofi beats").every((el) => island.contains(el))).toBe(true);
    // One set of bars, under the island rather than in it.
    const bars = screen.getAllByRole("img", { name: "Playing sound" });
    expect(bars).toHaveLength(1);
    expect(island.contains(bars[0])).toBe(false);
  });

  it("sizes the island and the panel separately but keeps the notch", async () => {
    const snap = baseSnapshot();
    snap.settings.islandSize = 150;
    snap.settings.panelSize = 112;
    resetMock(snap);
    render(<Island />);
    await flush();
    // Compact over the notch: same as the notch at every size.
    expect(invoked).toContainEqual({ cmd: "set_island_rect", args: { rect: { x: 400, y: 0, width: 200, height: 37 } } });
    act(() => emit("island-toggle"));
    const rects = invoked.filter((c) => c.cmd === "set_island_rect");
    expect(rects.at(-1)?.args).toMatchObject({ rect: { width: 717 } });
  });

  it("toggles from the shortcut", async () => {
    const { container } = render(<Island />);
    await flush();
    act(() => emit("island-toggle"));
    expect(container.querySelector(".island")).toHaveClass("expanded");
    act(() => emit("island-toggle"));
    expect(container.querySelector(".island")).toHaveClass("compact");
  });

  it("draws an empty floating capsule with the Dynamic Island style", async () => {
    const snap = baseSnapshot();
    snap.layout = { platform: "windows", notch: null, menuBarHeight: 0 };
    snap.settings.islandStyle = "island";
    resetMock(snap);
    const { container } = render(<Island />);
    await flush();
    const island = container.querySelector(".island")!;
    expect(island).toHaveClass("floating", "compact");
    expect(island).toHaveTextContent("");
    expect(invoked).toContainEqual({ cmd: "set_island_rect", args: { rect: { x: 402, y: 6, width: 196, height: 36 } } });
  });

  it("restyles live when the setting changes", async () => {
    const { container } = render(<Island />);
    await flush();
    expect(container.querySelector(".island")).toHaveClass("attached");
    act(() => emit("settings-changed", { ...baseSnapshot().settings, islandStyle: "island" }));
    expect(container.querySelector(".island")).toHaveClass("floating");
  });

  it("shows a clock and battery in the pill without a notch", async () => {
    const snap = baseSnapshot();
    snap.layout = { platform: "windows", notch: null, menuBarHeight: 0 };
    resetMock(snap);
    render(<Island />);
    await flush();
    expect(screen.getByText("80%")).toBeInTheDocument();
  });
});
