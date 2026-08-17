import type { IncomingMessage, Server } from "http";
import net, { type Socket } from "net";
import type { Duplex } from "stream";
import type { GatewayClient, VlessProfile } from "../drizzle/schema";
import { getVlessProfile, listGatewayClients, recordGatewayClientTunnelTraffic } from "./db";
import { resolvePublicGatewayRoute } from "./vless";
import { applyXrayProfile, enforceGatewayTrafficQuotas, xrayInternalPort } from "./xrayRuntime";
import { trackGatewayTunnel } from "./gatewayTunnels";

type UpgradeDependencies = {
  getProfile?: () => Promise<VlessProfile | undefined>;
  getClients?: () => Promise<GatewayClient[]>;
  applyProfile?: (profile: VlessProfile) => Promise<unknown>;
  internalPort?: () => number;
  recordTraffic?: (clientId: number, bytes: number) => Promise<Pick<GatewayClient, "trafficLimitBytes" | "trafficUsedBytes">>;
  enforceQuota?: (profile: VlessProfile) => Promise<unknown>;
};

function closeSockets(first: Duplex, second: Socket) {
  first.destroy();
  second.destroy();
}

function buildUpgradeRequest(req: IncomingMessage, internalPort: number, internalPath: string) {
  const headers = Object.entries(req.headers)
    .filter(([name, value]) => name.toLowerCase() !== "host" && value !== undefined)
    .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`);
  headers.push(`host: 127.0.0.1:${internalPort}`);
  const requestUrl = new URL(req.url || "/", "http://local-gateway");
  return `GET ${internalPath}${requestUrl.search} HTTP/${req.httpVersion}\r\n${headers.join("\r\n")}\r\n\r\n`;
}

export function createTunnelUsageFlusher(input: {
  clientId: number;
  profile: VlessProfile;
  recordTraffic: (clientId: number, bytes: number) => Promise<Pick<GatewayClient, "trafficLimitBytes" | "trafficUsedBytes">>;
  enforceQuota: (profile: VlessProfile) => Promise<unknown>;
  flushThresholdBytes?: number;
  initialBytes?: number;
}) {
  let pendingBytes = input.initialBytes ?? 0;
  let writeChain = Promise.resolve();
  const flush = (force = false): Promise<void> => {
    if (pendingBytes === 0 || (!force && pendingBytes < (input.flushThresholdBytes ?? 16 * 1024))) return writeChain;
    const bytes = pendingBytes;
    pendingBytes = 0;
    writeChain = writeChain.then(async () => {
      const updated = await input.recordTraffic(input.clientId, bytes);
      if (updated.trafficLimitBytes >= 0 && updated.trafficUsedBytes >= updated.trafficLimitBytes) {
        await input.enforceQuota(input.profile);
      }
    }).catch(() => undefined);
    return writeChain;
  };
  const observe = (bytes: number) => {
    pendingBytes += Math.max(0, bytes);
    return flush();
  };
  return { observe, flush };
}

function meterClientTunnel(
  client: GatewayClient,
  profile: VlessProfile,
  publicSocket: Duplex,
  upstream: Socket,
  initialBytes = 0,
  recordTraffic: (clientId: number, bytes: number) => Promise<Pick<GatewayClient, "trafficLimitBytes" | "trafficUsedBytes">> = recordGatewayClientTunnelTraffic,
  enforceQuota: (profile: VlessProfile) => Promise<unknown> = enforceGatewayTrafficQuotas,
  protocol: "vless" | "vmess" | "trojan" | "socks" = "vless",
) {
  const meter = createTunnelUsageFlusher({
    clientId: client.id,
    profile,
    initialBytes,
    recordTraffic,
    enforceQuota,
  });
  let flushed = false;
  let clientToGatewayBytes = initialBytes;
  let gatewayToClientBytes = 0;
  const observeClient = (chunk: Buffer) => {
    clientToGatewayBytes += chunk.length;
    void meter.observe(chunk.length);
  };
  let upstreamHandshakeComplete = false;
  let upstreamHandshakeBuffer = Buffer.alloc(0);
  const observeUpstream = (chunk: Buffer) => {
    if (upstreamHandshakeComplete) return observeUpstreamPayload(chunk);
    upstreamHandshakeBuffer = Buffer.concat([upstreamHandshakeBuffer, chunk]);
    const headerBoundary = upstreamHandshakeBuffer.indexOf("\r\n\r\n");
    if (headerBoundary === -1) return;
    upstreamHandshakeComplete = true;
    const payloadBytes = upstreamHandshakeBuffer.length - headerBoundary - 4;
    upstreamHandshakeBuffer = Buffer.alloc(0);
    if (payloadBytes > 0) {
      gatewayToClientBytes += payloadBytes;
      void meter.observe(payloadBytes);
    }
  };
  const observeUpstreamPayload = (chunk: Buffer) => {
    gatewayToClientBytes += chunk.length;
    void meter.observe(chunk.length);
  };
  publicSocket.on("data", observeClient);
  upstream.on("data", chunk => {
    if (upstreamHandshakeComplete) observeUpstreamPayload(chunk);
    else observeUpstream(chunk);
  });
  void meter.flush();
  const finalize = () => {
    if (flushed) return;
    flushed = true;
    void meter.flush(true);
    if (clientToGatewayBytes + gatewayToClientBytes > 0) {
      console.info(`[Gateway traffic] client=${client.id} protocol=${protocol} uplink=${clientToGatewayBytes} downlink=${gatewayToClientBytes} total=${clientToGatewayBytes + gatewayToClientBytes}`);
    }
  };
  publicSocket.once("close", finalize);
  upstream.once("close", finalize);
}

async function bridgeUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  dependencies: Required<UpgradeDependencies>,
) {
  const requestUrl = new URL(req.url || "/", "http://local-gateway");
  const profile = await dependencies.getProfile();
  if (!profile) {
    socket.destroy();
    return;
  }

  const route = resolvePublicGatewayRoute(profile, dependencies.internalPort(), await dependencies.getClients(), requestUrl.pathname);
  if (!route) {
    socket.destroy();
    return;
  }
  await dependencies.enforceQuota(profile);
  await dependencies.applyProfile(profile);
  const upstream = net.createConnection({ host: "127.0.0.1", port: route.port });
  const connectTimeout = setTimeout(() => closeSockets(socket, upstream), 5000);

  upstream.once("connect", () => {
    clearTimeout(connectTimeout);
    upstream.write(buildUpgradeRequest(req, route.port, route.internalPath));
    trackGatewayTunnel(socket, upstream);
    if (route.client) meterClientTunnel(route.client, profile, socket, upstream, head.length, dependencies.recordTraffic, dependencies.enforceQuota, route.protocol);
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.once("error", () => {
    clearTimeout(connectTimeout);
    socket.destroy();
  });
  socket.once("error", () => upstream.destroy());
  socket.once("close", () => upstream.destroy());
  upstream.once("close", () => socket.destroy());
}

/**
 * Registers the public upgrade gate. No regular HTTP route is exposed for the
 * VLESS path; only a valid WebSocket upgrade reaches Xray over loopback.
 */
export function registerVlessUpgradeProxy(server: Server, overrides: UpgradeDependencies = {}) {
  const dependencies: Required<UpgradeDependencies> = {
    getProfile: overrides.getProfile ?? getVlessProfile,
    getClients: overrides.getClients ?? listGatewayClients,
    applyProfile: overrides.applyProfile ?? applyXrayProfile,
    internalPort: overrides.internalPort ?? xrayInternalPort,
    recordTraffic: overrides.recordTraffic ?? recordGatewayClientTunnelTraffic,
    enforceQuota: overrides.enforceQuota ?? enforceGatewayTrafficQuotas,
  };

  server.on("upgrade", (req, socket, head) => {
    bridgeUpgrade(req, socket, head, dependencies).catch(() => socket.destroy());
  });
}
