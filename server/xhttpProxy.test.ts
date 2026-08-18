import { describe, expect, it } from "vitest";
import type { GatewayClient, VlessProfile } from "../drizzle/schema";
import { privateXhttpPath, resolvePublicXhttpRoute } from "./xhttpProxy";

const profile = { subscriptionToken: "opaque_global_token", globalProfileEnabled: true } as VlessProfile;
const namedClient = { id: 17, connectionToken: "opaque_client_token", enabled: true, expiresAt: null } as GatewayClient;

describe("global XHTTP proxy routing", () => {
  it("rewrites only the opaque public prefix to the private Xray XHTTP path", () => {
    expect(privateXhttpPath(profile, "/xhttp/opaque_global_token/session-123?seq=0")).toBe("/xhttp/session-123?seq=0");
    expect(privateXhttpPath(profile, "/xhttp/opaque_global_token")).toBe("/xhttp/");
  });

  it("rejects missing and mismatched opaque route tokens", () => {
    expect(privateXhttpPath(profile, "/xhttp/another-token/session-123")).toBeUndefined();
    expect(privateXhttpPath(undefined, "/xhttp/opaque_global_token/session-123")).toBeUndefined();
  });
});

describe("named XHTTP proxy routing", () => {
  it("resolves an active named client route to the shared private XHTTP path", () => {
    expect(resolvePublicXhttpRoute(profile, [namedClient], "/xhttp/opaque_client_token/session-123?seq=0")).toEqual({
      client: namedClient,
      internalPath: "/xhttp/session-123?seq=0",
    });
  });

  it("does not resolve disabled or expired named client routes", () => {
    expect(resolvePublicXhttpRoute(profile, [{ ...namedClient, enabled: false }], "/xhttp/opaque_client_token/session-123")).toBeUndefined();
    expect(resolvePublicXhttpRoute(profile, [{ ...namedClient, expiresAt: new Date(Date.now() - 1) }], "/xhttp/opaque_client_token/session-123")).toBeUndefined();
  });

  it("keeps the global route available only while the global profile is enabled", () => {
    expect(resolvePublicXhttpRoute(profile, [], "/xhttp/opaque_global_token/session-123")).toEqual({ internalPath: "/xhttp/session-123" });
    expect(resolvePublicXhttpRoute({ ...profile, globalProfileEnabled: false }, [], "/xhttp/opaque_global_token/session-123")).toBeUndefined();
  });

  it("rejects unknown opaque XHTTP tokens", () => {
    expect(resolvePublicXhttpRoute(profile, [namedClient], "/xhttp/not-a-client/session-123")).toBeUndefined();
  });
});
