import DashboardLayout from "@/components/DashboardLayout";
import { ClientRegistry } from "@/components/ClientRegistry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { claimClientActivationNotification } from "@/lib/clientActivationNotifications";
import { takeClientDraftPrefill } from "@/lib/clientPrefill";
import { readClientRegistryView, saveClientRegistryView, type ClientRegistryView } from "@/lib/clientRegistryView";
import { clientNotifications } from "@/lib/clientNotifications";
import { trpc } from "@/lib/trpc";
import { LayoutTemplate, List, Network, Plus, RefreshCw, Route, Rows3, Users } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

function copy(value: string, label: string) {
  navigator.clipboard.writeText(value).then(() => toast.success(`${label} copied`), () => toast.error(`Could not copy ${label.toLowerCase()}`));
}

type QuotaUnit = "MB" | "GB";

function limitToBytes(rawValue: string, unit: QuotaUnit) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value === -1) return -1;
  return Math.max(0, Math.min(Math.round(value * (unit === "GB" ? 1024 ** 3 : 1024 ** 2)), Number.MAX_SAFE_INTEGER));
}

function speedLimitFromForm(rawValue: string) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value === -1) return -1;
  return Math.max(1, Math.min(100_000, Math.floor(value)));
}

function ClientsLoading() {
  return <div className="protocol-shell min-h-full"><div className="mx-auto max-w-6xl space-y-5 py-2 sm:py-5"><header className="protocol-header flex items-start justify-between"><div className="space-y-3"><Skeleton className="h-3 w-28" /><Skeleton className="h-9 w-52" /><Skeleton className="h-4 w-96 max-w-full" /></div><Skeleton className="h-7 w-28 rounded-full" /></header><section className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]"><div className="protocol-panel space-y-5 p-5 sm:p-6"><div className="flex justify-between"><div className="space-y-3"><Skeleton className="h-3 w-24" /><Skeleton className="h-6 w-44" /><Skeleton className="h-4 w-72 max-w-full" /></div><Skeleton className="h-5 w-5 rounded" /></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Skeleton className="h-16 sm:col-span-2 lg:col-span-3" /><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-9 w-32 sm:col-span-2 lg:col-span-3" /></div></div><div className="protocol-panel p-5 sm:p-6"><Skeleton className="h-3 w-24" /><Skeleton className="mt-3 h-6 w-40" /><Skeleton className="mt-3 h-4 w-full" /><Skeleton className="mt-7 h-10 w-12 rounded-full" /></div></section><section className="protocol-panel p-5 sm:p-6"><Skeleton className="h-5 w-40" /><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div><div className="mt-5 flex justify-end"><Skeleton className="h-9 w-28" /></div></section><section className="space-y-3"><div className="flex items-end justify-between"><div className="space-y-2"><Skeleton className="h-3 w-28" /><Skeleton className="h-6 w-64" /><Skeleton className="h-4 w-96 max-w-full" /></div><Skeleton className="h-7 w-28" /></div><Skeleton className="h-52" /><Skeleton className="h-52" /></section></div></div>;
}

