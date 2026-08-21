import { describe, expect, it } from "vitest";
import { didTerminalViewportChange } from "./terminalSizing";

describe("terminal viewport sizing", () => {
  it("fits only when the terminal host dimensions actually change", () => {
    expect(didTerminalViewportChange(null, { width: 900, height: 500 })).toBe(true);
    expect(didTerminalViewportChange({ width: 900, height: 500 }, { width: 900, height: 500 })).toBe(false);
    expect(didTerminalViewportChange({ width: 900, height: 500 }, { width: 900, height: 501 })).toBe(true);
  });
});
