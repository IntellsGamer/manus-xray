import { describe, expect, it } from "vitest";
import { adminRouteFor, adminRoutes } from "./adminNavigation";

describe("admin sidebar navigation", () => {
  it("maps all owner workspaces to distinct client-side routes", () => {
    expect(adminRoutes).toEqual({ overview: "/admin", clients: "/admin/clients", devices: "/admin/devices", templates: "/admin/templates", recovery: "/admin/recovery", terminal: "/admin/terminal" });
    expect(adminRouteFor("overview")).toBe("/admin");
    expect(adminRouteFor("clients")).toBe("/admin/clients");
    expect(adminRouteFor("devices")).toBe("/admin/devices");
    expect(adminRouteFor("templates")).toBe("/admin/templates");
    expect(adminRouteFor("recovery")).toBe("/admin/recovery");
    expect(adminRouteFor("terminal")).toBe("/admin/terminal");
  });
});
