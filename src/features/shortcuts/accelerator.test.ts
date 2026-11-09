import { captureAccelerator, formatAccelerator, type KeyLike } from "./accelerator";

const key = (code: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: code.replace(/^Key|^Digit/, ""),
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("captureAccelerator", () => {
  it("maps Cmd on macOS and Ctrl on Windows to CommandOrControl", () => {
    expect(captureAccelerator(key("KeyP", { metaKey: true, shiftKey: true }), true)).toEqual({
      kind: "done",
      accelerator: "CommandOrControl+Shift+P",
    });
    expect(captureAccelerator(key("KeyP", { ctrlKey: true, shiftKey: true }), false)).toEqual({
      kind: "done",
      accelerator: "CommandOrControl+Shift+P",
    });
  });

  it("keeps macOS Control distinct from Command", () => {
    const r = captureAccelerator(key("Digit1", { ctrlKey: true, altKey: true }), true);
    expect(r).toEqual({ kind: "done", accelerator: "Control+Alt+1" });
  });

  it("waits while only modifiers are held", () => {
    expect(captureAccelerator({ ...key("ShiftLeft"), key: "Shift", shiftKey: true }, true).kind).toBe("pending");
  });

  it("cancels on plain Escape", () => {
    expect(captureAccelerator({ ...key("Escape"), key: "Escape" }, false).kind).toBe("cancel");
  });

  it("rejects shortcuts without a real modifier", () => {
    expect(captureAccelerator(key("KeyA"), false).kind).toBe("error");
    expect(captureAccelerator(key("KeyA", { shiftKey: true }), false).kind).toBe("error");
  });

  it("rejects unsupported keys", () => {
    expect(captureAccelerator({ ...key("NumpadEnter"), key: "Enter", ctrlKey: true }, false).kind).toBe("error");
  });

  it("supports function and named keys", () => {
    expect(captureAccelerator({ ...key("F9"), key: "F9", altKey: true }, false)).toEqual({
      kind: "done",
      accelerator: "Alt+F9",
    });
    expect(captureAccelerator({ ...key("Space"), key: " ", ctrlKey: true }, false)).toEqual({
      kind: "done",
      accelerator: "CommandOrControl+Space",
    });
  });
});

describe("formatAccelerator", () => {
  it("uses symbols on macOS", () => {
    expect(formatAccelerator("CommandOrControl+Shift+P", true)).toBe("⌘⇧P");
    expect(formatAccelerator("Control+Alt+ArrowUp", true)).toBe("⌃⌥↑");
  });

  it("uses names on Windows", () => {
    expect(formatAccelerator("CommandOrControl+Shift+H", false)).toBe("Ctrl+Shift+H");
    expect(formatAccelerator("Super+Alt+F1", false)).toBe("Win+Alt+F1");
  });
});
