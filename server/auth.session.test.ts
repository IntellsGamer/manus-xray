import { decodeJwt } from "jose";
import { describe, expect, it, vi } from "vitest";
import { COOKIE_NAME, THREE_DAYS_MS } from "../shared/const";

const database = vi.hoisted(() => ({
  getUserByOpenId: vi.fn(),
  upsertUser: vi.fn(),
}));

vi.mock("./db", () => database);

import { sdk } from "./_core/sdk";

const owner = {
  id: 1,
  openId: "owner-local-session",
  name: "Owner",
  email: null,
  loginMethod: "manus",
  role: "admin" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

describe("local owner session renewal", () => {
  it("issues a three-day local token and renews its secure cookie from a database-backed session without upstream identity lookup", async () => {
    database.getUserByOpenId.mockResolvedValue(owner);
    database.upsertUser.mockResolvedValue(undefined);
    const upstreamIdentity = vi.spyOn(sdk, "getUserInfoWithJwt");
    const token = await sdk.createSessionToken(owner.openId, { name: owner.name });
    const claims = decodeJwt(token);
    const cookie = vi.fn();

    const authenticated = await sdk.authenticateRequest({
      headers: { cookie: `${COOKIE_NAME}=${token}` },
      protocol: "https",
    } as never, { cookie } as never);

    expect(authenticated).toEqual(owner);
    expect(Number(claims.exp) - Number(claims.iat)).toBe(THREE_DAYS_MS / 1000);
    expect(upstreamIdentity).not.toHaveBeenCalled();
    expect(cookie).toHaveBeenCalledWith(COOKIE_NAME, expect.any(String), expect.objectContaining({
      maxAge: THREE_DAYS_MS,
      secure: true,
      httpOnly: true,
      sameSite: "none",
      path: "/",
    }));
  });
});
