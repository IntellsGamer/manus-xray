import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { ClientRegistry } from "@/components/ClientRegistry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { Plus, Route, Users } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

function copy(value: string, label: string) {
  navigator.clipboard.writeText(value).then(() => toast.success(`${label} copied`), () => toast.error(`Could not copy ${label.toLowerCase()}`));
}

type QuotaUnit = "MB" | "GB";

function limitToBytes(rawValue: string, unit: QuotaUnit) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value === -1) return -1;
  return Math.min(Math.round(value * (unit === "GB" ? 1024 ** 3 : 1024 ** 2)), Number.MAX_SAFE_INTEGER);
}

export function ClientManagerContent() {
  const utils = trpc.useUtils();
  const { data: profile, isLoading: loadingProfile } = trpc.vless.get.useQuery(undefined, { retry: false });
  const { data: clients, isLoading: loadingClients } = trpc.vless.clients.useQuery(undefined, { retry: false });
  const [name, setName] = useState("");
  const [trafficLimit, setTrafficLimit] = useState("-1");
  const [trafficUnit, setTrafficUnit] = useState<QuotaUnit>("GB");
  const [dayLimit, setDayLimit] = useState("-1");
  const [paths, setPaths] = useState({ wsPath: "/vless", vmessWsPath: "/vmess", trojanWsPath: "/trojan", socksWsPath: "/socks", globalProfileEnabled: true });

  useEffect(() => {
    if (profile) setPaths({ wsPath: profile.wsPath, vmessWsPath: profile.vmessWsPath, trojanWsPath: profile.trojanWsPath, socksWsPath: profile.socksWsPath, globalProfileEnabled: profile.globalProfileEnabled });
  }, [profile]);

  const refresh = () => { utils.vless.get.invalidate(); utils.vless.clients.invalidate(); };
  const create = trpc.vless.createClient.useMutation({ onSuccess: () => { setName(""); setTrafficLimit("-1"); setDayLimit("-1"); toast.success("Client identity created"); refresh(); }, onError: error => toast.error(error.message) });
  const updatePaths = trpc.vless.updatePaths.useMutation({ onSuccess: () => { toast.success("Gateway paths saved"); refresh(); }, onError: error => toast.error(error.message) });
  const toggle = trpc.vless.setClientEnabled.useMutation({ onSuccess: () => { toast.success("Client state updated"); refresh(); }, onError: error => toast.error(error.message) });
  const rotate = trpc.vless.rotateClient.useMutation({ onSuccess: () => { toast.success("Client credentials and subscription token rotated"); refresh(); }, onError: error => toast.error(error.message) });
  const deleteClient = trpc.vless.deleteClient.useMutation({ onSuccess: () => { toast.success("Client permanently deleted"); refresh(); }, onError: error => toast.error(error.message) });
  const updatePolicy = trpc.vless.updateClientPolicy.useMutation({ onSuccess: () => { toast.success("Client policy saved"); refresh(); }, onError: error => toast.error(error.message) });
  const resetUsage = trpc.vless.resetClientUsage.useMutation({ onSuccess: () => { toast.success("Recorded usage reset to 0"); refresh(); }, onError: error => toast.error(error.message) });

  if (loadingProfile || loadingClients || !profile) return <div className="protocol-shell min-h-screen p-6"><Skeleton className="mx-auto h-[32rem] max-w-6xl" /></div>;
  return <div className="protocol-shell min-h-full"><div className="mx-auto max-w-6xl space-y-5 py-2 sm:py-5">
    <header className="protocol-header"><div><div className="protocol-overline text-primary">Gateway administration</div><h1 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Clients & routes</h1><p className="mt-2 text-sm text-muted-foreground">Named identities receive separate credentials and subscription feeds while sharing one HTTPS gateway.</p></div><Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary"><Users className="mr-1.5 h-3.5 w-3.5" />{clients?.length || 0} named clients</Badge></header>

    <section className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]"><div className="protocol-panel p-5 sm:p-6"><div className="flex items-start justify-between"><div><p className="protocol-overline">Create identity</p><h2 className="mt-2 text-lg font-semibold">New client profile</h2><p className="mt-1 text-sm text-muted-foreground">Creates separate VLESS, VMess, Trojan, SOCKS5, and subscription credentials.</p></div><Plus className="h-5 w-5 text-primary" /></div><form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={(event: FormEvent) => { event.preventDefault(); if (!name.trim()) return; const parsedDays = Number(dayLimit); create.mutate({ name, trafficLimitBytes: limitToBytes(trafficLimit, trafficUnit), dayLimit: !Number.isFinite(parsedDays) || parsedDays === -1 ? -1 : Math.max(0, Math.min(3650, Math.floor(parsedDays))) }); }}><div className="space-y-2 sm:col-span-2"><Label htmlFor="client-name">Client or device label</Label><Input id="client-name" value={name} onChange={event => setName(event.target.value)} placeholder="Example: laptop or a friend" className="protocol-input" /></div><div className="space-y-2"><Label htmlFor="storage-limit">Storage limit</Label><div className="grid grid-cols-[minmax(0,1fr)_5.75rem] gap-2"><Input id="storage-limit" value={trafficLimit} onChange={event => setTrafficLimit(event.target.value)} type="number" min="-1" step="0.01" className="protocol-input" aria-describedby="storage-limit-help" /><select value={trafficUnit} onChange={event => setTrafficUnit(event.target.value as QuotaUnit)} className="protocol-input h-10 rounded-md border border-input bg-background px-2 text-sm" aria-label="Storage limit unit"><option value="GB">GB</option><option value="MB">MB</option></select></div><p id="storage-limit-help" className="text-xs text-muted-foreground"><strong>-1</strong> = unlimited storage</p></div><div className="space-y-2"><Label htmlFor="day-limit">Day limit</Label><Input id="day-limit" value={dayLimit} onChange={event => setDayLimit(event.target.value)} type="number" min="-1" max="3650" className="protocol-input" aria-describedby="day-limit-help" /><p id="day-limit-help" className="text-xs text-muted-foreground"><strong>-1</strong> = no expiry</p></div><div className="sm:col-span-2"><Button className="sm:w-fit" disabled={create.isPending}><Plus className="mr-2 h-4 w-4" />Create client</Button></div></form></div>
      <div className="protocol-panel p-5 sm:p-6"><div className="flex items-start justify-between"><div><p className="protocol-overline">Global profile</p><h2 className="mt-2 text-lg font-semibold">Legacy credentials</h2><p className="mt-1 text-sm text-muted-foreground">Disable to remove the original global credentials from Xray; named clients continue working.</p></div><Switch checked={paths.globalProfileEnabled} onCheckedChange={globalProfileEnabled => setPaths(current => ({ ...current, globalProfileEnabled }))} /></div></div></section>

    <section className="protocol-panel p-5 sm:p-6"><div className="flex items-center gap-3"><Route className="h-5 w-5 text-primary" /><div><p className="protocol-overline">Transport paths</p><h2 className="mt-1 text-lg font-semibold">Independent protocol routes</h2></div></div><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{([['VLESS', 'wsPath'], ['VMess', 'vmessWsPath'], ['Trojan', 'trojanWsPath'], ['SOCKS5', 'socksWsPath']] as const).map(([label, key]) => <div key={key} className="space-y-2"><Label>{label} path</Label><Input value={paths[key]} onChange={event => setPaths(current => ({ ...current, [key]: event.target.value }))} className="protocol-input font-mono" /></div>)}</div><div className="mt-5 flex justify-end"><Button onClick={() => updatePaths.mutate(paths)} disabled={updatePaths.isPending}>Save routes</Button></div></section>

    <section className="space-y-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="protocol-overline">Named identities</p><h2 className="mt-1 text-lg font-semibold">Client lifecycle & policy registry</h2><p className="mt-1 text-sm text-muted-foreground">Quota values reflect bytes carried through each client’s route-identified gateway tunnel.</p></div><div className="rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">{clients?.filter(client => client.enabled).length || 0} enabled · {clients?.length || 0} total</div></div><ClientRegistry clients={clients || []} pending={toggle.isPending || rotate.isPending || resetUsage.isPending || deleteClient.isPending || updatePolicy.isPending} onToggle={(id, enabled) => toggle.mutate({ id, enabled })} onRotate={id => rotate.mutate({ id })} onResetUsage={id => resetUsage.mutate({ id })} onDelete={id => deleteClient.mutate({ id })} onCopy={value => copy(value, "Subscription URL")} onSavePolicy={(id, trafficLimitBytes, policyDayLimit) => updatePolicy.mutate({ id, trafficLimitBytes, dayLimit: policyDayLimit })} /></section>
  </div></div>;
}

export default function Clients() {
  const { user, loading } = useAuth();
  if (loading) return <div className="protocol-shell min-h-screen" />;
  if (!user || user.role !== "admin") return <div className="protocol-shell grid min-h-screen place-items-center p-6"><div className="protocol-panel p-8 text-center"><h1 className="text-xl font-semibold">Owner access required</h1><p className="mt-2 text-sm text-muted-foreground">This page is available only to the gateway owner.</p></div></div>;
  return <DashboardLayout><ClientManagerContent /></DashboardLayout>;
}
