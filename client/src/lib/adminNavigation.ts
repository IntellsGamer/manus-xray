export const adminRoutes = {
  overview: "/admin",
  clients: "/admin/clients",
} as const;

export type AdminRouteId = keyof typeof adminRoutes;

export function adminRouteFor(route: AdminRouteId) {
  return adminRoutes[route];
}
