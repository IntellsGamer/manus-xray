import { describe, expect, it, vi } from "vitest";
import { adminSectionIds, navigateToAdminSection } from "./adminNavigation";

describe("unified admin sidebar navigation", () => {
  it("maps both sidebar sections into the single /admin workspace", () => {
    const navigate = vi.fn();
    const scroll = vi.fn();
    adminSectionIds.forEach(sectionId => navigateToAdminSection(sectionId, navigate, scroll));
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenNthCalledWith(1, "/admin");
    expect(scroll).toHaveBeenNthCalledWith(1, "gateway-overview");
    expect(scroll).toHaveBeenNthCalledWith(2, "client-management");
  });
});
