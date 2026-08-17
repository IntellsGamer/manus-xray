import { randomBytes, randomUUID } from "crypto";
import type { VlessProfile } from "../drizzle/schema";

export type XrayTlsFiles = {
  certificateFile?: string;
  keyFile?: string;
};

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

/** Builds an Xray inbound configuration compatible with VLESS over WebSocket. */
export function buildXrayConfig(profile: VlessProfile, tlsFiles: XrayTlsFiles = {}) {
  const streamSettings: Record<string, unknown> = {
    network: "ws",
    security: profile.tlsEnabled ? "tls" : "none",
    wsSettings: { path: normaliseWsPath(profile.wsPath) },
  };

  if (profile.tlsEnabled && tlsFiles.certificateFile && tlsFiles.keyFile) {
    streamSettings.tlsSettings = {
      certificates: [
        {
          certificateFile: tlsFiles.certificateFile,
          keyFile: tlsFiles.keyFile,
        },
      ],
    };
  }

  return {
    log: { loglevel: "warning" },
    inbounds: [
      {
        tag: "vless-in",
        listen: "0.0.0.0",
        port: profile.port,
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
