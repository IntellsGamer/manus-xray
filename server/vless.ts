import { randomBytes, randomUUID } from "crypto";
import type { GatewayClient, VlessProfile } from "../drizzle/schema";

export function createVlessUuid() {
  return randomUUID();
}

export function createSubscriptionToken() {
  return randomBytes(24).toString("base64url");
}

export function createGatewayCredential() {
  return randomBytes(24).toString("base64url");
}

export function normaliseWsPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "/vless";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function normaliseGatewayPaths(paths: { wsPath: string; vmessWsPath: string; trojanWsPath: string; socksWsPath: string }) {
  const normalized = {
    wsPath: normaliseWsPath(paths.wsPath),
    vmessWsPath: normaliseWsPath(paths.vmessWsPath),
    trojanWsPath: normaliseWsPath(paths.trojanWsPath),
    socksWsPath: normaliseWsPath(paths.socksWsPath),
  };
  if (new Set(Object.values(normalized)).size !== 4) throw new Error("Each protocol must use a different WebSocket path");
  return normalized;
}

export type GatewayProtocol = "vless" | "vmess" | "trojan" | "socks";

const xhttpExtraSettings = {
  headers: { "User-Agent": "firefox" },
  xPaddingBytes: "100-1000",
  scMaxBufferedPosts: 30,
  scStreamUpServerSecs: "20-80",
} as const;

function routeWithConnectionToken(basePath: string, connectionToken: string) {
  return `${normaliseWsPath(basePath).replace(/\/+$/, "")}/${connectionToken}`;
}

export function clientWebSocketPaths(profile: VlessProfile, client: Pick<GatewayClient, "connectionToken">) {
  return {
    vless: routeWithConnectionToken(profile.wsPath, client.connectionToken),
    vmess: routeWithConnectionToken(profile.vmessWsPath, client.connectionToken),
    trojan: routeWithConnectionToken(profile.trojanWsPath, client.connectionToken),
    socks: routeWithConnectionToken(profile.socksWsPath, client.connectionToken),
  };
}

export function gatewayWebSocketPaths(profile: VlessProfile) {
  return {
    vless: routeWithConnectionToken(profile.wsPath, profile.subscriptionToken),
    vmess: routeWithConnectionToken(profile.vmessWsPath, profile.subscriptionToken),
    trojan: routeWithConnectionToken(profile.trojanWsPath, profile.subscriptionToken),
    socks: routeWithConnectionToken(profile.socksWsPath, profile.subscriptionToken),
  };
}

export function gatewayXhttpPath(profile: VlessProfile) {
  return `/xhttp/${profile.subscriptionToken}`;
}

export function clientXhttpPath(client: Pick<GatewayClient, "connectionToken">) {
  return `/xhttp/${client.connectionToken}`;
}

function publicGatewayProfile(profile: VlessProfile): VlessProfile {
  const paths = gatewayWebSocketPaths(profile);
  return { ...profile, wsPath: paths.vless, vmessWsPath: paths.vmess, trojanWsPath: paths.trojan, socksWsPath: paths.socks };
}

export function buildVlessUri(profile: VlessProfile) {
  const endpoint = new URL(`vless://${profile.uuid}@${profile.serverAddress}:${profile.port}`);
  endpoint.searchParams.set("encryption", "none");
  endpoint.searchParams.set("security", profile.tlsEnabled ? "tls" : "none");
  endpoint.searchParams.set("type", "ws");
  endpoint.searchParams.set("host", profile.serverAddress);
  endpoint.searchParams.set("path", normaliseWsPath(profile.wsPath));
  return `${endpoint.toString()}#${encodeURIComponent("Nginx Gateway")}`;
}

function buildXhttpUriForPath(profile: VlessProfile, path: string, label: string) {
  const endpoint = new URL(`vless://${profile.uuid}@${profile.serverAddress}:${profile.port}`);
  endpoint.searchParams.set("encryption", "none");
  endpoint.searchParams.set("security", profile.tlsEnabled ? "tls" : "none");
  endpoint.searchParams.set("type", "xhttp");
  endpoint.searchParams.set("host", profile.serverAddress);
  endpoint.searchParams.set("path", path);
  endpoint.searchParams.set("mode", "packet-up");
  endpoint.searchParams.set("extra", JSON.stringify(xhttpExtraSettings));
  endpoint.searchParams.set("sni", profile.serverAddress);
  return `${endpoint.toString()}#${encodeURIComponent(label)}`;
}

