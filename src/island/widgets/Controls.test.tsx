import { act, fireEvent, render, screen } from "@testing-library/react";
import { invoked, resetMock } from "../../test/tauriMock";
import { ControlsWidget } from "./Widgets";

vi.mock("@tauri-apps/api/core", async () => (await import("../../test/tauriMock")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../test/tauriMock")).eventModule);

const flush = () => act(async () => {});

describe("Controls widget", () => {
  beforeEach(() => resetMock());

  it("shows only the controls this system has", async () => {
    render(<ControlsWidget />);
    await flush();
    expect(screen.getByRole("button", { name: "Wi-Fi" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Bluetooth" })).toHaveAttribute("aria-pressed", "false");
    // The mock is a Mac: no airplane mode.
    expect(screen.queryByRole("button", { name: "Airplane mode" })).toBeNull();
    expect(screen.getByRole("slider", { name: "Volume" })).toHaveAttribute("aria-valuenow", "0.5");
    expect(screen.getByRole("slider", { name: "Brightness" })).toBeTruthy();
  });

  it("switches a control and shows the new state", async () => {
    render(<ControlsWidget />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Bluetooth" }));
    await flush();
    expect(invoked).toContainEqual({ cmd: "set_control", args: { change: { control: "bluetooth", value: true } } });
    expect(screen.getByRole("button", { name: "Bluetooth" })).toHaveAttribute("aria-pressed", "true");
  });

  it("sends the last of several quick changes", async () => {
    render(<ControlsWidget />);
    await flush();
    const volume = screen.getByRole("slider", { name: "Volume" });
    fireEvent.keyDown(volume, { key: "ArrowRight" });
    fireEvent.keyDown(volume, { key: "ArrowRight" });
    fireEvent.keyDown(volume, { key: "ArrowRight" });
    await flush();
    const sets = invoked.filter((c) => c.cmd === "set_control");
    expect(sets.at(-1)?.args).toEqual({ change: { control: "volume", value: 0.53 } });
    expect(volume).toHaveAttribute("aria-valuenow", "0.53");
  });
});
