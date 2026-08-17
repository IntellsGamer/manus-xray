import { createServer as createHttpServer, request } from "http";
import { createServer as createTcpServer } from "net";
import { AddressInfo } from "net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VlessProfile } from "../drizzle/schema";
import { registerVlessUpgradeProxy } from "./vlessUpgradeProxy";

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

describe("VLESS WebSocket upgrade bridge", () => {
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
    });
    const bridgePort = await listen(bridge);

    await expect(upgrade(bridgePort, "/vless/named-client-route-token")).resolves.toMatchObject({ statusCode: 101 });
  });
});
