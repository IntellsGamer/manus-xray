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

export type LiveSessionGroup = {
  clientId: number;
  protocol: string;
  sourceGroup: string;
  tunnelCount: number;
  uplinkBytes: number;
  downlinkBytes: number;
  startedAt: Date | string;
  lastSeenAt: Date | string;
};

type LiveSessionsPanelProps = {
  clients: ClientPolicyTarget[];
  groups: LiveSessionGroup[];
  streamConnected: boolean;
  pending: boolean;
  onDisconnectGroup: (group: LiveSessionGroup) => void;
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

export function LiveSessionsPanel({ clients, groups, streamConnected, pending, onDisconnectGroup, onSaveAllowedProtocols }: LiveSessionsPanelProps) {
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

  return <div className="protocol-shell min-h-full"><div className="mx-auto max-w-6xl space-y-5 py-2 sm:py-5">
    <header className="protocol-header flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><div className="protocol-overline text-primary">Gateway administration</div><h1 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Live control</h1><p className="mt-2 text-sm text-muted-foreground">Monitor grouped VPN tunnels and control which protocols each client may use.</p></div><Badge variant="outline" className={streamConnected ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"}>{streamConnected ? "Live stream connected" : "Connecting live stream"}</Badge></header>

    <section className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
      <div className="protocol-panel overflow-hidden"><div className="flex items-start justify-between gap-4 px-5 pb-4 pt-5 sm:px-6"><div><p className="protocol-overline">Tunnel control</p><h2 className="mt-1 flex items-center gap-2 text-lg font-semibold"><Radio className="h-4.5 w-4.5 text-primary" />Live VPN sessions</h2><p className="mt-1 text-sm text-muted-foreground">Parallel Cloudflare tunnels from one client and source network are combined into a single control row.</p></div><Badge variant="outline" className="shrink-0 border-primary/30 bg-primary/10 text-primary">{groups.length} groups</Badge></div>{groups.length ? <div className="divide-y border-t border-border">{groups.map(group => { const client = clients.find(item => item.id === group.clientId); return <div key={`${group.clientId}:${group.protocol}:${group.sourceGroup}`} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium">{client?.name || "Deleted client"}</span><Badge variant="outline" className="font-mono text-[10px]">{protocolLabel[group.protocol as ClientProtocol] || group.protocol}</Badge><span className="text-[11px] text-muted-foreground">{group.tunnelCount} tunnel{group.tunnelCount === 1 ? "" : "s"}</span></div><p className="mt-1 text-xs text-muted-foreground"><span className="font-mono">{group.sourceGroup}</span> · connected {formatDuration(group.startedAt)} · {formatBytes(group.uplinkBytes + group.downlinkBytes)} transferred</p></div><Button type="button" size="sm" variant="outline" className="justify-self-start text-destructive hover:text-destructive sm:justify-self-end" disabled={pending} onClick={() => onDisconnectGroup(group)}><WifiOff className="mr-1.5 h-3.5 w-3.5" />Disconnect group</Button></div>; })}</div> : <div className="border-t border-border px-5 py-10 text-center text-sm text-muted-foreground sm:px-6">No named-client tunnel is active on any current gateway instance.</div>}</div>

      <div className="protocol-panel overflow-hidden"><div className="px-5 pb-4 pt-5 sm:px-6"><p className="protocol-overline">Access policy</p><h2 className="mt-1 text-lg font-semibold">Per-client protocols</h2><p className="mt-1 text-sm text-muted-foreground">Only saved selections are published in subscriptions and accepted by the gateway.</p></div><div className="divide-y border-t border-border">{clients.map(client => { const selected = drafts[client.id] || []; return <div key={client.id} className="px-5 py-4 sm:px-6"><div className="flex items-center justify-between gap-3"><span className="min-w-0 truncate text-sm font-medium">{client.name}</span><span className="shrink-0 text-xs text-muted-foreground">{selected.length}/6 enabled</span></div><div className="mt-3 flex flex-wrap gap-x-3 gap-y-2">{protocolOrder.map(protocol => <label key={protocol} className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={selected.includes(protocol)} onChange={() => toggleProtocol(client.id, protocol)} className="accent-primary" />{protocolLabel[protocol]}</label>)}</div><div className="mt-3 flex justify-end"><Button type="button" size="sm" disabled={pending || selected.length === 0} onClick={() => onSaveAllowedProtocols(client.id, selected)}><Save className="mr-1.5 h-3.5 w-3.5" />Save protocols</Button></div></div>; })}</div></div>
    </section>
  </div></div>;
}
