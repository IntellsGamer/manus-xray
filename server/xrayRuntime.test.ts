import { describe, expect, it, vi } from "vitest";
import type { GatewayClient, VlessProfile } from "../drizzle/schema";
import { enforceGatewayTrafficQuotas, parseClientTrafficStats } from "./xrayRuntime";

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

  it("disables only enabled clients whose measured finite quota is exhausted, then applies the refreshed profile", async () => {
    const clients = [
      { id: 1, enabled: true, trafficLimitBytes: 1024, trafficUsedBytes: 0 },
      { id: 2, enabled: true, trafficLimitBytes: -1, trafficUsedBytes: 0 },
      { id: 3, enabled: false, trafficLimitBytes: 1024, trafficUsedBytes: 0 },
    ] as GatewayClient[];
    const disableClient = vi.fn().mockResolvedValue(clients[0]);
    const applyProfile = vi.fn().mockResolvedValue(undefined);
    const closeTunnels = vi.fn().mockReturnValue(1);
    const result = await enforceGatewayTrafficQuotas({ id: 1 } as VlessProfile, {
      listClients: vi.fn().mockResolvedValue(clients),
      syncUsage: vi.fn().mockResolvedValue(new Map([[1, 1024], [2, 50], [3, 1024]])),
      disableClient,
      applyProfile,
      closeTunnels,
    });

    expect(result).toEqual({ trafficUsageAvailable: true, disabledClientIds: [1] });
    expect(disableClient).toHaveBeenCalledWith(1);
    expect(closeTunnels).toHaveBeenCalledTimes(1);
    expect(applyProfile).toHaveBeenCalledTimes(1);
  });
});
