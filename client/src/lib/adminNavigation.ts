export const adminRoutes = {
  overview: "/admin",
  clients: "/admin/clients",
  devices: "/admin/devices",
  templates: "/admin/templates",
  recovery: "/admin/recovery",
} as const;

export type AdminRouteId = keyof typeof adminRoutes;

export function adminRouteFor(route: AdminRouteId) {
  return adminRoutes[route];
}
