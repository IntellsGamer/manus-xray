import { randomUUID } from "crypto";
import type { IncomingMessage, Server } from "http";
import { isIP } from "net";
import type { Duplex } from "stream";
import { WebSocketServer, type WebSocket } from "ws";
import { acquireTerminalLease, releaseTerminalLease } from "./db";
import { sdk, type AuthenticatedUser } from "./_core/sdk";
import { connectRootTerminalBroker, type RootTerminalBrokerSession } from "./rootTerminalBroker";

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
const TERMINAL_REFRESH_GRACE_ATTEMPTS = 24;
const TERMINAL_REFRESH_GRACE_DELAY_MS = 100;

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

export async function waitForTerminalAvailability(
  check: () => boolean | Promise<boolean>,
  options: {
    attempts?: number;
    wait?: () => Promise<void>;
  } = {},
) {
  const attempts = options.attempts ?? TERMINAL_REFRESH_GRACE_ATTEMPTS;
  const wait = options.wait ?? (() => new Promise<void>(resolve => setTimeout(resolve, TERMINAL_REFRESH_GRACE_DELAY_MS)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return true;
    if (attempt < attempts - 1) await wait();
  }
  return false;
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

export function isTerminalAdministrator(
  user: Pick<AuthenticatedUser, "role"> | null | undefined,
) {
  return user?.role === "admin";
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
  const forwardedHost = headerValue(req, "x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || headerValue(req, "host");
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

async function startTerminal(socket: WebSocket, releaseLease: () => Promise<void>) {
  const sessionId = randomUUID();
  const inputLimiter = new TerminalInputLimiter();
  const outputLimiter = new TerminalOutputLimiter();
  let closed = false;
  let lastActivityAt = Date.now();
  let rootTerminal: RootTerminalBrokerSession | undefined;
  let queuedOutput = "";
  let outputFlushTimer: NodeJS.Timeout | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  let maxAgeTimer: NodeJS.Timeout | undefined;
  const flushOutput = () => {
    outputFlushTimer = undefined;
    if (closed || !queuedOutput) return;
    const data = queuedOutput;
    queuedOutput = "";
    send(socket, { type: "output", data });
  };
  const finalizeSession = createTerminalSessionFinalizer({
    releaseLease,
    endProcess: () => {
      try {
        rootTerminal?.close();
      } catch {
        // The broker may have already ended the PTY.
      }
    },
  });

  const shutdown = (code = 1000, reason = "Terminal session closed") => {
    if (closed) return;
    closed = true;
    terminalSockets.delete(socket);
    void finalizeSession().catch(() => undefined);
    if (idleTimer) clearInterval(idleTimer);
    if (maxAgeTimer) clearTimeout(maxAgeTimer);
    if (outputFlushTimer) clearTimeout(outputFlushTimer);
    if (socket.readyState === socket.OPEN || socket.readyState === socket.CLOSING) socket.close(code, reason);
  };

  try {
    rootTerminal = await connectRootTerminalBroker({
      onFrame: frame => {
        if (frame.type === "output") {
          const bytes = Buffer.byteLength(frame.data, "utf8");
          if (!outputLimiter.accept(bytes) || socket.bufferedAmount + Buffer.byteLength(queuedOutput, "utf8") + bytes > MAX_SOCKET_BUFFERED_OUTPUT_BYTES) {
            shutdown(1008, "Terminal output limit exceeded");
            return;
          }
          queuedOutput += frame.data;
          if (!outputFlushTimer) outputFlushTimer = setTimeout(flushOutput, 16);
          return;
        }
        if (frame.type === "exit") {
          flushOutput();
          send(socket, { type: "exit", exitCode: frame.exitCode, signal: frame.signal });
          shutdown(1000, "Terminal process exited");
          return;
        }
        if (frame.type === "error") {
          send(socket, { type: "error", message: frame.message });
          shutdown(1011, "Root terminal broker error");
          return;
        }
        if (frame.type === "ready") send(socket, { type: "ready", sessionId });
      },
      onError: () => shutdown(1011, "Root terminal broker unavailable"),
    });
    if (closed) {
      rootTerminal.close();
      return;
    }
    rootTerminal.start(120, 34);
  } catch {
    terminalSockets.delete(socket);
    void releaseLease().catch(() => undefined);
    send(socket, { type: "error", message: "Terminal process could not be started." });
    socket.close(1011, "Terminal start failed");
    return;
  }

  idleTimer = setInterval(() => {
    if (Date.now() - lastActivityAt >= MAX_IDLE_MS) shutdown(1000, "Idle terminal session expired");
  }, 30_000);
  maxAgeTimer = setTimeout(() => shutdown(1000, "Terminal session expired"), MAX_SESSION_MS);

  socket.on("message", raw => {
    if (closed) return;
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
      try {
        rootTerminal.write(frame.data);
      } catch {
        shutdown(1011, "Terminal process is no longer available");
      }
      return;
    }
    if (frame.type === "resize") {
      const cols = Math.max(2, Math.min(MAX_COLS, Math.floor(frame.cols)));
      const rows = Math.max(1, Math.min(MAX_ROWS, Math.floor(frame.rows)));
      try {
        rootTerminal.resize(cols, rows);
      } catch {
        shutdown(1000, "Terminal process exited before resize completed");
      }
    }
  });
  socket.once("close", () => shutdown());
  socket.once("error", () => shutdown(1011, "Terminal transport error"));

}

async function handleTerminalUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  if (!isTerminalOriginAllowed(req)) {
    console.warn(`[Terminal] Rejected upgrade due to origin mismatch (origin=${headerValue(req, "origin") ?? "missing"}, host=${headerValue(req, "host") ?? "missing"}, forwardedHost=${headerValue(req, "x-forwarded-host") ?? "missing"}).`);
    rejectUpgrade(socket, 403, "Forbidden");
    return;
  }

  let user: AuthenticatedUser;
  try {
    const requestUrl = new URL(req.url || TERMINAL_SOCKET_PATH, "http://terminal.local");
    const terminalTicket = requestUrl.searchParams.get("terminalTicket");
    const ticketRequest = terminalTicket
      ? { ...req, headers: { ...req.headers, authorization: `Bearer ${terminalTicket}` } }
      : req;
    user = await sdk.authenticateRequest(ticketRequest as Parameters<typeof sdk.authenticateRequest>[0]);
  } catch {
    console.warn("[Terminal] Rejected upgrade because terminal authentication failed.");
    rejectUpgrade(socket, 401, "Unauthorized");
    return;
  }

  if (!isTerminalAdministrator(user)) {
    console.warn("[Terminal] Rejected upgrade because the authenticated user is not an administrator.");
    rejectUpgrade(socket, 403, "Forbidden");
    return;
  }

  const slotAvailable = await waitForTerminalAvailability(() => terminalSockets.size < MAX_SESSIONS_PER_PROCESS);
  if (!slotAvailable) {
    console.warn("[Terminal] Rejected upgrade because this instance already has an active terminal session.");
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
  const acquired = await waitForTerminalAvailability(() => lease.acquire().catch(() => false));
  if (!acquired) {
    console.warn("[Terminal] Rejected upgrade because another instance holds the terminal lease.");
    rejectUpgrade(socket, 429, "Too Many Requests");
    return;
  }

  terminalWss.handleUpgrade(req, socket, head, websocket => {
    terminalSockets.add(websocket);
    console.info(`[Terminal] Session opened for administrator from ${trustedClientIp(req)}.`);
    void startTerminal(websocket, lease.release);
  });
}

export function registerTerminalWebSocket(server: Server) {
  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url || "/", "http://terminal.local").pathname;
    if (pathname !== TERMINAL_SOCKET_PATH) return;
    void handleTerminalUpgrade(req, socket, head).catch(() => socket.destroy());
  });
}
