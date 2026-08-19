import { afterEach, describe, expect, it } from "vitest";
import { readClientRegistryView, saveClientRegistryView } from "./clientRegistryView";

const values = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
});

afterEach(() => values.clear());

describe("client registry display preference", () => {
  it("uses detailed cards unless compact mode was explicitly saved", () => {
    expect(readClientRegistryView()).toBe("detailed");
    saveClientRegistryView("compact");
    expect(readClientRegistryView()).toBe("compact");
  });
});
