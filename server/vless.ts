import { randomBytes, randomUUID } from "crypto";
import type { VlessProfile } from "../drizzle/schema";

export function createVlessUuid() {
  return randomUUID();
}

export function createSubscriptionToken() {
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

export function buildSubscriptionPayload(profile: VlessProfile) {
  return Buffer.from(buildVlessUri(profile), "utf8").toString("base64");
}

/**
 * Builds the private Xray side of the public HTTPS/WebSocket bridge. TLS is
 * terminated at the platform edge, therefore this local listener is loopback
 * only and carries the already-upgraded WebSocket stream without TLS.
 */
export function buildXrayConfig(profile: VlessProfile, internalPort: number) {
  const streamSettings: Record<string, unknown> = {
    network: "ws",
    security: "none",
    wsSettings: { path: normaliseWsPath(profile.wsPath) },
  };

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
        streamSettings,
      },
    ],
    outbounds: [{ protocol: "freedom", tag: "direct" }],
  };
}
