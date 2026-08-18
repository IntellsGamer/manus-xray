import type { Express, Request, Response } from "express";
import { request as requestHttp } from "http";
import { getVlessProfile } from "./db";
import { gatewayXhttpPath } from "./vless";
import { applyXrayProfile, xrayInternalPort } from "./xrayRuntime";

export function privateXhttpPath(profile: Awaited<ReturnType<typeof getVlessProfile>>, originalUrl: string) {
  if (!profile) return undefined;
  const externalUrl = new URL(originalUrl, "http://gateway.local");
  const publicPath = gatewayXhttpPath(profile);
  if (externalUrl.pathname !== publicPath && !externalUrl.pathname.startsWith(`${publicPath}/`)) return undefined;
  const suffix = externalUrl.pathname.slice(publicPath.length) || "/";
  return `/xhttp${suffix}${externalUrl.search}`;
}

function forwardXhttp(req: Request, res: Response, internalPath: string) {
  const headers = { ...req.headers, host: `127.0.0.1:${xrayInternalPort()}` };
  delete headers.connection;
  const upstream = requestHttp({ host: "127.0.0.1", port: xrayInternalPort() + 4, method: req.method, path: internalPath, headers }, upstreamResponse => {
    res.status(upstreamResponse.statusCode || 502);
    Object.entries(upstreamResponse.headers).forEach(([name, value]) => {
      if (value !== undefined) res.setHeader(name, value);
    });
    upstreamResponse.pipe(res);
  });
  upstream.once("error", () => {
    if (!res.headersSent) res.status(502).type("text/plain").send("Gateway transport unavailable");
    else res.destroy();
  });
  req.pipe(upstream);
}

export function registerXhttpProxy(app: Express) {
  app.all(/^\/xhttp(?:\/.*)?$/, async (req, res, next) => {
    try {
      const profile = await getVlessProfile();
      const internalPath = privateXhttpPath(profile, req.originalUrl || req.url);
      if (!internalPath) {
        res.status(404).type("text/plain").send("Not found");
        return;
      }
      await applyXrayProfile(profile!);
      forwardXhttp(req, res, internalPath);
    } catch (error) {
      next(error);
    }
  });
}
