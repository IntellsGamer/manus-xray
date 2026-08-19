import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { GatewaySubscriptionPanel } from "@/components/GatewaySubscriptionPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { startLogin } from "@/const";
import { useTheme } from "@/contexts/ThemeContext";
import { buildQrDataUrl } from "@/lib/qr";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronRight,
  Clipboard,
  Code2,
  Copy,
  FileKey2,
  KeyRound,
  Link2,
  LockKeyhole,
  Moon,
  Network,
  QrCode,
  RefreshCw,
  Save,
  ServerCog,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type EditableProfile = { serverAddress: string; port: string; wsPath: string; tlsEnabled: boolean };
type ProtocolKey = "vless" | "vmess" | "trojan" | "socks" | "shadowsocks";
type QrPayload = { name: string; description: string; value: string } | null;

const protocolMeta: Record<ProtocolKey, { label: string; title: string; accent: string; detail: string }> = {
  vless: { label: "VLESS", title: "VLESS / WebSocket", accent: "cyan", detail: "UUID credentials over a WebSocket transport." },
  vmess: { label: "VMess", title: "VMess / WebSocket", accent: "violet", detail: "QR-ready VMess profile with a dedicated UUID." },
  trojan: { label: "Trojan", title: "Trojan / WebSocket", accent: "amber", detail: "Password-authenticated transport with a separate path." },
  socks: { label: "SOCKS5", title: "SOCKS5 remote endpoint", accent: "emerald", detail: "Authenticated remote SOCKS5 over its dedicated WebSocket path." },
  shadowsocks: { label: "Shadowsocks", title: "Shadowsocks 2022 / WebSocket", accent: "rose", detail: "Replay-protected Shadowsocks 2022 credentials over a dedicated WebSocket path." },
};

function copyValue(value: string, label: string) {
  navigator.clipboard.writeText(value).then(
    () => toast.success(`${label} copied`),
    () => toast.error(`Could not copy ${label.toLowerCase()}`),
  );
}

function QrImportDialog({ payload, onOpenChange }: { payload: QrPayload; onOpenChange: (open: boolean) => void }) {
  const [image, setImage] = useState("");
  useEffect(() => {
    if (!payload) { setImage(""); return; }
    buildQrDataUrl(payload.value).then(setImage).catch(() => toast.error("Could not generate the QR code"));
  }, [payload]);

  return (
    <Dialog open={Boolean(payload)} onOpenChange={onOpenChange}>
      <DialogContent className="protocol-dialog max-w-md">
        <DialogHeader>
          <DialogTitle>{payload?.name} import QR</DialogTitle>
          <DialogDescription>{payload?.description}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-center py-3">
          {image ? <img src={image} alt={`${payload?.name} connection QR code`} className="h-64 w-64 rounded-xl bg-white p-3 shadow-xl" /> : <Skeleton className="h-64 w-64" />}
        </div>
        <p className="rounded-lg border border-border bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">Scan with a compatible client, or copy the raw import data below. The SOCKS5 code contains an Xray client configuration rather than a universal URI.</p>
        <Button variant="outline" onClick={() => payload && copyValue(payload.value, `${payload.name} import data`)}><Copy className="mr-2 h-4 w-4" />Copy import data</Button>
      </DialogContent>
    </Dialog>
  );
}

function CodePane({ label, value, qrDescription, onQr, compact = false }: { label: string; value: string; qrDescription: string; onQr: () => void; compact?: boolean }) {
  let remoteSocksDetails: { endpoint: string; username: string; password: string; path: string } | null = null;
  if (label === "Xray client JSON") {
    try {
      const config = JSON.parse(value);
      const server = config.outbounds?.[0]?.settings?.servers?.[0];
      const path = config.outbounds?.[0]?.streamSettings?.wsSettings?.path;
      if (server?.address && server?.port && server?.users?.[0]?.user && server?.users?.[0]?.pass && path) {
        remoteSocksDetails = {
          endpoint: `${server.address}:${server.port}`,
          username: server.users[0].user,
          password: server.users[0].pass,
          path,
        };
      }
    } catch {
      remoteSocksDetails = null;
    }
  }

  return (
    <div className="protocol-code-pane">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="protocol-overline">{label}</span>
        <div className="flex items-center gap-1">
          <button type="button" className="icon-action" onClick={onQr} aria-label={`Open ${label} QR code`} title={qrDescription}><QrCode className="h-3.5 w-3.5" /></button>
          <button type="button" className="icon-action" onClick={() => copyValue(value, label)} aria-label={`Copy ${label}`}><Copy className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <code className={compact ? "line-clamp-2 block break-all font-mono text-[11px] leading-5" : "block max-h-28 overflow-auto break-all font-mono text-[11px] leading-5"}>{value}</code>
      {remoteSocksDetails && <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
        {([['Remote endpoint', remoteSocksDetails.endpoint], ['Username', remoteSocksDetails.username], ['Password', remoteSocksDetails.password], ['WebSocket path', remoteSocksDetails.path]] as const).map(([detailLabel, detailValue]) => <button type="button" key={detailLabel} onClick={() => copyValue(detailValue, detailLabel)} className="rounded-md bg-background/60 px-2 py-1.5 text-left transition-colors hover:bg-accent"><span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{detailLabel}</span><code className="block truncate text-[11px] text-foreground">{detailValue}</code></button>)}
      </div>}
    </div>
  );
}

