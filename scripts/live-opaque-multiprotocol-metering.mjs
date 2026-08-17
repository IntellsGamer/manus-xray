import { spawn, spawnSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { createGatewayClient, deleteGatewayClient, getGatewayClientById } from "../server/db.ts";

const host = "nginxadmin-kw4zek2d.manus.space";
const xrayBinary = process.env.XRAY_BINARY_PATH || "/home/ubuntu/xray-validation/xray/xray";
const workPrefix = "/tmp/nginx-gateway-live-multiprotocol";

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

function outboundFor(client, protocol) {
  const route = `/${protocol}/${client.connectionToken}`;
  const streamSettings = {
    network: "ws",
    security: "tls",
    tlsSettings: { serverName: host, allowInsecure: false },
    wsSettings: { path: route, headers: { Host: host } },
  };
  if (protocol === "vless") {
    return { protocol, settings: { vnext: [{ address: host, port: 443, users: [{ id: client.vlessUuid, encryption: "none" }] }] }, streamSettings };
  }
  if (protocol === "vmess") {
    return { protocol, settings: { vnext: [{ address: host, port: 443, users: [{ id: client.vmessUuid, security: "none" }] }] }, streamSettings };
  }
  return { protocol, settings: { servers: [{ address: host, port: 443, password: client.trojanPassword, level: 0 }] }, streamSettings };
}

async function main() {
  let client;
  const configPaths = [];
  try {
    client = await createGatewayClient({ name: `Disposable multi-protocol route validation ${Date.now()}`, trafficLimitBytes: 2 * 1024 * 1024, dayLimit: -1 });
    const subscription = await fetch(`https://${host}/sub/${client.subscriptionToken}`, { headers: { accept: "text/plain", "user-agent": "live-multiprotocol-metering-validator" } });
    if (!subscription.ok) throw new Error(`Production subscription warm-up returned HTTP ${subscription.status}`);

    let previousUsage = 0;
    for (const [index, protocol] of ["vless", "vmess", "trojan"].entries()) {
      const socksPort = 19200 + index;
      const configPath = `${workPrefix}-${protocol}.json`;
      configPaths.push(configPath);
      const config = {
        log: { loglevel: "warning" },
        inbounds: [{ listen: "127.0.0.1", port: socksPort, protocol: "socks", settings: { auth: "noauth", udp: false } }],
        outbounds: [outboundFor(client, protocol)],
      };
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
      const configTest = spawnSync(xrayBinary, ["run", "-test", "-c", configPath], { encoding: "utf8" });
      if (configTest.status !== 0) throw new Error(`${protocol} production client config is invalid: ${configTest.stderr || configTest.stdout}`);
      const xray = spawn(xrayBinary, ["run", "-c", configPath], { stdio: ["ignore", "ignore", "pipe"] });
      try {
        await waitForPort(socksPort);
        const proxied = await run("curl", ["--fail", "--silent", "--show-error", "--max-time", "20", "--proxy", `socks5h://127.0.0.1:${socksPort}`, "https://example.com/"]);
        if (proxied.code !== 0 || !proxied.stdout.includes("Example Domain")) throw new Error(`Opaque production ${protocol} route failed: ${proxied.stderr || proxied.stdout}`);
      } finally {
        await stop(xray);
      }
      await new Promise(resolveWait => setTimeout(resolveWait, 750));
      const measured = await getGatewayClientById(client.id);
      if (!measured || measured.trafficUsedBytes <= previousUsage || measured.trafficUsedBytes >= 2 * 1024 * 1024) {
        throw new Error(`Unexpected backend meter after ${protocol}: ${measured?.trafficUsedBytes ?? "missing"}`);
      }
      const delta = measured.trafficUsedBytes - previousUsage;
      previousUsage = measured.trafficUsedBytes;
      console.log(`${protocol} opaque route recorded ${delta} backend bridge bytes.`);
    }
    console.log("Live opaque VLESS, VMess, and Trojan routes each produced a bounded backend meter increment.");
  } finally {
    if (client) await deleteGatewayClient(client.id);
    await Promise.all(configPaths.map(path => rm(path, { force: true })));
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
