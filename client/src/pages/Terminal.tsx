import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Clipboard, Copy, CornerDownLeft, Power, RefreshCw, ShieldCheck, TerminalSquare, Wifi, WifiOff, Zap } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

type ConnectionState = "checking" | "connecting" | "connected" | "disconnected" | "blocked";

type TerminalMessage =
  | { type: "ready"; sessionId: string }
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number; signal?: number }
  | { type: "error"; message: string };

function socketUrl(path: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

function TerminalWorkspace({ socketPath }: { socketPath: string }) {
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("checking");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [lastCloseReason, setLastCloseReason] = useState<string | null>(null);

  const sendFrame = (frame: Record<string, unknown>) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return false;
    socketRef.current.send(JSON.stringify(frame));
    return true;
  };

  const copySelection = async () => {
    const selection = terminalRef.current?.getSelection() || "";
    if (!selection) {
      toast.message("Select terminal text before copying.");
      return;
    }
    try {
      await navigator.clipboard.writeText(selection);
      toast.success("Terminal selection copied.");
    } catch {
      toast.error("Clipboard permission was not granted.");
    }
  };

  const pasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      if (!sendFrame({ type: "input", data: text })) toast.error("Terminal is not connected.");
    } catch {
      toast.error("Clipboard permission was not granted.");
    }
  };

  const fitTerminal = () => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;
    try {
      fitAddon.fit();
      sendFrame({ type: "resize", cols: terminal.cols, rows: terminal.rows });
    } catch {
      // The host can report zero dimensions during an animated layout transition.
    }
  };

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) return;

    const terminal = new XtermTerminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
      fontSize: 13,
      fontWeight: 500,
      lineHeight: 1.25,
      scrollback: 15_000,
      theme: {
        background: "#071014",
        foreground: "#d9f6ea",
        cursor: "#67e8f9",
        cursorAccent: "#071014",
        selectionBackground: "#1f5c5c88",
        black: "#112027",
        red: "#fb7185",
        green: "#86efac",
        yellow: "#fde68a",
        blue: "#7dd3fc",
        magenta: "#f0abfc",
        cyan: "#67e8f9",
        white: "#e2e8f0",
        brightBlack: "#64748b",
        brightRed: "#fda4af",
        brightGreen: "#bbf7d0",
        brightYellow: "#fef08a",
        brightBlue: "#bae6fd",
        brightMagenta: "#f5d0fe",
        brightCyan: "#a5f3fc",
        brightWhite: "#f8fafc",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => fitTerminal());
    resizeObserver.observe(host);
    requestAnimationFrame(() => fitTerminal());

    const disposeData = terminal.onData(data => sendFrame({ type: "input", data }));
    terminal.attachCustomKeyEventHandler(event => {
      if (event.type !== "keydown" || !event.ctrlKey || !event.shiftKey) return true;
      if (event.code === "KeyC") {
        event.preventDefault();
        void copySelection();
        return false;
      }
      if (event.code === "KeyV") {
        event.preventDefault();
        void pasteClipboard();
        return false;
      }
      return true;
    });

    return () => {
      resizeObserver.disconnect();
      disposeData.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    setConnectionState("connecting");
    setLastCloseReason(null);
    terminal.focus();
    const socket = new WebSocket(socketUrl(socketPath));
    socketRef.current = socket;

    socket.onopen = () => {
      setConnectionState("connected");
      fitTerminal();
    };
    socket.onmessage = event => {
      if (typeof event.data !== "string") return;
      let message: TerminalMessage;
      try {
        message = JSON.parse(event.data) as TerminalMessage;
      } catch {
        return;
      }

      if (message.type === "ready") {
        setSessionId(message.sessionId);
        terminal.focus();
        return;
      }
      if (message.type === "output") {
        terminal.write(message.data);
        return;
      }
      if (message.type === "error") {
        terminal.writeln(`\r\n\x1b[31m[${message.message}]\x1b[0m`);
        return;
      }
      terminal.writeln(`\r\n\x1b[33m[Shell exited with code ${message.exitCode}${message.signal ? `, signal ${message.signal}` : ""}.]\x1b[0m`);
    };
    socket.onerror = () => setLastCloseReason("The terminal transport could not be established.");
    socket.onclose = event => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      setSessionId(null);
      setConnectionState("disconnected");
      const reason = event.reason || "The request-scoped terminal session was closed.";
      setLastCloseReason(reason);
      terminal.writeln(`\r\n\x1b[33m[${reason} Reconnect to open a new shell.]\x1b[0m`);
    };

    return () => {
      if (socketRef.current === socket) socketRef.current = null;
      socket.close(1000, "Terminal page disposed");
    };
  }, [socketPath, connectionAttempt]);

  const reconnect = () => {
    socketRef.current?.close(1000, "Reconnect requested");
    setConnectionAttempt(value => value + 1);
  };

  const disconnect = () => {
    socketRef.current?.close(1000, "Closed by owner");
  };

  const status = connectionState === "connected"
    ? { icon: Wifi, label: "Live terminal", classes: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" }
    : connectionState === "blocked"
      ? { icon: ShieldCheck, label: "Owner device required", classes: "border-rose-400/30 bg-rose-400/10 text-rose-200" }
      : { icon: connectionState === "checking" || connectionState === "connecting" ? RefreshCw : WifiOff, label: connectionState === "connecting" ? "Connecting" : connectionState === "checking" ? "Checking access" : "Disconnected", classes: "border-slate-500/40 bg-slate-800/80 text-slate-200" };
  const StatusIcon = status.icon;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-2rem)] w-full max-w-[1700px] flex-col gap-4">
      <header className="flex flex-col gap-3 rounded-2xl border border-cyan-500/20 bg-slate-950/80 px-4 py-4 shadow-2xl shadow-cyan-950/20 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-cyan-400/25 bg-cyan-400/10 text-cyan-200">
            <TerminalSquare className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight text-slate-100 sm:text-lg">Backend terminal</h1>
            <p className="truncate text-xs text-slate-400">Interactive PTY · owner device only · isolated process environment</p>
          </div>
        </div>
        <div className={`flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${status.classes}`}>
          <StatusIcon className={`h-3.5 w-3.5 ${connectionState === "checking" || connectionState === "connecting" ? "animate-spin" : ""}`} />
          {status.label}
        </div>
      </header>

      <section className="flex min-h-[440px] flex-1 flex-col overflow-hidden rounded-2xl border border-cyan-500/20 bg-[#071014] shadow-2xl shadow-cyan-950/30">
        <div className="flex flex-col gap-3 border-b border-cyan-400/10 bg-slate-950/80 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div className="flex min-w-0 items-center gap-2 text-xs text-slate-400">
            <span className="h-2 w-2 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,.95)]" />
            <span className="truncate">{sessionId ? `Session ${sessionId.slice(0, 8)}` : lastCloseReason || "Secure interactive shell"}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 border-slate-700 bg-slate-900/70 text-slate-100 hover:bg-slate-800" onClick={() => void copySelection()}>
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
              <kbd className="ml-2 hidden rounded border border-slate-600 px-1 text-[10px] text-slate-400 sm:inline">⇧⌃C</kbd>
            </Button>
            <Button variant="outline" size="sm" className="h-8 border-slate-700 bg-slate-900/70 text-slate-100 hover:bg-slate-800" onClick={() => void pasteClipboard()}>
              <Clipboard className="mr-1.5 h-3.5 w-3.5" /> Paste
              <kbd className="ml-2 hidden rounded border border-slate-600 px-1 text-[10px] text-slate-400 sm:inline">⇧⌃V</kbd>
            </Button>
            <Button variant="outline" size="sm" className="h-8 border-slate-700 bg-slate-900/70 text-slate-100 hover:bg-slate-800" onClick={() => sendFrame({ type: "input", data: "\u0003" })} disabled={connectionState !== "connected"}>
              <Zap className="mr-1.5 h-3.5 w-3.5" /> Interrupt
            </Button>
            <Button variant="outline" size="sm" className="h-8 border-slate-700 bg-slate-900/70 text-slate-100 hover:bg-slate-800" onClick={() => sendFrame({ type: "input", data: "\u0004" })} disabled={connectionState !== "connected"}>
              <CornerDownLeft className="mr-1.5 h-3.5 w-3.5" /> EOF
            </Button>
            <Button variant="outline" size="sm" className="h-8 border-cyan-400/30 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20" onClick={reconnect} disabled={connectionState === "checking" || connectionState === "connecting" || connectionState === "blocked"}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Reconnect
            </Button>
            <Button variant="outline" size="sm" className="h-8 border-rose-400/30 bg-rose-400/10 text-rose-100 hover:bg-rose-400/20" onClick={disconnect} disabled={connectionState !== "connected"}>
              <Power className="mr-1.5 h-3.5 w-3.5" /> Close
            </Button>
          </div>
        </div>

        <div className="relative min-h-[390px] flex-1 p-2 sm:p-3">
          <div ref={terminalHostRef} className="h-full w-full overflow-hidden rounded-xl bg-[#071014] p-2 sm:p-3" />
        </div>
      </section>

      <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 pb-1 text-xs text-slate-500">
        <span>Ctrl+Shift+C copies the selection.</span>
        <span>Ctrl+Shift+V pastes clipboard content.</span>
        <span>Interactive programs receive a real PTY and resize events.</span>
      </footer>
    </div>
  );
}

export default function TerminalPage() {
  const authorization = trpc.terminal.authorize.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  if (authorization.isLoading) {
    return (
      <DashboardLayout>
        <div className="grid min-h-[calc(100dvh-2rem)] place-items-center text-sm text-muted-foreground">Checking terminal access…</div>
      </DashboardLayout>
    );
  }

  if (authorization.isError) {
    return (
      <DashboardLayout>
        <TerminalAccessPanel title="Terminal access check unavailable" description="The owner-only terminal gate could not be verified. No terminal session has been created." />
      </DashboardLayout>
    );
  }

  if (!authorization.data?.permitted) {
    return (
      <DashboardLayout>
        <TerminalAccessPanel title="Owner device verification required" description="This terminal requires the configured owner account and an active, verified owner-device session. No terminal client is loaded for this session." />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <TerminalWorkspace socketPath={authorization.data.socketPath} />
    </DashboardLayout>
  );
}

function TerminalAccessPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-[calc(100dvh-2rem)] place-items-center p-4">
      <div className="max-w-md rounded-2xl border border-rose-400/25 bg-rose-500/10 p-6 text-center">
        <ShieldCheck className="mx-auto h-7 w-7 text-rose-200" />
        <h1 className="mt-3 font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