function ThemeControl() {
  const { theme, preference, setPreference, toggleTheme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <div className="theme-control" aria-label="Theme controls">
      <button type="button" onClick={toggleTheme} className="theme-icon-button" aria-label={`Switch to ${next} mode`}>
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
      <select value={preference} onChange={event => setPreference(event.target.value as "system" | "light" | "dark")} className="theme-select" aria-label="Theme preference">
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>
  );
}

function AdminLoading() {
  return <div className="protocol-shell min-h-screen p-6"><div className="mx-auto max-w-7xl space-y-5"><Skeleton className="h-12 w-72" /><div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div><Skeleton className="h-[30rem]" /></div></div>;
}

function SignInRequired() {
  return <div className="protocol-shell grid min-h-screen place-items-center p-6"><div className="protocol-panel w-full max-w-md p-8 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary"><LockKeyhole className="h-5 w-5" /></div><h1 className="mt-6 text-2xl font-semibold tracking-tight">Restricted control surface</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Authenticate with the configured owner account to manage gateway profiles.</p><Button onClick={() => startLogin()} className="mt-7 w-full">Continue with Manus</Button></div></div>;
}

function Forbidden() {
  return <div className="protocol-shell grid min-h-screen place-items-center p-6"><div className="protocol-panel w-full max-w-md p-8 text-center"><ShieldCheck className="mx-auto h-8 w-8 text-amber-500" /><h1 className="mt-5 text-2xl font-semibold">Owner access required</h1><p className="mt-3 text-sm text-muted-foreground">Your signed-in account cannot access this gateway.</p></div></div>;
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Activity; label: string; value: string; detail: string }) {
  return <article className="protocol-panel metric-card"><div><p className="protocol-overline">{label}</p><p className="mt-3 text-lg font-semibold tracking-tight">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div><span className="metric-icon"><Icon className="h-4 w-4" /></span></article>;
}

