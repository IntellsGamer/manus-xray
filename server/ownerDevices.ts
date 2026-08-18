import { randomBytes } from "crypto";
import type { Request } from "express";

export type OwnerDeviceObservation = {
  deviceName: string;
  deviceKind: "desktop" | "mobile" | "tablet" | "unknown";
  browser: string;
  operatingSystem: string;
  userAgent: string;
  ipAddress: string | null;
  countryCode: string | null;
  city: string | null;
  region: string | null;
};

export function createOwnerDeviceToken() {
  return randomBytes(24).toString("base64url");
}

export function isOwnerDeviceToken(value: string | undefined) {
  return Boolean(value && /^[A-Za-z0-9_-]{24,64}$/.test(value));
}

function header(req: Request, name: string) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function clientIp(req: Request) {
  const cloudflare = header(req, "cf-connecting-ip")?.trim();
  const forwarded = header(req, "x-forwarded-for")?.split(",")[0]?.trim();
  return cloudflare || forwarded || req.socket?.remoteAddress || null;
}

function browserName(userAgent: string) {
  if (/Edg\//.test(userAgent)) return "Microsoft Edge";
  if (/OPR\//.test(userAgent)) return "Opera";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  if (/Chrome\//.test(userAgent) || /CriOS\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return "Unknown browser";
}

function operatingSystem(userAgent: string) {
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Android";
  if (/Windows NT 10/.test(userAgent)) return "Windows 10/11";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/Mac OS X/.test(userAgent)) return "macOS";
  if (/Linux/.test(userAgent)) return "Linux";
  return "Unknown OS";
}

function deviceKind(userAgent: string): OwnerDeviceObservation["deviceKind"] {
  if (/iPad|Tablet/.test(userAgent)) return "tablet";
  if (/Mobile|iPhone|Android/.test(userAgent)) return "mobile";
  if (/Windows|Macintosh|Linux/.test(userAgent)) return "desktop";
  return "unknown";
}

/** Extracts only request headers delivered by Cloudflare or the trusted edge. */
export function observeOwnerDeviceRequest(req: Request): OwnerDeviceObservation {
  const userAgent = header(req, "user-agent")?.slice(0, 512) || "Unknown client";
  const browser = browserName(userAgent);
  const os = operatingSystem(userAgent);
  const kind = deviceKind(userAgent);
  const countryCode = header(req, "cf-ipcountry")?.trim().toUpperCase() || null;
  const city = header(req, "cf-ipcity")?.trim() || null;
  const region = header(req, "cf-region")?.trim() || null;
  return {
    deviceName: `${browser} on ${os}`,
    deviceKind: kind,
    browser,
    operatingSystem: os,
    userAgent,
    ipAddress: clientIp(req),
    countryCode: countryCode === "XX" ? null : countryCode,
    city,
    region,
  };
}
