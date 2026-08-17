import type { Express, Request, Response } from "express";
import {
  getGatewayClientBySubscriptionToken,
  getVlessProfile,
  getVlessProfileBySubscriptionToken,
  recordSubscriptionDelivery,
} from "./db";
import { buildClientConnectionDetails, buildClientSubscriptionPayload, buildSubscriptionPayload } from "./vless";
import { syncGatewayClientTrafficUsage } from "./xrayRuntime";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
}

function isBrowserRequest(req: Request) {
  const userAgent = req.get("user-agent") || "";
  const acceptsHtml = (req.get("accept") || "").includes("text/html");
  return acceptsHtml && /(mozilla|chrome|safari|firefox|edg)/i.test(userAgent);
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${Math.round((bytes / 1024 ** 3) * 100) / 100} GB`;
  return `${Math.round((bytes / 1024 ** 2) * 100) / 100} MB`;
}

function quotaCards(quota: { trafficLimitBytes: number; trafficUsedBytes: number; trafficUsageAvailable: boolean; dayLimit: number; expiresAt?: Date | null }) {
  const data = quota.trafficLimitBytes < 0
    ? { title: "Unlimited", detail: quota.trafficUsageAvailable ? `${formatBytes(quota.trafficUsedBytes)} observed` : "Traffic sampler awaiting data" }
    : quota.trafficUsageAvailable
      ? { title: `${formatBytes(Math.max(0, quota.trafficLimitBytes - quota.trafficUsedBytes))} left`, detail: `${formatBytes(quota.trafficUsedBytes)} / ${formatBytes(quota.trafficLimitBytes)} used` }
      : { title: formatBytes(quota.trafficLimitBytes), detail: "Traffic sampler awaiting data" };
  const days = quota.dayLimit < 0
    ? { title: "Unlimited", detail: "No expiry policy" }
    : quota.expiresAt
      ? (() => { const left = Math.ceil((quota.expiresAt.getTime() - Date.now()) / 86_400_000); return left > 0 ? { title: `${left} days left`, detail: `Expires ${quota.expiresAt.toLocaleDateString()}` } : { title: "Expired", detail: quota.expiresAt.toLocaleDateString() }; })()
      : { title: "Not scheduled", detail: `${quota.dayLimit} day policy` };
  return `<article class="card"><span>Data quota</span><strong>${escapeHtml(data.title)}</strong><small>${escapeHtml(data.detail)}</small></article><article class="card"><span>Validity</span><strong>${escapeHtml(days.title)}</strong><small>${escapeHtml(days.detail)}</small></article>`;
}

function statusPage(input: { name: string; enabled: boolean; serverAddress: string; port: number; paths: string[]; deliveries: number; lastSubscriptionAt?: Date | null; imports?: string[]; quota?: { trafficLimitBytes: number; trafficUsedBytes: number; trafficUsageAvailable: boolean; dayLimit: number; expiresAt?: Date | null } }) {
  const lastSync = input.lastSubscriptionAt ? input.lastSubscriptionAt.toISOString().replace("T", " ").replace(".000Z", " UTC") : "First browser visit";
  const pathRows = input.paths.map(path => `<code>${escapeHtml(path)}</code>`).join("");
  const state = input.enabled ? "Active" : "Disabled";
  const importDetails = input.imports?.length ? `<details class="imports"><summary>Show client import details</summary>${input.imports.map(value => `<code>${escapeHtml(value)}</code>`).join("")}</details>` : "";
  const quota = input.quota ? quotaCards(input.quota) : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.name)} · Gateway subscription</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 85% -10%,#0b7f8a22,transparent 34rem),#07101b;color:#e8f1f7;font:15px Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}.shell{max-width:980px;margin:0 auto;padding:42px 22px}.eyebrow{color:#55dce8;font-size:11px;font-weight:800;letter-spacing:.17em;text-transform:uppercase}.hero{padding:28px 0 25px;border-bottom:1px solid #ffffff18}.hero h1{margin:12px 0 8px;font-size:32px;letter-spacing:-.04em}.hero p{margin:0;color:#9fb1c3;line-height:1.6}.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin:24px 0}.card{border:1px solid #ffffff14;border-radius:16px;background:#ffffff08;padding:17px}.card span{display:block;color:#90a6ba;font-size:11px;text-transform:uppercase;letter-spacing:.12em}.card strong{display:block;margin-top:9px;font-size:17px}.card small{display:block;margin-top:5px;color:#9fb1c3;font-size:12px;line-height:1.4}.status{color:${input.enabled ? "#75e6a4" : "#ffbd72"}}.panel{border:1px solid #ffffff14;border-radius:18px;background:#0d1a28;padding:21px}.panel h2{margin:0;font-size:17px}.panel p{color:#9fb1c3;line-height:1.6}.paths{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.paths code{border:1px solid #1f6170;background:#0a3039;color:#75e3ed;border-radius:999px;padding:7px 10px;font-size:12px}.imports{margin-top:16px;color:#9fb1c3}.imports summary{cursor:pointer;color:#75e3ed}.imports code{display:block;margin-top:8px;max-height:90px;overflow:auto;white-space:pre-wrap;word-break:break-all;border:1px solid #ffffff14;border-radius:8px;padding:9px;color:#dcebf4;font-size:11px}footer{padding-top:26px;color:#63798e;font-size:12px}@media(max-width:640px){.shell{padding:28px 16px}}</style></head><body><main class="shell"><section class="hero"><div class="eyebrow">Nginx Gateway · Subscription</div><h1>${escapeHtml(input.name)}</h1><p>Use this address in a compatible client for an importable subscription. Data usage appears only after the local Xray sampler has reported it.</p></section><section class="grid"><article class="card"><span>Profile state</span><strong class="status">${state}</strong></article><article class="card"><span>Gateway endpoint</span><strong>${escapeHtml(input.serverAddress)}:${input.port}</strong></article><article class="card"><span>Subscription deliveries</span><strong>${input.deliveries + 1}</strong></article>${quota}</section><section class="panel"><h2>Connection details</h2><p>Available transports use the gateway paths below. Open this link in a compatible client to receive its importable subscription payload.</p><div class="paths">${pathRows}</div><p>Last observed subscription delivery: ${escapeHtml(lastSync)}</p>${importDetails}</section><footer>Gateway subscription status · Usage is read from local Xray counters when the runtime sampler is available.</footer></main></body></html>`;
}

