import { describe, expect, it } from "vitest";
import type { VlessProfile } from "../drizzle/schema";
import { privateXhttpPath } from "./xhttpProxy";

const profile = { subscriptionToken: "opaque_global_token" } as VlessProfile;

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
