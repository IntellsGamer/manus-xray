import type { Socket } from "net";
import type { Duplex } from "stream";

type Tunnel = { client: Duplex; upstream: Socket; clientId?: number; sourceId?: string };
const activeTunnels = new Set<Tunnel>();
const tunnelsByClient = new Map<number, Set<Tunnel>>();
const tunnelsByClientSource = new Map<number, Map<string, Set<Tunnel>>>();
const pendingSourceAdmissions = new Map<number, Map<string, number>>();

function activeClientTunnelCount(clientId: number) {
  return tunnelsByClient.get(clientId)?.size ?? 0;
}

function activeSourceCount(clientId: number) {
  return tunnelsByClientSource.get(clientId)?.size ?? 0;
}

function pendingSourceCount(clientId: number) {
  return pendingSourceAdmissions.get(clientId)?.size ?? 0;
}

function hasPendingSource(clientId: number, sourceId: string) {
  return (pendingSourceAdmissions.get(clientId)?.get(sourceId) ?? 0) > 0;
}

/**
 * Reserve one source-IP slot before an asynchronous loopback connection opens.
 * Further tunnels from a known source do not consume another policy slot.
 */
export function reserveGatewayClientSource(clientId: number, sourceId: string, connectionLimit: number) {
  if (connectionLimit < 0) return () => undefined;
  const hasActiveSource = tunnelsByClientSource.get(clientId)?.has(sourceId) ?? false;
  if (!hasActiveSource && !hasPendingSource(clientId, sourceId) && activeSourceCount(clientId) + pendingSourceCount(clientId) >= connectionLimit) return undefined;
  const pending = pendingSourceAdmissions.get(clientId) ?? new Map<string, number>();
  pending.set(sourceId, (pending.get(sourceId) ?? 0) + 1);
  pendingSourceAdmissions.set(clientId, pending);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = pendingSourceAdmissions.get(clientId);
    if (!current) return;
    const next = (current.get(sourceId) ?? 1) - 1;
    if (next <= 0) current.delete(sourceId);
    else current.set(sourceId, next);
    if (!current.size) pendingSourceAdmissions.delete(clientId);
  };
}

/** Track an accepted public bridge tunnel until either side closes. */
export function trackGatewayTunnel(client: Duplex, upstream: Socket, clientId?: number, sourceId?: string, releaseReservation?: () => void) {
  releaseReservation?.();
  const tunnel = { client, upstream, clientId, sourceId };
  activeTunnels.add(tunnel);
  if (clientId !== undefined) {
    const clientTunnels = tunnelsByClient.get(clientId) ?? new Set<Tunnel>();
    clientTunnels.add(tunnel);
    tunnelsByClient.set(clientId, clientTunnels);
    if (sourceId) {
      const sources = tunnelsByClientSource.get(clientId) ?? new Map<string, Set<Tunnel>>();
      const sourceTunnels = sources.get(sourceId) ?? new Set<Tunnel>();
      sourceTunnels.add(tunnel);
      sources.set(sourceId, sourceTunnels);
      tunnelsByClientSource.set(clientId, sources);
    }
  }
  const cleanup = () => {
    activeTunnels.delete(tunnel);
    if (clientId !== undefined) {
      const clientTunnels = tunnelsByClient.get(clientId);
      clientTunnels?.delete(tunnel);
      if (!clientTunnels?.size) tunnelsByClient.delete(clientId);
      if (sourceId) {
        const sources = tunnelsByClientSource.get(clientId);
        const sourceTunnels = sources?.get(sourceId);
        sourceTunnels?.delete(tunnel);
        if (!sourceTunnels?.size) sources?.delete(sourceId);
        if (!sources?.size) tunnelsByClientSource.delete(clientId);
      }
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
  tunnelsByClientSource.clear();
  pendingSourceAdmissions.clear();
  return tunnels.length;
}

export function activeGatewayTunnelCount() {
  return activeTunnels.size;
}

export function activeGatewayTunnelCountForClient(clientId: number) {
  return activeClientTunnelCount(clientId);
}

export function activeGatewaySourceCountForClient(clientId: number) {
  return activeSourceCount(clientId);
}
