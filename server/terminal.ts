import { randomUUID } from "crypto";
import type { IncomingMessage, Server } from "http";
import { isIP } from "net";
import { resolve } from "path";
import type { Duplex } from "stream";
import * as pty from "node-pty";
import { WebSocketServer, type WebSocket } from "ws";
import { acquireTerminalLease, releaseTerminalLease } from "./db";
import { ENV } from "./_core/env";
import { sdk, type AuthenticatedUser } from "./_core/sdk";
import { isOwnerDeviceToken } from "./ownerDevices";

export const TERMINAL_SOCKET_PATH = "/api/terminal/socket";

const MAX_SESSIONS_PER_PROCESS = 1;
const MAX_FRAME_BYTES = 64 * 1024;
const MAX_INPUT_BYTES_PER_SECOND = 128 * 1024;
const MAX_OUTPUT_BYTES_PER_SECOND = 2 * 1024 * 1024;
const MAX_SOCKET_BUFFERED_OUTPUT_BYTES = 512 * 1024;
const MAX_IDLE_MS = 5 * 60 * 1000;
const MAX_SESSION_MS = 14 * 60 * 1000;
const MAX_COLS = 300;
const MAX_ROWS = 120;

type TerminalFrame =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "ping" };

type TerminalOutputFrame =
  | { type: "ready"; sessionId: string }
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number; signal?: number }
  | { type: "error"; message: string };

export type TerminalLeaseStore = {
  acquire: (input: { leaseId: string; ownerOpenId: string; instanceId: string; expiresAt: Date }) => Promise<boolean>;
  release: (leaseId: string, instanceId: string) => Promise<void>;
};

export function createTerminalLeaseCoordinator(
  store: TerminalLeaseStore,
  input: { leaseId: string; ownerOpenId: string; instanceId: string; expiresAt: Date },
) {
  let released = false;
  return {
    acquire: () => store.acquire(input),
    release: async () => {
      if (released) return;
      released = true;
      await store.release(input.leaseId, input.instanceId);
    },
  };
}

export function createTerminalSessionFinalizer(input: {
  releaseLease: () => Promise<void>;
  endProcess: () => void;
}) {
  let finalized = false;
  return async () => {
    if (finalized) return;
    finalized = true;
    try {
      input.endProcess();
    } finally {
      await input.releaseLease();
    }
  };
}

export class TerminalInputLimiter {
  private windowStartedAt = Date.now();
  private bytesInWindow = 0;

  accept(bytes: number, now = Date.now()) {
    if (now - this.windowStartedAt >= 1_000) {
      this.windowStartedAt = now;
      this.bytesInWindow = 0;
    }
    if (bytes < 0 || this.bytesInWindow + bytes > MAX_INPUT_BYTES_PER_SECOND) return false;
    this.bytesInWindow += bytes;
    return true;
  }
}

export class TerminalOutputLimiter {
  private windowStartedAt = Date.now();
  private bytesInWindow = 0;

  accept(bytes: number, now = Date.now()) {
    if (now - this.windowStartedAt >= 1_000) {
      this.windowStartedAt = now;
      this.bytesInWindow = 0;
    }
    if (bytes < 0 || this.bytesInWindow + bytes > MAX_OUTPUT_BYTES_PER_SECOND) return false;
    this.bytesInWindow += bytes;
    return true;
  }
}

export function isTerminalOwner(
  user: Pick<AuthenticatedUser, "openId" | "role" | "deviceToken"> | null | undefined,
  ownerOpenId = ENV.ownerOpenId,
) {
  return Boolean(
    user &&
      ownerOpenId &&
      user.role === "admin" &&
      user.openId === ownerOpenId &&
      isOwnerDeviceToken(user.deviceToken),
  );
}

function headerValue(req: IncomingMessage, name: string) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function trustedClientIp(req: IncomingMessage) {
  const cloudflareIp = headerValue(req, "cf-connecting-ip")?.trim();
  if (cloudflareIp && isIP(cloudflareIp)) return cloudflareIp;
  return req.socket.remoteAddress || "unknown";
}

export function isTerminalOriginAllowed(req: IncomingMessage) {
  const origin = headerValue(req, "origin");
  const host = headerValue(req, "host");
  if (!origin || !host) return false;

  try {
    const parsedOrigin = new URL(origin);
    const forwardedProto = headerValue(req, "x-forwarded-proto")?.split(",")[0]?.trim();
    const expectedProtocol = forwardedProto === "https" ? "https:" : (req.socket as { encrypted?: boolean }).encrypted ? "https:" : "http:";
    return parsedOrigin.host === host && parsedOrigin.protocol === expectedProtocol;
  } catch {
    return false;
  }
}

export function parseTerminalFrame(raw: WebSocket.RawData): TerminalFrame | null {
  if (Buffer.isBuffer(raw) && raw.length > MAX_FRAME_BYTES) return null;
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  if (Buffer.byteLength(text, "utf8") > MAX_FRAME_BYTES) return null;

  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
    const frame = parsed as Record<string, unknown>;
    if (frame.type === "input" && typeof frame.data === "string") return { type: "input", data: frame.data };
    if (
      frame.type === "resize" &&
      typeof frame.cols === "number" &&
      typeof frame.rows === "number" &&
      Number.isFinite(frame.cols) &&
      Number.isFinite(frame.rows)
    ) {
      return { type: "resize", cols: frame.cols, rows: frame.rows };
    }
    if (frame.type === "ping") return { type: "ping" };
  } catch {
    return null;
  }
  return null;
}

function terminalEnvironment() {
  const safeHome = process.env.HOME || "/tmp";
  return {
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: safeHome,
    SHELL: "/bin/bash",
    HISTFILE: "/dev/null",
    PS1: "\\[\\e[38;5;81m\\]backend\\[\\e[0m\\] \\[\\e[38;5;114m\\]\\w\\[\\e[0m\\] $ ",
  };
}

