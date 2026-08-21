import net from "node:net";

export const ROOT_TERMINAL_SOCKET_PATH = "/tmp/nginx-vless-root-terminal.sock";

export type RootTerminalBrokerFrame =
  | { type: "ready" }
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number; signal?: number }
  | { type: "error"; message: string };

type RootTerminalBrokerCommand =
  | { type: "start"; cols: number; rows: number }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "shutdown" };

export function parseRootTerminalBrokerFrame(raw: string): RootTerminalBrokerFrame | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.type === "ready") return { type: "ready" };
    if (value.type === "output" && typeof value.data === "string") return { type: "output", data: value.data };
    if (value.type === "exit" && typeof value.exitCode === "number" && (typeof value.signal === "number" || value.signal === undefined)) {
      return { type: "exit", exitCode: value.exitCode, signal: value.signal as number | undefined };
    }
    if (value.type === "error" && typeof value.message === "string") return { type: "error", message: value.message };
  } catch {
    // The root broker connection is invalid and must not be trusted.
  }
  return null;
}

export type RootTerminalBrokerSession = {
  start: (cols: number, rows: number) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
};

type RootTerminalBrokerHandlers = {
  onFrame: (frame: RootTerminalBrokerFrame) => void;
  onError: (error: Error) => void;
};

export function connectRootTerminalBroker(handlers: RootTerminalBrokerHandlers): Promise<RootTerminalBrokerSession> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(ROOT_TERMINAL_SOCKET_PATH);
    let connected = false;
    let closedByCaller = false;
    let queued = "";

    const send = (frame: RootTerminalBrokerCommand) => {
      if (socket.destroyed) throw new Error("Root terminal broker is unavailable");
      socket.write(`${JSON.stringify(frame)}\n`);
    };

    socket.setEncoding("utf8");
    socket.once("connect", () => {
      connected = true;
      resolve({
        start: (cols, rows) => send({ type: "start", cols, rows }),
        write: data => send({ type: "input", data }),
        resize: (cols, rows) => send({ type: "resize", cols, rows }),
        close: () => {
          closedByCaller = true;
          if (!socket.destroyed) {
            try {
              send({ type: "shutdown" });
            } catch {
              // The connection has already been closed by the root broker.
            }
            socket.end();
          }
        },
      });
    });
    socket.on("data", data => {
      queued += data;
      while (true) {
        const newlineAt = queued.indexOf("\n");
        if (newlineAt < 0) break;
        const raw = queued.slice(0, newlineAt);
        queued = queued.slice(newlineAt + 1);
        const frame = parseRootTerminalBrokerFrame(raw);
        if (!frame) {
          socket.destroy(new Error("Root terminal broker sent an invalid frame"));
          return;
        }
        handlers.onFrame(frame);
      }
      if (queued.length > 1_048_576) socket.destroy(new Error("Root terminal broker frame exceeded limit"));
    });
    socket.on("error", error => {
      if (!connected) reject(error);
      else if (!closedByCaller) handlers.onError(error);
    });
    socket.on("close", () => {
      if (connected && !closedByCaller) handlers.onError(new Error("Root terminal broker connection closed"));
    });
  });
}
