import { describe, expect, it } from "vitest";
import type { GatewayClient, VlessProfile } from "../drizzle/schema";
import { buildClientConnectionDetails, buildClientSubscriptionPayload, buildSocksClientConfig, buildSubscriptionPayload, buildTrojanUri, buildVlessUri, buildVmessUri, buildXhttpUri, buildXrayConfig, clientWebSocketPaths, normaliseGatewayPaths, normaliseWsPath, resolvePublicGatewayRoute } from "./vless";

const profile: VlessProfile = {
  id: 1,
  uuid: "51dc1a8e-0667-4ed5-aa36-15c8c5a85125",
  serverAddress: "gateway.example.com",
  port: 443,
  wsPath: "vless",
  tlsEnabled: true,
  subscriptionToken: "local_xray_validation_token_00000",
  vmessUuid: "f0f5027c-7325-43d2-97c3-84957a7934e9",
  vmessWsPath: "/vmess",
  trojanPassword: "test-trojan-password",
  trojanWsPath: "/trojan",
  socksUsername: "gateway",
  socksPassword: "test-socks-password",
  socksWsPath: "/socks",
  globalProfileEnabled: true,
  createdAt: new Date("2026-08-17T00:00:00Z"),
  updatedAt: new Date("2026-08-17T00:00:00Z"),
};

