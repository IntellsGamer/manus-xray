import { EventEmitter } from "events";
import { afterEach, describe, expect, it, vi } from "vitest";

const persistent = vi.hoisted(() => ({
  createGatewayLiveSession: vi.fn(),
  closeGatewayLiveSession: vi.fn(),
  getGatewayLiveSessionById: vi.fn(),
  heartbeatGatewayLiveSession: vi.fn(),
}));

vi.mock("./db", () => persistent);

import { activeGatewayTunnelCount, closeActiveGatewayTunnels, observeGatewayTunnelTraffic, trackGatewayTunnel } from "./gatewayTunnels";

class TestTunnel extends EventEmitter {
  destroyed = false;
  destroy() { this.destroyed = true; this.emit("close"); return this; }
}

describe("gateway bridge tunnel tracking", () => {
  afterEach(() => {
    closeActiveGatewayTunnels();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("forcibly closes both sides of every tracked tunnel", () => {
    const client = new TestTunnel();
    const upstream = new TestTunnel();
    trackGatewayTunnel(client as never, upstream as never);

    expect(activeGatewayTunnelCount()).toBe(1);
    expect(closeActiveGatewayTunnels()).toBe(1);
    expect(client.destroyed).toBe(true);
    expect(upstream.destroyed).toBe(true);
    expect(activeGatewayTunnelCount()).toBe(0);
  });

  it("heartbeats directional byte totals and destroys the local tunnel after a durable disconnect request", async () => {
    vi.useFakeTimers();
    persistent.createGatewayLiveSession.mockResolvedValue({ id: "session-1" });
    persistent.heartbeatGatewayLiveSession.mockResolvedValue(undefined);
    persistent.closeGatewayLiveSession.mockResolvedValue(undefined);
    persistent.getGatewayLiveSessionById.mockResolvedValue({ id: "session-1", disconnectRequestedAt: new Date() });
    const client = new TestTunnel();
    const upstream = new TestTunnel();

    trackGatewayTunnel(client as never, upstream as never, 9, "198.51.100.0/24", undefined, "vless");
    await Promise.resolve();
    observeGatewayTunnelTraffic(client as never, "uplink", 120);
    observeGatewayTunnelTraffic(upstream as never, "downlink", 340);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(persistent.heartbeatGatewayLiveSession).toHaveBeenCalledWith(expect.objectContaining({ uplinkBytes: 120, downlinkBytes: 340 }));
    expect(client.destroyed).toBe(true);
    expect(upstream.destroyed).toBe(true);
    expect(persistent.closeGatewayLiveSession).toHaveBeenCalledWith(expect.objectContaining({ uplinkBytes: 120, downlinkBytes: 340, reason: "disconnected" }));
  });
});
