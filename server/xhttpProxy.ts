import type { Express, Request, Response } from "express";
import { request as requestHttp } from "http";
import type { GatewayClient, VlessProfile } from "../drizzle/schema";
import { getVlessProfile, listGatewayClients, recordGatewayClientTunnelTraffic } from "./db";
import { reserveGatewayClientSource, trackGatewayTunnel } from "./gatewayTunnels";
import { clientXhttpPath, gatewayXhttpPath } from "./vless";
import { createSpeedLimitTransform, createTunnelUsageFlusher, gatewaySourceIdentity, limiterForGatewayClient } from "./vlessUpgradeProxy";
import { enforceGatewayTrafficQuotas, xrayInternalPort } from "./xrayRuntime";

export type XhttpRoute = { internalPath: string; client?: GatewayClient };

function activeClient(client: GatewayClient) {
  return client.enabled && (!client.expiresAt || client.expiresAt.getTime() > Date.now());
}

function rewritePublicXhttpPath(prefix: string, originalUrl: string) {
  const externalUrl = new URL(originalUrl, "http://gateway.local");
  if (externalUrl.pathname !== prefix && !externalUrl.pathname.startsWith(`${prefix}/`)) return undefined;
  const suffix = externalUrl.pathname.slice(prefix.length) || "/";
  return `/xhttp${suffix}${externalUrl.search}`;
}

export function resolvePublicXhttpRoute(profile: VlessProfile, clients: GatewayClient[], originalUrl: string): XhttpRoute | undefined {
  if (profile.globalProfileEnabled !== false) {
    const internalPath = rewritePublicXhttpPath(gatewayXhttpPath(profile), originalUrl);
    if (internalPath) return { internalPath };
  }
  for (const client of clients.filter(activeClient)) {
    const internalPath = rewritePublicXhttpPath(clientXhttpPath(client), originalUrl);
    if (internalPath) return { internalPath, client };
  }
  return undefined;
}

/** Compatibility helper retained for the global XHTTP route regression. */
export function privateXhttpPath(profile: Awaited<ReturnType<typeof getVlessProfile>>, originalUrl: string) {
  return profile ? resolvePublicXhttpRoute(profile, [], originalUrl)?.internalPath : undefined;
}

function forwardXhttp(req: Request, res: Response, profile: VlessProfile, route: XhttpRoute, releaseReservation?: () => void) {
  const headers = { ...req.headers, host: `127.0.0.1:${xrayInternalPort()}` };
  delete headers.connection;
  const meter = route.client ? createTunnelUsageFlusher({
    clientId: route.client.id,
    profile,
    recordTraffic: recordGatewayClientTunnelTraffic,
    enforceQuota: enforceGatewayTrafficQuotas,
  }) : undefined;
  const limiter = route.client ? limiterForGatewayClient(route.client) : undefined;
  const upstream = requestHttp({ host: "127.0.0.1", port: xrayInternalPort() + 4, method: req.method, path: route.internalPath, headers }, upstreamResponse => {
    res.status(upstreamResponse.statusCode || 502);
    Object.entries(upstreamResponse.headers).forEach(([name, value]) => {
      if (value !== undefined) res.setHeader(name, value);
    });
    if (route.client) {
      trackGatewayTunnel(res, upstreamResponse, route.client.id, gatewaySourceIdentity(req), releaseReservation);
      upstreamResponse.on("data", chunk => { void meter?.observe(Buffer.byteLength(chunk)); });
      upstreamResponse.once("end", () => { void meter?.flush(true); });
      upstreamResponse.once("close", () => { void meter?.flush(true); });
    } else {
      releaseReservation?.();
    }
    const downstream = createSpeedLimitTransform(limiter);
    upstreamResponse.pipe(downstream).pipe(res);
  });
  upstream.once("error", () => {
    releaseReservation?.();
    void meter?.flush(true);
    if (!res.headersSent) res.status(502).type("text/plain").send("Gateway transport unavailable");
    else res.destroy();
  });
  req.on("data", chunk => { void meter?.observe(Buffer.byteLength(chunk)); });
  req.once("close", () => { void meter?.flush(true); });
  const upstreamLimiter = createSpeedLimitTransform(limiter);
  req.pipe(upstreamLimiter).pipe(upstream);
}

export function registerXhttpProxy(app: Express) {
  app.all(/^\/xhttp(?:\/.*)?$/, async (req, res, next) => {
    try {
      const profile = await getVlessProfile();
      if (!profile) {
        res.status(404).type("text/plain").send("Not found");
        return;
      }
      const route = resolvePublicXhttpRoute(profile, await listGatewayClients(), req.originalUrl || req.url);
      if (!route) {
        res.status(404).type("text/plain").send("Not found");
        return;
      }
      const sourceIdentity = gatewaySourceIdentity(req);
      const releaseReservation = route.client ? reserveGatewayClientSource(route.client.id, sourceIdentity, route.client.connectionLimit ?? -1) : undefined;
      if (route.client && !releaseReservation) {
        res.status(429).type("text/plain").send("Connection limit reached");
        return;
      }
      await enforceGatewayTrafficQuotas(profile);
      forwardXhttp(req, res, profile, route, releaseReservation);
    } catch (error) {
      next(error);
    }
  });
}
