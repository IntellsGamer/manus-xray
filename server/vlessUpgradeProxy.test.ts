import { createServer as createHttpServer, request } from "http";
import { createConnection, createServer as createTcpServer } from "net";
import { AddressInfo } from "net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VlessProfile } from "../drizzle/schema";
import { createTunnelUsageFlusher, registerVlessUpgradeProxy } from "./vlessUpgradeProxy";
import { activeGatewayTunnelCount, closeActiveGatewayTunnels } from "./gatewayTunnels";

const profile: VlessProfile = {
  id: 1,
  uuid: "51dc1a8e-0667-4ed5-aa36-15c8c5a85125",
  serverAddress: "gateway.example.com",
  port: 443,
  wsPath: "/vless",
  tlsEnabled: true,
  subscriptionToken: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  vmessUuid: "f0f5027c-7325-43d2-97c3-84957a7934e9",
  vmessWsPath: "/vmess",
  trojanPassword: "test-trojan-password",
  trojanWsPath: "/trojan",
  socksUsername: "gateway",
  socksPassword: "test-socks-password",
  socksWsPath: "/socks",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const closeables: Array<{ close: (callback: () => void) => void }> = [];

afterEach(async () => {
  await Promise.all(closeables.splice(0).map(item => new Promise<void>(resolveClose => item.close(resolveClose))));
});

function listen(server: ReturnType<typeof createHttpServer> | ReturnType<typeof createTcpServer>) {
  return new Promise<number>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      closeables.push(server);
      resolveListen((server.address() as AddressInfo).port);
    });
  });
}

function upgrade(port: number, path: string) {
  return new Promise<{ statusCode?: number; error?: Error }>(resolveUpgrade => {
    const client = request({
      host: "127.0.0.1",
      port,
      path,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    });
    client.once("upgrade", response => {
      response.socket.destroy();
      resolveUpgrade({ statusCode: response.statusCode });
    });
    client.once("error", error => resolveUpgrade({ error }));
    client.end();
  });
}

