export const adminRoutes = {
  overview: "/admin",
  clients: "/admin/clients",
  liveControl: "/admin/live",
  devices: "/admin/devices",
  templates: "/admin/templates",
  recovery: "/admin/recovery",
  terminal: "/admin/terminal",
} as const;

export type AdminRouteId = keyof typeof adminRoutes;

export function adminRouteFor(route: AdminRouteId) {
  return adminRoutes[route];
}
