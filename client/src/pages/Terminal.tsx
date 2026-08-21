import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Clipboard, Copy, CornerDownLeft, Power, RefreshCw, ShieldCheck, TerminalSquare, Wifi, WifiOff, Zap } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { resolveTerminalSelection } from "@/lib/terminalClipboard";
import { didTerminalViewportChange } from "@/lib/terminalSizing";
import { trpc } from "@/lib/trpc";

type ConnectionState = "checking" | "connecting" | "connected" | "disconnected" | "blocked";

type TerminalMessage =
  | { type: "ready"; sessionId: string }
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number; signal?: number }
  | { type: "error"; message: string };

function socketUrl(path: string, terminalTicket: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const separator = path.includes("?") ? "&" : "?";
  return `${protocol}//${window.location.host}${path}${separator}terminalTicket=${encodeURIComponent(terminalTicket)}`;
}

function TerminalWorkspace({ socketPath, terminalTicket }: { socketPath: string; terminalTicket: string }) {
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const lastViewportRef = useRef<{ width: number; height: number } | null>(null);
  const outputQueueRef = useRef<string[]>([]);
  const outputQueuedCharsRef = useRef(0);
  const outputFlushPendingRef = useRef(false);
  const renderingOutputRef = useRef(false);
  const selectionRef = useRef("");
  const [connectionState, setConnectionState] = useState<ConnectionState>("checking");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [lastCloseReason, setLastCloseReason] = useState<string | null>(null);

  const sendFrame = (frame: Record<string, unknown>) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return false;
    socketRef.current.send(JSON.stringify(frame));
    return true;
  };

  const copySelection = async (capturedSelection?: string) => {
    const selection = resolveTerminalSelection(
      capturedSelection ?? terminalRef.current?.getSelection() ?? "",
      selectionRef.current,
    );
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

  const fitTerminal = (forceResizeFrame = false) => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const host = terminalHostRef.current;
    if (!terminal || !fitAddon || !host) return;
    try {
      const viewport = {
        width: Math.floor(host.clientWidth),
        height: Math.floor(host.clientHeight),
      };
      if (viewport.width < 2 || viewport.height < 2) return;
      if (didTerminalViewportChange(lastViewportRef.current, viewport)) {
        lastViewportRef.current = viewport;
        fitAddon.fit();
      }
      const size = { cols: terminal.cols, rows: terminal.rows };
      if (size.cols > 0 && size.rows > 0 && (forceResizeFrame || lastSizeRef.current?.cols !== size.cols || lastSizeRef.current?.rows !== size.rows)) {
        lastSizeRef.current = size;
        sendFrame({ type: "resize", ...size });
      }
    } catch {
      // The host can report zero dimensions during an animated layout transition.
    }
  };

  const enqueueOutput = (data: string) => {
    if (data) {
      if (outputQueuedCharsRef.current + data.length > 256 * 1024) {
        outputQueueRef.current = [];
        outputQueuedCharsRef.current = 0;
        socketRef.current?.close(1008, "Terminal output rendered too quickly");
        return;
      }
      outputQueueRef.current.push(data);
      outputQueuedCharsRef.current += data.length;
    }
    if (outputFlushPendingRef.current) return;
    outputFlushPendingRef.current = true;

    requestAnimationFrame(() => {
      const terminal = terminalRef.current;
      const output = outputQueueRef.current.join("");
      outputQueueRef.current = [];
      outputQueuedCharsRef.current = 0;
      outputFlushPendingRef.current = false;
      if (!terminal || !output) return;

      renderingOutputRef.current = true;
      terminal.write(output, () => {
        renderingOutputRef.current = false;
        if (outputQueueRef.current.length > 0) enqueueOutput("");
      });
    });
  };

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) return;

    const terminal = new XtermTerminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
      fontSize: 13,
      fontWeight: 500,
      lineHeight: 1.25,
      scrollback: 6_000,
      theme: {
        background: "#171717",
        foreground: "#e5e5e5",
        cursor: "#f5f5f5",
        cursorAccent: "#171717",
        selectionBackground: "#73737388",
        black: "#262626",
        red: "#fb7185",
        green: "#d4d4d4",
        yellow: "#fde68a",
        blue: "#d4d4d4",
        magenta: "#d4d4d4",
        cyan: "#d4d4d4",
        white: "#e5e5e5",
        brightBlack: "#737373",
        brightRed: "#fda4af",
        brightGreen: "#e5e5e5",
        brightYellow: "#fef08a",
        brightBlue: "#e5e5e5",
        brightMagenta: "#e5e5e5",
        brightCyan: "#e5e5e5",
        brightWhite: "#f8fafc",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    let resizeFrame: number | undefined;
    const scheduleFit = () => {
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined;
        fitTerminal();
      });
    };
    const resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(host);
    scheduleFit();

    const disposeData = terminal.onData(data => {
      if (!renderingOutputRef.current) sendFrame({ type: "input", data });
    });
    const disposeSelection = terminal.onSelectionChange(() => {
      selectionRef.current = terminal.getSelection();
    });
    terminal.attachCustomKeyEventHandler(event => {
      if (event.type !== "keydown" || !event.ctrlKey || !event.shiftKey) return true;
      if (event.code === "KeyC") {
        const selection = resolveTerminalSelection(terminal.getSelection(), selectionRef.current);
        event.preventDefault();
        void copySelection(selection);
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
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      disposeData.dispose();
      disposeSelection.dispose();
      outputQueueRef.current = [];
      outputQueuedCharsRef.current = 0;
      selectionRef.current = "";
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      lastViewportRef.current = null;
      lastSizeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    setConnectionState("connecting");
    setLastCloseReason(null);
    terminal.focus();
    const socket = new WebSocket(socketUrl(socketPath, terminalTicket));
    socketRef.current = socket;

    socket.onopen = () => {
      setConnectionState("connected");
      terminal.clear();
      fitTerminal(true);
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
        enqueueOutput(message.data);
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
    };

    return () => {
      if (socketRef.current === socket) socketRef.current = null;
      socket.close(1000, "Terminal page disposed");
    };
  }, [socketPath, terminalTicket, connectionAttempt]);

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
    <div className="mx-auto flex h-[calc(100dvh-2rem)] min-h-0 w-full max-w-[1700px] flex-col gap-4 overflow-hidden">
      <header className="shrink-0 flex flex-col gap-3 rounded-2xl border border-zinc-700/80 bg-zinc-900/95 px-4 py-4 shadow-2xl shadow-black/30 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-zinc-600 bg-zinc-800 text-zinc-200">
            <TerminalSquare className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight text-slate-100 sm:text-lg">Backend terminal</h1>
            <p className="truncate text-xs text-slate-400">Interactive PTY · authenticated administrators · isolated process environment</p>
          </div>
        </div>
        <div className={`flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${status.classes}`}>
          <StatusIcon className={`h-3.5 w-3.5 ${connectionState === "checking" || connectionState === "connecting" ? "animate-spin" : ""}`} />
          {status.label}
        </div>
      </header>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-700/80 bg-[#171717] shadow-2xl shadow-black/35">
        <div className="flex flex-col gap-3 border-b border-zinc-700/80 bg-zinc-900/95 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div className="flex min-w-0 items-center gap-2 text-xs text-slate-400">
            <span className="h-2 w-2 shrink-0 rounded-full bg-zinc-300 shadow-[0_0_12px_rgba(212,212,212,.6)]" />
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
            <Button variant="outline" size="sm" className="h-8 border-zinc-600 bg-zinc-800 text-zinc-100 hover:bg-zinc-700" onClick={reconnect} disabled={connectionState === "checking" || connectionState === "connecting" || connectionState === "blocked"}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Reconnect
            </Button>
            <Button variant="outline" size="sm" className="h-8 border-rose-400/30 bg-rose-400/10 text-rose-100 hover:bg-rose-400/20" onClick={disconnect} disabled={connectionState !== "connected"}>
              <Power className="mr-1.5 h-3.5 w-3.5" /> Close
            </Button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 p-2 sm:p-3">
          <div ref={terminalHostRef} className="h-full min-h-0 w-full overflow-hidden rounded-xl bg-[#171717] p-2 sm:p-3" />
        </div>
      </section>

      <footer className="shrink-0 flex flex-wrap items-center gap-x-5 gap-y-2 px-1 pb-1 text-xs text-slate-500">
        <span>Ctrl+Shift+C copies the selection.</span>
        <span>Ctrl+Shift+V pastes clipboard content.</span>
        <span>Interactive programs receive a real PTY and resize events.</span>
        <span className="text-amber-300/80">Container filesystem changes are ephemeral and may disappear after refresh or restart.</span>
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
        <TerminalAccessPanel title="Terminal access check unavailable" description="The administrator access check could not be verified. No terminal session has been created." />
      </DashboardLayout>
    );
  }

  if (!authorization.data?.permitted) {
    return (
      <DashboardLayout>
        <TerminalAccessPanel title="Administrator access required" description="This terminal is available only to authenticated administrators. No terminal client is loaded for this session." />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <TerminalWorkspace socketPath={authorization.data.socketPath} terminalTicket={authorization.data.terminalTicket} />
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