function upgradeWithBufferedPayload(port: number, path: string, payload: string, keepOpen = false) {
  return new Promise<ReturnType<typeof createConnection>>((resolveUpgrade, rejectUpgrade) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let response = "";
    socket.once("connect", () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n${payload}`);
    });
    socket.on("data", chunk => {
      response += chunk.toString();
      if (!response.includes("\r\n\r\n")) return;
      if (!response.startsWith("HTTP/1.1 101")) return rejectUpgrade(new Error(`Unexpected upgrade response: ${response}`));
      if (!keepOpen) socket.destroy();
      resolveUpgrade(socket);
    });
    socket.once("error", rejectUpgrade);
  });
}

describe("VLESS WebSocket upgrade bridge", () => {
  it("persists concurrent bridge deltas in order and enforces the quota when the accumulated total reaches its threshold", async () => {
    const recordTraffic = vi.fn()
      .mockResolvedValueOnce({ trafficLimitBytes: 1000, trafficUsedBytes: 200 })
      .mockResolvedValueOnce({ trafficLimitBytes: 1000, trafficUsedBytes: 500 })
      .mockResolvedValueOnce({ trafficLimitBytes: 1000, trafficUsedBytes: 1000 });
    const enforceQuota = vi.fn().mockResolvedValue(undefined);
    const meter = createTunnelUsageFlusher({ clientId: 9, profile, recordTraffic, enforceQuota, flushThresholdBytes: 1 });

    await Promise.all([meter.observe(200), meter.observe(300), meter.observe(500)]);

    expect(recordTraffic).toHaveBeenNthCalledWith(1, 9, 200);
    expect(recordTraffic).toHaveBeenNthCalledWith(2, 9, 300);
    expect(recordTraffic).toHaveBeenNthCalledWith(3, 9, 500);
    expect(enforceQuota).toHaveBeenCalledTimes(1);
    expect(enforceQuota).toHaveBeenCalledWith(profile);
  });

  it("forwards the configured path to loopback and preserves the upgrade response", async () => {
    const upstream = createTcpServer(socket => {
      socket.once("data", requestBytes => {
        expect(requestBytes.toString()).toContain("GET /vless HTTP/1.1");
        socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n");
      });
    });
    const upstreamPort = await listen(upstream);
    const applyProfile = vi.fn().mockResolvedValue(undefined);
    const bridge = createHttpServer((_request, response) => response.end("not found"));
    registerVlessUpgradeProxy(bridge, {
      getProfile: async () => profile,
      applyProfile,
      internalPort: () => upstreamPort,
      enforceQuota: vi.fn().mockResolvedValue(undefined),
    });
    const bridgePort = await listen(bridge);

    await expect(upgrade(bridgePort, `/vless/${profile.subscriptionToken}`)).resolves.toMatchObject({ statusCode: 101 });
    expect(applyProfile).toHaveBeenCalledWith(profile);
  });

  it("rejects a non-matching upgrade path before applying or contacting Xray", async () => {
    const applyProfile = vi.fn().mockResolvedValue(undefined);
    const bridge = createHttpServer((_request, response) => response.end("not found"));
    registerVlessUpgradeProxy(bridge, {
      getProfile: async () => profile,
      applyProfile,
      internalPort: () => 65535,
    });
    const bridgePort = await listen(bridge);

    const result = await upgrade(bridgePort, "/not-vless");
    expect(result.error).toBeInstanceOf(Error);
    expect(applyProfile).not.toHaveBeenCalled();
  });

  it("rewrites a named client route to the stable private VLESS inbound path", async () => {
    const namedClient = {
      id: 9,
      enabled: true,
      connectionToken: "named-client-route-token",
      expiresAt: null,
    } as unknown as import("../drizzle/schema").GatewayClient;
    const upstream = createTcpServer(socket => {
      socket.once("data", requestBytes => {
        expect(requestBytes.toString()).toContain("GET /vless HTTP/1.1");
        socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n");
      });
    });
    const upstreamPort = await listen(upstream);
    const bridge = createHttpServer((_request, response) => response.end("not found"));
    registerVlessUpgradeProxy(bridge, {
      getProfile: async () => profile,
      getClients: async () => [namedClient],
      applyProfile: vi.fn().mockResolvedValue(undefined),
      internalPort: () => upstreamPort,
      enforceQuota: vi.fn().mockResolvedValue(undefined),
    });
    const bridgePort = await listen(bridge);

    await expect(upgrade(bridgePort, "/vless/named-client-route-token")).resolves.toMatchObject({ statusCode: 101 });
  });

  it("flushes bytes buffered on a named client route and invokes quota enforcement after the quota is reached", async () => {
    const namedClient = { id: 11, enabled: true, connectionToken: "quota-route-token", expiresAt: null } as unknown as import("../drizzle/schema").GatewayClient;
    const recordTraffic = vi.fn().mockResolvedValue({ trafficLimitBytes: 3, trafficUsedBytes: 3 });
    const enforceQuota = vi.fn().mockResolvedValue(undefined);
    const upstream = createTcpServer(socket => {
      socket.once("data", () => socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n"));
    });
    const upstreamPort = await listen(upstream);
    const bridge = createHttpServer((_request, response) => response.end("not found"));
    registerVlessUpgradeProxy(bridge, {
      getProfile: async () => profile,
      getClients: async () => [namedClient],
      applyProfile: vi.fn().mockResolvedValue(undefined),
      internalPort: () => upstreamPort,
      recordTraffic,
      enforceQuota,
    });
    const bridgePort = await listen(bridge);

    await upgradeWithBufferedPayload(bridgePort, "/vless/quota-route-token", "abc");
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(recordTraffic).toHaveBeenCalledWith(11, 3);
    expect(enforceQuota).toHaveBeenCalledTimes(2);
  });

  it("persists each uplink and downlink payload exactly once without counting the upgrade handshake", async () => {
    const namedClient = { id: 12, enabled: true, connectionToken: "bidirectional-route-token", expiresAt: null } as unknown as import("../drizzle/schema").GatewayClient;
    const recordTraffic = vi.fn().mockResolvedValue({ trafficLimitBytes: -1, trafficUsedBytes: 7 });
    const upstream = createTcpServer(socket => {
      socket.once("data", requestBytes => {
        expect(requestBytes.toString()).toContain("GET /vless HTTP/1.1");
        socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\ndown");
      });
    });
    const upstreamPort = await listen(upstream);
    const bridge = createHttpServer((_request, response) => response.end("not found"));
    registerVlessUpgradeProxy(bridge, {
      getProfile: async () => profile,
      getClients: async () => [namedClient],
      applyProfile: vi.fn().mockResolvedValue(undefined),
      internalPort: () => upstreamPort,
      recordTraffic,
      enforceQuota: vi.fn().mockResolvedValue(undefined),
    });
    const bridgePort = await listen(bridge);

    await upgradeWithBufferedPayload(bridgePort, "/vless/bidirectional-route-token", "up!");
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(recordTraffic).toHaveBeenCalledTimes(1);
    expect(recordTraffic).toHaveBeenCalledWith(12, 7);
  });

  it.each([
    ["vmess", 1],
    ["trojan", 2],
  ])("closes a quota-hit %s tunnel reached through an opaque client route", async (protocol, portOffset) => {
    const namedClient = { id: 21 + portOffset, enabled: true, connectionToken: `${protocol}-quota-route`, expiresAt: null } as unknown as import("../drizzle/schema").GatewayClient;
    const recordTraffic = vi.fn().mockResolvedValue({ trafficLimitBytes: 1, trafficUsedBytes: 16 * 1024 });
    const enforceQuota = vi.fn(async () => {
      if (recordTraffic.mock.calls.length) closeActiveGatewayTunnels();
    });
    const upstream = createTcpServer(socket => {
      socket.once("data", requestBytes => {
        expect(requestBytes.toString()).toContain(`GET /${protocol} HTTP/1.1`);
        socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n");
      });
    });
    const upstreamPort = await listen(upstream);
    const bridge = createHttpServer((_request, response) => response.end("not found"));
    registerVlessUpgradeProxy(bridge, {
      getProfile: async () => profile,
      getClients: async () => [namedClient],
      applyProfile: vi.fn().mockResolvedValue(undefined),
      internalPort: () => upstreamPort - portOffset,
      recordTraffic,
      enforceQuota,
    });
    const bridgePort = await listen(bridge);
    const payloadSocket = await upgradeWithBufferedPayload(bridgePort, `/${protocol}/${namedClient.connectionToken}`, "", true);
    try {
      payloadSocket.write("x".repeat(16 * 1024));
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(recordTraffic).toHaveBeenCalledWith(namedClient.id, 16 * 1024);
      expect(enforceQuota).toHaveBeenCalledTimes(2);
      expect(activeGatewayTunnelCount()).toBe(0);
    } finally {
      payloadSocket.destroy();
    }
  });
});