const namedClient: GatewayClient = {
  id: 9,
  name: "Test device",
  enabled: true,
  vlessUuid: "faec6149-bbf5-45f8-a1bc-657d64023841",
  vmessUuid: "be1d4606-5320-450d-82ae-2e447f6a7d8b",
  trojanPassword: "named-trojan-password",
  socksUsername: "client-test-device",
  socksPassword: "named-socks-password",
  subscriptionToken: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  connectionToken: "named-client-route-token",
  trafficLimitBytes: -1,
  trafficUsedBytes: 0,
  trafficStatsSnapshotBytes: 0,
  quotaExhaustedAt: null,
  expiresAt: null,
  lastSubscriptionAt: null,
  subscriptionDeliveryCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("VLESS profile serialization", () => {
  it("creates a client-importable VLESS URI and base64 subscription payload", () => {
    const uri = buildVlessUri(profile);
    const parsed = new URL(uri);

    expect(parsed.protocol).toBe("vless:");
    expect(parsed.username).toBe(profile.uuid);
    expect(parsed.hostname).toBe(profile.serverAddress);
    expect(parsed.port).toBe("443");
    expect(parsed.searchParams.get("encryption")).toBe("none");
    expect(parsed.searchParams.get("security")).toBe("tls");
    expect(parsed.searchParams.get("type")).toBe("ws");
    expect(parsed.searchParams.get("path")).toBe("/vless");
    const xhttp = new URL(buildXhttpUri(profile));
    expect(xhttp.searchParams.get("type")).toBe("xhttp");
    expect(xhttp.searchParams.get("mode")).toBe("packet-up");
    expect(xhttp.searchParams.get("path")).toBe(`/xhttp/${profile.subscriptionToken}`);
    expect(JSON.parse(xhttp.searchParams.get("extra") || "{}")).toEqual({ headers: { "User-Agent": "firefox" }, xPaddingBytes: "100-1000", scMaxBufferedPosts: 30, scStreamUpServerSecs: "20-80" });
    const subscriptionLines = Buffer.from(buildSubscriptionPayload(profile), "base64").toString("utf8").split("\n");
    expect(subscriptionLines).toHaveLength(4);
    expect(new URL(subscriptionLines[0] || "").searchParams.get("path")).toBe(`/vless/${profile.subscriptionToken}`);
    expect(new URL(subscriptionLines[1] || "").searchParams.get("type")).toBe("xhttp");
    expect(subscriptionLines[2]).toMatch(/^vmess:\/\//);
    expect(subscriptionLines[3]).toMatch(/^trojan:\/\//);
  });

  it("normalizes the WebSocket path and produces a valid VLESS inbound shape", () => {
    const config = buildXrayConfig(profile, 10000) as {
      inbounds: Array<{ port: number; settings: { clients: Array<{ id: string; encryption?: string }> }; streamSettings: { wsSettings: { path: string } } }>;
    };

    expect(normaliseWsPath("gateway")).toBe("/gateway");
    expect(normaliseWsPath("/gateway")).toBe("/gateway");
    expect(config.inbounds[0]?.port).toBe(10000);
    expect(config.inbounds[0]?.listen).toBe("127.0.0.1");
    expect(config.inbounds[0]?.settings.clients[0]).toEqual({ id: profile.uuid });
    expect(config.inbounds[0]?.streamSettings.wsSettings.path).toBe("/vless");
    expect(config.inbounds).toHaveLength(5);
    expect(config.inbounds.map(inbound => inbound.port)).toEqual([10000, 10001, 10002, 10003, 10004]);
    expect(config.inbounds[4]).toMatchObject({ port: 10004, streamSettings: { network: "xhttp", xhttpSettings: { path: "/xhttp", mode: "auto", headers: { "User-Agent": "firefox" }, xPaddingBytes: "100-1000", scMaxBufferedPosts: 30, scStreamUpServerSecs: "20-80" } } });
  });

  it("serializes VMess, Trojan, and SOCKS5 imports with their isolated transport paths", () => {
    const vmess = JSON.parse(Buffer.from(buildVmessUri(profile).replace("vmess://", ""), "base64").toString("utf8"));
    const trojan = new URL(buildTrojanUri(profile));
    const socks = JSON.parse(buildSocksClientConfig(profile));

    expect(vmess.id).toBe(profile.vmessUuid);
    expect(vmess.path).toBe("/vmess");
    expect(trojan.protocol).toBe("trojan:");
    expect(trojan.searchParams.get("path")).toBe("/trojan");
    expect(socks.outbounds[0].protocol).toBe("socks");
    expect(socks.outbounds[0].settings.servers[0].users[0]).toEqual({ user: "gateway", pass: "test-socks-password" });
    expect(socks.outbounds[0].streamSettings.wsSettings.path).toBe("/socks");
  });

  it("isolates named credentials and excludes global credentials when the global profile is disabled", () => {
    const disabledGlobal = { ...profile, globalProfileEnabled: false };
    const config = buildXrayConfig(disabledGlobal, 10000, [namedClient]) as { inbounds: Array<{ tag?: string; port?: number; settings: { clients?: Array<{ id?: string; password?: string }>; accounts?: Array<{ user: string }> } }> };
    const clientDetails = buildClientConnectionDetails(profile, namedClient);

    expect(config.inbounds[0]?.settings.clients).toEqual([{ id: namedClient.vlessUuid, email: `gateway-client-${namedClient.id}-vless@local.invalid`, level: 0 }]);
    expect(config.inbounds[1]?.settings.clients).toEqual([{ id: namedClient.vmessUuid, email: `gateway-client-${namedClient.id}-vmess@local.invalid`, level: 0 }]);
    expect(config.inbounds[2]?.settings.clients).toEqual([{ password: namedClient.trojanPassword, email: `gateway-client-${namedClient.id}-trojan@local.invalid`, level: 0 }]);
    expect(config.inbounds[3]?.settings.accounts).toEqual([]);
    expect(config.inbounds[4]?.settings.clients).toEqual([{ id: namedClient.vlessUuid, email: `gateway-client-${namedClient.id}-vless@local.invalid`, level: 0 }]);
    expect(config.inbounds[5]).toMatchObject({ tag: "gateway-client-9-socks-in", port: 10109, settings: { accounts: [{ user: namedClient.socksUsername, pass: namedClient.socksPassword }] } });
    expect(clientDetails.vlessUri).toContain(namedClient.vlessUuid);
    expect(new URL(clientDetails.vlessUri).searchParams.get("path")).toBe("/vless/named-client-route-token");
    const namedXhttp = new URL(clientDetails.xhttpUri);
    expect(namedXhttp.searchParams.get("type")).toBe("xhttp");
    expect(namedXhttp.searchParams.get("mode")).toBe("packet-up");
    expect(namedXhttp.searchParams.get("path")).toBe("/xhttp/named-client-route-token");
    expect(JSON.parse(namedXhttp.searchParams.get("extra") || "{}")).toEqual({ headers: { "User-Agent": "firefox" }, xPaddingBytes: "100-1000", scMaxBufferedPosts: 30, scStreamUpServerSecs: "20-80" });
    expect(decodeURIComponent(new URL(clientDetails.xhttpUri).hash.slice(1))).toBe("Nginx Gateway · VLESS XHTTP");
    expect(JSON.parse(Buffer.from(clientDetails.vmessUri.replace("vmess://", ""), "base64").toString("utf8")).path).toBe("/vmess/named-client-route-token");
    expect(new URL(clientDetails.trojanUri).searchParams.get("path")).toBe("/trojan/named-client-route-token");
    expect(clientDetails.vmessUri).toContain(Buffer.from(namedClient.vmessUuid).toString("base64").slice(0, 0));
    expect(clientDetails.trojanUri).toContain(encodeURIComponent(namedClient.trojanPassword));
    const subscriptionLines = Buffer.from(buildClientSubscriptionPayload(profile, namedClient), "base64").toString("utf8").split("\n");
    expect(subscriptionLines).toHaveLength(4);
    expect(new URL(subscriptionLines[1] || "").searchParams.get("path")).toBe("/xhttp/named-client-route-token");
  });

  it("rejects colliding protocol paths after normalization", () => {
    expect(() => normaliseGatewayPaths({ wsPath: "shared", vmessWsPath: "/shared", trojanWsPath: "/trojan", socksWsPath: "/socks" })).toThrow("different WebSocket path");
  });

  it("maps a named client’s opaque public routes to the existing private Xray protocol path and port", () => {
    const paths = clientWebSocketPaths(profile, namedClient);
    const route = resolvePublicGatewayRoute(profile, 10000, [namedClient], paths.vless);

    expect(paths).toEqual({
      vless: "/vless/named-client-route-token",
      vmess: "/vmess/named-client-route-token",
      trojan: "/trojan/named-client-route-token",
      socks: "/socks/named-client-route-token",
    });
    expect(route).toMatchObject({ protocol: "vless", internalPath: "/vless", port: 10000, client: { id: namedClient.id } });
    expect(resolvePublicGatewayRoute(profile, 10000, [namedClient], "/vless/unknown-route")).toBeUndefined();
  });
});
