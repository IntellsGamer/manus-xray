import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { Ban, Copy, KeyRound, Plus, Power, Route, Users } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

function copy(value: string, label: string) {
  navigator.clipboard.writeText(value).then(() => toast.success(`${label} copied`), () => toast.error(`Could not copy ${label.toLowerCase()}`));
}

export function ClientManagerContent() {
  const utils = trpc.useUtils();
  const { data: profile, isLoading: loadingProfile } = trpc.vless.get.useQuery(undefined, { retry: false });
  const { data: clients, isLoading: loadingClients } = trpc.vless.clients.useQuery(undefined, { retry: false });
  const [name, setName] = useState("");
  const [paths, setPaths] = useState({ wsPath: "/vless", vmessWsPath: "/vmess", trojanWsPath: "/trojan", socksWsPath: "/socks", globalProfileEnabled: true });

  useEffect(() => {
    if (profile) setPaths({ wsPath: profile.wsPath, vmessWsPath: profile.vmessWsPath, trojanWsPath: profile.trojanWsPath, socksWsPath: profile.socksWsPath, globalProfileEnabled: profile.globalProfileEnabled });
  }, [profile]);

  const refresh = () => { utils.vless.get.invalidate(); utils.vless.clients.invalidate(); };
  const create = trpc.vless.createClient.useMutation({ onSuccess: () => { setName(""); toast.success("Client identity created"); refresh(); }, onError: error => toast.error(error.message) });
  const updatePaths = trpc.vless.updatePaths.useMutation({ onSuccess: () => { toast.success("Gateway paths saved"); refresh(); }, onError: error => toast.error(error.message) });
  const toggle = trpc.vless.setClientEnabled.useMutation({ onSuccess: () => { toast.success("Client state updated"); refresh(); }, onError: error => toast.error(error.message) });
  const rotate = trpc.vless.rotateClient.useMutation({ onSuccess: () => { toast.success("Client credentials and subscription token rotated"); refresh(); }, onError: error => toast.error(error.message) });
  const revoke = trpc.vless.revokeClient.useMutation({ onSuccess: () => { toast.success("Client revoked: credentials and subscription token invalidated"); refresh(); }, onError: error => toast.error(error.message) });

  if (loadingProfile || loadingClients || !profile) return <div className="protocol-shell min-h-screen p-6"><Skeleton className="mx-auto h-[32rem] max-w-6xl" /></div>;
  return <div className="protocol-shell min-h-full"><div className="mx-auto max-w-6xl space-y-5 py-2 sm:py-5">
    <header className="protocol-header"><div><div className="protocol-overline text-primary">Gateway administration</div><h1 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Clients & routes</h1><p className="mt-2 text-sm text-muted-foreground">Named identities receive separate credentials and subscription feeds while sharing one HTTPS gateway.</p></div><Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary"><Users className="mr-1.5 h-3.5 w-3.5" />{clients?.length || 0} named clients</Badge></header>

    <section className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]"><div className="protocol-panel p-5 sm:p-6"><div className="flex items-start justify-between"><div><p className="protocol-overline">Create identity</p><h2 className="mt-2 text-lg font-semibold">New client profile</h2><p className="mt-1 text-sm text-muted-foreground">Creates separate VLESS, VMess, Trojan, SOCKS5, and subscription credentials.</p></div><Plus className="h-5 w-5 text-primary" /></div><form className="mt-5 flex gap-3" onSubmit={(event: FormEvent) => { event.preventDefault(); if (name.trim()) create.mutate({ name }); }}><Input value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Ilya laptop" className="protocol-input" /><Button disabled={create.isPending}><Plus className="mr-2 h-4 w-4" />Create</Button></form></div>
      <div className="protocol-panel p-5 sm:p-6"><div className="flex items-start justify-between"><div><p className="protocol-overline">Global profile</p><h2 className="mt-2 text-lg font-semibold">Legacy credentials</h2><p className="mt-1 text-sm text-muted-foreground">Disable to remove the original global credentials from Xray; named clients continue working.</p></div><Switch checked={paths.globalProfileEnabled} onCheckedChange={globalProfileEnabled => setPaths(current => ({ ...current, globalProfileEnabled }))} /></div></div></section>

    <section className="protocol-panel p-5 sm:p-6"><div className="flex items-center gap-3"><Route className="h-5 w-5 text-primary" /><div><p className="protocol-overline">Transport paths</p><h2 className="mt-1 text-lg font-semibold">Independent protocol routes</h2></div></div><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{([['VLESS', 'wsPath'], ['VMess', 'vmessWsPath'], ['Trojan', 'trojanWsPath'], ['SOCKS5', 'socksWsPath']] as const).map(([label, key]) => <div key={key} className="space-y-2"><Label>{label} path</Label><Input value={paths[key]} onChange={event => setPaths(current => ({ ...current, [key]: event.target.value }))} className="protocol-input font-mono" /></div>)}</div><div className="mt-5 flex justify-end"><Button onClick={() => updatePaths.mutate(paths)} disabled={updatePaths.isPending}>Save routes</Button></div></section>

    <section className="space-y-3"><div><p className="protocol-overline">Named identities</p><h2 className="mt-1 text-lg font-semibold">Client lifecycle & subscription telemetry</h2><p className="mt-1 text-sm text-muted-foreground">Counts reflect actual subscription deliveries, not inferred proxy traffic.</p></div>{clients?.map(client => { const subscriptionUrl = `${window.location.origin}${client.subscriptionPath}`; return <article key={client.id} className="protocol-panel p-5 sm:p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{client.name}</h3><Badge variant="outline" className={client.enabled ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-300" : "border-amber-500/30 text-amber-600"}>{client.enabled ? "Enabled" : "Disabled"}</Badge></div><p className="mt-2 text-sm text-muted-foreground">Subscription deliveries: <strong className="text-foreground">{client.subscriptionDeliveryCount}</strong> · Last observed: {client.lastSubscriptionAt ? new Date(client.lastSubscriptionAt).toLocaleString() : "Never"}</p><div className="mt-4 flex max-w-xl items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"><code className="min-w-0 flex-1 truncate text-xs">{subscriptionUrl}</code><button onClick={() => copy(subscriptionUrl, "Subscription URL")} className="icon-action"><Copy className="h-4 w-4" /></button></div></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => toggle.mutate({ id: client.id, enabled: !client.enabled })}><Power className="mr-2 h-4 w-4" />{client.enabled ? "Disable" : "Enable"}</Button><Button variant="outline" onClick={() => rotate.mutate({ id: client.id })}><KeyRound className="mr-2 h-4 w-4" />Rotate all</Button><Button variant="destructive" onClick={() => revoke.mutate({ id: client.id })}><Ban className="mr-2 h-4 w-4" />Revoke</Button></div></div></article>; })}</section>
  </div></div>;
}

export default function Clients() {
  const { user, loading } = useAuth();
  if (loading) return <div className="protocol-shell min-h-screen" />;
  if (!user || user.role !== "admin") return <div className="protocol-shell grid min-h-screen place-items-center p-6"><div className="protocol-panel p-8 text-center"><h1 className="text-xl font-semibold">Owner access required</h1><p className="mt-2 text-sm text-muted-foreground">This page is available only to the gateway owner.</p></div></div>;
  return <DashboardLayout><ClientManagerContent /></DashboardLayout>;
}
