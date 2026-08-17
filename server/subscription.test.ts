import express from "express";
import { AddressInfo } from "net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VlessProfile } from "../drizzle/schema";

const databaseMock = vi.hoisted(() => ({ getVlessProfileBySubscriptionToken: vi.fn() }));
vi.mock("./db", () => ({ getVlessProfileBySubscriptionToken: databaseMock.getVlessProfileBySubscriptionToken }));

import { registerSubscriptionRoute } from "./subscription";

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

const servers: ReturnType<ReturnType<typeof express>["listen"]>[] = [];

afterEach(async () => {
  databaseMock.getVlessProfileBySubscriptionToken.mockReset();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

async function request(path: string) {
  const app = express();
  registerSubscriptionRoute(app);
  const server = app.listen(0);
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${port}${path}`);
}

describe("subscription route", () => {
  it("serves a base64 VLESS payload for the matching token", async () => {
    databaseMock.getVlessProfileBySubscriptionToken.mockResolvedValue(profile);
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
});
