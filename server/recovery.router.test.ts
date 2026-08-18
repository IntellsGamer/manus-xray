import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const database = vi.hoisted(() => ({ exportGatewayRecoverySnapshot: vi.fn(), replaceGatewayRecoverySnapshot: vi.fn() }));
const runtime = vi.hoisted(() => ({ applyXrayProfile: vi.fn() }));
const tunnels = vi.hoisted(() => ({ closeActiveGatewayTunnels: vi.fn(() => 2) }));
vi.mock("./db", () => database);
vi.mock("./xrayRuntime", () => runtime);
vi.mock("./gatewayTunnels", () => tunnels);

import { recoveryRouter } from "./routers/recovery";

function context(): TrpcContext {
  return {
    user: { id: 1, openId: "owner", name: "Owner", email: null, loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { headers: {}, protocol: "https" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function snapshot(connectionToken = "connection-token") {
  return {
    schemaVersion: 1 as const,
    exportedAt: "2026-08-18T12:00:00.000Z",
    profile: { uuid: "51dc1a8e-0667-4ed5-aa36-15c8c5a85125", serverAddress: "gateway.example.com", port: 443, wsPath: "/vless", tlsEnabled: true, subscriptionToken: "profile-token", vmessUuid: "f0f5027c-7325-43d2-97c3-84957a7934e9", vmessWsPath: "/vmess", trojanPassword: "gateway-trojan", trojanWsPath: "/trojan", socksUsername: "gateway", socksPassword: "gateway-socks", socksWsPath: "/socks", globalProfileEnabled: true },
    templates: [{ name: "Standard", trafficLimitBytes: 1024, dayLimit: 30, speedLimitMbps: 25, connectionLimit: 3 }],
    clients: [{ name: "Recovered client", enabled: true, vlessUuid: "faec6149-bbf5-45f8-a1bc-657d64023841", vmessUuid: "be1d4606-5320-450d-82ae-2e447f6a7d8b", trojanPassword: "client-trojan", socksUsername: "client-socks", socksPassword: "client-socks-password", subscriptionToken: "client-subscription-token", connectionToken, trafficLimitBytes: 1024, trafficUsedBytes: 512, dayLimit: 30, speedLimitMbps: 25, connectionLimit: 3, expiresAt: null, quotaExhaustedAt: null }],
  };
}

describe("recovery router", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exports the server-produced recovery snapshot for the owner", async () => {
    const backup = snapshot();
    database.exportGatewayRecoverySnapshot.mockResolvedValue(backup);

    await expect(recoveryRouter.createCaller(context()).exportSnapshot()).resolves.toEqual(backup);
  });

  it("validates a snapshot, restores it, reloads Xray, and closes existing tunnels", async () => {
    const backup = snapshot();
    database.exportGatewayRecoverySnapshot.mockResolvedValue(backup);
    database.replaceGatewayRecoverySnapshot.mockResolvedValue(backup.profile);
    runtime.applyXrayProfile.mockResolvedValue(undefined);

    await expect(recoveryRouter.createCaller(context()).importSnapshot(backup)).resolves.toEqual({ success: true, clientCount: 1, templateCount: 1, closedTunnels: 2 });
    expect(database.replaceGatewayRecoverySnapshot).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: 1 }));
    expect(runtime.applyXrayProfile).toHaveBeenCalledWith(backup.profile);
    expect(tunnels.closeActiveGatewayTunnels).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate opaque connection tokens before changing stored gateway data", async () => {
    const invalid = snapshot();
    invalid.clients.push({ ...invalid.clients[0], name: "Duplicate route", vlessUuid: "8bf7bd03-0680-4edb-8d17-3a84fd3b903d", vmessUuid: "8fd5b8fe-332d-4545-9a62-36b8247729fa" });

    await expect(recoveryRouter.createCaller(context()).importSnapshot(invalid)).rejects.toThrow("duplicate connection token");
    expect(database.replaceGatewayRecoverySnapshot).not.toHaveBeenCalled();
  });
});
