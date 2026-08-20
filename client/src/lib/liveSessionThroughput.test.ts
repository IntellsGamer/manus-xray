import { formatLiveMbps, measureLiveThroughput } from "./liveSessionThroughput";
import { describe, expect, it } from "vitest";

describe("live session throughput", () => {
  it("converts grouped traffic growth between SSE snapshots into Mbps", () => {
    const result = measureLiveThroughput({ totalBytes: 1_000_000, sampledAt: 1_000 }, 2_250_000, 2_000);

    expect(result.reading).toEqual({ mbps: 10, sampledAt: 2_000 });
    expect(formatLiveMbps(result.reading, 2_100)).toBe("10.0 Mbps");
  });

  it("shows zero for an initial, reset, or stale sample instead of reporting an invalid rate", () => {
    expect(measureLiveThroughput(undefined, 500, 1_000).reading.mbps).toBe(0);
    expect(measureLiveThroughput({ totalBytes: 1_000, sampledAt: 1_000 }, 500, 2_000).reading.mbps).toBe(0);
    expect(formatLiveMbps({ mbps: 32.5, sampledAt: 1_000 }, 5_001)).toBe("0 Mbps");
  });
});
