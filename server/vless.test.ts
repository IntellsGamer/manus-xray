import { describe, expect, it } from "vitest";
import type { VlessProfile } from "../drizzle/schema";
import { buildSocksClientConfig, buildSubscriptionPayload, buildTrojanUri, buildVlessUri, buildVmessUri, buildXrayConfig, normaliseWsPath } from "./vless";

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
  createdAt: new Date("2026-08-17T00:00:00Z"),
  updatedAt: new Date("2026-08-17T00:00:00Z"),
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
    expect(socks.outbounds[0].settings.servers[0].users[0]).toEqual({ user: "gateway", pass: "test-socks-password" });
    expect(socks.outbounds[0].streamSettings.wsSettings.path).toBe("/socks");
  });
});
