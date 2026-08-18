export const adminRoutes = {
  overview: "/admin",
  clients: "/admin/clients",
  devices: "/admin/devices",
} as const;

export type AdminRouteId = keyof typeof adminRoutes;

export function adminRouteFor(route: AdminRouteId) {
  return adminRoutes[route];
}
