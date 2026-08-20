import { randomUUID } from "crypto";
import { closeGatewayLiveSession, createGatewayLiveSession, getGatewayLiveSessionById, heartbeatGatewayLiveSession } from "./db";

type TunnelSide = {
  destroy: () => unknown;
  once(event: "close", listener: () => void): unknown;
};
type Tunnel = {
  client: TunnelSide;
  upstream: TunnelSide;
  clientId?: number;
  sourceId?: string;
  protocol?: string;
  sessionId?: string;
  uplinkBytes: number;
  downlinkBytes: number;
  disconnectRequested: boolean;
  closed: boolean;
  sessionCreated: boolean;
  heartbeatTimer?: ReturnType<typeof setInterval>;
};
const activeTunnels = new Set<Tunnel>();
const tunnelsByClient = new Map<number, Set<Tunnel>>();
const tunnelsByClientSource = new Map<number, Map<string, Set<Tunnel>>>();
const pendingSourceAdmissions = new Map<number, Map<string, number>>();
const tunnelsBySide = new Map<TunnelSide, Tunnel>();

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
export function trackGatewayTunnel(client: TunnelSide, upstream: TunnelSide, clientId?: number, sourceId?: string, releaseReservation?: () => void, protocol?: string) {
  releaseReservation?.();
  const tunnel: Tunnel = { client, upstream, clientId, sourceId, protocol, sessionId: clientId === undefined ? undefined : randomUUID(), uplinkBytes: 0, downlinkBytes: 0, disconnectRequested: false, closed: false, sessionCreated: false };
  activeTunnels.add(tunnel);
  tunnelsBySide.set(client, tunnel);
  tunnelsBySide.set(upstream, tunnel);
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
  if (tunnel.sessionId && clientId !== undefined && sourceId && protocol) {
    void createGatewayLiveSession({ id: tunnel.sessionId, clientId, protocol, sourceGroup: sourceId }).then(() => {
      tunnel.sessionCreated = true;
      if (!tunnel.closed || !tunnel.sessionId) return;
      return closeGatewayLiveSession({ id: tunnel.sessionId, uplinkBytes: tunnel.uplinkBytes, downlinkBytes: tunnel.downlinkBytes, reason: tunnel.disconnectRequested ? "disconnected" : "closed" });
    }).catch(() => undefined);
    tunnel.heartbeatTimer = setInterval(() => {
      if (!tunnel.sessionId) return;
      void heartbeatGatewayLiveSession({ id: tunnel.sessionId, uplinkBytes: tunnel.uplinkBytes, downlinkBytes: tunnel.downlinkBytes }).catch(() => undefined);
      void getGatewayLiveSessionById(tunnel.sessionId).then(session => {
        if (!session?.disconnectRequestedAt || tunnel.disconnectRequested) return;
        tunnel.disconnectRequested = true;
        tunnel.client.destroy();
        tunnel.upstream.destroy();
      }).catch(() => undefined);
    }, 3_000);
    tunnel.heartbeatTimer.unref?.();
  }
  const cleanup = () => {
    if (tunnel.closed) return;
    tunnel.closed = true;
    if (tunnel.heartbeatTimer) clearInterval(tunnel.heartbeatTimer);
    activeTunnels.delete(tunnel);
    tunnelsBySide.delete(client);
    tunnelsBySide.delete(upstream);
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
    if (tunnel.sessionId && tunnel.sessionCreated) {
      void closeGatewayLiveSession({ id: tunnel.sessionId, uplinkBytes: tunnel.uplinkBytes, downlinkBytes: tunnel.downlinkBytes, reason: tunnel.disconnectRequested ? "disconnected" : "closed" }).catch(() => undefined);
    }
  };
  client.once("close", cleanup);
  upstream.once("close", cleanup);
  return cleanup;
}

/** Updates durable-session byte counters without adding per-chunk database traffic. */
export function observeGatewayTunnelTraffic(side: TunnelSide, direction: "uplink" | "downlink", bytes: number) {
  const tunnel = tunnelsBySide.get(side);
  if (!tunnel || !tunnel.sessionId || bytes <= 0) return;
  if (direction === "uplink") tunnel.uplinkBytes += bytes;
  else tunnel.downlinkBytes += bytes;
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
  tunnelsBySide.clear();
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
