import { ENV } from "../server/_core/env.ts";
import { getUserByOpenId } from "../server/db.ts";
import { vlessRouter } from "../server/routers/vless.ts";

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
    const created = await caller.createClient({ name: testName, trafficLimitBytes: 1024 * 1024, dayLimit: -1 });
    temporaryId = created.id;
    if (created.trafficLimitBytes !== 1024 * 1024 || created.dayLimit !== -1) throw new Error("The temporary client did not retain its 1 MB unlimited-day policy");

    const listed = await caller.clients();
    const persisted = listed.find(client => client.id === temporaryId);
    if (!persisted || persisted.trafficLimitBytes !== 1024 * 1024 || persisted.dayLimit !== -1) throw new Error("The temporary client policy was not visible through the management API");
    if (listed.some(client => client.id !== temporaryId && !existingIds.has(client.id))) throw new Error("Unexpected client identity appeared during temporary validation");

    const proxyResponse = await fetch(`http://127.0.0.1:3000${created.subscriptionPath}`, { headers: { accept: "text/plain", "user-agent": "temporary-lifecycle-validator" } });
    if (!proxyResponse.ok) throw new Error(`Temporary subscription returned HTTP ${proxyResponse.status}`);
    const payload = Buffer.from(await proxyResponse.text(), "base64").toString("utf8");
    if (!payload.includes(created.connection.vlessUri)) throw new Error("Temporary subscription payload did not contain the generated VLESS import");
  } finally {
    if (temporaryId) await caller.deleteClient({ id: temporaryId });
  }

  const after = await caller.clients();
  if (after.some(client => client.id === temporaryId) || existingIds.size !== after.length || after.some(client => !existingIds.has(client.id))) {
    throw new Error("Temporary client cleanup did not preserve the original client set");
  }
  console.log("Real temporary 1 MB client creation, subscription validation, permanent deletion, and existing-client preservation passed.");
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
