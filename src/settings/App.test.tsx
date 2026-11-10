import { act, fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.getByText("Welcome to Islet")).toBeInTheDocument();
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

  it("reorders widgets", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Widgets" }));
    fireEvent.click(await screen.findByRole("button", { name: "Move Timer earlier" }));
    await flush();
    const save = invoked.find((c) => c.cmd === "save_settings");
    expect(save?.args).toMatchObject({ settings: { widgets: ["clock", "timer", "calendar", "system", "notes"] } });
  });

  it("offers a drag handle for each shown widget only", async () => {
    const snap = baseSnapshot();
    snap.settings.widgets = ["timer", "clock"];
    resetMock(snap);
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Widgets" }));
    const handle = await screen.findByRole("button", { name: "Drag to reorder Timer" });
    expect(handle).toHaveAttribute("aria-roledescription", "sortable");
    expect(screen.getAllByRole("button", { name: /^Drag to reorder/ })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Drag to reorder Notes" })).toBeNull();
    // Hidden widgets are listed after the shown ones and can be turned on.
    fireEvent.click(screen.getByRole("switch", { name: "Show Notes" }));
    await flush();
    const save = invoked.find((c) => c.cmd === "save_settings");
    expect(save?.args).toMatchObject({ settings: { widgets: ["timer", "clock", "notes"] } });
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

  it("sets a widget's size", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Widgets" }));
    fireEvent.change(await screen.findByLabelText("Calendar size"), { target: { value: "2x2" } });
    await flush();
    const save = invoked.find((c) => c.cmd === "save_settings");
    expect(save?.args).toMatchObject({ settings: { widgetSizes: { calendar: { cols: 2, rows: 2 } } } });
  });

  it("rejects an out-of-range port before saving", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "API" }));
    const port = await screen.findByLabelText("Port");
    fireEvent.change(port, { target: { value: "80" } });
    fireEvent.blur(port);
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Port must be");
    expect(invoked.some((c) => c.cmd === "save_settings")).toBe(false);
  });

  it("shows the API example for the platform", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "API" }));
    expect(await screen.findByText(/curl -X POST http:\/\/127.0.0.1:47821\/v1\/notify/)).toBeInTheDocument();
    expect(screen.getByText("Listening on http://127.0.0.1:47821")).toBeInTheDocument();
  });

  it("pairs the browser extension", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Browser" }));
    const token = await screen.findByLabelText("Pairing token");
    expect(token).not.toHaveTextContent("0123");
    fireEvent.click(screen.getByRole("button", { name: "Show token" }));
    expect(token).toHaveTextContent("0123456789abcdef0123456789abcdef");
    fireEvent.click(screen.getByRole("button", { name: /Generate new token/ }));
    await flush();
    expect(token).toHaveTextContent("fedcba9876543210fedcba9876543210");
    fireEvent.click(screen.getByRole("button", { name: /Show folder/ }));
    await flush();
    expect(screen.getByText("/Applications/Islet.app/Contents/Resources/extension")).toBeInTheDocument();
  });

  it("edits the followed stocks and the island pin", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Widgets" }));
    const input = await screen.findByLabelText("Add symbol");
    const lastSave = () => invoked.filter((c) => c.cmd === "save_settings").at(-1)?.args;

    fireEvent.change(input, { target: { value: "not a symbol" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Use a ticker symbol");
    expect(lastSave()).toBeUndefined();

    fireEvent.change(input, { target: { value: " tsla " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
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

  it("sets where the music bars go and their colors", async () => {
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Now playing" }));
    const lastSave = () => invoked.filter((c) => c.cmd === "save_settings").at(-1)?.args;
    fireEvent.click(await screen.findByRole("radio", { name: "Below the island" }));
    await flush();
    expect(lastSave()).toMatchObject({ settings: { musicBars: { position: "below" } } });
    fireEvent.click(screen.getByRole("switch", { name: "Flip vertically" }));
    await flush();
    expect(lastSave()).toMatchObject({ settings: { musicBars: { position: "below", flipped: true } } });
    fireEvent.click(screen.getByRole("button", { name: "Sunset" }));
    await flush();
    expect(lastSave()).toMatchObject({ settings: { musicBars: { colors: ["#f97316", "#ec4899"] } } });
    expect(screen.getByRole("button", { name: "Sunset" })).toHaveAttribute("aria-pressed", "true");
  });
});
