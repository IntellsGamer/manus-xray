import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function contextWithRole(role: "admin" | "user" | null): TrpcContext {
  return {
    user: role ? {
      id: 1,
      openId: "test-user",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "manus",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } : null,
    req: { headers: {}, protocol: "https" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("vless administration router", () => {
  it("rejects unauthenticated callers before database access", async () => {
    const caller = appRouter.createCaller(contextWithRole(null));
    await expect(caller.vless.get()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects non-owner callers before database access", async () => {
    const caller = appRouter.createCaller(contextWithRole("user"));
    await expect(caller.vless.get()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("protects client deletion and quota policy mutations from non-owner callers", async () => {
    const caller = appRouter.createCaller(contextWithRole("user"));
    await expect(caller.vless.deleteClient({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.vless.updateClientPolicy({ id: 1, trafficLimitBytes: 10 * 1024 * 1024, dayLimit: 30 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
