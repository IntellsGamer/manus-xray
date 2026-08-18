import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { resolve } from "node:path";
import { buildSocksClientConfig, buildXrayConfig } from "../server/vless.ts";
import { registerVlessUpgradeProxy } from "../server/vlessUpgradeProxy.ts";

const xrayBinary = process.env.XRAY_BINARY_PATH || "/home/ubuntu/xray-validation/xray/xray";
const workDir = resolve("/tmp/nginx-vless-xray-check");
const uuid = "51dc1a8e-0667-4ed5-aa36-15c8c5a85125";
const serverPort = 18080;
const socksPort = 18181;
const vmessSocksPort = 18184;
const directVmessSocksPort = 18185;
const remoteSocksPort = 18186;
const trojanSocksPort = 18187;
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
  globalProfileEnabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const temporaryQuotaClient = {
  id: 99,
  name: "Temporary 1 MB quota validation",
  enabled: true,
  vlessUuid: "2f2c37ad-5b4c-4f70-90cc-0eb2d4d2b3ca",
  vmessUuid: "d9f5c469-3905-4796-b0f5-270fc889d5e4",
  trojanPassword: "temporary-quota-trojan-password",
  socksUsername: "temporary-quota-client",
  socksPassword: "temporary-quota-socks-password",
  subscriptionToken: "temporary_quota_validation_token_00",
  connectionToken: "temporary-quota-route-token",
  trafficLimitBytes: 1024 * 1024,
  trafficUsedBytes: 0,
  trafficStatsSnapshotBytes: 0,
  dayLimit: -1,
  speedLimitMbps: -1,
  connectionLimit: -1,
  expiresAt: null,
  lastSubscriptionAt: null,
  subscriptionDeliveryCount: 0,
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

function assertWebSocketHandshake(port, path = "/vless") {
  return new Promise((resolveHandshake, rejectHandshake) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let response = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      rejectHandshake(new Error("Timed out waiting for WebSocket upgrade response"));
    }, 5000);
    socket.on("connect", () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
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
  const child = spawn(xrayBinary, ["run", "-c", configPath], { stdio: ["ignore", "pipe", "pipe"] });
  const errors = [];
  child.stdout.on("data", () => {});
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
  const vmessClientConfigPath = resolve(workDir, "vmess-socks-client.json");
  const directVmessClientConfigPath = resolve(workDir, "direct-vmess-client.json");
  const remoteSocksClientConfigPath = resolve(workDir, "remote-socks-client.json");
  const trojanClientConfigPath = resolve(workDir, "trojan-socks-client.json");

  await writeFile(serverConfigPath, `${JSON.stringify(buildXrayConfig(profile, serverPort, [temporaryQuotaClient]), null, 2)}\n`);
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
      settings: { vnext: [{ address: "127.0.0.1", port: bridgePort, users: [{ id: temporaryQuotaClient.vlessUuid, encryption: "none" }] }] },
      streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless/temporary-quota-route-token" } },
    }],
  }, null, 2)}\n`);
  const remoteSocksConfig = JSON.parse(buildSocksClientConfig(profile));
  remoteSocksConfig.inbounds[0].port = remoteSocksPort;
  remoteSocksConfig.outbounds[0].settings.servers[0].address = "127.0.0.1";
  remoteSocksConfig.outbounds[0].settings.servers[0].port = bridgePort;
  remoteSocksConfig.outbounds[0].settings.servers[0].users[0].user = temporaryQuotaClient.socksUsername;
  remoteSocksConfig.outbounds[0].settings.servers[0].users[0].pass = temporaryQuotaClient.socksPassword;
  remoteSocksConfig.outbounds[0].streamSettings.security = "none";
  remoteSocksConfig.outbounds[0].streamSettings.wsSettings.path = "/socks/temporary-quota-route-token";
  delete remoteSocksConfig.outbounds[0].streamSettings.tlsSettings;
  delete remoteSocksConfig.outbounds[0].streamSettings.wsSettings.headers;
  await writeFile(remoteSocksClientConfigPath, `${JSON.stringify(remoteSocksConfig, null, 2)}\n`);
  const vmessSocksConfig = {
    log: { loglevel: "warning" },
    inbounds: [{ listen: "127.0.0.1", port: vmessSocksPort, protocol: "socks", settings: { auth: "noauth", udp: true } }],
    outbounds: [{
      protocol: "vmess",
      settings: { address: "127.0.0.1", port: bridgePort, id: temporaryQuotaClient.vmessUuid, security: "none", level: 0 },
      streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vmess/temporary-quota-route-token" } },
    }],
  };
  await writeFile(vmessClientConfigPath, `${JSON.stringify(vmessSocksConfig, null, 2)}\n`);
  const directVmessConfig = structuredClone(vmessSocksConfig);
  directVmessConfig.inbounds[0].port = directVmessSocksPort;
  directVmessConfig.outbounds[0].settings.address = "127.0.0.1";
  directVmessConfig.outbounds[0].settings.port = serverPort + 1;
  directVmessConfig.outbounds[0].streamSettings.security = "none";
  directVmessConfig.outbounds[0].streamSettings.wsSettings.path = "/vmess";
  delete directVmessConfig.outbounds[0].streamSettings.tlsSettings;
  delete directVmessConfig.outbounds[0].streamSettings.wsSettings.headers;
  await writeFile(directVmessClientConfigPath, `${JSON.stringify(directVmessConfig, null, 2)}\n`);
  await writeFile(trojanClientConfigPath, `${JSON.stringify({
    log: { loglevel: "warning" },
    inbounds: [{ listen: "127.0.0.1", port: trojanSocksPort, protocol: "socks", settings: { auth: "noauth", udp: false } }],
    outbounds: [{
      protocol: "trojan",
      settings: { servers: [{ address: "127.0.0.1", port: bridgePort, password: temporaryQuotaClient.trojanPassword, level: 0 }] },
      streamSettings: { network: "ws", security: "none", wsSettings: { path: "/trojan/temporary-quota-route-token" } },
    }],
  }, null, 2)}\n`);

  xrayTest(serverConfigPath);
  xrayTest(clientConfigPath);
  xrayTest(vmessClientConfigPath);
  xrayTest(directVmessClientConfigPath);
  xrayTest(remoteSocksClientConfigPath);
  xrayTest(trojanClientConfigPath);

  let server;
  let client;
  let vmessClient;
  let directVmessClient;
  let remoteSocksClient;
  let trojanClient;
  let bridge;
  let probeServer;
  try {
    server = startXray(serverConfigPath, resolve(workDir, "server.log"));
    await waitForPort(serverPort);
    bridge = createServer((_request, response) => {
      response.statusCode = 404;
      response.end();
    });
    registerVlessUpgradeProxy(bridge, {
      getProfile: async () => profile,
      getClients: async () => [temporaryQuotaClient],
      applyProfile: async () => undefined,
      internalPort: () => serverPort,
    });
    await new Promise((resolveListen, rejectListen) => {
      bridge.once("error", rejectListen);
      bridge.listen(bridgePort, "127.0.0.1", resolveListen);
    });
    probeServer = createServer((_request, response) => response.end("Xray SOCKS counter probe"));
    const probePort = await new Promise((resolveListen, rejectListen) => {
      probeServer.once("error", rejectListen);
      probeServer.listen(0, "127.0.0.1", () => resolveListen(probeServer.address().port));
    });
    await assertWebSocketHandshake(bridgePort, "/vless/temporary-quota-route-token");
    await assertWebSocketHandshake(bridgePort, "/vmess/temporary-quota-route-token");
    await assertWebSocketHandshake(bridgePort, "/trojan/temporary-quota-route-token");
    client = startXray(clientConfigPath, resolve(workDir, "client.log"));
    await waitForPort(socksPort);
    vmessClient = startXray(vmessClientConfigPath, resolve(workDir, "vmess-client.log"));
    await waitForPort(vmessSocksPort);
    directVmessClient = startXray(directVmessClientConfigPath, resolve(workDir, "direct-vmess-client.log"));
    await waitForPort(directVmessSocksPort);
    remoteSocksClient = startXray(remoteSocksClientConfigPath, resolve(workDir, "remote-socks-client.log"));
    await waitForPort(remoteSocksPort);
    trojanClient = startXray(trojanClientConfigPath, resolve(workDir, "trojan-client.log"));
    await waitForPort(trojanSocksPort);

    const request = await runCommand("curl", ["--fail", "--silent", "--show-error", "--max-time", "20", "--proxy", `socks5h://127.0.0.1:${socksPort}`, "https://example.com/"]);
    if (request.code !== 0) throw new Error(`VLESS transport request failed: ${request.stderr}`);
    if (!request.stdout.includes("Example Domain")) throw new Error("Unexpected upstream response through VLESS transport");
    const directVmessRequest = await runCommand("curl", ["--fail", "--silent", "--show-error", "--max-time", "20", "--proxy", `socks5h://127.0.0.1:${directVmessSocksPort}`, "https://example.com/"]);
    if (directVmessRequest.code !== 0) throw new Error(`Direct VMess transport request failed: ${directVmessRequest.stderr}`);
    if (!directVmessRequest.stdout.includes("Example Domain")) throw new Error("Unexpected upstream response through direct VMess transport");

    const vmessRequest = await runCommand("curl", ["--fail", "--silent", "--show-error", "--max-time", "20", "--proxy", `socks5h://127.0.0.1:${vmessSocksPort}`, "https://example.com/"]);
    if (vmessRequest.code !== 0) throw new Error(`VMess SOCKS5 transport request failed: ${vmessRequest.stderr}`);
    if (!vmessRequest.stdout.includes("Example Domain")) throw new Error("Unexpected upstream response through VMess SOCKS5 transport");

    const remoteSocksRequest = await runCommand("curl", ["--fail", "--silent", "--show-error", "--max-time", "20", "--noproxy", "", "--proxy", `socks5h://127.0.0.1:${remoteSocksPort}`, `http://127.0.0.1:${probePort}/`]);
    if (remoteSocksRequest.code !== 0) throw new Error(`Remote SOCKS5 transport request failed: ${remoteSocksRequest.stderr}`);
    if (!remoteSocksRequest.stdout.includes("Xray SOCKS counter probe")) throw new Error("Unexpected upstream response through remote SOCKS5 WebSocket transport");

    const trojanRequest = await runCommand("curl", ["--fail", "--silent", "--show-error", "--max-time", "20", "--proxy", `socks5h://127.0.0.1:${trojanSocksPort}`, "https://example.com/"]);
    if (trojanRequest.code !== 0) throw new Error(`Trojan transport request failed: ${trojanRequest.stderr}`);
    if (!trojanRequest.stdout.includes("Example Domain")) throw new Error("Unexpected upstream response through Trojan WebSocket transport");

    const stats = await runCommand(xrayBinary, ["api", "statsquery", `--server=127.0.0.1:${serverPort + 10}`, "-pattern", "gateway-client-99"]);
    const counterIdentities = [
      "gateway-client-99-vless@local.invalid",
      "gateway-client-99-vmess@local.invalid",
      "gateway-client-99-trojan@local.invalid",
      "gateway-client-99-socks-in",
    ];
    if (stats.code !== 0 || counterIdentities.some(identity => !stats.stdout.includes(identity))) {
      throw new Error(`Named client Xray counter query did not include all protocol identities: ${stats.stderr || stats.stdout}`);
    }

    console.log("Xray config validation plus named VLESS, VMess, Trojan, and SOCKS5 transport requests with per-protocol Xray counter identities passed.");
  } finally {
    await stop(trojanClient);
    await stop(remoteSocksClient);
    await stop(vmessClient);
    await stop(directVmessClient);
    await stop(client);
    await stop(server);
    await new Promise(resolveClose => bridge?.close(() => resolveClose()));
    await new Promise(resolveClose => probeServer?.close(() => resolveClose()));
    const generated = JSON.parse(await readFile(serverConfigPath, "utf8"));
    if (generated.inbounds?.[0]?.settings?.clients?.[0]?.id !== uuid) {
      throw new Error("Generated config did not preserve the client UUID");
    }
    if (!generated.inbounds?.[0]?.settings?.clients?.some(client => client.id === temporaryQuotaClient.vlessUuid && client.email === "gateway-client-99-vless@local.invalid")) {
      throw new Error("Generated config did not preserve the temporary 1 MB client statistics identity");
    }
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