export function ClientManagerContent() {
  const utils = trpc.useUtils();
  const { data: profile, isLoading: loadingProfile, isFetching: fetchingProfile } = trpc.vless.get.useQuery(undefined, { retry: false });
  const { data: clients, isLoading: loadingClients, isFetching: fetchingClients } = trpc.vless.clients.useQuery(undefined, { retry: false });
  const { data: templates } = trpc.templates.list.useQuery(undefined, { retry: false });
  const [name, setName] = useState("");
  const [trafficLimit, setTrafficLimit] = useState("-1");
  const [trafficUnit, setTrafficUnit] = useState<QuotaUnit>("GB");
  const [dayLimit, setDayLimit] = useState("-1");
  const [speedLimitMbps, setSpeedLimitMbps] = useState("-1");
  const [connectionLimit, setConnectionLimit] = useState("-1");
  const [selectedTemplateId, setSelectedTemplateId] = useState("none");
  const [clientRegistryView, setClientRegistryView] = useState<ClientRegistryView>(() => readClientRegistryView());
  const [paths, setPaths] = useState({ wsPath: "/vless", vmessWsPath: "/vmess", trojanWsPath: "/trojan", socksWsPath: "/socks", globalProfileEnabled: true });
  const [savedGlobalProfileEnabled, setSavedGlobalProfileEnabled] = useState(true);
  const activationTimerIds = useRef(new Map<number, number>());
  const notifiedActivationClientIds = useRef(new Set<number>());

  useEffect(() => {
    if (!profile) return;
    setPaths({ wsPath: profile.wsPath, vmessWsPath: profile.vmessWsPath, trojanWsPath: profile.trojanWsPath, socksWsPath: profile.socksWsPath, globalProfileEnabled: profile.globalProfileEnabled });
    setSavedGlobalProfileEnabled(profile.globalProfileEnabled);
  }, [profile]);

  useEffect(() => {
    const prefill = takeClientDraftPrefill();
    if (!prefill) return;
    setName(prefill.name);
    toast.success("Device label autofilled — review limits, then create manually");
  }, []);

  const refresh = () => { utils.vless.get.invalidate(); utils.vless.clients.invalidate(); };
  const activate = trpc.vless.activateClient.useMutation({
    onSuccess: result => {
      activationTimerIds.current.delete(result.id);
      if (result.activationPending) { refresh(); return; }
      if (result.activationFailed) { toast.error("Client activation failed"); refresh(); return; }
      if (claimClientActivationNotification(notifiedActivationClientIds.current, result)) toast.success(clientNotifications.activated);
      refresh();
    },
    onError: (error, variables) => { activationTimerIds.current.delete(variables.id); toast.error(`Client is saved; Xray activation will retry automatically. ${error.message}`); refresh(); },
  });
  useEffect(() => {
    const pendingClients = (clients || []).filter(client => client.activationPending && client.activationDueAt);
    const pendingClientIds = new Set(pendingClients.map(client => client.id));
    for (const [clientId, timerId] of Array.from(activationTimerIds.current.entries())) {
      if (!pendingClientIds.has(clientId)) {
        window.clearTimeout(timerId);
        activationTimerIds.current.delete(clientId);
      }
    }
    for (const client of pendingClients) {
      if (activationTimerIds.current.has(client.id)) continue;
      const delay = Math.max(250, new Date(client.activationDueAt!).getTime() - Date.now() + 250);
      const timerId = window.setTimeout(() => {
        activationTimerIds.current.delete(client.id);
        activate.mutate({ id: client.id, force: false });
      }, delay);
      activationTimerIds.current.set(client.id, timerId);
    }
  }, [activate.mutate, clients]);
  useEffect(() => () => {
    for (const timerId of Array.from(activationTimerIds.current.values())) window.clearTimeout(timerId);
    activationTimerIds.current.clear();
  }, []);

  const clearDraft = () => { setName(""); setTrafficLimit("-1"); setTrafficUnit("GB"); setDayLimit("-1"); setSpeedLimitMbps("-1"); setConnectionLimit("-1"); setSelectedTemplateId("none"); };
  const create = trpc.vless.createClient.useMutation({
    onSuccess: () => { clearDraft(); refresh(); toast.success(clientNotifications.created); },
    onError: error => toast.error(error.message),
  });
  const updatePaths = trpc.vless.updatePaths.useMutation({
    onSuccess: saved => { setPaths({ wsPath: saved.wsPath, vmessWsPath: saved.vmessWsPath, trojanWsPath: saved.trojanWsPath, socksWsPath: saved.socksWsPath, globalProfileEnabled: saved.globalProfileEnabled }); setSavedGlobalProfileEnabled(saved.globalProfileEnabled); toast.success("Gateway paths saved"); refresh(); },
    onError: error => toast.error(error.message),
  });
  const persistGlobalProfile = trpc.vless.updatePaths.useMutation({
    onSuccess: saved => { setPaths({ wsPath: saved.wsPath, vmessWsPath: saved.vmessWsPath, trojanWsPath: saved.trojanWsPath, socksWsPath: saved.socksWsPath, globalProfileEnabled: saved.globalProfileEnabled }); setSavedGlobalProfileEnabled(saved.globalProfileEnabled); toast.success(saved.globalProfileEnabled ? "Legacy credentials enabled" : "Legacy credentials disabled"); refresh(); },
    onError: error => { setPaths(current => ({ ...current, globalProfileEnabled: savedGlobalProfileEnabled })); toast.error(error.message); },
  });
  useEffect(() => {
    if (paths.globalProfileEnabled === savedGlobalProfileEnabled || persistGlobalProfile.isPending) return;
    persistGlobalProfile.mutate(paths);
  }, [paths, savedGlobalProfileEnabled, persistGlobalProfile.isPending, persistGlobalProfile.mutate]);
  const toggle = trpc.vless.setClientEnabled.useMutation({ onSuccess: () => { toast.success("Client state updated"); refresh(); }, onError: error => toast.error(error.message) });
  const rotate = trpc.vless.rotateClient.useMutation({ onSuccess: () => { toast.success("Client credentials and subscription token rotated"); refresh(); }, onError: error => toast.error(error.message) });
  const deleteClient = trpc.vless.deleteClient.useMutation({ onSuccess: () => { toast.success("Client permanently deleted"); refresh(); }, onError: error => toast.error(error.message) });
  const updatePolicy = trpc.vless.updateClientPolicy.useMutation({ onSuccess: () => { toast.success("Client policy saved"); refresh(); }, onError: error => toast.error(error.message) });
  const resetUsage = trpc.vless.resetClientUsage.useMutation({ onSuccess: () => { toast.success("Recorded usage reset to 0"); refresh(); }, onError: error => toast.error(error.message) });

  const applyTemplate = (id: string) => {
    setSelectedTemplateId(id);
    if (id === "none") return;
    const template = templates?.find(item => String(item.id) === id);
    if (!template) return;
    const bytes = Number(template.trafficLimitBytes);
    if (bytes < 0) { setTrafficLimit("-1"); setTrafficUnit("GB"); }
    else if (bytes >= 1024 ** 3 && bytes % (1024 ** 3) === 0) { setTrafficLimit(String(bytes / 1024 ** 3)); setTrafficUnit("GB"); }
    else { setTrafficLimit(String(Math.round((bytes / 1024 ** 2) * 100) / 100)); setTrafficUnit("MB"); }
    setDayLimit(String(template.dayLimit));
    setSpeedLimitMbps(String(template.speedLimitMbps));
    setConnectionLimit(String(template.connectionLimit));
    toast.success(`Applied ${template.name} — review and create manually`);
  };
  const setRegistryView = (view: ClientRegistryView) => { setClientRegistryView(view); saveClientRegistryView(view); };

  if (loadingProfile || loadingClients || !profile) return <ClientsLoading />;
  return <div className="protocol-shell min-h-full"><div className="mx-auto max-w-6xl space-y-5 py-2 sm:py-5">
    <header className="protocol-header"><div><div className="protocol-overline text-primary">Gateway administration</div><h1 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Clients & routes</h1><p className="mt-2 text-sm text-muted-foreground">Named identities receive separate credentials and subscription feeds while sharing one HTTPS gateway.</p></div><Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary"><Users className="mr-1.5 h-3.5 w-3.5" />{clients?.length || 0} named clients</Badge></header>

    <section className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]"><div className="protocol-panel p-5 sm:p-6"><div className="flex items-start justify-between"><div><p className="protocol-overline">Create identity</p><h2 className="mt-2 text-lg font-semibold">New client profile</h2><p className="mt-1 text-sm text-muted-foreground">Creates separate VLESS, VMess, Trojan, SOCKS5, and subscription credentials.</p></div><Plus className="h-5 w-5 text-primary" /></div><form className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(event: FormEvent) => { event.preventDefault(); if (!name.trim() || create.isPending) return; const parsedDays = Number(dayLimit); const parsedConnections = Number(connectionLimit); create.mutate({ name, trafficLimitBytes: limitToBytes(trafficLimit, trafficUnit), dayLimit: !Number.isFinite(parsedDays) || parsedDays === -1 ? -1 : Math.max(0, Math.min(3650, Math.floor(parsedDays))), speedLimitMbps: speedLimitFromForm(speedLimitMbps), connectionLimit: !Number.isFinite(parsedConnections) || parsedConnections === -1 ? -1 : Math.max(1, Math.min(10_000, Math.floor(parsedConnections))), creationRequestId: crypto.randomUUID() }); }}><div className="space-y-2 sm:col-span-2 lg:col-span-4"><Label htmlFor="client-template"><LayoutTemplate className="mr-1 inline h-3.5 w-3.5" />Start from policy template</Label><select id="client-template" value={selectedTemplateId} onChange={event => applyTemplate(event.target.value)} className="protocol-input h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="none">No template — use current form values</option>{(templates || []).map(template => <option value={String(template.id)} key={template.id}>{template.name}</option>)}</select><p className="text-xs text-muted-foreground">Applies limits to this form only. It never creates a client automatically.</p></div><div className="space-y-2 sm:col-span-2 lg:col-span-4"><Label htmlFor="client-name">Client or device label</Label><Input id="client-name" value={name} onChange={event => setName(event.target.value)} placeholder="Example: laptop or a friend" className="protocol-input" /></div><div className="space-y-2"><Label htmlFor="storage-limit">Storage limit</Label><div className="grid grid-cols-[minmax(0,1fr)_5.75rem] gap-2"><Input id="storage-limit" value={trafficLimit} onChange={event => setTrafficLimit(event.target.value)} type="number" min="-1" step="0.01" className="protocol-input" aria-describedby="storage-limit-help" /><select value={trafficUnit} onChange={event => setTrafficUnit(event.target.value as QuotaUnit)} className="protocol-input h-10 rounded-md border border-input bg-background px-2 text-sm" aria-label="Storage limit unit"><option value="GB">GB</option><option value="MB">MB</option></select></div><p id="storage-limit-help" className="text-xs text-muted-foreground"><strong>-1</strong> = unlimited storage</p></div><div className="space-y-2"><Label htmlFor="day-limit">Day limit</Label><Input id="day-limit" value={dayLimit} onChange={event => setDayLimit(event.target.value)} type="number" min="-1" max="3650" className="protocol-input" aria-describedby="day-limit-help" /><p id="day-limit-help" className="text-xs text-muted-foreground"><strong>-1</strong> = no expiry</p></div><div className="space-y-2"><Label htmlFor="speed-limit">Speed limit</Label><Input id="speed-limit" value={speedLimitMbps} onChange={event => setSpeedLimitMbps(event.target.value)} type="number" min="-1" max="100000" step="1" className="protocol-input" aria-describedby="speed-limit-help" /><p id="speed-limit-help" className="text-xs text-muted-foreground"><strong>-1</strong> = unlimited Mbps</p></div><div className="space-y-2"><Label htmlFor="connection-limit"><Network className="mr-1 inline h-3.5 w-3.5" />Connections</Label><Input id="connection-limit" value={connectionLimit} onChange={event => setConnectionLimit(event.target.value)} type="number" min="-1" max="10000" step="1" className="protocol-input" aria-describedby="connection-limit-help" /><p id="connection-limit-help" className="text-xs text-muted-foreground"><strong>-1</strong> = unlimited source IPs</p></div><div className="sm:col-span-2 lg:col-span-4"><Button className="sm:w-fit" disabled={create.isPending}><Plus className="mr-2 h-4 w-4" />Create client</Button></div></form></div><div className="protocol-panel p-5 sm:p-6"><div className="flex items-start justify-between"><div><p className="protocol-overline">Global profile</p><h2 className="mt-2 text-lg font-semibold">Legacy credentials</h2><p className="mt-1 text-sm text-muted-foreground">Disable to remove the original global credentials from Xray; named clients continue working.</p></div><Switch checked={paths.globalProfileEnabled} onCheckedChange={globalProfileEnabled => setPaths(current => ({ ...current, globalProfileEnabled }))} /></div></div></section>

    <section className="protocol-panel p-5 sm:p-6"><div className="flex items-center gap-3"><Route className="h-5 w-5 text-primary" /><div><p className="protocol-overline">Transport paths</p><h2 className="mt-1 text-lg font-semibold">Independent protocol routes</h2></div></div><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{([['VLESS', 'wsPath'], ['VMess', 'vmessWsPath'], ['Trojan', 'trojanWsPath'], ['SOCKS5', 'socksWsPath']] as const).map(([label, key]) => <div key={key} className="space-y-2"><Label>{label} path</Label><Input value={paths[key]} onChange={event => setPaths(current => ({ ...current, [key]: event.target.value }))} className="protocol-input font-mono" /></div>)}</div><div className="mt-5 flex justify-end"><Button onClick={() => updatePaths.mutate(paths)} disabled={updatePaths.isPending}>Save routes</Button></div></section>

    <section className="space-y-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="protocol-overline">Named identities</p><h2 className="mt-1 text-lg font-semibold">Client lifecycle & policy registry</h2><p className="mt-1 text-sm text-muted-foreground">Quota values update in real time from payload bytes crossing each route-identified gateway tunnel.</p></div><div className="flex items-center gap-2"><div className="rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">{clients?.filter(client => client.enabled).length || 0} enabled · {clients?.length || 0} total</div><div className="flex rounded-md border border-border bg-card p-0.5" aria-label="Client display mode"><Button type="button" size="icon" variant={clientRegistryView === "detailed" ? "secondary" : "ghost"} className="h-7 w-7" aria-label="Detailed client cards" title="Detailed cards" onClick={() => setRegistryView("detailed")}><Rows3 className="h-3.5 w-3.5" /></Button><Button type="button" size="icon" variant={clientRegistryView === "compact" ? "secondary" : "ghost"} className="h-7 w-7" aria-label="Compact client cards" title="Compact cards" onClick={() => setRegistryView("compact")}><List className="h-3.5 w-3.5" /></Button></div><Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label="Refresh client registry" title="Refresh client registry" disabled={fetchingProfile || fetchingClients} onClick={refresh}><RefreshCw className={`h-3.5 w-3.5 ${(fetchingProfile || fetchingClients) ? "animate-spin" : ""}`} /></Button></div></div><ClientRegistry clients={clients || []} viewMode={clientRegistryView} pending={activate.isPending || toggle.isPending || rotate.isPending || resetUsage.isPending || deleteClient.isPending || updatePolicy.isPending} onToggle={(id, enabled) => toggle.mutate({ id, enabled })} onActivate={id => activate.mutate({ id, force: true })} onRotate={id => rotate.mutate({ id })} onResetUsage={id => resetUsage.mutate({ id })} onDelete={id => deleteClient.mutate({ id })} onCopy={value => copy(value, "Subscription URL")} onSavePolicy={(id, trafficLimitBytes, policyDayLimit, policySpeedLimitMbps, policyConnectionLimit) => updatePolicy.mutate({ id, trafficLimitBytes, dayLimit: policyDayLimit, speedLimitMbps: policySpeedLimitMbps, connectionLimit: policyConnectionLimit })} /></section>
  </div></div>;
}

export default function Clients() {
  return <DashboardLayout><ClientManagerContent /></DashboardLayout>;
}
