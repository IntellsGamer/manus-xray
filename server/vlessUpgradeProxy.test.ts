import { createServer as createHttpServer, request } from "http";
import { createConnection, createServer as createTcpServer } from "net";
import { AddressInfo } from "net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VlessProfile } from "../drizzle/schema";
import { ClientSpeedLimiter, createTunnelUsageFlusher, gatewaySourceIdentity, registerVlessUpgradeProxy, speedLimitBytesPerSecond } from "./vlessUpgradeProxy";
import { activeGatewaySourceCountForClient, activeGatewayTunnelCount, activeGatewayTunnelCountForClient, closeActiveGatewayTunnels } from "./gatewayTunnels";

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

function listenAt(server: ReturnType<typeof createTcpServer>, port: number) {
  return new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error) => {
      server.off("error", onError);
      rejectListen(error);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolveListen();
    });
  });
}

async function listenAdjacent(first: ReturnType<typeof createTcpServer>, second: ReturnType<typeof createTcpServer>) {
  for (let port = 19000; port < 19100; port += 2) {
    try {
      await listenAt(first, port);
      try {
        await listenAt(second, port + 1);
        closeables.push(first, second);
        return port;
      } catch {
        await new Promise<void>(resolveClose => first.close(() => resolveClose()));
      }
    } catch {
      // Try the next adjacent port pair.
    }
  }
  throw new Error("Could not allocate adjacent loopback ports for protocol bridge testing");
}

