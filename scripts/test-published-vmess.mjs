import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [host, uuid, path = "/vmess"] = process.argv.slice(2);
if (!host || !uuid) throw new Error("Usage: test-published-vmess.mjs <host> <uuid> [path]");

const xrayBinary = process.env.XRAY_BINARY_PATH || "/home/ubuntu/xray-validation/xray/xray";
const localPort = 18188;

function waitForPort(port) {
  return new Promise((resolveReady, rejectReady) => {
    const deadline = Date.now() + 10000;
    const attempt = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolveReady(); });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) rejectReady(new Error(`Timed out waiting for local SOCKS listener on ${port}`));
        else setTimeout(attempt, 100);
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
    child.stdout.on("data", data => { stdout += data.toString(); });
    child.stderr.on("data", data => { stderr += data.toString(); });
    child.once("error", rejectRun);
    child.once("exit", code => resolveRun({ code, stdout, stderr }));
  });
}

async function main() {
  const workdir = await mkdtemp(join(tmpdir(), "published-vmess-"));
  const configPath = join(workdir, "client.json");
  const config = {
    log: { loglevel: "warning" },
    inbounds: [{ listen: "127.0.0.1", port: localPort, protocol: "socks", settings: { auth: "noauth", udp: true } }],
    outbounds: [{
      protocol: "vmess",
      settings: { address: host, port: 443, id: uuid, security: "none", level: 0 },
      streamSettings: {
        network: "ws",
        security: "tls",
        tlsSettings: { serverName: host, allowInsecure: false },
        wsSettings: { path, headers: { Host: host } },
      },
    }],
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  const client = spawn(xrayBinary, ["run", "-c", configPath], { stdio: "ignore" });
  try {
    await waitForPort(localPort);
    const request = await run("curl", ["--fail", "--silent", "--show-error", "--max-time", "30", "--proxy", `socks5h://127.0.0.1:${localPort}`, "https://example.com/"]);
    if (request.code !== 0 || !request.stdout.includes("Example Domain")) {
      throw new Error(`Published VMess transport failed: ${request.stderr || "unexpected response"}`);
    }
    console.log("Published VMess WebSocket transport passed.");
  } finally {
    client.kill("SIGTERM");
    await rm(workdir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
