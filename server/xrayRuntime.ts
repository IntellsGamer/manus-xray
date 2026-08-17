import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { ChildProcess, spawn } from "child_process";
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
    return { configPath, running: true };
  }

  await stopProcess();
  const child = spawn(xrayBinary(), ["run", "-c", configPath], {
    cwd: process.cwd(),
    detached: false,
    stdio: "ignore",
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
  return { configPath, running: true };
}

export async function stopXrayRuntime() {
  await stopProcess();
}
