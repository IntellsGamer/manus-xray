import { describe, expect, it } from "vitest";
import { parseClientTrafficStats } from "./xrayRuntime";

describe("Xray client traffic counters", () => {
  it("sums uplink and downlink values only for known named-client statistics", () => {
    const counters = parseClientTrafficStats(JSON.stringify({
      stat: [
        { name: "user>>>gateway-client-7@local.invalid>>>traffic>>>uplink", value: "1200" },
        { name: "user>>>gateway-client-7@local.invalid>>>traffic>>>downlink", value: "4800" },
        { name: "user>>>unrelated@local.invalid>>>traffic>>>downlink", value: "9000" },
        { name: "inbound>>>vless-in>>>traffic>>>uplink", value: "600" },
      ],
    }), [{ id: 7 }, { id: 8 }]);

    expect(counters.get(7)).toBe(6000);
    expect(counters.get(8)).toBeUndefined();
  });
});
