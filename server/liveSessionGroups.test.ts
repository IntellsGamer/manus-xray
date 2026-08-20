import { describe, expect, it } from "vitest";
import type { GatewayLiveSession } from "../drizzle/schema";
import { groupGatewayLiveSessions } from "./db";

function session(overrides: Partial<GatewayLiveSession>): GatewayLiveSession {
  return {
    id: "ce1b6a8a-0000-4000-8000-000000000001",
    clientId: 7,
    protocol: "vless",
    sourceGroup: "198.51.100.0/24",
    uplinkBytes: 10,
    downlinkBytes: 20,
    startedAt: new Date("2026-08-20T08:00:00.000Z"),
    lastSeenAt: new Date("2026-08-20T08:01:00.000Z"),
    disconnectRequestedAt: null,
    closedAt: null,
    closeReason: null,
    ...overrides,
  };
}

describe("live VPN session grouping", () => {
  it("combines parallel Cloudflare tunnels with the same client and source network across every protocol", () => {
    const groups = groupGatewayLiveSessions([
      session({ id: "ce1b6a8a-0000-4000-8000-000000000001", uplinkBytes: 100, downlinkBytes: 200 }),
      session({ id: "ce1b6a8a-0000-4000-8000-000000000002", uplinkBytes: 300, downlinkBytes: 400, startedAt: new Date("2026-08-20T07:59:00.000Z"), lastSeenAt: new Date("2026-08-20T08:02:00.000Z") }),
      session({ id: "ce1b6a8a-0000-4000-8000-000000000003", protocol: "xhttp", uplinkBytes: 5, downlinkBytes: 6 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ protocols: ["vless", "xhttp"], tunnelCount: 3, uplinkBytes: 405, downlinkBytes: 606, startedAt: new Date("2026-08-20T07:59:00.000Z"), lastSeenAt: new Date("2026-08-20T08:02:00.000Z") });
  });
});
