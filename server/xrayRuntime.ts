import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { ChildProcess, execFile, spawn } from "child_process";
import { promisify } from "util";
import net from "net";
import type { GatewayClient, VlessProfile } from "../drizzle/schema";
import { disableGatewayClientForQuota, listGatewayClients, synchronizeGatewayClientTrafficStats } from "./db";
import { buildXrayConfig, clientSocksInboundTag, clientTrafficEmail, type TrafficProtocol } from "./vless";
import { closeActiveGatewayTunnels } from "./gatewayTunnels";

let runningProcess: ChildProcess | undefined;
let runningConfigHash: string | undefined;
const execFileAsync = promisify(execFile);

const xrayBinary = () => process.env.XRAY_BINARY_PATH || "xray";
const xrayConfigPath = () => resolve(process.env.XRAY_CONFIG_PATH || "/tmp/xray/config.json");
const runtimeEnabled = () => process.env.XRAY_RUNTIME_ENABLED === "true";
export const xrayInternalPort = () => {
  const configured = Number(process.env.XRAY_INTERNAL_PORT || "10000");
  if (!Number.isInteger(configured) || configured < 1024 || configured > 65535) {
    throw new Error("XRAY_INTERNAL_PORT must be an integer between 1024 and 65535");
  }
  return configured;
};

export const xrayStatsPort = () => xrayInternalPort() + 10;

export function getXrayRuntimeStatus() {
  const enabled = runtimeEnabled();
  const running = Boolean(runningProcess && runningProcess.exitCode === null && !runningProcess.killed);
  return { enabled, running, statsAvailable: enabled && running };
}

function safeCounter(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, Number.MAX_SAFE_INTEGER) : 0;
}

export function parseClientTrafficStats(payload: string, clients: Pick<GatewayClient, "id">[]) {
  const totals = new Map<number, number>();
  const protocols: TrafficProtocol[] = ["vless", "vmess", "trojan"];
  const emailToId = new Map(clients.flatMap(client => protocols.map(protocol => [clientTrafficEmail(client.id, protocol), client.id] as const)));
  const socksTagToId = new Map(clients.map(client => [clientSocksInboundTag(client.id), client.id] as const));
  const parsed = JSON.parse(payload) as { stat?: Array<{ name?: unknown; value?: unknown }> };
  for (const entry of parsed.stat || []) {
    if (typeof entry.name !== "string") continue;
    const userMatch = /^user>>>([^>]+)>>>traffic>>>(uplink|downlink)$/.exec(entry.name);
    const inboundMatch = /^inbound>>>([^>]+)>>>traffic>>>(uplink|downlink)$/.exec(entry.name);
    const clientId = userMatch ? emailToId.get(userMatch[1]) : inboundMatch ? socksTagToId.get(inboundMatch[1]) : undefined;
    if (!clientId) continue;
    totals.set(clientId, (totals.get(clientId) || 0) + safeCounter(entry.value));
  }
  return totals;
}

