import type { Socket } from "net";
import type { Duplex } from "stream";

type Tunnel = { client: Duplex; upstream: Socket; clientId?: number };
const activeTunnels = new Set<Tunnel>();
const tunnelsByClient = new Map<number, Set<Tunnel>>();
const pendingClientAdmissions = new Map<number, number>();

function pendingAdmissionCount(clientId: number) {
  return pendingClientAdmissions.get(clientId) ?? 0;
}

function activeClientTunnelCount(clientId: number) {
  return tunnelsByClient.get(clientId)?.size ?? 0;
}

/** Reserve one finite-cap client tunnel before an asynchronous loopback connection opens. */
export function reserveGatewayClientTunnel(clientId: number, connectionLimit: number) {
  if (connectionLimit < 0) return () => undefined;
  if (activeClientTunnelCount(clientId) + pendingAdmissionCount(clientId) >= connectionLimit) return undefined;
  pendingClientAdmissions.set(clientId, pendingAdmissionCount(clientId) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = pendingAdmissionCount(clientId) - 1;
    if (next <= 0) pendingClientAdmissions.delete(clientId);
    else pendingClientAdmissions.set(clientId, next);
  };
}

/** Track an accepted public bridge tunnel until either side closes. */
export function trackGatewayTunnel(client: Duplex, upstream: Socket, clientId?: number, releaseReservation?: () => void) {
  releaseReservation?.();
  const tunnel = { client, upstream, clientId };
  activeTunnels.add(tunnel);
  if (clientId !== undefined) {
    const clientTunnels = tunnelsByClient.get(clientId) ?? new Set<Tunnel>();
    clientTunnels.add(tunnel);
    tunnelsByClient.set(clientId, clientTunnels);
  }
  const cleanup = () => {
    activeTunnels.delete(tunnel);
    if (clientId !== undefined) {
      const clientTunnels = tunnelsByClient.get(clientId);
      clientTunnels?.delete(tunnel);
      if (!clientTunnels?.size) tunnelsByClient.delete(clientId);
    }
  };
  client.once("close", cleanup);
  upstream.once("close", cleanup);
  return cleanup;
}

/** Explicitly tears down public and private sides of all active bridge tunnels. */
export function closeActiveGatewayTunnels() {
  const tunnels = Array.from(activeTunnels);
  for (const tunnel of tunnels) {
    tunnel.client.destroy();
    tunnel.upstream.destroy();
  }
  activeTunnels.clear();
  tunnelsByClient.clear();
  pendingClientAdmissions.clear();
  return tunnels.length;
}

export function activeGatewayTunnelCount() {
  return activeTunnels.size;
}

export function activeGatewayTunnelCountForClient(clientId: number) {
  return activeClientTunnelCount(clientId);
}
