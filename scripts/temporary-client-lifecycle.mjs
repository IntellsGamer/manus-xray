import { ENV } from "../server/_core/env.ts";
import { getGatewayClientById, getUserByOpenId, getVlessProfile } from "../server/db.ts";
import { vlessRouter } from "../server/routers/vless.ts";
import { enforceGatewayTrafficQuotas } from "../server/xrayRuntime.ts";

const host = "nginxadmin-kw4zek2d.manus.space";
const testName = `Temporary 1 MB validation ${Date.now()}`;

async function main() {
  const user = await getUserByOpenId(ENV.ownerOpenId);
  if (!user || user.role !== "admin") throw new Error("Owner administrator record is unavailable for temporary client validation");

  const caller = vlessRouter.createCaller({
    user,
    req: { headers: { host }, protocol: "https" },
    res: {},
  });
  const existing = await caller.clients();
  const existingIds = new Set(existing.map(client => client.id));
  let temporaryId;

  try {
    const creationRequestId = crypto.randomUUID();
    const created = await caller.createClient({ name: testName, trafficLimitBytes: 1024 * 1024, dayLimit: -1, speedLimitMbps: -1, connectionLimit: -1, creationRequestId });
    const retried = await caller.createClient({ name: testName, trafficLimitBytes: 1024 * 1024, dayLimit: -1, speedLimitMbps: -1, connectionLimit: -1, creationRequestId });
    temporaryId = created.id;
    if (retried.id !== created.id) throw new Error("A repeated client-creation request produced a duplicate identity");
    if (created.trafficLimitBytes !== 1024 * 1024 || created.dayLimit !== -1 || created.speedLimitMbps !== -1 || created.connectionLimit !== -1) throw new Error("The temporary client did not retain its unlimited day, speed, and connection policy");
    if (!created.activationPending || created.enabled) throw new Error("The temporary client was not returned in its short pending-activation state");

    const listed = await caller.clients();
    const persisted = listed.find(client => client.id === temporaryId);
    if (!persisted || persisted.trafficLimitBytes !== 1024 * 1024 || persisted.dayLimit !== -1 || persisted.speedLimitMbps !== -1 || persisted.connectionLimit !== -1) throw new Error("The temporary client policy was not visible through the management API");
    if (listed.some(client => client.id !== temporaryId && !existingIds.has(client.id))) throw new Error("Unexpected client identity appeared during temporary validation");

    await new Promise(resolve => setTimeout(resolve, 12_250));
    const activated = await caller.activateClient({ id: temporaryId });
    if (!activated.activated || !activated.enabled || activated.activationPending) throw new Error("The temporary client did not activate after its deferred Xray refresh window");

    const proxyResponse = await fetch(`http://127.0.0.1:3000${created.subscriptionPath}`, { headers: { accept: "text/plain", "user-agent": "temporary-lifecycle-validator" } });
    if (!proxyResponse.ok) throw new Error(`Temporary subscription returned HTTP ${proxyResponse.status}`);
    const payload = Buffer.from(await proxyResponse.text(), "base64").toString("utf8");
    if (!payload.includes(created.connection.vlessUri)) throw new Error("Temporary subscription payload did not contain the generated VLESS import");

    const storedBeforeUsage = await getGatewayClientById(temporaryId);
    if (!storedBeforeUsage) throw new Error("The temporary client could not be loaded for Xray counter validation");

    const profile = await getVlessProfile();
    if (!profile) throw new Error("Gateway profile is unavailable for quota enforcement validation");
    const enforcement = await enforceGatewayTrafficQuotas(profile, {
      listClients: async () => [storedBeforeUsage],
      getTrafficStats: async () => new Map([[temporaryId, 1024 * 1024]]),
      synchronizeTraffic: async (clients, counters) => clients.map(client => ({ ...client, trafficUsedBytes: counters.get(client.id) ?? 0, trafficStatsSnapshotBytes: counters.get(client.id) ?? 0 })),
    });
    if (!enforcement.disabledClientIds.includes(temporaryId)) throw new Error("Quota-hit temporary client was not disabled");
    const disabled = await getGatewayClientById(temporaryId);
    if (!disabled || disabled.enabled || !disabled.quotaExhaustedAt) throw new Error("Quota-hit state was not persisted on the temporary client");
    const disabledSubscription = await fetch(`http://127.0.0.1:3000${created.subscriptionPath}`, { headers: { accept: "text/plain", "user-agent": "temporary-lifecycle-validator" } });
    if (disabledSubscription.status !== 404) throw new Error(`Quota-exhausted subscription returned HTTP ${disabledSubscription.status} instead of 404`);
  } finally {
    if (temporaryId) await caller.deleteClient({ id: temporaryId });
  }

  const after = await caller.clients();
  if (after.some(client => client.id === temporaryId) || existingIds.size !== after.length || after.some(client => !existingIds.has(client.id))) {
    throw new Error("Temporary client cleanup did not preserve the original client set");
  }
  console.log("Real temporary 1 MB client creation, Xray-counter quota handoff, quota disablement, subscription rejection, permanent deletion, and existing-client preservation passed.");
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