export async function getClientTrafficStats(clients: Pick<GatewayClient, "id">[]) {
  if (!runtimeEnabled() || !runningProcess || runningProcess.exitCode !== null || clients.length === 0) return null;
  try {
    const { stdout } = await execFileAsync(xrayBinary(), ["api", "statsquery", `--server=127.0.0.1:${xrayStatsPort()}`, "-pattern", ".*"] , { timeout: 1500, maxBuffer: 512 * 1024 });
    return parseClientTrafficStats(stdout, clients);
  } catch (error) {
    console.warn("[Xray] Unable to query local client traffic statistics:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Disables only clients whose backend-measured finite quota has been reached.
 * Applying the rebuilt profile restarts the local Xray process, which closes
 * in-flight tunnels and prevents the disabled credentials from reconnecting.
 */
type QuotaEnforcementDependencies = {
  listClients?: () => Promise<GatewayClient[]>;
  getTrafficStats?: (clients: Pick<GatewayClient, "id">[]) => Promise<Map<number, number> | null>;
  synchronizeTraffic?: (clients: GatewayClient[], counters: Map<number, number>) => Promise<GatewayClient[]>;
  disableClient?: (id: number) => Promise<GatewayClient>;
  applyProfile?: (profile: VlessProfile) => Promise<unknown>;
  closeTunnels?: () => number;
};

export async function enforceGatewayTrafficQuotas(profile: VlessProfile, overrides: QuotaEnforcementDependencies = {}) {
  const listClients = overrides.listClients ?? listGatewayClients;
  const disableClient = overrides.disableClient ?? disableGatewayClientForQuota;
  const applyProfile = overrides.applyProfile ?? applyXrayProfile;
  const closeTunnels = overrides.closeTunnels ?? closeActiveGatewayTunnels;
  const clients = await listClients();
  const counters = await (overrides.getTrafficStats ?? getClientTrafficStats)(clients);
  if (!counters) return { trafficUsageAvailable: false, disabledClientIds: [] as number[] };
  const sampledClients = await (overrides.synchronizeTraffic ?? synchronizeGatewayClientTrafficStats)(clients, counters);
  const exhausted = sampledClients.filter(client => {
    if (!client.enabled || client.trafficLimitBytes < 0) return false;
    return client.trafficUsedBytes >= client.trafficLimitBytes;
  });
  if (exhausted.length === 0) {
    return { trafficUsageAvailable: true, disabledClientIds: [] as number[] };
  }

  for (const client of exhausted) await disableClient(client.id);
  closeTunnels();
  await applyProfile(profile);
  return { trafficUsageAvailable: true, disabledClientIds: exhausted.map(client => client.id) };
}

async function configFor(profile: VlessProfile) {
  return buildXrayConfig(profile, xrayInternalPort(), await listGatewayClients());
}

async function stopProcess() {
  const processToStop = runningProcess;
  runningProcess = undefined;
  runningConfigHash = undefined;
  if (!processToStop || processToStop.exitCode !== null || processToStop.killed) return;

  await new Promise<void>(resolveStop => {
    const timeout = setTimeout(() => {
      processToStop.kill("SIGKILL");
      resolveStop();
    }, 5000);
    processToStop.once("exit", () => {
      clearTimeout(timeout);
      resolveStop();
    });
    processToStop.kill("SIGTERM");
  });
}

async function waitForPrivateListener(port: number, child: ChildProcess) {
  const deadline = Date.now() + 5000;
  return new Promise<void>((resolveReady, rejectReady) => {
    const attempt = () => {
      if (child.exitCode !== null) {
        rejectReady(new Error(`Xray exited before opening its private listener (code ${child.exitCode})`));
        return;
      }
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolveReady();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          rejectReady(new Error("Xray did not open its private listener within 5 seconds"));
          return;
        }
        setTimeout(attempt, 75);
      });
    };
    attempt();
  });
}

/** Writes the generated Xray JSON before any runtime process is launched. */
export async function writeXrayConfig(profile: VlessProfile) {
  const configPath = xrayConfigPath();
  const content = `${JSON.stringify(await configFor(profile), null, 2)}\n`;
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, content, { mode: 0o600 });
  return { configPath, configHash: createHash("sha256").update(content).digest("hex") };
}

/**
 * Applies a stored profile. Runtime supervision is deliberately opt-in so the
 * WebDev HTTP environment never claims to expose the separate Xray TCP port.
 */
export async function applyXrayProfile(profile: VlessProfile) {
  const { configPath, configHash } = await writeXrayConfig(profile);
  if (!runtimeEnabled()) return { configPath, running: false };

  if (runningProcess?.exitCode === null && runningConfigHash === configHash) {
    await waitForPrivateListener(xrayInternalPort(), runningProcess);
    return { configPath, running: true };
  }

  await stopProcess();
  const child = spawn(xrayBinary(), ["run", "-c", configPath], {
    cwd: process.cwd(),
    detached: false,
    stdio: ["ignore", "ignore", "pipe"],
  });
  runningProcess = child;
  runningConfigHash = configHash;
  child.once("exit", () => {
    if (runningProcess === child) {
      runningProcess = undefined;
      runningConfigHash = undefined;
    }
  });
  child.once("error", () => {
    if (runningProcess === child) {
      runningProcess = undefined;
      runningConfigHash = undefined;
    }
  });
  child.stderr?.on("data", data => console.error(`[Xray] ${data.toString().trim()}`));
  await waitForPrivateListener(xrayInternalPort(), child);
  return { configPath, running: true };
}

export async function stopXrayRuntime() {
  await stopProcess();
}
