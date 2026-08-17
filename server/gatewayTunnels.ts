import type { Socket } from "net";
import type { Duplex } from "stream";

type Tunnel = { client: Duplex; upstream: Socket };
const activeTunnels = new Set<Tunnel>();

/** Track an accepted public bridge tunnel until either side closes. */
export function trackGatewayTunnel(client: Duplex, upstream: Socket) {
  const tunnel = { client, upstream };
  activeTunnels.add(tunnel);
  const cleanup = () => activeTunnels.delete(tunnel);
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
  return tunnels.length;
}

export function activeGatewayTunnelCount() {
  return activeTunnels.size;
}