export function buildXhttpUri(profile: VlessProfile) {
  return buildXhttpUriForPath(profile, gatewayXhttpPath(profile), "Nginx Gateway · VLESS XHTTP");
}

export function buildClientXhttpUri(profile: VlessProfile, client: GatewayClient) {
  const clientProfile = profileForClient(profile, client);
  return buildXhttpUriForPath(clientProfile, clientXhttpPath(client), "Nginx Gateway · VLESS XHTTP");
}

function publicWebSocketParams(profile: VlessProfile, path: string) {
  return {
    security: profile.tlsEnabled ? "tls" : "none",
    type: "ws",
    host: profile.serverAddress,
    path: normaliseWsPath(path),
  };
}

export function buildVmessUri(profile: VlessProfile) {
  const config = {
    v: "2",
    ps: "Nginx Gateway · VMess",
    add: profile.serverAddress,
    port: String(profile.port),
    id: profile.vmessUuid,
    aid: "0",
    scy: "none",
    security: "none",
    net: "ws",
    type: "none",
    host: profile.serverAddress,
    path: normaliseWsPath(profile.vmessWsPath),
    tls: profile.tlsEnabled ? "tls" : "",
    sni: profile.serverAddress,
    alpn: "",
    fp: "",
    insecure: "0",
  };
  return `vmess://${Buffer.from(JSON.stringify(config), "utf8").toString("base64")}`;
}

export function buildTrojanUri(profile: VlessProfile) {
  const endpoint = new URL(`trojan://${encodeURIComponent(profile.trojanPassword)}@${profile.serverAddress}:${profile.port}`);
  Object.entries(publicWebSocketParams(profile, profile.trojanWsPath)).forEach(([key, value]) => endpoint.searchParams.set(key, value));
  endpoint.searchParams.set("sni", profile.serverAddress);
  return `${endpoint.toString()}#${encodeURIComponent("Nginx Gateway · Trojan")}`;
}

export function buildSocksClientConfig(profile: VlessProfile) {
  return JSON.stringify({
    log: { loglevel: "warning" },
    inbounds: [{
      listen: "127.0.0.1",
      port: 10808,
      protocol: "socks",
      settings: { auth: "noauth", udp: true, ip: "127.0.0.1" },
      sniffing: { enabled: true, destOverride: ["http", "tls"] },
    }],
    outbounds: [{
      tag: "proxy",
      protocol: "socks",
      settings: {
        servers: [{
          address: profile.serverAddress,
          port: profile.port,
          users: [{ user: profile.socksUsername, pass: profile.socksPassword }],
        }],
      },
      streamSettings: {
        network: "ws",
        security: profile.tlsEnabled ? "tls" : "none",
        tlsSettings: profile.tlsEnabled ? { serverName: profile.serverAddress, allowInsecure: false } : undefined,
        wsSettings: { path: normaliseWsPath(profile.socksWsPath), headers: { Host: profile.serverAddress } },
      },
      mux: { enabled: false },
    }, { protocol: "freedom", tag: "direct" }],
    routing: { rules: [{ type: "field", ip: ["geoip:private"], outboundTag: "direct" }] },
  }, null, 2);
}

function profileForClient(profile: VlessProfile, client: GatewayClient): VlessProfile {
  const paths = clientWebSocketPaths(profile, client);
  return {
    ...profile,
    uuid: client.vlessUuid,
    vmessUuid: client.vmessUuid,
    trojanPassword: client.trojanPassword,
    socksUsername: client.socksUsername,
    socksPassword: client.socksPassword,
    subscriptionToken: client.subscriptionToken,
    wsPath: paths.vless,
    vmessWsPath: paths.vmess,
    trojanWsPath: paths.trojan,
    socksWsPath: paths.socks,
  };
}

