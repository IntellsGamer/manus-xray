import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "http";
import { createTerminalLeaseCoordinator, createTerminalSessionFinalizer, isTerminalOriginAllowed, isTerminalOwner, parseTerminalFrame, TerminalInputLimiter, TerminalOutputLimiter } from "./terminal";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const verifiedDeviceToken = "verified_owner_device_token_123456";

function upgradeRequest(headers: Record<string, string>): IncomingMessage {
  return {
    headers,
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;
}

function adminContext(openId: string): TrpcContext {
  return {
    user: {
      id: 1,
      openId,
      email: "owner@example.test",
      name: "Owner",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      deviceToken: verifiedDeviceToken,
    },
    req: { headers: {}, protocol: "https" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("terminal authorization boundary", () => {
  it("requires the exact owner, the admin role, and a verified owner-device token", () => {
    expect(isTerminalOwner({ openId: "owner-1", role: "admin", deviceToken: verifiedDeviceToken }, "owner-1")).toBe(true);
    expect(isTerminalOwner({ openId: "other-admin", role: "admin", deviceToken: verifiedDeviceToken }, "owner-1")).toBe(false);
    expect(isTerminalOwner({ openId: "owner-1", role: "user", deviceToken: verifiedDeviceToken }, "owner-1")).toBe(false);
    expect(isTerminalOwner({ openId: "owner-1", role: "admin" }, "owner-1")).toBe(false);
  });

  it("accepts a same-origin HTTPS upgrade and rejects a mismatched origin", () => {
    expect(isTerminalOriginAllowed(upgradeRequest({
      host: "gateway.example.test",
      origin: "https://gateway.example.test",
      "x-forwarded-proto": "https",
    }))).toBe(true);
    expect(isTerminalOriginAllowed(upgradeRequest({
      host: "gateway.example.test",
      origin: "https://attacker.example.test",
      "x-forwarded-proto": "https",
    }))).toBe(false);
  });

  it("keeps the terminal router unavailable to a non-owner admin", async () => {
    const caller = appRouter.createCaller(adminContext("not-the-configured-owner"));
    await expect(caller.terminal.authorize()).resolves.toEqual({
      permitted: false,
      socketPath: "/api/terminal/socket",
    });
  });
});

describe("shared terminal lease coordination", () => {
  it("propagates a conflicting lease refusal and releases a successful lease only once", async () => {
    const acquire = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const release = vi.fn().mockResolvedValue(undefined);
    const input = {
      leaseId: "terminal-lease-1",
      ownerOpenId: "owner-1",
      instanceId: "instance-1",
      expiresAt: new Date(Date.now() + 60_000),
    };
    const refused = createTerminalLeaseCoordinator({ acquire, release }, input);
    expect(await refused.acquire()).toBe(false);

    const accepted = createTerminalLeaseCoordinator({ acquire, release }, input);
    expect(await accepted.acquire()).toBe(true);
    await accepted.release();
    await accepted.release();
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith("terminal-lease-1", "instance-1");
  });
});

describe("terminal session cleanup guards", () => {
  it("finalizes the terminal process and its lease only once across repeated shutdown paths", async () => {
    const endProcess = vi.fn();
    const releaseLease = vi.fn().mockResolvedValue(undefined);
    const finalize = createTerminalSessionFinalizer({ endProcess, releaseLease });

    await finalize();
    await finalize();

    expect(endProcess).toHaveBeenCalledTimes(1);
    expect(releaseLease).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed terminal input frames before they can reach a PTY", () => {
    expect(parseTerminalFrame("not-json")).toBeNull();
    expect(parseTerminalFrame(JSON.stringify({ type: "input", data: 7 }))).toBeNull();
    expect(parseTerminalFrame(JSON.stringify({ type: "resize", cols: 80, rows: 24 }))).toEqual({ type: "resize", cols: 80, rows: 24 });
  });
});

describe("terminal I/O limits", () => {
  it("rejects input that exceeds the one-second input ceiling", () => {
    const limiter = new TerminalInputLimiter();
    const startedAt = Date.now();
    expect(limiter.accept(64 * 1024, startedAt)).toBe(true);
    expect(limiter.accept(64 * 1024 + 1, startedAt + 1)).toBe(false);
    expect(limiter.accept(64 * 1024, startedAt + 1_001)).toBe(true);
  });

  it("rejects terminal output that exceeds the one-second output ceiling", () => {
    const limiter = new TerminalOutputLimiter();
    const startedAt = Date.now();
    expect(limiter.accept(1024 * 1024, startedAt)).toBe(true);
    expect(limiter.accept(1024 * 1024 + 1, startedAt + 2)).toBe(false);
    expect(limiter.accept(1024 * 1024, startedAt + 1_002)).toBe(true);
  });
});
