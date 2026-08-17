import { describe, expect, it } from "vitest";
import type { VlessProfile } from "../drizzle/schema";
import { buildSubscriptionPayload, buildVlessUri, buildXrayConfig, normaliseWsPath } from "./vless";

const profile: VlessProfile = {
  id: 1,
  uuid: "51dc1a8e-0667-4ed5-aa36-15c8c5a85125",
  serverAddress: "gateway.example.com",
  port: 443,
  wsPath: "vless",
  tlsEnabled: true,
  subscriptionToken: "local_xray_validation_token_00000",
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
    expect(Buffer.from(buildSubscriptionPayload(profile), "base64").toString("utf8")).toBe(uri);
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
  });
});
