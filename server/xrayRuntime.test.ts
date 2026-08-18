import { describe, expect, it, vi } from "vitest";
import type { GatewayClient, VlessProfile } from "../drizzle/schema";
import { enforceGatewayTrafficQuotas, parseClientTrafficStats } from "./xrayRuntime";

describe("Xray client traffic counters", () => {
  it("sums protocol-specific user counters and isolated SOCKS inbound counters once while ignoring legacy identities", () => {
    const counters = parseClientTrafficStats(JSON.stringify({
      stat: [
        { name: "user>>>gateway-client-7-vless@local.invalid>>>traffic>>>uplink", value: "1200" },
        { name: "user>>>gateway-client-7-vmess@local.invalid>>>traffic>>>downlink", value: "4800" },
        { name: "user>>>gateway-client-7-trojan@local.invalid>>>traffic>>>uplink", value: "600" },
        { name: "inbound>>>gateway-client-7-socks-in>>>traffic>>>uplink", value: "300" },
        { name: "inbound>>>gateway-client-7-socks-in>>>traffic>>>downlink", value: "700" },
        { name: "user>>>gateway-client-7@local.invalid>>>traffic>>>downlink", value: "999999" },
        { name: "inbound>>>socks-in>>>traffic>>>uplink", value: "999999" },
      ],
    }), [{ id: 7 }, { id: 8 }]);

    expect(counters.get(7)).toBe(7600);
    expect(counters.get(8)).toBeUndefined();
  });

  it("samples Xray counters, persists their delta, then disables only clients whose finite quota is exhausted", async () => {
    const clients = [
      { id: 1, enabled: true, trafficLimitBytes: 1024, trafficUsedBytes: 900, trafficStatsSnapshotBytes: 500 },
      { id: 2, enabled: true, trafficLimitBytes: -1, trafficUsedBytes: 0, trafficStatsSnapshotBytes: 0 },
    ] as GatewayClient[];
    const sampled = [{ ...clients[0], trafficUsedBytes: 1100 }, clients[1]] as GatewayClient[];
    const getTrafficStats = vi.fn().mockResolvedValue(new Map([[1, 700], [2, 500]]));
    const synchronizeTraffic = vi.fn().mockResolvedValue(sampled);
    const disableClient = vi.fn().mockResolvedValue(sampled[0]);
    const applyProfile = vi.fn().mockResolvedValue(undefined);
    const closeTunnels = vi.fn().mockReturnValue(1);

    const result = await enforceGatewayTrafficQuotas({ id: 1 } as VlessProfile, {
      listClients: vi.fn().mockResolvedValue(clients), getTrafficStats, synchronizeTraffic, disableClient, applyProfile, closeTunnels,
    });

    expect(getTrafficStats).toHaveBeenCalledWith(clients);
    expect(synchronizeTraffic).toHaveBeenCalledWith(clients, new Map([[1, 700], [2, 500]]));
    expect(result).toEqual({ trafficUsageAvailable: true, disabledClientIds: [1] });
    expect(disableClient).toHaveBeenCalledWith(1);
    expect(closeTunnels).toHaveBeenCalledTimes(1);
    expect(applyProfile).toHaveBeenCalledTimes(1);
  });

  it("does not change usage or restart Xray when the local stats service is unavailable", async () => {
    const synchronizeTraffic = vi.fn();
    const applyProfile = vi.fn().mockResolvedValue(undefined);
    const result = await enforceGatewayTrafficQuotas({ id: 1 } as VlessProfile, {
      listClients: vi.fn().mockResolvedValue([{ id: 2, enabled: true, trafficLimitBytes: 1024, trafficUsedBytes: 0 }] as GatewayClient[]),
      getTrafficStats: vi.fn().mockResolvedValue(null), synchronizeTraffic, applyProfile,
    });

    expect(result).toEqual({ trafficUsageAvailable: false, disabledClientIds: [] });
    expect(synchronizeTraffic).not.toHaveBeenCalled();
    expect(applyProfile).not.toHaveBeenCalled();
  });

  it("does not restart Xray after a sampled no-op quota check", async () => {
    const applyProfile = vi.fn().mockResolvedValue(undefined);
    const clients = [{ id: 2, enabled: true, trafficLimitBytes: -1, trafficUsedBytes: 0 }] as GatewayClient[];
    const result = await enforceGatewayTrafficQuotas({ id: 1 } as VlessProfile, {
      listClients: vi.fn().mockResolvedValue(clients),
      getTrafficStats: vi.fn().mockResolvedValue(new Map([[2, 0]])),
      synchronizeTraffic: vi.fn().mockResolvedValue(clients),
      applyProfile,
    });

    expect(result).toEqual({ trafficUsageAvailable: true, disabledClientIds: [] });
    expect(applyProfile).not.toHaveBeenCalled();
  });
});
