import { describe, expect, it } from "vitest";
import { resolveThemePreference } from "./ThemeContext";

describe("theme preference resolution", () => {
  it("uses the system setting only when no explicit override is selected", () => {
    expect(resolveThemePreference("system", true)).toBe("dark");
    expect(resolveThemePreference("system", false)).toBe("light");
    expect(resolveThemePreference("light", true)).toBe("light");
    expect(resolveThemePreference("dark", false)).toBe("dark");
  });
});