export function buildClientConnectionDetails(profile: VlessProfile, client: GatewayClient) {
  const clientProfile = profileForClient(profile, client);
  return {
    vlessUri: buildVlessUri(clientProfile),
    xhttpUri: buildClientXhttpUri(profile, client),
    vmessUri: buildVmessUri(clientProfile),
    trojanUri: buildTrojanUri(clientProfile),
    socksClientConfig: buildSocksClientConfig(clientProfile),
  };
}

export function buildGatewayConnectionDetails(profile: VlessProfile) {
  const publicProfile = publicGatewayProfile(profile);
  return {
    vlessUri: buildVlessUri(publicProfile),
    xhttpUri: buildXhttpUri(profile),
    xhttpPath: gatewayXhttpPath(profile),
    vmessUri: buildVmessUri(publicProfile),
    trojanUri: buildTrojanUri(publicProfile),
    socksClientConfig: buildSocksClientConfig(publicProfile),
  };
}

export function buildClientSubscriptionPayload(profile: VlessProfile, client: GatewayClient) {
  const details = buildClientConnectionDetails(profile, client);
  return Buffer.from([details.vlessUri, details.xhttpUri, details.vmessUri, details.trojanUri].join("\n"), "utf8").toString("base64");
}

export type TrafficProtocol = "vless" | "vmess" | "trojan";

export function clientTrafficEmail(clientId: number, protocol: TrafficProtocol = "vless") {
  return `gateway-client-${clientId}-${protocol}@local.invalid`;
}

export function clientSocksInboundTag(clientId: number) {
  return `gateway-client-${clientId}-socks-in`;
}

export function clientSocksInboundPort(internalPort: number, clientId: number) {
  return internalPort + 100 + clientId;
}

export function buildSubscriptionPayload(profile: VlessProfile) {
  const details = buildGatewayConnectionDetails(profile);
  return Buffer.from([details.vlessUri, details.xhttpUri, details.vmessUri, details.trojanUri].join("\n"), "utf8").toString("base64");
}

export function internalInboundForPath(profile: VlessProfile, internalBasePort: number, path: string) {
  const normalizedPath = normaliseWsPath(path);
  const mapping = [
    { path: normaliseWsPath(profile.wsPath), port: internalBasePort },
    { path: normaliseWsPath(profile.vmessWsPath), port: internalBasePort + 1 },
    { path: normaliseWsPath(profile.trojanWsPath), port: internalBasePort + 2 },
    { path: normaliseWsPath(profile.socksWsPath), port: internalBasePort + 3 },
  ];
  return mapping.find(candidate => candidate.path === normalizedPath)?.port;
}

export function resolvePublicGatewayRoute(profile: VlessProfile, internalBasePort: number, clients: GatewayClient[], path: string) {
  const normalizedPath = normaliseWsPath(path);
  const mappings: Array<{ protocol: GatewayProtocol; internalPath: string; port: number }> = [
    { protocol: "vless", internalPath: normaliseWsPath(profile.wsPath), port: internalBasePort },
    { protocol: "vmess", internalPath: normaliseWsPath(profile.vmessWsPath), port: internalBasePort + 1 },
    { protocol: "trojan", internalPath: normaliseWsPath(profile.trojanWsPath), port: internalBasePort + 2 },
    { protocol: "socks", internalPath: normaliseWsPath(profile.socksWsPath), port: internalBasePort + 3 },
  ];
  const gatewayPaths = gatewayWebSocketPaths(profile);
  for (const mapping of mappings) {
    if (normalizedPath === gatewayPaths[mapping.protocol]) return { ...mapping, client: undefined };
  }
  const activeClients = clients.filter(client => client.enabled && (!client.expiresAt || client.expiresAt.getTime() > Date.now()));
  for (const client of activeClients) {
    const paths = clientWebSocketPaths(profile, client);
    for (const mapping of mappings) {
      if (normalizedPath === paths[mapping.protocol]) {
        if (mapping.protocol === "socks") {
          return { ...mapping, internalPath: paths.socks, port: clientSocksInboundPort(internalBasePort, client.id), client };
        }
        return { ...mapping, client };
      }
    }
  }
  return undefined;
}

