import { EventEmitter } from "events";
import { describe, expect, it } from "vitest";
import { activeGatewayTunnelCount, closeActiveGatewayTunnels, trackGatewayTunnel } from "./gatewayTunnels";

class TestTunnel extends EventEmitter {
  destroyed = false;
  destroy() { this.destroyed = true; this.emit("close"); return this; }
}

describe("gateway bridge tunnel tracking", () => {
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
});
