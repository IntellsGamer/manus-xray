import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const database = vi.hoisted(() => ({
  listOwnerDevices: vi.fn(),
  revokeOwnerDevice: vi.fn(),
  revokeAllOwnerDevices: vi.fn(),
  updateOwnerDeviceCountry: vi.fn(),
}));

vi.mock("./db", () => database);

import { devicesRouter } from "./routers/devices";

const token = "a".repeat(24);
const otherToken = "b".repeat(24);
const devices = [
  { id: 10, ownerOpenId: "owner", deviceToken: token, deviceName: "Chrome on Linux", deviceKind: "desktop", browser: "Chrome", operatingSystem: "Linux", userAgent: "test", ipAddress: "198.51.100.10", countryCode: "DE", city: "Berlin", region: "Berlin", firstSeenAt: new Date(), lastSeenAt: new Date(), revokedAt: null },
  { id: 11, ownerOpenId: "owner", deviceToken: otherToken, deviceName: "Safari on iPhone", deviceKind: "mobile", browser: "Safari", operatingSystem: "iPhone", userAgent: "test", ipAddress: "198.51.100.11", countryCode: "US", city: null, region: null, firstSeenAt: new Date(), lastSeenAt: new Date(), revokedAt: null },
];

function context() {
  const cleared: string[] = [];
  const ctx: TrpcContext = {
    user: { id: 1, openId: "owner", name: "Owner", email: null, loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(), deviceToken: token },
    req: { headers: { cookie: `gateway_device_id=${token}` }, protocol: "https" } as TrpcContext["req"],
    res: { clearCookie: (name: string) => cleared.push(name) } as TrpcContext["res"],
  };
  return { ctx, cleared };
}

describe("owner devices router", () => {
  it("identifies the current device by id without exposing its opaque token", async () => {
    database.listOwnerDevices.mockResolvedValue(devices);
    const caller = devicesRouter.createCaller(context().ctx);

    const result = await caller.list();

    expect(result.currentDeviceId).toBe(10);
    expect(result).not.toHaveProperty("currentDeviceToken");
    expect(result.devices[0]).not.toHaveProperty("deviceToken");
  });

  it("revokes the selected current device and clears both local session cookies", async () => {
    database.listOwnerDevices.mockResolvedValue(devices);
    database.revokeOwnerDevice.mockResolvedValue(undefined);
    const { ctx, cleared } = context();

    await expect(devicesRouter.createCaller(ctx).remove({ id: 10 })).resolves.toEqual({ success: true });

    expect(database.revokeOwnerDevice).toHaveBeenCalledWith("owner", 10);
    expect(cleared).toEqual(expect.arrayContaining(["app_session_id", "gateway_device_id"]));
  });

  it("revokes all devices and clears the current session", async () => {
    database.revokeAllOwnerDevices.mockResolvedValue(undefined);
    const { ctx, cleared } = context();

    await expect(devicesRouter.createCaller(ctx).removeAll()).resolves.toEqual({ success: true });

    expect(database.revokeAllOwnerDevices).toHaveBeenCalledWith("owner");
    expect(cleared).toEqual(expect.arrayContaining(["app_session_id", "gateway_device_id"]));
  });

  it("persists a same-origin Cloudflare trace country only for the authenticated device", async () => {
    database.updateOwnerDeviceCountry.mockResolvedValue(undefined);

    await expect(devicesRouter.createCaller(context().ctx).reportCountry({ countryCode: "DE" })).resolves.toEqual({ success: true });

    expect(database.updateOwnerDeviceCountry).toHaveBeenCalledWith("owner", token, "DE");
  });
});
