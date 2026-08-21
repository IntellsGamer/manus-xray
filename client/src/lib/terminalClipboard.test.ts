import { describe, expect, it } from "vitest";
import { resolveTerminalSelection } from "./terminalClipboard";

describe("terminal clipboard selection", () => {
  it("keeps the remembered xterm selection when a shortcut keydown clears the live selection", () => {
    expect(resolveTerminalSelection("selected output", "")).toBe("selected output");
    expect(resolveTerminalSelection("", "selected output")).toBe("selected output");
    expect(resolveTerminalSelection("", "")).toBe("");
  });
});