function AdminContent() {
  const utils = trpc.useUtils();
  const { data: profile, isLoading, error } = trpc.vless.get.useQuery(undefined, { retry: false });
  const [form, setForm] = useState<EditableProfile>({ serverAddress: "", port: "443", wsPath: "/vless", tlsEnabled: true });
  const [activeProtocol, setActiveProtocol] = useState<ProtocolKey>("vless");
  const [qrPayload, setQrPayload] = useState<QrPayload>(null);

  useEffect(() => {
    document.title = "Gateway Control";
  }, []);
  useEffect(() => { if (profile) setForm({ serverAddress: profile.serverAddress, port: String(profile.port), wsPath: profile.wsPath, tlsEnabled: profile.tlsEnabled }); }, [profile]);
  const refresh = () => utils.vless.get.invalidate();
  const updateMutation = trpc.vless.update.useMutation({ onSuccess: () => { toast.success("Gateway settings saved"); refresh(); }, onError: error => toast.error(error.message) });
  const rotateUuid = trpc.vless.regenerateUuid.useMutation({ onSuccess: () => { toast.success("VLESS UUID rotated"); refresh(); }, onError: error => toast.error(error.message) });
  const rotateToken = trpc.vless.regenerateToken.useMutation({ onSuccess: () => { toast.success("Subscription token rotated"); refresh(); }, onError: error => toast.error(error.message) });
  const rotateProtocol = trpc.vless.regenerateProtocolCredential.useMutation({ onSuccess: () => { toast.success("Protocol credential rotated"); refresh(); }, onError: error => toast.error(error.message) });

  const subscriptionUrl = useMemo(() => profile ? `${window.location.origin}${profile.subscriptionPath}` : "", [profile]);
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const port = Number(form.port); if (!Number.isInteger(port) || port < 1 || port > 65535) { toast.error("Use a port from 1 to 65535"); return; } updateMutation.mutate({ ...form, port }); };

  if (isLoading) return <AdminLoading />;
  if (!profile || error) return <div className="p-6"><Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Gateway profile unavailable</AlertTitle><AlertDescription>{error?.message || "The profile could not be loaded."}</AlertDescription></Alert></div>;

  const activeUri = activeProtocol === "vless" ? profile.vlessUri : activeProtocol === "vmess" ? profile.vmess.uri : activeProtocol === "trojan" ? profile.trojan.uri : activeProtocol === "shadowsocks" ? profile.shadowsocks.uri : profile.socks5.clientConfig;
  const activeMeta = protocolMeta[activeProtocol];
  const activePath = activeProtocol === "vless" ? profile.wsPath : activeProtocol === "vmess" ? profile.vmess.wsPath : activeProtocol === "trojan" ? profile.trojan.wsPath : activeProtocol === "shadowsocks" ? profile.shadowsocks.wsPath : profile.socks5.wsPath;

  return <div id="gateway-overview" className="protocol-shell min-h-full"><QrImportDialog payload={qrPayload} onOpenChange={open => !open && setQrPayload(null)} /><div className="mx-auto max-w-7xl px-1 py-2 sm:px-4 sm:py-5">
    <header className="protocol-header"><div><div className="mb-3 flex items-center gap-2 text-primary"><ServerCog className="h-4 w-4" /><span className="protocol-overline">Nginx gateway</span></div><h1 className="text-3xl font-semibold tracking-[-0.04em]">Connection control</h1><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">A focused control plane for import-ready Xray profiles on one HTTPS gateway.</p></div><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={`flex ${profile.runtime.running ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}><Activity className="mr-1.5 h-3.5 w-3.5" />{profile.runtime.running ? "Gateway live" : profile.runtime.enabled ? "Runtime starting" : "Runtime inactive"}</Badge><ThemeControl /></div></header>

    <section className="mt-6 grid gap-4 md:grid-cols-3"><Metric icon={Network} label="Gateway transport" value="HTTPS / WebSocket" detail="One TLS edge, five private inbounds" /><Metric icon={ShieldCheck} label="Protocols" value="VLESS · VMess · Trojan" detail="Shadowsocks 2022 and SOCKS5 are also available" /><Metric icon={FileKey2} label="Subscription" value="Four URI profiles" detail="VLESS, VMess, Trojan, and Shadowsocks feed" /></section>

    <Alert className="mt-5 border-primary/20 bg-primary/5"><ShieldCheck className="h-4 w-4 text-primary" /><AlertTitle>Gateway paths are isolated</AlertTitle><AlertDescription>Each protocol has a dedicated WebSocket path while the application keeps the Xray listeners private on loopback.</AlertDescription></Alert>

    <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]"><div className="space-y-5"><div className="protocol-panel p-5 sm:p-7"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="protocol-overline">Gateway parameters</p><h2 className="mt-2 text-lg font-semibold">Public edge configuration</h2><p className="mt-1 text-sm text-muted-foreground">Changes update generated imports and restart the matching private listener.</p></div><span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-300"><Check className="h-3.5 w-3.5" />Database-backed</span></div><Separator className="my-6" /><form className="space-y-5" onSubmit={submit}><div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_130px]"><div className="space-y-2"><Label htmlFor="serverAddress">Server address</Label><Input id="serverAddress" value={form.serverAddress} onChange={event => setForm(value => ({ ...value, serverAddress: event.target.value }))} className="protocol-input" /></div><div className="space-y-2"><Label htmlFor="port">Port</Label><Input id="port" value={form.port} onChange={event => setForm(value => ({ ...value, port: event.target.value }))} className="protocol-input" inputMode="numeric" /></div></div><div className="space-y-2"><Label htmlFor="wsPath">VLESS WebSocket path</Label><Input id="wsPath" value={form.wsPath} onChange={event => setForm(value => ({ ...value, wsPath: event.target.value }))} className="protocol-input font-mono" /></div><div className="flex items-center justify-between rounded-xl border border-border bg-muted/35 px-4 py-3.5"><div><Label htmlFor="tlsEnabled" className="text-sm font-medium">TLS at the public edge</Label><p className="mt-1 text-xs text-muted-foreground">Advertise the managed HTTPS certificate in client imports.</p></div><Switch id="tlsEnabled" checked={form.tlsEnabled} onCheckedChange={tlsEnabled => setForm(value => ({ ...value, tlsEnabled }))} /></div><div className="flex justify-end"><Button type="submit" disabled={updateMutation.isPending}>{updateMutation.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save gateway</Button></div></form></div>

      <div className="protocol-panel overflow-hidden"><div className="protocol-tabs" role="tablist">{(Object.keys(protocolMeta) as ProtocolKey[]).map(key => <button key={key} type="button" role="tab" aria-selected={activeProtocol === key} onClick={() => setActiveProtocol(key)} className={`protocol-tab ${activeProtocol === key ? "is-active" : ""}`}><span className={`protocol-dot ${protocolMeta[key].accent}`} />{protocolMeta[key].label}</button>)}</div><div className="p-5 sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="protocol-overline">{activeMeta.label} profile</p><h2 className="mt-2 text-lg font-semibold">{activeMeta.title}</h2><p className="mt-1 text-sm text-muted-foreground">{activeMeta.detail}</p></div><button type="button" onClick={() => setQrPayload({ name: activeMeta.label, description: activeProtocol === "socks" ? "Scan to transfer the Xray JSON configuration." : "Scan to import this connection URI.", value: activeUri })} className="qr-launch"><QrCode className="h-4 w-4" />QR</button></div><div className="mt-6 grid gap-3"><CodePane label={activeProtocol === "socks" ? "Xray client JSON" : `${activeMeta.label} URI`} value={activeUri} qrDescription="Open connection QR" onQr={() => setQrPayload({ name: activeMeta.label, description: activeProtocol === "socks" ? "Scan to transfer the Xray JSON configuration." : "Scan to import this connection URI.", value: activeUri })} /><div className="grid gap-3 sm:grid-cols-2"><CodePane label="WebSocket path" value={activePath} qrDescription="Open path QR" onQr={() => setQrPayload({ name: `${activeMeta.label} path`, description: "Gateway transport path.", value: activePath })} compact />{activeProtocol === "socks" ? <CodePane label="SOCKS5 username" value={profile.socks5.username} qrDescription="Open username QR" onQr={() => setQrPayload({ name: "SOCKS5 username", description: "SOCKS5 client username.", value: profile.socks5.username })} compact /> : <CodePane label="Public endpoint" value={`${profile.serverAddress}:${profile.port}`} qrDescription="Open endpoint QR" onQr={() => setQrPayload({ name: "Public endpoint", description: "Gateway endpoint.", value: `${profile.serverAddress}:${profile.port}` })} compact />}</div></div><div className="mt-5 flex flex-wrap gap-3"><AlertDialog><AlertDialogTrigger asChild><Button variant="outline"><KeyRound className="mr-2 h-4 w-4" />Rotate credential</Button></AlertDialogTrigger><AlertDialogContent className="protocol-dialog"><AlertDialogHeader><AlertDialogTitle>Rotate {activeMeta.label} credential?</AlertDialogTitle><AlertDialogDescription>{activeProtocol === "vless" ? "Existing VLESS client imports will stop working." : `Existing ${activeMeta.label} imports will stop working after the private listener reloads.`}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => activeProtocol === "vless" ? rotateUuid.mutate() : rotateProtocol.mutate({ protocol: activeProtocol })}>Rotate</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>{activeProtocol !== "socks" && <Button variant="ghost" onClick={() => copyValue(activeUri, `${activeMeta.label} URI`)}><Clipboard className="mr-2 h-4 w-4" />Copy import</Button>}</div></div></div></div>

      <aside className="space-y-5"><GatewaySubscriptionPanel url={subscriptionUrl} pending={rotateToken.isPending} onCopy={() => copyValue(subscriptionUrl, "Subscription URL")} onQr={() => setQrPayload({ name: "Subscription feed", description: "Scan to import VLESS, VMess, Trojan, and Shadowsocks profiles.", value: subscriptionUrl })} onRotate={() => { if (window.confirm("Rotate the global subscription token? The previous URL will immediately stop working.")) rotateToken.mutate(); }} /><div className="protocol-panel p-5 sm:p-6"><p className="protocol-overline">Protocol routes</p><div className="mt-4 space-y-3">{(Object.keys(protocolMeta) as ProtocolKey[]).map(key => { const path = key === "vless" ? profile.wsPath : key === "vmess" ? profile.vmess.wsPath : key === "trojan" ? profile.trojan.wsPath : key === "shadowsocks" ? profile.shadowsocks.wsPath : profile.socks5.wsPath; return <button type="button" key={key} onClick={() => setActiveProtocol(key)} className="route-row"><span><span className={`protocol-dot ${protocolMeta[key].accent}`} />{protocolMeta[key].label}</span><code>{path}</code><ChevronRight className="h-4 w-4" /></button>; })}</div></div></aside></section>
  </div></div>;
}

export default function Admin() {
  return <DashboardLayout><AdminContent /></DashboardLayout>;
}
