import type { Express, Request, Response } from "express";
import { request as requestHttp } from "http";
import type { GatewayClient, VlessProfile } from "../drizzle/schema";
import { getVlessProfile, listGatewayClients, recordGatewayClientTunnelTraffic } from "./db";
import { observeGatewayTunnelTraffic, reserveGatewayClientSource, trackGatewayTunnel } from "./gatewayTunnels";
import { clientAllowsProtocol, clientXhttpPath, gatewayXhttpPath } from "./vless";
import { ClientSpeedLimiter, createSpeedLimitTransform, createTunnelUsageFlusher, gatewaySourceIdentity, limiterForGatewayClient } from "./vlessUpgradeProxy";
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
  for (const client of clients.filter(client => activeClient(client) && clientAllowsProtocol(client, "xhttp"))) {
    const internalPath = rewritePublicXhttpPath(clientXhttpPath(client), originalUrl);
    if (internalPath) return { internalPath, client };
  }
  return undefined;
}

/** Rewrites Xray packet-up's opaque public Referer to the private XHTTP base. */
export function rewritePublicXhttpReferer(referer: string | undefined, publicPrefix: string) {
  if (!referer) return referer;
  try {
    const externalUrl = new URL(referer);
    const internalPath = rewritePublicXhttpPath(publicPrefix, `${externalUrl.pathname}${externalUrl.search}`);
    return internalPath ? new URL(internalPath, externalUrl).toString() : referer;
  } catch {
    return referer;
  }
}

/** Compatibility helper retained for the global XHTTP route regression. */
export function privateXhttpPath(profile: Awaited<ReturnType<typeof getVlessProfile>>, originalUrl: string) {
  return profile ? resolvePublicXhttpRoute(profile, [], originalUrl)?.internalPath : undefined;
}

/**
 * Unlimited clients use a direct stream pipe. Keeping the optional branch here
 * prevents a no-op Transform from being allocated or from participating in
 * backpressure for an unlimited tunnel.
 */
export function pipeXhttpPayload(
  source: NodeJS.ReadableStream,
  destination: NodeJS.WritableStream,
  limiter?: ClientSpeedLimiter,
) {
  if (!limiter) {
    source.pipe(destination);
    return undefined;
  }
  const transform = createSpeedLimitTransform(limiter);
  source.pipe(transform).pipe(destination);
  return transform;
}

function forwardXhttp(req: Request, res: Response, profile: VlessProfile, route: XhttpRoute, releaseReservation?: () => void) {
  const headers = { ...req.headers, host: `127.0.0.1:${xrayInternalPort()}` };
  delete headers.connection;
  if (typeof headers.referer === "string") {
    headers.referer = rewritePublicXhttpReferer(headers.referer, route.client ? clientXhttpPath(route.client) : gatewayXhttpPath(profile));
  }
  const meter = route.client ? createTunnelUsageFlusher({
    clientId: route.client.id,
    profile,
    recordTraffic: recordGatewayClientTunnelTraffic,
    enforceQuota: enforceGatewayTrafficQuotas,
  }) : undefined;
  const limiter = route.client && route.client.speedLimitMbps > 0
    ? limiterForGatewayClient(route.client)
    : undefined;
  const upstream = requestHttp({ host: "127.0.0.1", port: xrayInternalPort() + 4, method: req.method, path: route.internalPath, headers }, upstreamResponse => {
    res.status(upstreamResponse.statusCode || 502);
    Object.entries(upstreamResponse.headers).forEach(([name, value]) => {
      if (value !== undefined) res.setHeader(name, value);
    });
    res.flushHeaders();
    if (route.client) {
      trackGatewayTunnel(res, upstreamResponse, route.client.id, gatewaySourceIdentity(req), releaseReservation, "xhttp");
      upstreamResponse.on("data", chunk => {
        const bytes = Buffer.byteLength(chunk);
        void meter?.observe(bytes);
        observeGatewayTunnelTraffic(upstreamResponse, "downlink", bytes);
      });
      upstreamResponse.once("end", () => { void meter?.flush(true); });
      upstreamResponse.once("close", () => { void meter?.flush(true); });
    } else {
      releaseReservation?.();
    }
    pipeXhttpPayload(upstreamResponse, res, limiter);
  });
  upstream.flushHeaders();
  upstream.once("error", () => {
    releaseReservation?.();
    void meter?.flush(true);
    if (!res.headersSent) res.status(502).type("text/plain").send("Gateway transport unavailable");
    else res.destroy();
  });
  req.on("data", chunk => {
    const bytes = Buffer.byteLength(chunk);
    void meter?.observe(bytes);
    observeGatewayTunnelTraffic(res, "uplink", bytes);
  });
  req.once("close", () => { void meter?.flush(true); });
  pipeXhttpPayload(req, upstream, limiter);
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
