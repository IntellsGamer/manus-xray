import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Radio, Save, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

export type ClientProtocol = "vless" | "xhttp" | "vmess" | "trojan" | "socks" | "shadowsocks";

const protocolOrder: ClientProtocol[] = ["vless", "xhttp", "vmess", "trojan", "socks", "shadowsocks"];
const protocolLabel: Record<ClientProtocol, string> = {
  vless: "VLESS",
  xhttp: "VLESS XHTTP",
  vmess: "VMess",
  trojan: "Trojan",
  socks: "SOCKS5",
  shadowsocks: "SS2022",
};

type ClientPolicyTarget = {
  id: number;
  name: string;
  allowedProtocols: ClientProtocol[];
};

type LiveSession = {
  id: string;
  clientId: number;
  protocol: string;
  sourceGroup: string;
  uplinkBytes: number;
  downlinkBytes: number;
  startedAt: Date | string;
  lastSeenAt: Date | string;
};

type LiveSessionsPanelProps = {
  clients: ClientPolicyTarget[];
  sessions: LiveSession[];
  pending: boolean;
  onDisconnect: (sessionId: string) => void;
  onSaveAllowedProtocols: (clientId: number, protocols: ClientProtocol[]) => void;
};

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${Math.round((bytes / 1024 ** 3) * 100) / 100} GB`;
  return `${Math.round((bytes / 1024 ** 2) * 100) / 100} MB`;
}

function formatDuration(startedAt: Date | string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : minutes > 0 ? `${minutes}m` : `${seconds}s`;
}

export function LiveSessionsPanel({ clients, sessions, pending, onDisconnect, onSaveAllowedProtocols }: LiveSessionsPanelProps) {
  const [drafts, setDrafts] = useState<Record<number, ClientProtocol[]>>({});

  useEffect(() => {
    setDrafts(Object.fromEntries(clients.map(client => [client.id, client.allowedProtocols])));
  }, [clients]);

  const toggleProtocol = (clientId: number, protocol: ClientProtocol) => {
    setDrafts(current => {
      const currentProtocols = current[clientId] || [];
      const next = currentProtocols.includes(protocol)
        ? currentProtocols.filter(item => item !== protocol)
        : protocolOrder.filter(item => [...currentProtocols, protocol].includes(item));
      return { ...current, [clientId]: next };
    });
  };

  return <section className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
    <div className="protocol-panel overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-5 sm:px-6">
        <div><p className="protocol-overline">Tunnel control</p><h2 className="mt-1 flex items-center gap-2 text-lg font-semibold"><Radio className="h-4.5 w-4.5 text-primary" />Live VPN sessions</h2><p className="mt-1 text-sm text-muted-foreground">Active bridge tunnels are grouped by client and source network. Transfer totals refresh automatically.</p></div>
        <Badge variant="outline" className="shrink-0 border-primary/30 bg-primary/10 text-primary">{sessions.length} active</Badge>
      </div>
      {sessions.length ? <div className="divide-y border-t border-border">{sessions.map(session => {
        const client = clients.find(item => item.id === session.clientId);
        return <div key={session.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium">{client?.name || "Deleted client"}</span><Badge variant="outline" className="font-mono text-[10px]">{protocolLabel[session.protocol as ClientProtocol] || session.protocol}</Badge></div><p className="mt-1 text-xs text-muted-foreground"><span className="font-mono">{session.sourceGroup}</span> · connected {formatDuration(session.startedAt)} · {formatBytes(session.uplinkBytes + session.downlinkBytes)} transferred</p></div><Button type="button" size="sm" variant="outline" className="justify-self-start text-destructive hover:text-destructive sm:justify-self-end" disabled={pending} onClick={() => onDisconnect(session.id)}><WifiOff className="mr-1.5 h-3.5 w-3.5" />Disconnect</Button></div>;
      })}</div> : <div className="border-t border-border px-5 py-10 text-center text-sm text-muted-foreground sm:px-6">No named-client tunnel is active on any current gateway instance.</div>}
    </div>

    <div className="protocol-panel overflow-hidden">
      <div className="px-5 pb-4 pt-5 sm:px-6"><p className="protocol-overline">Access policy</p><h2 className="mt-1 text-lg font-semibold">Per-client protocols</h2><p className="mt-1 text-sm text-muted-foreground">Only saved selections are published in subscriptions and accepted by the gateway.</p></div>
      <div className="divide-y border-t border-border">{clients.map(client => {
        const selected = drafts[client.id] || [];
        return <div key={client.id} className="px-5 py-4 sm:px-6"><div className="flex items-center justify-between gap-3"><span className="min-w-0 truncate text-sm font-medium">{client.name}</span><span className="shrink-0 text-xs text-muted-foreground">{selected.length}/6 enabled</span></div><div className="mt-3 flex flex-wrap gap-x-3 gap-y-2">{protocolOrder.map(protocol => <label key={protocol} className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={selected.includes(protocol)} onChange={() => toggleProtocol(client.id, protocol)} className="accent-primary" />{protocolLabel[protocol]}</label>)}</div><div className="mt-3 flex justify-end"><Button type="button" size="sm" disabled={pending || selected.length === 0} onClick={() => onSaveAllowedProtocols(client.id, selected)}><Save className="mr-1.5 h-3.5 w-3.5" />Save protocols</Button></div></div>;
      })}</div>
    </div>
  </section>;
}
