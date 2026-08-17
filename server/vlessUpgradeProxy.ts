import type { IncomingMessage, Server } from "http";
import net, { type Socket } from "net";
import type { Duplex } from "stream";
import type { VlessProfile } from "../drizzle/schema";
import { getVlessProfile } from "./db";
import { internalInboundForPath, normaliseWsPath } from "./vless";
import { applyXrayProfile, enforceGatewayTrafficQuotas, xrayInternalPort } from "./xrayRuntime";

type UpgradeDependencies = {
  getProfile?: () => Promise<VlessProfile | undefined>;
  applyProfile?: (profile: VlessProfile) => Promise<unknown>;
  internalPort?: () => number;
};

function closeSockets(first: Duplex, second: Socket) {
  first.destroy();
  second.destroy();
}

function buildUpgradeRequest(req: IncomingMessage, internalPort: number) {
  const headers = Object.entries(req.headers)
    .filter(([name, value]) => name.toLowerCase() !== "host" && value !== undefined)
    .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`);
  headers.push(`host: 127.0.0.1:${internalPort}`);
  return `GET ${req.url || "/"} HTTP/${req.httpVersion}\r\n${headers.join("\r\n")}\r\n\r\n`;
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

  const internalPort = internalInboundForPath(profile, dependencies.internalPort(), requestUrl.pathname);
  if (!internalPort) {
    socket.destroy();
    return;
  }
  await enforceGatewayTrafficQuotas(profile);
  await dependencies.applyProfile(profile);
  const upstream = net.createConnection({ host: "127.0.0.1", port: internalPort });
  const connectTimeout = setTimeout(() => closeSockets(socket, upstream), 5000);

  upstream.once("connect", () => {
    clearTimeout(connectTimeout);
    upstream.write(buildUpgradeRequest(req, internalPort));
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.once("error", () => {
    clearTimeout(connectTimeout);
    socket.destroy();
  });
  socket.once("error", () => upstream.destroy());
  socket.once("close", () => upstream.destroy());
}

/**
 * Registers the public upgrade gate. No regular HTTP route is exposed for the
 * VLESS path; only a valid WebSocket upgrade reaches Xray over loopback.
 */
export function registerVlessUpgradeProxy(server: Server, overrides: UpgradeDependencies = {}) {
  const dependencies: Required<UpgradeDependencies> = {
    getProfile: overrides.getProfile ?? getVlessProfile,
    applyProfile: overrides.applyProfile ?? applyXrayProfile,
    internalPort: overrides.internalPort ?? xrayInternalPort,
  };

  server.on("upgrade", (req, socket, head) => {
    bridgeUpgrade(req, socket, head, dependencies).catch(() => socket.destroy());
  });
}