function shellWorkingDirectory() {
  const configured = process.env.TERMINAL_CWD;
  return configured ? resolve(configured) : process.cwd();
}

function send(socket: WebSocket, frame: TerminalOutputFrame) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
}

function rejectUpgrade(socket: Duplex, status: number, reason: string) {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

const terminalSockets = new Set<WebSocket>();
const terminalWss = new WebSocketServer({ noServer: true, clientTracking: false, maxPayload: MAX_FRAME_BYTES });
const terminalInstanceId = randomUUID();

function startTerminal(socket: WebSocket, releaseLease: () => Promise<void>) {
  const sessionId = randomUUID();
  const inputLimiter = new TerminalInputLimiter();
  const outputLimiter = new TerminalOutputLimiter();
  let closed = false;
  let lastActivityAt = Date.now();
  let ptyProcess: pty.IPty;
  const finalizeSession = createTerminalSessionFinalizer({
    releaseLease,
    endProcess: () => {
      try {
        ptyProcess.kill("SIGHUP");
      } catch {
        // The process may have already exited.
      }
    },
  });

  const shutdown = (code = 1000, reason = "Terminal session closed") => {
    if (closed) return;
    closed = true;
    terminalSockets.delete(socket);
    void finalizeSession().catch(() => undefined);
    clearInterval(idleTimer);
    clearTimeout(maxAgeTimer);
    if (socket.readyState === socket.OPEN || socket.readyState === socket.CLOSING) socket.close(code, reason);
  };

  try {
    ptyProcess = pty.spawn("/bin/bash", ["--noprofile", "--norc", "-i"], {
      name: "xterm-256color",
      cols: 120,
      rows: 34,
      cwd: shellWorkingDirectory(),
      env: terminalEnvironment(),
    });
  } catch {
    terminalSockets.delete(socket);
    void releaseLease().catch(() => undefined);
    send(socket, { type: "error", message: "Terminal process could not be started." });
    socket.close(1011, "Terminal start failed");
    return;
  }

  const idleTimer = setInterval(() => {
    if (Date.now() - lastActivityAt >= MAX_IDLE_MS) shutdown(1000, "Idle terminal session expired");
  }, 30_000);
  const maxAgeTimer = setTimeout(() => shutdown(1000, "Terminal session expired"), MAX_SESSION_MS);

  ptyProcess.onData(data => {
    const bytes = Buffer.byteLength(data, "utf8");
    if (!outputLimiter.accept(bytes) || socket.bufferedAmount + bytes > MAX_SOCKET_BUFFERED_OUTPUT_BYTES) {
      shutdown(1008, "Terminal output limit exceeded");
      return;
    }
    send(socket, { type: "output", data });
  });
  ptyProcess.onExit(({ exitCode, signal }) => {
    send(socket, { type: "exit", exitCode, signal });
    shutdown(1000, "Terminal process exited");
  });

  socket.on("message", raw => {
    const frame = parseTerminalFrame(raw);
    if (!frame) {
      shutdown(1008, "Malformed terminal frame");
      return;
    }
    lastActivityAt = Date.now();

    if (frame.type === "input") {
      const inputBytes = Buffer.byteLength(frame.data, "utf8");
      if (!inputLimiter.accept(inputBytes) || inputBytes > MAX_FRAME_BYTES) {
        shutdown(1008, "Terminal input limit exceeded");
        return;
      }
      ptyProcess.write(frame.data);
      return;
    }
    if (frame.type === "resize") {
      const cols = Math.max(2, Math.min(MAX_COLS, Math.floor(frame.cols)));
      const rows = Math.max(1, Math.min(MAX_ROWS, Math.floor(frame.rows)));
      ptyProcess.resize(cols, rows);
    }
  });
  socket.once("close", () => shutdown());
  socket.once("error", () => shutdown(1011, "Terminal transport error"));

  send(socket, { type: "ready", sessionId });
}

async function handleTerminalUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  if (!isTerminalOriginAllowed(req)) {
    rejectUpgrade(socket, 403, "Forbidden");
    return;
  }

  let user: AuthenticatedUser;
  try {
    user = await sdk.authenticateRequest(req as Parameters<typeof sdk.authenticateRequest>[0]);
  } catch {
    rejectUpgrade(socket, 401, "Unauthorized");
    return;
  }

  if (!isTerminalOwner(user)) {
    rejectUpgrade(socket, 403, "Forbidden");
    return;
  }

  if (terminalSockets.size >= MAX_SESSIONS_PER_PROCESS) {
    rejectUpgrade(socket, 429, "Too Many Requests");
    return;
  }

  const lease = createTerminalLeaseCoordinator({
    acquire: acquireTerminalLease,
    release: releaseTerminalLease,
  }, {
    leaseId: randomUUID(),
    ownerOpenId: user.openId,
    instanceId: terminalInstanceId,
    expiresAt: new Date(Date.now() + MAX_SESSION_MS),
  });
  const acquired = await lease.acquire().catch(() => false);
  if (!acquired) {
    rejectUpgrade(socket, 429, "Too Many Requests");
    return;
  }

  terminalWss.handleUpgrade(req, socket, head, websocket => {
    terminalSockets.add(websocket);
    console.info(`[Terminal] Session opened for owner from ${trustedClientIp(req)}.`);
    startTerminal(websocket, lease.release);
  });
}

export function registerTerminalWebSocket(server: Server) {
  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url || "/", "http://terminal.local").pathname;
    if (pathname !== TERMINAL_SOCKET_PATH) return;
    void handleTerminalUpgrade(req, socket, head).catch(() => socket.destroy());
  });
}
