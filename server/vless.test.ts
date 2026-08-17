import { describe, expect, it } from "vitest";
import type { GatewayClient, VlessProfile } from "../drizzle/schema";
import { buildClientConnectionDetails, buildSocksClientConfig, buildSubscriptionPayload, buildTrojanUri, buildVlessUri, buildVmessUri, buildXrayConfig, normaliseGatewayPaths, normaliseWsPath } from "./vless";

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
    const subscriptionLines = Buffer.from(buildSubscriptionPayload(profile), "base64").toString("utf8").split("\n");
    expect(subscriptionLines).toHaveLength(3);
    expect(subscriptionLines[0]).toBe(uri);
    expect(subscriptionLines[1]).toMatch(/^vmess:\/\//);
    expect(subscriptionLines[2]).toMatch(/^trojan:\/\//);
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
    expect(config.inbounds).toHaveLength(4);
    expect(config.inbounds.map(inbound => inbound.port)).toEqual([10000, 10001, 10002, 10003]);
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
    const config = buildXrayConfig(disabledGlobal, 10000, [namedClient]) as { inbounds: Array<{ settings: { clients?: Array<{ id?: string; password?: string }>; accounts?: Array<{ user: string }> } }> };
    const clientDetails = buildClientConnectionDetails(profile, namedClient);

    expect(config.inbounds[0]?.settings.clients).toEqual([{ id: namedClient.vlessUuid }]);
    expect(config.inbounds[1]?.settings.clients).toEqual([{ id: namedClient.vmessUuid, level: 0 }]);
    expect(config.inbounds[2]?.settings.clients).toEqual([{ password: namedClient.trojanPassword }]);
    expect(config.inbounds[3]?.settings.accounts).toEqual([{ user: namedClient.socksUsername, pass: namedClient.socksPassword }]);
    expect(clientDetails.vlessUri).toContain(namedClient.vlessUuid);
    expect(clientDetails.vmessUri).toContain(Buffer.from(namedClient.vmessUuid).toString("base64").slice(0, 0));
    expect(clientDetails.trojanUri).toContain(encodeURIComponent(namedClient.trojanPassword));
  });

  it("rejects colliding protocol paths after normalization", () => {
    expect(() => normaliseGatewayPaths({ wsPath: "shared", vmessWsPath: "/shared", trojanWsPath: "/trojan", socksWsPath: "/socks" })).toThrow("different WebSocket path");
  });
});
