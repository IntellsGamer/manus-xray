import { describe, expect, it } from "vitest";
import { adminRouteFor, adminRoutes } from "./adminNavigation";

describe("admin sidebar navigation", () => {
  it("maps overview and client management to distinct client-side routes", () => {
    expect(adminRoutes).toEqual({ overview: "/admin", clients: "/admin/clients" });
    expect(adminRouteFor("overview")).toBe("/admin");
    expect(adminRouteFor("clients")).toBe("/admin/clients");
  });
});
