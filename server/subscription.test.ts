import express from "express";
import { AddressInfo } from "net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VlessProfile } from "../drizzle/schema";

const databaseMock = vi.hoisted(() => ({ getVlessProfileBySubscriptionToken: vi.fn(), getGatewayClientBySubscriptionToken: vi.fn(), getVlessProfile: vi.fn(), recordSubscriptionDelivery: vi.fn() }));
const runtimeMock = vi.hoisted(() => ({ syncGatewayClientTrafficUsage: vi.fn() }));
vi.mock("./db", () => ({
  getVlessProfileBySubscriptionToken: databaseMock.getVlessProfileBySubscriptionToken,
  getGatewayClientBySubscriptionToken: databaseMock.getGatewayClientBySubscriptionToken,
  getVlessProfile: databaseMock.getVlessProfile,
  recordSubscriptionDelivery: databaseMock.recordSubscriptionDelivery,
}));
vi.mock("./xrayRuntime", () => ({ syncGatewayClientTrafficUsage: runtimeMock.syncGatewayClientTrafficUsage }));

import { registerSubscriptionRoute } from "./subscription";

const namedClient = {
  id: 4, name: "Browser client", enabled: true, vlessUuid: "faec6149-bbf5-45f8-a1bc-657d64023841", vmessUuid: "be1d4606-5320-450d-82ae-2e447f6a7d8b", trojanPassword: "named-trojan-password", socksUsername: "client-browser", socksPassword: "named-socks-password", subscriptionToken: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", trafficLimitBytes: 10 * 1024 * 1024, trafficUsedBytes: 0, trafficStatsSnapshotBytes: 0, dayLimit: -1, expiresAt: null, lastSubscriptionAt: null, subscriptionDeliveryCount: 0, createdAt: new Date(), updatedAt: new Date(),
};

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
  globalProfileEnabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const servers: ReturnType<ReturnType<typeof express>["listen"]>[] = [];

afterEach(async () => {
  databaseMock.getVlessProfileBySubscriptionToken.mockReset();
  databaseMock.getGatewayClientBySubscriptionToken.mockReset();
  databaseMock.getVlessProfile.mockReset();
  databaseMock.recordSubscriptionDelivery.mockReset();
  runtimeMock.syncGatewayClientTrafficUsage.mockReset();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

async function request(path: string, headers?: Record<string, string>) {
  const app = express();
  registerSubscriptionRoute(app);
  const server = app.listen(0);
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${port}${path}`, { headers });
}

describe("subscription route", () => {
  it("serves a base64 VLESS payload for the matching token", async () => {
    databaseMock.getVlessProfileBySubscriptionToken.mockResolvedValue(profile);
    databaseMock.recordSubscriptionDelivery.mockResolvedValue(undefined);
    const response = await request(`/sub/${profile.subscriptionToken}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(Buffer.from(await response.text(), "base64").toString("utf8")).toContain(`vless://${profile.uuid}@`);
  });

  it("returns 404 without database lookup for malformed tokens", async () => {
    const response = await request("/sub/not-a-valid-token");
    expect(response.status).toBe(404);
    expect(databaseMock.getVlessProfileBySubscriptionToken).not.toHaveBeenCalled();
  });

  it("returns a status page for a browser subscription visit without replacing proxy payload delivery", async () => {
    databaseMock.getVlessProfileBySubscriptionToken.mockResolvedValue(profile);
    databaseMock.recordSubscriptionDelivery.mockResolvedValue(undefined);
    const response = await request(`/sub/${profile.subscriptionToken}`, { accept: "text/html", "user-agent": "Mozilla/5.0" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    await expect(response.text()).resolves.toContain("Global gateway profile");
  });

  it("shows credential-specific connection details on a valid named-client browser visit", async () => {
    databaseMock.getVlessProfileBySubscriptionToken.mockResolvedValue(undefined);
    databaseMock.getGatewayClientBySubscriptionToken.mockResolvedValue(namedClient);
    databaseMock.getVlessProfile.mockResolvedValue(profile);
    databaseMock.recordSubscriptionDelivery.mockResolvedValue(undefined);
    runtimeMock.syncGatewayClientTrafficUsage.mockResolvedValue(new Map([[namedClient.id, 2 * 1024 * 1024]]));
    const response = await request(`/sub/${namedClient.subscriptionToken}`, { accept: "text/html", "user-agent": "Mozilla/5.0" });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(namedClient.vlessUuid);
    expect(html).toContain("8 MB left");
  });
});
