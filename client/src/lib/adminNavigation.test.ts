import { describe, expect, it } from "vitest";
import { adminRouteFor, adminRoutes } from "./adminNavigation";

describe("admin sidebar navigation", () => {
  it("maps overview, client management, and devices to distinct client-side routes", () => {
    expect(adminRoutes).toEqual({ overview: "/admin", clients: "/admin/clients", devices: "/admin/devices" });
    expect(adminRouteFor("overview")).toBe("/admin");
    expect(adminRouteFor("clients")).toBe("/admin/clients");
    expect(adminRouteFor("devices")).toBe("/admin/devices");
  });
});