function upgrade(port: number, path: string, extraHeaders: Record<string, string> = {}) {
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
        ...extraHeaders,
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

function upgradeWithBufferedPayload(port: number, path: string, payload: string, keepOpen = false, extraHeaders: Record<string, string> = {}) {
  return new Promise<ReturnType<typeof createConnection>>((resolveUpgrade, rejectUpgrade) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let response = "";
    socket.once("connect", () => {
      const forwardedHeaders = Object.entries(extraHeaders).map(([name, value]) => `${name}: ${value}\r\n`).join("");
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n${forwardedHeaders}\r\n${payload}`);
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

function upgradeThenSendPayload(port: number, path: string, payload: Buffer) {
  return new Promise<ReturnType<typeof createConnection>>((resolveUpgrade, rejectUpgrade) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let response = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      rejectUpgrade(new Error("Timed out waiting for the named route upgrade"));
    }, 5000);
    socket.once("connect", () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
    });
    socket.on("data", chunk => {
      response += chunk.toString();
      if (!response.includes("\r\n\r\n")) return;
      clearTimeout(timeout);
      if (!response.startsWith("HTTP/1.1 101")) return rejectUpgrade(new Error(`Unexpected upgrade response: ${response}`));
      socket.write(payload);
      resolveUpgrade(socket);
    });
    socket.once("error", error => {
      clearTimeout(timeout);
      rejectUpgrade(error);
    });
  });
}

function receiveUpgradePayload(port: number, path: string, expectedPayloadBytes: number) {
  return new Promise<number>((resolvePayload, rejectPayload) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const startedAt = Date.now();
    let response = Buffer.alloc(0);
    const timeout = setTimeout(() => {
      socket.destroy();
      rejectPayload(new Error("Timed out waiting for upgraded payload"));
    }, 5000);
    socket.once("connect", () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
    });
    socket.on("data", chunk => {
      response = Buffer.concat([response, chunk]);
      const headerBoundary = response.indexOf("\r\n\r\n");
      if (headerBoundary === -1 || response.length - headerBoundary - 4 < expectedPayloadBytes) return;
      clearTimeout(timeout);
      socket.destroy();
      resolvePayload(Date.now() - startedAt);
    });
    socket.once("error", error => {
      clearTimeout(timeout);
      rejectPayload(error);
    });
  });
}

describe("VLESS WebSocket upgrade bridge", () => {
  it("normalizes Cloudflare IPv6 source addresses to a /64 while preserving exact IPv4 identities", () => {
    const request = (source: string) => ({ headers: { "cf-connecting-ip": source }, socket: { remoteAddress: "127.0.0.1" } }) as unknown as import("http").IncomingMessage;

    expect(gatewaySourceIdentity(request("2001:db8:1234:5678:aaaa:bbbb:cccc:dddd"))).toBe("2001:db8:1234:5678::/64");
    expect(gatewaySourceIdentity(request("2001:db8:1234:5678:1111:2222:3333:4444"))).toBe("2001:db8:1234:5678::/64");
    expect(gatewaySourceIdentity(request("2001:db8:1234:5679::1"))).toBe("2001:db8:1234:5679::/64");
    expect(gatewaySourceIdentity(request("198.51.100.20"))).toBe("198.51.100.20");
  });

  it("shares one finite Mbps budget across upload and download reservations", () => {
    const limiter = new ClientSpeedLimiter(1_000);

    expect(speedLimitBytesPerSecond(-1)).toBe(0);
    expect(speedLimitBytesPerSecond(8)).toBe(1_000_000);
    expect(limiter.reserve(500, 0)).toBe(500);
    expect(limiter.reserve(500, 0)).toBe(1_000);
    expect(limiter.reserve(250, 0)).toBe(1_250);
  });

  it("throttles a finite-Mbps named route while leaving an unlimited route direct", async () => {
    const payload = Buffer.alloc(128 * 1024, 0x61);
    const finiteClient = { id: 51, enabled: true, connectionToken: "finite-speed-route", expiresAt: null, speedLimitMbps: 1 } as unknown as import("../drizzle/schema").GatewayClient;
    const unlimitedClient = { id: 52, enabled: true, connectionToken: "unlimited-speed-route", expiresAt: null, speedLimitMbps: -1 } as unknown as import("../drizzle/schema").GatewayClient;
    const upstream = createTcpServer(socket => {
      socket.once("data", () => {
        socket.write(Buffer.concat([Buffer.from("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n"), payload]));
      });
    });
    const upstreamPort = await listen(upstream);
    const bridge = createHttpServer((_request, response) => response.end("not found"));
    registerVlessUpgradeProxy(bridge, {
      getProfile: async () => profile,
      getClients: async () => [finiteClient, unlimitedClient],
      applyProfile: vi.fn().mockResolvedValue(undefined),
      internalPort: () => upstreamPort,
      recordTraffic: vi.fn().mockResolvedValue({ trafficLimitBytes: -1, trafficUsedBytes: 0 }),
      enforceQuota: vi.fn().mockResolvedValue(undefined),
    });
    const bridgePort = await listen(bridge);

    const unlimitedElapsed = await receiveUpgradePayload(bridgePort, "/vless/unlimited-speed-route", payload.length);
    const limitedElapsed = await receiveUpgradePayload(bridgePort, "/vless/finite-speed-route", payload.length);

    expect(unlimitedElapsed).toBeLessThan(500);
    expect(limitedElapsed).toBeGreaterThanOrEqual(800);
    expect(limitedElapsed).toBeGreaterThan(unlimitedElapsed + 500);
  });

  it("shares one finite client budget across concurrent bridge tunnels", async () => {
    const payload = Buffer.alloc(64 * 1024, 0x62);
    const namedClient = { id: 53, enabled: true, connectionToken: "shared-speed-route", expiresAt: null, speedLimitMbps: 1 } as unknown as import("../drizzle/schema").GatewayClient;
    const upstream = createTcpServer(socket => {
      socket.once("data", () => {
        socket.write(Buffer.concat([Buffer.from("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n"), payload]));
      });
    });
    const upstreamPort = await listen(upstream);
    const bridge = createHttpServer((_request, response) => response.end("not found"));
    registerVlessUpgradeProxy(bridge, {
      getProfile: async () => profile,
      getClients: async () => [namedClient],
      applyProfile: vi.fn().mockResolvedValue(undefined),
      internalPort: () => upstreamPort,
      recordTraffic: vi.fn().mockResolvedValue({ trafficLimitBytes: -1, trafficUsedBytes: 0 }),
      enforceQuota: vi.fn().mockResolvedValue(undefined),
    });
    const bridgePort = await listen(bridge);

    const durations = await Promise.all([
      receiveUpgradePayload(bridgePort, "/vless/shared-speed-route", payload.length),
      receiveUpgradePayload(bridgePort, "/vless/shared-speed-route", payload.length),
    ]);

    expect(Math.max(...durations)).toBeGreaterThanOrEqual(900);
  });

  it("shares a finite client budget across concurrent VLESS and VMess routes", async () => {
    const payload = Buffer.alloc(64 * 1024, 0x63);
    const namedClient = { id: 54, enabled: true, connectionToken: "cross-protocol-speed-route", expiresAt: null, speedLimitMbps: 1 } as unknown as import("../drizzle/schema").GatewayClient;
    const respond = (socket: Socket) => {
      socket.once("data", () => {
        socket.write(Buffer.concat([Buffer.from("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n"), payload]));
      });
    };
    const vlessUpstream = createTcpServer(respond);
    const vmessUpstream = createTcpServer(respond);
    const internalPort = await listenAdjacent(vlessUpstream, vmessUpstream);
    const bridge = createHttpServer((_request, response) => response.end("not found"));
    registerVlessUpgradeProxy(bridge, {
      getProfile: async () => profile,
      getClients: async () => [namedClient],
      applyProfile: vi.fn().mockResolvedValue(undefined),
      internalPort: () => internalPort,
      recordTraffic: vi.fn().mockResolvedValue({ trafficLimitBytes: -1, trafficUsedBytes: 0 }),
      enforceQuota: vi.fn().mockResolvedValue(undefined),
    });
    const bridgePort = await listen(bridge);

    const durations = await Promise.all([
      receiveUpgradePayload(bridgePort, "/vless/cross-protocol-speed-route", payload.length),
      receiveUpgradePayload(bridgePort, "/vmess/cross-protocol-speed-route", payload.length),
    ]);

    expect(Math.max(...durations)).toBeGreaterThanOrEqual(900);
  });

  it("allows multiplexed VLESS and VMess tunnels from one Cloudflare source while rejecting a distinct source at the finite client cap", async () => {
    const namedClient = { id: 55, enabled: true, connectionToken: "shared-connection-cap-route", expiresAt: null, connectionLimit: 1 } as unknown as import("../drizzle/schema").GatewayClient;
    const respond = (socket: Socket) => {
      socket.once("data", () => socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n"));
    };
    const vlessUpstream = createTcpServer(respond);
    const vmessUpstream = createTcpServer(respond);
    const internalPort = await listenAdjacent(vlessUpstream, vmessUpstream);
    const applyProfile = vi.fn().mockResolvedValue(undefined);
    const bridge = createHttpServer((_request, response) => response.end("not found"));
    registerVlessUpgradeProxy(bridge, {
      getProfile: async () => profile,
      getClients: async () => [namedClient],
      applyProfile,
      internalPort: () => internalPort,
      recordTraffic: vi.fn().mockResolvedValue({ trafficLimitBytes: -1, trafficUsedBytes: 0 }),
      enforceQuota: vi.fn().mockResolvedValue(undefined),
    });
    const bridgePort = await listen(bridge);

    const sharedSource = { "cf-connecting-ip": "2001:db8:1234:5678::10" };
    const sameIpv6Network = { "cf-connecting-ip": "2001:db8:1234:5678:ffff:eeee:dddd:cccc" };
    const secondSource = { "cf-connecting-ip": "2001:db8:1234:5679::11" };
    const first = await upgradeWithBufferedPayload(bridgePort, "/vless/shared-connection-cap-route", "", true, sharedSource);
    expect(activeGatewayTunnelCountForClient(namedClient.id)).toBe(1);
    const sameSource = await upgradeWithBufferedPayload(bridgePort, "/vmess/shared-connection-cap-route", "", true, sameIpv6Network);
    expect(activeGatewayTunnelCountForClient(namedClient.id)).toBe(2);
    expect(activeGatewaySourceCountForClient(namedClient.id)).toBe(1);
    const rejected = await upgrade(bridgePort, "/vmess/shared-connection-cap-route", secondSource);
    expect(rejected.error).toBeInstanceOf(Error);
    expect(applyProfile).not.toHaveBeenCalled();

    first.destroy();
    sameSource.destroy();
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(activeGatewayTunnelCountForClient(namedClient.id)).toBe(0);
    expect(activeGatewaySourceCountForClient(namedClient.id)).toBe(0);
    await expect(upgrade(bridgePort, "/vmess/shared-connection-cap-route", secondSource)).resolves.toMatchObject({ statusCode: 101 });
  });

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
    expect(enforceQuota).toHaveBeenCalledOnce();
    expect(enforceQuota).toHaveBeenCalledWith(profile);
  });

  it("forwards the configured path to loopback without reapplying the Xray profile", async () => {
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
    expect(applyProfile).not.toHaveBeenCalled();
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

    expect(recordTraffic).toHaveBeenCalledOnce();
    expect(recordTraffic).toHaveBeenCalledWith(12, 7);
  });

  it("records a real 10 MB payload sent through a named VLESS gateway route before quota closure", async () => {
    const payload = Buffer.alloc(10 * 1024 * 1024, 0x61);
    const namedClient = { id: 13, enabled: true, connectionToken: "ten-megabyte-route-token", expiresAt: null } as unknown as import("../drizzle/schema").GatewayClient;
    let recordedBytes = 0;
    const recordTraffic = vi.fn(async (_clientId: number, bytes: number) => {
      recordedBytes += bytes;
      return { trafficLimitBytes: payload.length, trafficUsedBytes: recordedBytes };
    });
    const enforceQuota = vi.fn().mockResolvedValue(undefined);
    const upstream = createTcpServer(socket => {
      socket.once("data", () => {
        socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n");
        socket.on("data", () => {});
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
      enforceQuota,
    });
    const bridgePort = await listen(bridge);
    const payloadSocket = await upgradeThenSendPayload(bridgePort, "/vless/ten-megabyte-route-token", payload);
    try {
      await vi.waitFor(() => expect(recordedBytes).toBe(payload.length), { timeout: 5000 });
      expect(recordTraffic).toHaveBeenCalledWith(namedClient.id, expect.any(Number));
      expect(enforceQuota).toHaveBeenCalledTimes(2);
    } finally {
      payloadSocket.destroy();
    }
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
