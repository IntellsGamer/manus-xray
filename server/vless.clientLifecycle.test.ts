import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  activateGatewayClientIfDue: vi.fn(),
  ensureVlessProfile: vi.fn(),
  getGatewayClientById: vi.fn(),
  createGatewayClient: vi.fn(),
  deleteGatewayClient: vi.fn(),
  listGatewayClients: vi.fn(),
  listSubscriptionEventsForClient: vi.fn(),
  regenerateGatewayProtocolCredential: vi.fn(),
  regenerateSubscriptionToken: vi.fn(),
  regenerateVlessUuid: vi.fn(),
  resetGatewayClientTrafficUsage: vi.fn(),
  revokeGatewayClient: vi.fn(),
  rotateGatewayClientCredentials: vi.fn(),
  setGatewayClientEnabled: vi.fn(),
  updateGatewayPathsAndGlobalProfile: vi.fn(),
  updateGatewayClientPolicy: vi.fn(),
  updateVlessProfile: vi.fn(),
  applyXrayProfile: vi.fn(),
}));

vi.mock("./db", () => ({
  activateGatewayClientIfDue: mocks.activateGatewayClientIfDue,
  createGatewayClient: mocks.createGatewayClient,
  deleteGatewayClient: mocks.deleteGatewayClient,
  ensureVlessProfile: mocks.ensureVlessProfile,
  getGatewayClientById: mocks.getGatewayClientById,
  listGatewayClients: mocks.listGatewayClients,
  listSubscriptionEventsForClient: mocks.listSubscriptionEventsForClient,
  regenerateGatewayProtocolCredential: mocks.regenerateGatewayProtocolCredential,
  regenerateSubscriptionToken: mocks.regenerateSubscriptionToken,
  regenerateVlessUuid: mocks.regenerateVlessUuid,
  resetGatewayClientTrafficUsage: mocks.resetGatewayClientTrafficUsage,
  revokeGatewayClient: mocks.revokeGatewayClient,
  rotateGatewayClientCredentials: mocks.rotateGatewayClientCredentials,
  setGatewayClientEnabled: mocks.setGatewayClientEnabled,
  updateGatewayPathsAndGlobalProfile: mocks.updateGatewayPathsAndGlobalProfile,
  updateGatewayClientPolicy: mocks.updateGatewayClientPolicy,
  updateVlessProfile: mocks.updateVlessProfile,
}));

vi.mock("./vless", () => ({
  buildClientConnectionDetails: vi.fn(() => ({ vlessUri: "vless://isolated" })),
  buildSocksClientConfig: vi.fn(() => ({})),
  buildTrojanUri: vi.fn(() => "trojan://isolated"),
  buildVlessUri: vi.fn(() => "vless://isolated"),
  buildVmessUri: vi.fn(() => "vmess://isolated"),
  normaliseWsPath: vi.fn((value: string) => value),
}));

vi.mock("./xrayRuntime", () => ({ applyXrayProfile: mocks.applyXrayProfile, enforceGatewayTrafficQuotas: vi.fn() }));

import { vlessRouter } from "./routers/vless";

const profile = {
  uuid: "00000000-0000-4000-8000-000000000001",
  vmessUuid: "00000000-0000-4000-8000-000000000002",
  trojanPassword: "trojan-secret",
  socksUsername: "socks-user",
  socksPassword: "socks-secret",
  subscriptionToken: "profile-token",
  serverAddress: "gateway.example.test",
  port: 443,
  wsPath: "/vless",
  vmessWsPath: "/vmess",
  trojanWsPath: "/trojan",
  socksWsPath: "/socks",
  tlsEnabled: true,
  globalProfileEnabled: true,
  updatedAt: new Date(),
};

