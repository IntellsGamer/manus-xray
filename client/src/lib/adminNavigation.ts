export const adminSectionIds = ["gateway-overview", "client-management"] as const;
export type AdminSectionId = (typeof adminSectionIds)[number];

export function navigateToAdminSection(sectionId: AdminSectionId, navigate: (path: string) => void, scroll: (id: AdminSectionId) => void) {
  if (!adminSectionIds.includes(sectionId)) throw new Error("Unknown admin section");
  navigate("/admin");
  scroll(sectionId);
}