async function serveSubscription(req: Request, res: Response) {
  const token = req.params.token;
  if (!TOKEN_PATTERN.test(token)) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }

  const userAgent = req.get("user-agent") || undefined;
  const browser = isBrowserRequest(req);
  const profile = await getVlessProfileBySubscriptionToken(token);
  if (profile && profile.globalProfileEnabled) {
    await recordSubscriptionDelivery({ profileKind: "global", deliveryKind: browser ? "browser" : "proxy", userAgent });
    if (browser) {
      res.status(200).set("Cache-Control", "no-store, max-age=0").type("text/html; charset=utf-8").send(statusPage({
        name: "Global gateway profile", enabled: true, serverAddress: profile.serverAddress, port: profile.port,
        paths: [profile.wsPath, profile.vmessWsPath, profile.trojanWsPath, profile.socksWsPath], deliveries: 0,
      }));
      return;
    }
    res.status(200).set({ "Cache-Control": "no-store, max-age=0", "Content-Disposition": 'inline; filename="subscription.txt"', "X-Content-Type-Options": "nosniff" }).type("text/plain; charset=utf-8").send(buildSubscriptionPayload(profile));
    return;
  }

  const client = await getGatewayClientBySubscriptionToken(token);
  if (!client || !client.enabled || (client.expiresAt && client.expiresAt.getTime() <= Date.now())) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  const gateway = await getVlessProfile();
  if (!gateway) {
    res.status(503).type("text/plain").send("Gateway unavailable");
    return;
  }
  const trafficUsage = await syncGatewayClientTrafficUsage([client]);
  const trafficUsedBytes = trafficUsage?.get(client.id) ?? client.trafficUsedBytes;
  await recordSubscriptionDelivery({ profileKind: "client", clientId: client.id, deliveryKind: browser ? "browser" : "proxy", userAgent });
  if (browser) {
    const details = buildClientConnectionDetails(gateway, client);
    res.status(200).set("Cache-Control", "no-store, max-age=0").type("text/html; charset=utf-8").send(statusPage({
      name: client.name, enabled: client.enabled, serverAddress: gateway.serverAddress, port: gateway.port,
      paths: [gateway.wsPath, gateway.vmessWsPath, gateway.trojanWsPath, gateway.socksWsPath], deliveries: client.subscriptionDeliveryCount, lastSubscriptionAt: client.lastSubscriptionAt,
      imports: [details.vlessUri, details.vmessUri, details.trojanUri],
      quota: { trafficLimitBytes: client.trafficLimitBytes, trafficUsedBytes, trafficUsageAvailable: trafficUsage !== null, dayLimit: client.dayLimit, expiresAt: client.expiresAt },
    }));
    return;
  }
  res.status(200).set({ "Cache-Control": "no-store, max-age=0", "Content-Disposition": 'inline; filename="subscription.txt"', "X-Content-Type-Options": "nosniff" }).type("text/plain; charset=utf-8").send(buildClientSubscriptionPayload(gateway, client));
}

export function registerSubscriptionRoute(app: Express) {
  app.get("/sub/:token", (req, res, next) => serveSubscription(req, res).catch(next));
}