/**
 * Builds the private Xray side of the public HTTPS/WebSocket bridge. TLS is
 * terminated at the platform edge, therefore this local listener is loopback
 * only and carries the already-upgraded WebSocket stream without TLS.
 */
export function buildXrayConfig(profile: VlessProfile, internalPort: number, clients: GatewayClient[] = []) {
  const streamSettings = (path: string): Record<string, unknown> => ({
    network: "ws",
    security: "none",
    wsSettings: { path: normaliseWsPath(path) },
  });
  const xhttpStreamSettings: Record<string, unknown> = {
    network: "xhttp",
    security: "none",
    xhttpSettings: { path: "/xhttp", mode: "auto", ...xhttpExtraSettings },
  };

  const activeClients = clients.filter(client => client.enabled && (!client.expiresAt || client.expiresAt.getTime() > Date.now()));
  const globalClientEnabled = profile.globalProfileEnabled;
  return {
    log: { loglevel: "warning" },
    stats: {},
    policy: {
      levels: { "0": { statsUserUplink: true, statsUserDownlink: true } },
      system: { statsInboundUplink: true, statsInboundDownlink: true },
    },
    api: { tag: "api", listen: `127.0.0.1:${internalPort + 10}`, services: ["StatsService"] },
    inbounds: [
      {
        tag: "vless-in",
        listen: "127.0.0.1",
        port: internalPort,
        protocol: "vless",
        settings: {
          clients: [
            ...(globalClientEnabled ? [{ id: profile.uuid }] : []),
            ...activeClients.map(client => ({ id: client.vlessUuid, email: clientTrafficEmail(client.id, "vless"), level: 0 })),
          ],
          decryption: "none",
        },
        streamSettings: streamSettings(profile.wsPath),
      },
      {
        tag: "vmess-in",
        listen: "127.0.0.1",
        port: internalPort + 1,
        protocol: "vmess",
        settings: { clients: [
          ...(globalClientEnabled ? [{ id: profile.vmessUuid, level: 0 }] : []),
          ...activeClients.map(client => ({ id: client.vmessUuid, email: clientTrafficEmail(client.id, "vmess"), level: 0 })),
        ] },
        streamSettings: streamSettings(profile.vmessWsPath),
      },
      {
        tag: "trojan-in",
        listen: "127.0.0.1",
        port: internalPort + 2,
        protocol: "trojan",
        settings: { clients: [
          ...(globalClientEnabled ? [{ password: profile.trojanPassword }] : []),
          ...activeClients.map(client => ({ password: client.trojanPassword, email: clientTrafficEmail(client.id, "trojan"), level: 0 })),
        ] },
        streamSettings: streamSettings(profile.trojanWsPath),
      },
      {
        tag: "socks-in",
        listen: "127.0.0.1",
        port: internalPort + 3,
        protocol: "socks",
        settings: {
          auth: "password",
          accounts: globalClientEnabled ? [{ user: profile.socksUsername, pass: profile.socksPassword }] : [],
          udp: true,
        },
        streamSettings: streamSettings(profile.socksWsPath),
      },
      {
        tag: "vless-xhttp-in",
        listen: "127.0.0.1",
        port: internalPort + 4,
        protocol: "vless",
        settings: {
          clients: [
            ...(globalClientEnabled ? [{ id: profile.uuid }] : []),
            ...activeClients.map(client => ({ id: client.vlessUuid, email: clientTrafficEmail(client.id, "vless"), level: 0 })),
          ],
          decryption: "none",
        },
        streamSettings: xhttpStreamSettings,
      },
      ...activeClients.map(client => ({
        tag: clientSocksInboundTag(client.id),
        listen: "127.0.0.1",
        port: clientSocksInboundPort(internalPort, client.id),
        protocol: "socks",
        settings: {
          auth: "password",
          accounts: [{ user: client.socksUsername, pass: client.socksPassword }],
          udp: true,
          userLevel: 0,
        },
        streamSettings: streamSettings(clientWebSocketPaths(profile, client).socks),
      })),
    ],
    outbounds: [{ protocol: "freedom", tag: "direct" }],
  };
}
