import fs from "node:fs";
import net from "node:net";
import pty from "node-pty";

const socketPath = "/tmp/nginx-vless-root-terminal.sock";
const maxFrameBytes = 64 * 1024;
const maxCols = 300;
const maxRows = 120;
let activeSession = false;

try {
  fs.unlinkSync(socketPath);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

function send(socket, frame) {
  if (!socket.destroyed) socket.write(`${JSON.stringify(frame)}\n`);
}

function boundedDimension(value, min, max) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

const server = net.createServer(socket => {
  if (activeSession) {
    send(socket, { type: "error", message: "A terminal session is already active in this instance." });
    socket.end();
    return;
  }

  activeSession = true;
  socket.setEncoding("utf8");
  let buffered = "";
  let terminal;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    activeSession = false;
    if (terminal) {
      try {
        terminal.kill("SIGHUP");
      } catch {
        // The terminal may already have exited.
      }
    }
  };

  const handle = raw => {
    let command;
    try {
      command = JSON.parse(raw);
    } catch {
      send(socket, { type: "error", message: "Invalid root terminal broker command." });
      socket.end();
      return;
    }

    if (command?.type === "start" && !terminal && Number.isFinite(command.cols) && Number.isFinite(command.rows)) {
      try {
        terminal = pty.spawn("/bin/bash", ["--noprofile", "--norc", "-i"], {
          name: "xterm-256color",
          cols: boundedDimension(command.cols, 2, maxCols),
          rows: boundedDimension(command.rows, 1, maxRows),
          cwd: "/root",
          env: {
            HOME: "/root",
            LANG: process.env.LANG || "C.UTF-8",
            PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            SHELL: "/bin/bash",
            TERM: "xterm-256color",
          },
        });
      } catch {
        send(socket, { type: "error", message: "Root terminal process could not be started." });
        socket.end();
        return;
      }
      terminal.onData(data => send(socket, { type: "output", data }));
      terminal.onExit(({ exitCode, signal }) => {
        send(socket, { type: "exit", exitCode, signal });
        socket.end();
      });
      send(socket, { type: "ready" });
      return;
    }

    if (command?.type === "input" && terminal && typeof command.data === "string" && Buffer.byteLength(command.data, "utf8") <= maxFrameBytes) {
      terminal.write(command.data);
      return;
    }

    if (command?.type === "resize" && terminal && Number.isFinite(command.cols) && Number.isFinite(command.rows)) {
      terminal.resize(boundedDimension(command.cols, 2, maxCols), boundedDimension(command.rows, 1, maxRows));
      return;
    }

    if (command?.type === "shutdown") {
      socket.end();
      return;
    }

    send(socket, { type: "error", message: "Invalid root terminal broker command." });
    socket.end();
  };

  socket.on("data", data => {
    buffered += data;
    if (Buffer.byteLength(buffered, "utf8") > maxFrameBytes) {
      send(socket, { type: "error", message: "Root terminal broker frame exceeded limit." });
      socket.end();
      return;
    }
    while (true) {
      const newlineAt = buffered.indexOf("\n");
      if (newlineAt < 0) break;
      const raw = buffered.slice(0, newlineAt);
      buffered = buffered.slice(newlineAt + 1);
      handle(raw);
    }
  });
  socket.on("close", close);
  socket.on("error", close);
});

server.listen(socketPath);
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
