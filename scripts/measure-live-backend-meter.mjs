import { spawn, spawnSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { createGatewayClient, deleteGatewayClient, getGatewayClientById } from "../server/db.ts";

const host = "nginxadmin-kw4zek2d.manus.space";
const xrayBinary = process.env.XRAY_BINARY_PATH || "/home/ubuntu/xray-validation/xray/xray";
const configPath = "/tmp/nginx-gateway-meter-measurement.json";
const socksPort = 19381;
const expectedBytes = 8 * 1024 * 1024;

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
    client = await createGatewayClient({ name: `Disposable exact-meter measurement ${Date.now()}`, trafficLimitBytes: 128 * 1024 * 1024, dayLimit: -1 });
    const subscription = await fetch(`https://${host}/sub/${client.subscriptionToken}`, { headers: { accept: "text/plain", "user-agent": "exact-meter-validator" } });
    if (!subscription.ok) throw new Error(`Production subscription warm-up returned HTTP ${subscription.status}`);
    const config = {
      log: { loglevel: "warning" },
      inbounds: [{ listen: "127.0.0.1", port: socksPort, protocol: "socks", settings: { auth: "noauth", udp: false } }],
      outbounds: [{
        protocol: "vless",
        settings: { vnext: [{ address: host, port: 443, users: [{ id: client.vlessUuid, encryption: "none" }] }] },
        streamSettings: { network: "ws", security: "tls", tlsSettings: { serverName: host, allowInsecure: false }, wsSettings: { path: `/vless/${client.connectionToken}`, headers: { Host: host } } },
      }],
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    const configTest = spawnSync(xrayBinary, ["run", "-test", "-c", configPath], { encoding: "utf8" });
    if (configTest.status !== 0) throw new Error(`Measurement config is invalid: ${configTest.stderr || configTest.stdout}`);
    xray = spawn(xrayBinary, ["run", "-c", configPath], { stdio: ["ignore", "ignore", "pipe"] });
    await waitForPort(socksPort);
    const transfer = spawn("curl", ["--fail", "--silent", "--show-error", "--max-time", "90", "--proxy", `socks5h://127.0.0.1:${socksPort}`, "https://speed.cloudflare.com/__down?bytes=8388608", "-o", "/dev/null"], { stdio: ["ignore", "ignore", "pipe"] });
    const stderr = [];
    transfer.stderr.on("data", chunk => stderr.push(chunk.toString()));
    const exitCode = await new Promise(resolve => transfer.once("exit", resolve));
    if (exitCode !== 0) throw new Error(`Exact-size download failed: ${stderr.join("")}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 1_000));
    const measured = await getGatewayClientById(client.id);
    if (!measured) throw new Error("Measurement client disappeared before reading usage");
    console.log(JSON.stringify({ expectedPayloadBytes: expectedBytes, recordedBridgeBytes: measured.trafficUsedBytes, ratio: measured.trafficUsedBytes / expectedBytes }));
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
