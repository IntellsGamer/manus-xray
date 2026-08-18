import { afterEach, describe, expect, it } from "vitest";
import { saveClientDraftPrefill, takeClientDraftPrefill } from "./clientPrefill";

const values = new Map<string, string>();

Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});

afterEach(() => values.clear());

describe("device client-form handoff", () => {
  it("transfers a selected device label once without creating anything", () => {
    saveClientDraftPrefill({ name: "Chrome on Linux", source: "device" });

    expect(takeClientDraftPrefill()).toEqual({ name: "Chrome on Linux", source: "device" });
    expect(takeClientDraftPrefill()).toBeUndefined();
  });

  it("ignores malformed draft values", () => {
    values.set("nginx-gateway-client-draft-prefill", '{"name":"","source":"device"}');
    expect(takeClientDraftPrefill()).toBeUndefined();
  });
});
