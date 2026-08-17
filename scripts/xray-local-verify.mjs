import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { resolve } from "node:path";
import { buildXrayConfig } from "../server/vless.ts";
import { registerVlessUpgradeProxy } from "../server/vlessUpgradeProxy.ts";

const xrayBinary = process.env.XRAY_BINARY_PATH || "/home/ubuntu/xray-validation/xray/xray";
const workDir = resolve("/tmp/nginx-vless-xray-check");
const uuid = "51dc1a8e-0667-4ed5-aa36-15c8c5a85125";
const serverPort = 18080;
const socksPort = 18181;
const bridgePort = 18182;
const profile = {
  id: 1,
  uuid,
  serverAddress: "127.0.0.1",
  port: serverPort,
  wsPath: "/vless",
  tlsEnabled: false,
  subscriptionToken: "local_xray_validation_token_00000",
  vmessUuid: "f0f5027c-7325-43d2-97c3-84957a7934e9",
  vmessWsPath: "/vmess",
  trojanPassword: "local-trojan-password",
  trojanWsPath: "/trojan",
  socksUsername: "gateway",
  socksPassword: "local-socks-password",
  socksWsPath: "/socks",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function waitForPort(port) {
  return new Promise((resolveWait, reject) => {
    const deadline = Date.now() + 10000;
    const tryConnection = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.end();
        resolveWait();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for ${port}`));
          return;
        }
        setTimeout(tryConnection, 100);
      });
    };
    tryConnection();
  });
}

function assertWebSocketHandshake(port) {
  return new Promise((resolveHandshake, rejectHandshake) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let response = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      rejectHandshake(new Error("Timed out waiting for WebSocket upgrade response"));
    }, 5000);
    socket.on("connect", () => {
      socket.write("GET /vless HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n");
    });
    socket.on("data", chunk => {
      response += chunk.toString("utf8");
      if (!response.includes("\r\n\r\n")) return;
      clearTimeout(timeout);
      socket.destroy();
      if (!response.startsWith("HTTP/1.1 101")) {
        rejectHandshake(new Error(`Unexpected WebSocket handshake response: ${response.split("\r\n")[0]}`));
        return;
      }
      resolveHandshake();
    });
    socket.on("error", error => {
      clearTimeout(timeout);
      rejectHandshake(error);
    });
  });
}

function xrayTest(configPath) {
  const result = spawnSync(xrayBinary, ["run", "-test", "-c", configPath], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Xray config test failed: ${result.stderr || result.stdout}`);
}

function runCommand(command, args) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.once("error", rejectCommand);
    child.once("exit", code => resolveCommand({ code, stdout, stderr }));
  });
}

function startXray(configPath, logPath) {
  const child = spawn(xrayBinary, ["run", "-c", configPath], { stdio: ["ignore", "ignore", "pipe"] });
  const errors = [];
  child.stderr.on("data", data => errors.push(data.toString()));
  child.once("exit", code => {
    if (code !== 0 && code !== null) console.error(`Xray exited (${code}): ${errors.join("")}`);
  });
  return child;
}

function stop(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise(resolveStop => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolveStop();
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveStop();
    });
    child.kill("SIGTERM");
  });
}

async function main() {
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  const serverConfigPath = resolve(workDir, "server.json");
  const clientConfigPath = resolve(workDir, "client.json");

  await writeFile(serverConfigPath, `${JSON.stringify(buildXrayConfig(profile, serverPort), null, 2)}\n`);
  await writeFile(clientConfigPath, `${JSON.stringify({
    log: { loglevel: "warning" },
    inbounds: [{
      listen: "127.0.0.1",
      port: socksPort,
      protocol: "socks",
      settings: { udp: false },
    }],
    outbounds: [{
      protocol: "vless",
      settings: { vnext: [{ address: "127.0.0.1", port: bridgePort, users: [{ id: uuid, encryption: "none" }] }] },
      streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless" } },
    }],
  }, null, 2)}\n`);

  xrayTest(serverConfigPath);
  xrayTest(clientConfigPath);

  let server;
  let client;
  let bridge;
  try {
    server = startXray(serverConfigPath, resolve(workDir, "server.log"));
    await waitForPort(serverPort);
    bridge = createServer((_request, response) => {
      response.statusCode = 404;
      response.end();
    });
    registerVlessUpgradeProxy(bridge, {
      getProfile: async () => profile,
      applyProfile: async () => undefined,
      internalPort: () => serverPort,
    });
    await new Promise((resolveListen, rejectListen) => {
      bridge.once("error", rejectListen);
      bridge.listen(bridgePort, "127.0.0.1", resolveListen);
    });
    await assertWebSocketHandshake(bridgePort);
    client = startXray(clientConfigPath, resolve(workDir, "client.log"));
    await waitForPort(socksPort);

    const request = await runCommand("curl", ["--fail", "--silent", "--show-error", "--max-time", "20", "--proxy", `socks5h://127.0.0.1:${socksPort}`, "https://example.com/"]);
    if (request.code !== 0) throw new Error(`VLESS transport request failed: ${request.stderr}`);
    if (!request.stdout.includes("Example Domain")) throw new Error("Unexpected upstream response through VLESS transport");

    console.log("Xray config validation and application WebSocket-to-VLESS loopback request passed.");
  } finally {
    await stop(client);
    await stop(server);
    await new Promise(resolveClose => bridge?.close(() => resolveClose()));
    const generated = JSON.parse(await readFile(serverConfigPath, "utf8"));
    if (generated.inbounds?.[0]?.settings?.clients?.[0]?.id !== uuid) {
      throw new Error("Generated config did not preserve the client UUID");
    }
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
