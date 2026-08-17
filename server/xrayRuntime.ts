import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { ChildProcess, spawn } from "child_process";
import net from "net";
import type { VlessProfile } from "../drizzle/schema";
import { buildXrayConfig } from "./vless";

let runningProcess: ChildProcess | undefined;
let runningConfigHash: string | undefined;

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

function configFor(profile: VlessProfile) {
  return buildXrayConfig(profile, xrayInternalPort());
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
  const content = `${JSON.stringify(configFor(profile), null, 2)}\n`;
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
