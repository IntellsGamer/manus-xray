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

function meterClientTunnel(client: GatewayClient, profile: VlessProfile, publicSocket: Duplex, upstream: Socket, initialBytes = 0) {
  let pendingBytes = initialBytes;
  let flushed = false;
  let writeChain = Promise.resolve();
  const flush = (force = false) => {
    if (pendingBytes === 0 || (!force && pendingBytes < 16 * 1024)) return writeChain;
    const bytes = pendingBytes;
    pendingBytes = 0;
    writeChain = writeChain.then(async () => {
      const updated = await recordGatewayClientTunnelTraffic(client.id, bytes);
      if (updated.trafficLimitBytes >= 0 && updated.trafficUsedBytes >= updated.trafficLimitBytes) {
        await enforceGatewayTrafficQuotas(profile);
      }
    }).catch(() => undefined);
    return writeChain;
  };
  const observe = (chunk: Buffer) => {
    pendingBytes += chunk.length;
    void flush();
  };
  publicSocket.on("data", observe);
  upstream.on("data", observe);
  const finalize = () => {
    if (flushed) return;
    flushed = true;
    void flush(true);
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
  await enforceGatewayTrafficQuotas(profile);
  await dependencies.applyProfile(profile);
  const upstream = net.createConnection({ host: "127.0.0.1", port: route.port });
  const connectTimeout = setTimeout(() => closeSockets(socket, upstream), 5000);

  upstream.once("connect", () => {
    clearTimeout(connectTimeout);
    upstream.write(buildUpgradeRequest(req, route.port, route.internalPath));
    trackGatewayTunnel(socket, upstream);
    if (route.client) meterClientTunnel(route.client, profile, socket, upstream, head.length);
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
  };

  server.on("upgrade", (req, socket, head) => {
    bridgeUpgrade(req, socket, head, dependencies).catch(() => socket.destroy());
  });
}
