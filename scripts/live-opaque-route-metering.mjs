import { spawn, spawnSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { createGatewayClient, deleteGatewayClient, getGatewayClientById, getVlessProfile } from "../server/db.ts";

const host = "nginxadmin-kw4zek2d.manus.space";
const xrayBinary = process.env.XRAY_BINARY_PATH || "/home/ubuntu/xray-validation/xray/xray";
const configPath = "/tmp/nginx-gateway-live-route-metering.json";
const socksPort = 19181;

function waitForPort(port) {
  return new Promise((resolveWait, rejectWait) => {
    const deadline = Date.now() + 15_000;
    const attempt = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolveWait(); });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) return rejectWait(new Error(`Timed out waiting for local SOCKS listener ${port}`));
        setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.once("error", rejectRun);
    child.once("exit", code => resolveRun({ code, stdout, stderr }));
  });
}

function stop(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise(resolveStop => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); resolveStop(); }, 3_000);
    child.once("exit", () => { clearTimeout(timeout); resolveStop(); });
    child.kill("SIGTERM");
  });
}

async function main() {
  let client;
  let xray;
  try {
    client = await createGatewayClient({ name: `Disposable live route validation ${Date.now()}`, trafficLimitBytes: 2 * 1024 * 1024, dayLimit: -1 });
    const profile = await getVlessProfile();
    if (!profile) throw new Error("Gateway profile is unavailable");

    const subscription = await fetch(`https://${host}/sub/${client.subscriptionToken}`, { headers: { accept: "text/plain", "user-agent": "live-route-metering-validator" } });
    if (!subscription.ok) throw new Error(`Production subscription warm-up returned HTTP ${subscription.status}`);

    const clientConfig = {
      log: { loglevel: "warning" },
      inbounds: [{ listen: "127.0.0.1", port: socksPort, protocol: "socks", settings: { auth: "noauth", udp: false } }],
      outbounds: [{
        protocol: "vless",
        settings: { vnext: [{ address: host, port: 443, users: [{ id: client.vlessUuid, encryption: "none" }] }] },
        streamSettings: {
          network: "ws",
          security: "tls",
          tlsSettings: { serverName: host, allowInsecure: false },
          wsSettings: { path: `/vless/${client.connectionToken}`, headers: { Host: host } },
        },
      }],
    };
    await writeFile(configPath, `${JSON.stringify(clientConfig, null, 2)}\n`, { mode: 0o600 });
    const configTest = spawnSync(xrayBinary, ["run", "-test", "-c", configPath], { encoding: "utf8" });
    if (configTest.status !== 0) throw new Error(`Live client config is invalid: ${configTest.stderr || configTest.stdout}`);

    xray = spawn(xrayBinary, ["run", "-c", configPath], { stdio: ["ignore", "ignore", "pipe"] });
    await waitForPort(socksPort);
    const proxied = await run("curl", ["--fail", "--silent", "--show-error", "--max-time", "20", "--proxy", `socks5h://127.0.0.1:${socksPort}`, "https://example.com/"]);
    if (proxied.code !== 0 || !proxied.stdout.includes("Example Domain")) throw new Error(`Opaque production VLESS route failed: ${proxied.stderr || proxied.stdout}`);

    await new Promise(resolveWait => setTimeout(resolveWait, 750));
    const measured = await getGatewayClientById(client.id);
    if (!measured || measured.trafficUsedBytes <= 0 || measured.trafficUsedBytes >= 2 * 1024 * 1024) {
      throw new Error(`Unexpected backend meter value: ${measured?.trafficUsedBytes ?? "missing"}`);
    }
    console.log(`Live opaque VLESS route and backend meter passed with ${measured.trafficUsedBytes} recorded bridge bytes.`);
  } finally {
    await stop(xray);
    if (client) await deleteGatewayClient(client.id);
    await rm(configPath, { force: true });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
