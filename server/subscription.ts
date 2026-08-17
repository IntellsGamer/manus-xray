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
  const stateClass = input.enabled ? "is-active" : "is-disabled";
  const importDetails = input.imports?.length ? `<details class="imports"><summary>Show client import details</summary>${input.imports.map(value => `<code>${escapeHtml(value)}</code>`).join("")}</details>` : "";
  const quota = input.quota ? quotaCards(input.quota) : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.name)} · Gateway subscription</title><style>
:root{color-scheme:light;--bg:#fafafa;--surface:#fff;--surface-muted:#f5f5f5;--text:#171717;--muted:#737373;--border:#e5e5e5;--chip:#f5f5f5;--chip-text:#404040;--focus:#525252} @media(prefers-color-scheme:dark){:root:not([data-theme]){color-scheme:dark;--bg:#121212;--surface:#181818;--surface-muted:#202020;--text:#ededed;--muted:#a3a3a3;--border:#303030;--chip:#242424;--chip-text:#d4d4d4;--focus:#a3a3a3}}:root[data-theme="dark"]{color-scheme:dark;--bg:#121212;--surface:#181818;--surface-muted:#202020;--text:#ededed;--muted:#a3a3a3;--border:#303030;--chip:#242424;--chip-text:#d4d4d4;--focus:#a3a3a3}:root[data-theme="light"]{color-scheme:light;--bg:#fafafa;--surface:#fff;--surface-muted:#f5f5f5;--text:#171717;--muted:#737373;--border:#e5e5e5;--chip:#f5f5f5;--chip-text:#404040;--focus:#525252}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font:15px Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}.shell{max-width:980px;margin:0 auto;padding:42px 22px}.topline{display:flex;align-items:center;justify-content:space-between;gap:16px}.eyebrow{color:var(--muted);font-size:11px;font-weight:800;letter-spacing:.17em;text-transform:uppercase}.theme-picker{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}.theme-picker select{border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);padding:6px 8px;font:inherit;outline:none}.theme-picker select:focus{border-color:var(--focus)}.hero{padding:28px 0 25px;border-bottom:1px solid var(--border)}.hero h1{margin:12px 0 8px;font-size:32px;letter-spacing:-.04em}.hero p{margin:0;color:var(--muted);line-height:1.6}.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin:24px 0}.card{border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:17px}.card span{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.12em}.card strong{display:block;margin-top:9px;font-size:17px}.card small{display:block;margin-top:5px;color:var(--muted);font-size:12px;line-height:1.4}.status.is-active{color:#15803d}.status.is-disabled{color:#b45309}.panel{border:1px solid var(--border);border-radius:14px;background:var(--surface);padding:21px}.panel h2{margin:0;font-size:17px}.panel p{color:var(--muted);line-height:1.6}.paths{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.paths code{border:1px solid var(--border);background:var(--chip);color:var(--chip-text);border-radius:999px;padding:7px 10px;font-size:12px}.imports{margin-top:16px;color:var(--muted)}.imports summary{cursor:pointer;color:var(--text);font-weight:600}.imports code{display:block;margin-top:8px;max-height:90px;overflow:auto;white-space:pre-wrap;word-break:break-all;border:1px solid var(--border);border-radius:8px;padding:9px;background:var(--surface-muted);color:var(--text);font-size:11px}footer{padding-top:26px;color:var(--muted);font-size:12px}@media(max-width:640px){.shell{padding:28px 16px}.topline{align-items:flex-start;flex-direction:column}.hero h1{font-size:27px}}</style></head><body><main class="shell"><section class="hero"><div class="topline"><div class="eyebrow">Nginx Gateway · Subscription</div><label class="theme-picker">Appearance <select id="theme" aria-label="Appearance"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div><h1>${escapeHtml(input.name)}</h1><p>Use this address in a compatible client for an importable subscription. Data usage appears only after the local Xray sampler has reported it.</p></section><section class="grid"><article class="card"><span>Profile state</span><strong class="status ${stateClass}">${state}</strong></article><article class="card"><span>Gateway endpoint</span><strong>${escapeHtml(input.serverAddress)}:${input.port}</strong></article><article class="card"><span>Subscription deliveries</span><strong>${input.deliveries + 1}</strong></article>${quota}</section><section class="panel"><h2>Connection details</h2><p>Available transports use the gateway paths below. Open this link in a compatible client to receive its importable subscription payload.</p><div class="paths">${pathRows}</div><p>Last observed subscription delivery: ${escapeHtml(lastSync)}</p>${importDetails}</section><footer>Gateway subscription status · Usage is read from local Xray counters when the runtime sampler is available.</footer></main><script>const key="nginx-gateway-subscription-theme",select=document.getElementById("theme"),stored=localStorage.getItem(key);if(stored==="light"||stored==="dark"){document.documentElement.dataset.theme=stored;select.value=stored}else{select.value="system"}select.addEventListener("change",()=>{const value=select.value;if(value==="system"){delete document.documentElement.dataset.theme;localStorage.removeItem(key)}else{document.documentElement.dataset.theme=value;localStorage.setItem(key,value)}})</script></body></html>`;
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