const storedClient = {
  id: 72,
  name: "Regression client",
  enabled: true,
  vlessUuid: "00000000-0000-4000-8000-000000000003",
  vmessUuid: "00000000-0000-4000-8000-000000000004",
  trojanPassword: "client-trojan-secret",
  socksUsername: "client-socks-user",
  socksPassword: "client-socks-secret",
  subscriptionToken: "client-token",
  trafficLimitBytes: -1,
  trafficUsedBytes: 0,
  trafficStatsSnapshotBytes: 0,
  dayLimit: -1,
  speedLimitMbps: -1,
  expiresAt: null,
  subscriptionDeliveryCount: 0,
  lastSubscriptionAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function adminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-owner",
      email: "owner@example.test",
      name: "Test Owner",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { headers: {}, protocol: "https" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("client lifecycle mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureVlessProfile.mockResolvedValue(profile);
    mocks.updateGatewayClientPolicy.mockResolvedValue({
      ...storedClient,
      trafficLimitBytes: 10 * 1024 * 1024 * 1024,
      dayLimit: 30,
      speedLimitMbps: 25,
      expiresAt: new Date("2026-09-16T00:00:00.000Z"),
    });
    mocks.deleteGatewayClient.mockResolvedValue(undefined);
    mocks.createGatewayClient.mockResolvedValue({ ...storedClient, enabled: false, activationDueAt: new Date(Date.now() + 12_000) });
    mocks.activateGatewayClientIfDue.mockResolvedValue({ client: storedClient, activated: true, activationPending: false });
    mocks.applyXrayProfile.mockResolvedValue(undefined);
    mocks.getGatewayClientById.mockResolvedValue(storedClient);
    mocks.resetGatewayClientTrafficUsage.mockResolvedValue({ ...storedClient, trafficUsedBytes: 0, trafficStatsSnapshotBytes: 0, quotaExhaustedAt: null });
  });

  it("persists a valid storage, day, and Mbps policy and returns the rendered state", async () => {
    const caller = vlessRouter.createCaller(adminContext());
    const result = await caller.updateClientPolicy({ id: storedClient.id, trafficLimitBytes: 10 * 1024 * 1024 * 1024, dayLimit: 30, speedLimitMbps: 25 });

    expect(mocks.updateGatewayClientPolicy).toHaveBeenCalledWith(storedClient.id, {
      id: storedClient.id,
      trafficLimitBytes: 10 * 1024 * 1024 * 1024,
      dayLimit: 30,
      speedLimitMbps: 25,
    });
    expect(result).toMatchObject({ trafficLimitBytes: 10 * 1024 * 1024 * 1024, dayLimit: 30, speedLimitMbps: 25 });
    expect(mocks.applyXrayProfile).toHaveBeenCalledWith(profile);
  });

  it("persists a new client once, returns it pending before an Xray reload, and retains retry-safe creation input", async () => {
    const caller = vlessRouter.createCaller(adminContext());
    const creationRequestId = "ce1b6a8a-0000-4000-8000-000000000001";
    const result = await caller.createClient({ name: "Unlimited default", creationRequestId });
    expect(mocks.createGatewayClient).toHaveBeenCalledWith({ name: "Unlimited default", trafficLimitBytes: -1, dayLimit: -1, speedLimitMbps: -1, creationRequestId });
    expect(mocks.applyXrayProfile).not.toHaveBeenCalled();
    expect(result).toMatchObject({ enabled: false, activationPending: true });

    await expect(caller.updateClientPolicy({ id: storedClient.id, trafficLimitBytes: -1, dayLimit: -1, speedLimitMbps: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("reloads Xray only when a due client activation succeeds", async () => {
    const caller = vlessRouter.createCaller(adminContext());

    await caller.activateClient({ id: storedClient.id });

    expect(mocks.activateGatewayClientIfDue).toHaveBeenCalledWith(storedClient.id);
    expect(mocks.applyXrayProfile).toHaveBeenCalledWith(profile);
  });

  it("does not reload Xray when a browser attempts activation before the due time", async () => {
    mocks.activateGatewayClientIfDue.mockResolvedValue({ client: { ...storedClient, enabled: false, activationDueAt: new Date(Date.now() + 2_000) }, activated: false, activationPending: true });
    const caller = vlessRouter.createCaller(adminContext());

    const result = await caller.activateClient({ id: storedClient.id });

    expect(result).toMatchObject({ enabled: false, activationPending: true, activated: false });
    expect(mocks.applyXrayProfile).not.toHaveBeenCalled();
  });

  it("rejects invalid quota and day-limit requests before persistence", async () => {
    const caller = vlessRouter.createCaller(adminContext());

    await expect(caller.updateClientPolicy({ id: storedClient.id, trafficLimitBytes: -2, dayLimit: 30, speedLimitMbps: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.updateClientPolicy({ id: storedClient.id, trafficLimitBytes: 0, dayLimit: 3651, speedLimitMbps: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.updateGatewayClientPolicy).not.toHaveBeenCalled();
  });

  it("delegates permanent client deletion before applying the refreshed gateway profile", async () => {
    const caller = vlessRouter.createCaller(adminContext());
    await expect(caller.deleteClient({ id: storedClient.id })).resolves.toEqual({ success: true });

    expect(mocks.deleteGatewayClient).toHaveBeenCalledWith(storedClient.id);
    expect(mocks.applyXrayProfile).toHaveBeenCalledWith(profile);
  });

  it("resets backend-recorded usage without changing client policy", async () => {
    const caller = vlessRouter.createCaller(adminContext());
    const result = await caller.resetClientUsage({ id: storedClient.id });

    expect(mocks.resetGatewayClientTrafficUsage).toHaveBeenCalledWith(storedClient.id);
    expect(result).toMatchObject({ id: storedClient.id, trafficUsedBytes: 0, trafficLimitBytes: -1, dayLimit: -1, speedLimitMbps: -1 });
  });
});
