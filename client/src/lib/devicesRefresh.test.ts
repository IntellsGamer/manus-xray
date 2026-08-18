import { describe, expect, it } from "vitest";
import { DEVICES_REFRESH_INTERVAL_MS } from "./devicesRefresh";

describe("Devices refresh cadence", () => {
  it("uses a one-minute background refresh interval", () => {
    expect(DEVICES_REFRESH_INTERVAL_MS).toBe(60_000);
  });
});
