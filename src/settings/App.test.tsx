import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { baseSnapshot, invoked, resetMock, setMockBackground } from "../test/tauriMock";
import { App } from "./App";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/tauriMock")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/tauriMock")).eventModule);

const flush = () => act(async () => {});

describe("Settings", () => {
  beforeEach(() => resetMock());

  it("shows the welcome card until it is dismissed", async () => {
    const snap = baseSnapshot();
    snap.settings.onboardingCompleted = false;
    resetMock(snap);
    render(<App />);
    await flush();
    expect(screen.getByText("Welcome to Lintel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await flush();
    expect(invoked.some((c) => c.cmd === "complete_onboarding")).toBe(true);
  });

  it("saves the expand trigger", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("radio", { name: "Click" }));
    await flush();
    const save = invoked.find((c) => c.cmd === "save_settings");
    expect(save?.args).toMatchObject({ settings: { expandTrigger: "click" } });
  });

  it("adds an icon to the island mirror and removes it again", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Add CPU to the island" }));
    await flush();
    let save = invoked.filter((c) => c.cmd === "save_settings").at(-1);
    expect(save?.args).toMatchObject({ settings: { islandIcons: { left: [], right: ["cpu"] } } });
    fireEvent.click(await screen.findByRole("button", { name: "Remove CPU from the island" }));
    await flush();
    save = invoked.filter((c) => c.cmd === "save_settings").at(-1);
    expect(save?.args).toMatchObject({ settings: { islandIcons: { left: [], right: [] } } });
  });

  it("mirrors the island as one centered row when there is no notch around it", async () => {
    const snap = baseSnapshot();
    snap.settings.islandStyle = "island";
    snap.settings.islandIcons = { left: ["cpu"], right: ["memory"] };
    resetMock(snap);
    render(<App />);
    await flush();
    expect(screen.queryByRole("group", { name: "Right" })).toBeNull();
    const row = screen.getByRole("group", { name: "Status icons" });
    expect(row.querySelectorAll("button")).toHaveLength(2);
  });

  it("switches the whole page to the chosen language", async () => {
    render(<App />);
    await flush();
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "vi" } });
    await flush();
    const save = invoked.filter((c) => c.cmd === "save_settings").at(-1);
    expect((save?.args as { settings: { language: string } }).settings.language).toBe("vi");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Chung");
    fireEvent.change(screen.getByLabelText("Ngôn ngữ"), { target: { value: "en" } });
    await flush();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("General");
  });

  it("picks a theme", async () => {
    render(<App />);
    await flush();
    expect(screen.getByRole("radio", { name: "Graphite" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Midnight" }));
    await flush();
    const save = invoked.find((c) => c.cmd === "save_settings");
    expect((save?.args as { settings: { theme: string } }).settings.theme).toBe("midnight");
  });

  it("shows a place for each picture when Picture is picked, without opening anything", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("radio", { name: "Picture" }));
    await flush();
    const save = invoked.find((c) => c.cmd === "save_settings");
    expect((save?.args as { settings: { theme: string } }).settings.theme).toBe("picture");
    expect(screen.getByRole("button", { name: "Choose panel picture" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose island picture" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps separate panel and island pictures, and removing one keeps Picture picked", async () => {
    const snap = baseSnapshot();
    snap.settings.theme = "picture";
    snap.settings.islandStyle = "island";
    resetMock(snap);
    setMockBackground("panel", "data:image/png;base64,AA");
    render(<App />);
    await flush();
    // No island picture yet: it borrows the panel's, so there is nothing to remove.
    expect(screen.getByText("Uses the panel picture until one is selected.", { exact: false })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove island picture" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove panel picture" }));
    await flush();
    expect(invoked).toContainEqual({ cmd: "set_background_image", args: { slot: "panel", image: null } });
    expect(invoked.some((c) => c.cmd === "save_settings")).toBe(false);
    expect(await screen.findByRole("button", { name: "Choose panel picture" })).toBeTruthy();
  });

  it("asks to frame a chosen picture before saving it", async () => {
    render(<App />);
    await flush();
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "beach.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Choose a background picture"), { target: { files: [file] } });
    const dialog = await screen.findByRole("dialog", { name: "Crop panel picture" });
    expect(dialog).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(invoked.some((c) => c.cmd === "set_background_image")).toBe(false);
  });

  it("switches to the Dynamic Island style", async () => {
    render(<App />);
    await flush();
    expect(screen.getByRole("radio", { name: /Notch/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: /Dynamic Island/ }));
    await flush();
    const save = invoked.find((c) => c.cmd === "save_settings");
    expect(save?.args).toMatchObject({ settings: { islandStyle: "island" } });
    expect(screen.getByRole("radio", { name: /Dynamic Island/ })).toHaveAttribute("aria-checked", "true");
  });

  it("lays the widgets out as panel tiles, hides one and adds another", async () => {
    const snap = baseSnapshot();
    snap.settings.widgets = ["timer", "clock"];
    resetMock(snap);
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Widgets" }));
    // Each shown widget is a draggable tile; hidden ones wait to be added.
    const tile = await screen.findByRole("button", { name: "Drag to reorder Timer" });
    expect(tile).toHaveAttribute("aria-roledescription", "sortable");
    expect(screen.getAllByRole("button", { name: /^Drag to reorder/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Show Notes" }));
    await flush();
    expect(invoked.filter((c) => c.cmd === "save_settings").at(-1)?.args).toMatchObject({ settings: { widgets: ["timer", "clock", "notes"] } });
    fireEvent.click(screen.getByRole("button", { name: "Hide Timer" }));
    await flush();
    expect(invoked.filter((c) => c.cmd === "save_settings").at(-1)?.args).toMatchObject({ settings: { widgets: ["clock", "notes"] } });
  });

  it("sets the island and panel sizes", async () => {
    render(<App />);
    await flush();
    const lastSize = () => invoked.filter((c) => c.cmd === "save_settings").at(-1)?.args;
    fireEvent.click(screen.getByRole("button", { name: "Larger Island" }));
    await flush();
    expect(lastSize()).toMatchObject({ settings: { islandSize: 105 } });
    // The bar moves one percent per arrow key.
    fireEvent.keyDown(screen.getByRole("slider", { name: "Island size" }), { key: "ArrowLeft" });
    await flush();
    expect(lastSize()).toMatchObject({ settings: { islandSize: 104 } });
    fireEvent.click(screen.getByRole("button", { name: "Island 104%, reset to 100%" }));
    await flush();
    expect(lastSize()).toMatchObject({ settings: { islandSize: 100 } });
    // The panel has its own size.
    fireEvent.click(screen.getByRole("button", { name: "Smaller Panel" }));
    await flush();
    expect(lastSize()).toMatchObject({ settings: { islandSize: 100, panelSize: 95 } });
  });

  it("sets a widget's size from the picked tile", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Widgets" }));
    fireEvent.click(await screen.findByRole("button", { name: "Drag to reorder Calendar" }));
    const sizes = screen.getByRole("radiogroup", { name: "Calendar size" });
    fireEvent.click(within(sizes).getByRole("radio", { name: "2 × 2" }));
    await flush();
    const save = invoked.find((c) => c.cmd === "save_settings");
    expect(save?.args).toMatchObject({ settings: { widgetSizes: { calendar: { cols: 2, rows: 2 } } } });
  });

  it("rejects an out-of-range port before saving", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    const port = await screen.findByLabelText("Port");
    fireEvent.change(port, { target: { value: "80" } });
    fireEvent.blur(port);
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Port must be");
    expect(invoked.some((c) => c.cmd === "save_settings")).toBe(false);
  });

  it("shows the browser connection and the extension folder under Notifications", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.queryByText("Pairing token")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show folder/ }));
    await flush();
    expect(screen.getByText("/Applications/Lintel.app/Contents/Resources/extension")).toBeInTheDocument();
  });

  it("resets every setting from the sidebar after a second click", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Reset settings" }));
    expect(invoked.some((c) => c.cmd === "reset_settings")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Reset all settings" }));
    await flush();
    expect(invoked.some((c) => c.cmd === "reset_settings")).toBe(true);
  });

  it("edits the followed stocks and the island pin", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Widgets" }));
    // Its settings show once the widget is in the panel and picked.
    fireEvent.click(await screen.findByRole("button", { name: "Show Stocks" }));
    await flush();
    const input = await screen.findByLabelText("Add symbol");
    const addButton = () => within(input.closest("form")!).getByRole("button", { name: "Add" });
    const lastSave = () => invoked.filter((c) => c.cmd === "save_settings").at(-1)?.args;

    fireEvent.change(input, { target: { value: "not a symbol" } });
    fireEvent.click(addButton());
    expect(screen.getByRole("alert")).toHaveTextContent("Use a ticker symbol");
    expect(lastSave()).toMatchObject({ settings: { stocks: ["AAPL", "BTC-USD"] } });

    fireEvent.change(input, { target: { value: " tsla " } });
    fireEvent.click(addButton());
    await flush();
    expect(lastSave()).toMatchObject({ settings: { stocks: ["AAPL", "BTC-USD", "TSLA"] } });

    // Up to three symbols go on the island.
    for (const symbol of ["TSLA", "AAPL", "BTC-USD"]) {
      fireEvent.click(screen.getByRole("button", { name: `Show ${symbol} on island` }));
      await flush();
    }
    expect(lastSave()).toMatchObject({ settings: { islandStocks: ["TSLA", "AAPL", "BTC-USD"] } });
    expect(screen.getByRole("button", { name: "Show TSLA on island" })).toHaveAttribute("aria-pressed", "true");

    // Removing a symbol takes it off the island too.
    fireEvent.click(screen.getByRole("button", { name: "Remove TSLA" }));
    await flush();
    expect(lastSave()).toMatchObject({ settings: { stocks: ["AAPL", "BTC-USD"], islandStocks: ["AAPL", "BTC-USD"] } });
  });

  it("adds news sites, shows each feed's name or problem, and removes one", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Widgets" }));
    // Its settings show once the widget is in the panel and picked.
    fireEvent.click(await screen.findByRole("button", { name: "Show News" }));
    await flush();
    const input = await screen.findByLabelText("Add news site");
    const form = within(input.closest("form")!);
    const lastSave = () => invoked.filter((c) => c.cmd === "save_settings").at(-1)?.args;

    fireEvent.change(input, { target: { value: "file:///etc/passwd" } });
    fireEvent.click(form.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a web address");
    expect(lastSave()).toMatchObject({ settings: { newsFeeds: [] } });

    fireEvent.change(input, { target: { value: " vnexpress.net/rss " } });
    fireEvent.click(form.getByRole("button", { name: "Add" }));
    await flush();
    fireEvent.change(input, { target: { value: "bad.example" } });
    fireEvent.click(form.getByRole("button", { name: "Add" }));
    await flush();
    expect(lastSave()).toMatchObject({ settings: { newsFeeds: ["https://vnexpress.net/rss", "https://bad.example"] } });
    expect(await screen.findByText("Sample News")).toBeInTheDocument();
    expect(screen.getByText("no news feed found at this address")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove https://bad.example" }));
    await flush();
    expect(lastSave()).toMatchObject({ settings: { newsFeeds: ["https://vnexpress.net/rss"] } });

    fireEvent.click(screen.getByRole("radio", { name: "Slides" }));
    await flush();
    expect(lastSave()).toMatchObject({ settings: { newsView: "slides" } });
  });

  it("shows only the picked widget's settings", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Widgets" }));
    fireEvent.click(await screen.findByRole("button", { name: "Show Stocks" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Show News" }));
    await flush();
    expect(screen.getByLabelText("Add news site")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add symbol")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Drag to reorder Stocks" }));
    expect(screen.getByLabelText("Add symbol")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add news site")).toBeNull();

    // A widget without settings shows only its size.
    fireEvent.click(screen.getByRole("button", { name: "Drag to reorder Clock" }));
    expect(screen.getByRole("radiogroup", { name: "Clock size" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Add symbol")).toBeNull();
  });

  it("adds calendar links, shows each calendar's name or problem", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Widgets" }));
    // Its settings show once the widget is in the panel and picked.
    fireEvent.click(await screen.findByRole("button", { name: "Show Upcoming events" }));
    await flush();
    const input = await screen.findByLabelText("Add calendar link");
    const form = within(input.closest("form")!);
    const lastSave = () => invoked.filter((c) => c.cmd === "save_settings").at(-1)?.args;

    fireEvent.change(input, { target: { value: "webcal://p01.icloud.com/published/2/abc" } });
    fireEvent.click(form.getByRole("button", { name: "Add" }));
    await flush();
    fireEvent.change(input, { target: { value: "https://bad.example/x.ics" } });
    fireEvent.click(form.getByRole("button", { name: "Add" }));
    await flush();
    expect(lastSave()).toMatchObject({ settings: { calendarLinks: ["https://p01.icloud.com/published/2/abc", "https://bad.example/x.ics"] } });
    expect(await screen.findByText("this address is not a calendar link")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "p01.icloud.com/published/2/abc" } });
    fireEvent.click(form.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent("already in the list");
  });

  it("adds a countdown and removes it", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Widgets" }));
    // Its settings show once the widget is in the panel and picked.
    fireEvent.click(await screen.findByRole("button", { name: "Show Countdowns" }));
    await flush();
    const name = await screen.findByLabelText("Countdown name");
    const form = within(name.closest("form")!);
    const lastSave = () => invoked.filter((c) => c.cmd === "save_settings").at(-1)?.args;

    fireEvent.change(name, { target: { value: "  Trip " } });
    expect(form.getByRole("button", { name: "Add" })).toBeDisabled();
    fireEvent.change(form.getByLabelText("Date"), { target: { value: "2026-12-24" } });
    fireEvent.click(form.getByRole("button", { name: "Add" }));
    await flush();
    expect(lastSave()).toMatchObject({ settings: { countdowns: [{ name: "Trip", date: "2026-12-24" }] } });
    expect(name).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Remove Trip" }));
    await flush();
    expect(lastSave()).toMatchObject({ settings: { countdowns: [] } });
  });

  it("previews a notification and sends a test one from the preview", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send test notification" }));
    await flush();
    expect(invoked.some((c) => c.cmd === "send_test_notification")).toBe(true);
    expect(await screen.findByRole("button", { name: "Sent" })).toBeInTheDocument();
  });

  it("sets where the music bars go and their colors", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Now playing" }));
    const lastSave = () => invoked.filter((c) => c.cmd === "save_settings").at(-1)?.args;
    fireEvent.click(await screen.findByRole("radio", { name: "Below the island" }));
    await flush();
    expect(lastSave()).toMatchObject({ settings: { musicBars: { position: "below" } } });
    fireEvent.click(screen.getByRole("radio", { name: "Below the island, flipped" }));
    await flush();
    expect(lastSave()).toMatchObject({ settings: { musicBars: { position: "below", flipped: true } } });
    fireEvent.click(screen.getByRole("button", { name: "Sunset" }));
    await flush();
    expect(lastSave()).toMatchObject({ settings: { musicBars: { colors: ["#f97316", "#ec4899"] } } });
    expect(screen.getByRole("button", { name: "Sunset" })).toHaveAttribute("aria-pressed", "true");
  });
});
