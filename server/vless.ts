import { randomBytes, randomUUID } from "crypto";
import type { VlessProfile } from "../drizzle/schema";

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

export function buildVlessUri(profile: VlessProfile) {
  const endpoint = new URL(`vless://${profile.uuid}@${profile.serverAddress}:${profile.port}`);
  endpoint.searchParams.set("encryption", "none");
  endpoint.searchParams.set("security", profile.tlsEnabled ? "tls" : "none");
  endpoint.searchParams.set("type", "ws");
  endpoint.searchParams.set("host", profile.serverAddress);
  endpoint.searchParams.set("path", normaliseWsPath(profile.wsPath));
  return `${endpoint.toString()}#${encodeURIComponent("Nginx Gateway")}`;
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
    scy: "auto",
    net: "ws",
    type: "none",
    host: profile.serverAddress,
    path: normaliseWsPath(profile.vmessWsPath),
    tls: profile.tlsEnabled ? "tls" : "",
    sni: profile.serverAddress,
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
    inbounds: [{ listen: "127.0.0.1", port: 10808, protocol: "socks", settings: { auth: "noauth", udp: true } }],
    outbounds: [{
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
        tlsSettings: profile.tlsEnabled ? { serverName: profile.serverAddress } : undefined,
        wsSettings: { path: normaliseWsPath(profile.socksWsPath), headers: { Host: profile.serverAddress } },
      },
    }],
  }, null, 2);
}

export function buildSubscriptionPayload(profile: VlessProfile) {
  return Buffer.from([buildVlessUri(profile), buildVmessUri(profile), buildTrojanUri(profile)].join("\n"), "utf8").toString("base64");
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

/**
 * Builds the private Xray side of the public HTTPS/WebSocket bridge. TLS is
 * terminated at the platform edge, therefore this local listener is loopback
 * only and carries the already-upgraded WebSocket stream without TLS.
 */
export function buildXrayConfig(profile: VlessProfile, internalPort: number) {
  const streamSettings = (path: string): Record<string, unknown> => ({
    network: "ws",
    security: "none",
    wsSettings: { path: normaliseWsPath(path) },
  });

  return {
    log: { loglevel: "warning" },
    inbounds: [
      {
        tag: "vless-in",
        listen: "127.0.0.1",
        port: internalPort,
        protocol: "vless",
        settings: {
          clients: [{ id: profile.uuid }],
          decryption: "none",
        },
        streamSettings: streamSettings(profile.wsPath),
      },
      {
        tag: "vmess-in",
        listen: "127.0.0.1",
        port: internalPort + 1,
        protocol: "vmess",
        settings: { clients: [{ id: profile.vmessUuid, alterId: 0 }] },
        streamSettings: streamSettings(profile.vmessWsPath),
      },
      {
        tag: "trojan-in",
        listen: "127.0.0.1",
        port: internalPort + 2,
        protocol: "trojan",
        settings: { clients: [{ password: profile.trojanPassword }] },
        streamSettings: streamSettings(profile.trojanWsPath),
      },
      {
        tag: "socks-in",
        listen: "127.0.0.1",
        port: internalPort + 3,
        protocol: "socks",
        settings: {
          auth: "password",
          accounts: [{ user: profile.socksUsername, pass: profile.socksPassword }],
          udp: true,
        },
        streamSettings: streamSettings(profile.socksWsPath),
      },
    ],
    outbounds: [{ protocol: "freedom", tag: "direct" }],
  };
}
