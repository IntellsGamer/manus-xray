import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClientRegistryView } from "@/lib/clientRegistryView";
import { CalendarClock, ChevronDown, ChevronUp, Copy, Gauge, HardDrive, KeyRound, MoreHorizontal, Network, Power, RotateCcw, Save, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

type QuotaUnit = "MB" | "GB";

type ClientRecord = {
  id: number;
  name: string;
  enabled: boolean;
  expiresAt: Date | string | null;
  activationDueAt: Date | string | null;
  activationFailedAt: Date | string | null;
  activationPending: boolean;
  activationFailed: boolean;
  trafficLimitBytes: number;
  trafficUsedBytes: number;
  remainingTrafficBytes: number | null;
  trafficUsageAvailable: boolean;
  quotaExhaustedAt: Date | string | null;
  dayLimit: number;
  speedLimitMbps: number;
  connectionLimit: number;
  subscriptionPath: string;
  createdAt: Date | string;
};

type ClientRegistryProps = {
  clients: ClientRecord[];
  viewMode: ClientRegistryView;
  pending: boolean;
  onToggle: (id: number, enabled: boolean) => void;
  onActivate: (id: number) => void;
  onRotate: (id: number) => void;
  onResetUsage: (id: number) => void;
  onDelete: (id: number, name: string) => void;
  onCopy: (value: string) => void;
  onSavePolicy: (id: number, trafficLimitBytes: number, dayLimit: number, speedLimitMbps: number, connectionLimit: number) => void;
};

type ClientActionCandidate = Pick<ClientRecord, "id" | "name">;
type QuotaProgress = NonNullable<ReturnType<typeof clientQuotaProgress>>;

function formatBytes(bytes: number) {
  if (bytes < 0) return "Unlimited";
  if (bytes >= 1024 ** 3) return `${Math.round((bytes / 1024 ** 3) * 100) / 100} GB`;
  return `${Math.round((bytes / 1024 ** 2) * 100) / 100} MB`;
}

function limitFormValue(bytes: number): { value: string; unit: QuotaUnit } {
  if (bytes < 0) return { value: "-1", unit: "GB" };
  if (bytes >= 1024 ** 3 && bytes % (1024 ** 3) === 0) return { value: String(bytes / 1024 ** 3), unit: "GB" };
  return { value: String(Math.round((bytes / 1024 ** 2) * 100) / 100), unit: "MB" };
}

function quotaToBytes(rawValue: string, unit: QuotaUnit) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value === -1) return -1;
  return Math.max(0, Math.min(Math.round(value * (unit === "GB" ? 1024 ** 3 : 1024 ** 2)), Number.MAX_SAFE_INTEGER));
}

function policyDays(rawValue: string) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value === -1) return -1;
  return Math.max(0, Math.min(3650, Math.floor(value)));
}

function policySpeed(rawValue: string) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value === -1) return -1;
  return Math.max(0, Math.min(100_000, Math.floor(value)));
}

function policyConnections(rawValue: string) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value === -1) return -1;
  return Math.max(0, Math.min(10_000, Math.floor(value)));
}

function dayStatus(expiresAt: Date | string | null, dayLimit: number) {
  if (dayLimit < 0) return { title: "Unlimited", detail: "No expiry policy" };
  if (!expiresAt) return { title: "Not scheduled", detail: `${dayLimit} day policy` };
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (remainingMs <= 0) return { title: "Expired", detail: new Date(expiresAt).toLocaleDateString() };
  return { title: `${Math.ceil(remainingMs / 86_400_000)} days left`, detail: `Expires ${new Date(expiresAt).toLocaleDateString()}` };
}

export function clientQuotaProgress(trafficLimitBytes: number, trafficUsedBytes: number) {
  if (trafficLimitBytes < 0) return null;
  const remainingBytes = Math.max(0, trafficLimitBytes - Math.max(0, trafficUsedBytes));
  const remainingPercent = trafficLimitBytes > 0 ? Math.round((remainingBytes / trafficLimitBytes) * 100) : 0;
  const usedPercent = 100 - remainingPercent;
  const toneClass = remainingPercent <= 10 ? "bg-destructive" : remainingPercent <= 25 ? "bg-amber-500" : "bg-primary";
  return { remainingBytes, remainingPercent, usedPercent, toneClass };
}

export function clientActivationState(client: Pick<ClientRecord, "enabled" | "activationPending" | "activationFailed" | "quotaExhaustedAt">) {
  if (client.activationPending) return { label: "Activating", detail: "Credentials saved; Xray refresh is in progress", className: "border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300", action: "Activating", actionDisabled: true, retry: false };
  if (client.activationFailed) return { label: "Failed", detail: "Xray activation did not complete", className: "border-destructive/35 bg-destructive/10 text-destructive", action: "Activate", actionDisabled: false, retry: true };
  if (client.enabled) return { label: "Enabled", detail: "Ready for connections", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", action: "Disable", actionDisabled: false, retry: false };
  if (client.quotaExhaustedAt) return { label: "Quota reached", detail: "Disabled by quota policy", className: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300", action: "Enable", actionDisabled: false, retry: false };
  return { label: "Disabled", detail: "Connections are blocked", className: "border-muted-foreground/30 text-muted-foreground", action: "Enable", actionDisabled: false, retry: false };
}

export function clientDeleteDialogCopy(name: string) {
  return { title: `Permanently delete ${name}?`, description: "This removes the client identity, all protocol credentials, its subscription token, and recorded delivery history. This cannot be undone.", action: "Delete permanently" };
}

export function clientResetUsageDialogCopy(name: string) {
  return { title: `Reset usage for ${name}?`, description: "This sets the recorded data usage to 0 and establishes a fresh accounting baseline. Credentials, subscription access, and every policy limit remain unchanged.", action: "Reset usage" };
}

export function nextExpandedCompactClientId(currentClientId: number | null, clientId: number) {
  return currentClientId === clientId ? null : clientId;
}

function useAnimatedPercent(value: number) {
  const [displayValue, setDisplayValue] = useState(value);
  const currentValue = useRef(value);

  useEffect(() => {
    const startValue = currentValue.current;
    if (startValue === value) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      currentValue.current = value;
      setDisplayValue(value);
      return;
    }
    const startedAt = performance.now();
    let frameId = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 260);
      const eased = 1 - (1 - progress) ** 3;
      const nextValue = Math.round(startValue + (value - startValue) * eased);
      currentValue.current = nextValue;
      setDisplayValue(nextValue);
      if (progress < 1) frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [value]);

  return displayValue;
}

function QuotaProgressBar({ quotaProgress, compact = false }: { quotaProgress: QuotaProgress; compact?: boolean }) {
  const animatedRemainingPercent = useAnimatedPercent(quotaProgress.remainingPercent);
  const animatedUsedPercent = Math.max(0, Math.min(100, 100 - animatedRemainingPercent));
  return <div className="min-w-0"><div className={`flex items-center justify-between gap-3 text-[11px] font-medium ${compact ? "mb-1" : "mb-1.5"}`}><span className="text-muted-foreground">Data remaining</span><span className="shrink-0 tabular-nums text-foreground">{animatedRemainingPercent}% remaining</span></div><div className={`${compact ? "h-1.5" : "h-2"} overflow-hidden rounded-full bg-muted`} role="progressbar" aria-label={`Data quota: ${animatedRemainingPercent}% remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={animatedRemainingPercent}><div className={`h-full rounded-full transition-[width,background-color] duration-300 motion-reduce:transition-none ${quotaProgress.toneClass}`} style={{ width: `${animatedUsedPercent}%` }} /></div></div>;
}

function ClientActions({ client, pending, status, subscriptionUrl, expanded, onToggleExpansion, onToggle, onActivate, onRotate, onReset, onDelete, onCopy }: { client: ClientRecord; pending: boolean; status: ReturnType<typeof clientActivationState>; subscriptionUrl: string; expanded?: boolean; onToggleExpansion?: () => void; onToggle: (id: number, enabled: boolean) => void; onActivate: (id: number) => void; onRotate: (id: number) => void; onReset: (candidate: ClientActionCandidate) => void; onDelete: (candidate: ClientActionCandidate) => void; onCopy: (value: string) => void }) {
  return <div className="flex shrink-0 items-center gap-2"><Button size="sm" variant={client.enabled ? "outline" : "default"} onClick={() => status.retry ? onActivate(client.id) : onToggle(client.id, !client.enabled)} disabled={pending || status.actionDisabled}><Power className="mr-1.5 h-3.5 w-3.5" />{status.action}</Button><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="outline" aria-label={`More actions for ${client.name}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-52"><DropdownMenuLabel>Client actions</DropdownMenuLabel><DropdownMenuItem onSelect={() => onCopy(subscriptionUrl)}><Copy className="mr-2 h-4 w-4" />Copy subscription</DropdownMenuItem><DropdownMenuItem onSelect={() => onRotate(client.id)}><KeyRound className="mr-2 h-4 w-4" />Rotate credentials</DropdownMenuItem><DropdownMenuItem onSelect={() => onReset({ id: client.id, name: client.name })}><RotateCcw className="mr-2 h-4 w-4" />Reset usage</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDelete({ id: client.id, name: client.name })}><Trash2 className="mr-2 h-4 w-4" />Delete permanently</DropdownMenuItem></DropdownMenuContent></DropdownMenu>{onToggleExpansion ? <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={expanded ? `Collapse ${client.name}` : `Expand ${client.name}`} aria-expanded={expanded} title={expanded ? "Collapse details" : "Expand details"} onClick={onToggleExpansion}>{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button> : null}</div>;
}

function ClientIdentity({ client, status, compact, validity }: { client: ClientRecord; status: ReturnType<typeof clientActivationState>; compact: boolean; validity: ReturnType<typeof dayStatus> }) {
  const detail = client.activationPending || client.activationFailed ? status.detail : compact ? validity.detail : `Created ${new Date(client.createdAt).toLocaleDateString()}`;
  return <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-lg font-semibold">{client.name}</h3><Badge variant="outline" className={status.className}>{status.label}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}

export function ClientRegistry({ clients, viewMode, pending, onToggle, onActivate, onRotate, onResetUsage, onDelete, onCopy, onSavePolicy }: ClientRegistryProps) {
  const [deleteCandidate, setDeleteCandidate] = useState<ClientActionCandidate | null>(null);
  const [resetCandidate, setResetCandidate] = useState<ClientActionCandidate | null>(null);
  const [expandedCompactClientId, setExpandedCompactClientId] = useState<number | null>(null);

  if (!clients.length) return <div className="rounded-xl border border-dashed border-border bg-card/30 px-5 py-14 text-center"><HardDrive className="mx-auto h-7 w-7 text-muted-foreground" /><h3 className="mt-3 font-medium">No named clients yet</h3><p className="mt-1 text-sm text-muted-foreground">Create an identity above to issue independent credentials and a subscription feed.</p></div>;

  const deleteCopy = deleteCandidate ? clientDeleteDialogCopy(deleteCandidate.name) : null;
  const resetCopy = resetCandidate ? clientResetUsageDialogCopy(resetCandidate.name) : null;

  return <div className={viewMode === "compact" ? "space-y-2" : "space-y-3"}>
    {clients.map(client => {
      const subscriptionUrl = `${window.location.origin}${client.subscriptionPath}`;
      const quota = limitFormValue(client.trafficLimitBytes);
      const validity = dayStatus(client.expiresAt, client.dayLimit);
      const quotaDetail = client.trafficLimitBytes < 0 ? { title: "Unlimited", detail: `${formatBytes(client.trafficUsedBytes)} used` } : { title: `${formatBytes(client.trafficUsedBytes)} / ${formatBytes(client.trafficLimitBytes)}`, detail: `${formatBytes(client.remainingTrafficBytes || 0)} remaining` };
      const speedDetail = client.speedLimitMbps < 0 ? { title: "Unlimited", detail: "No throughput cap" } : { title: `${client.speedLimitMbps} Mbps`, detail: "Shared across this identity" };
      const connectionDetail = client.connectionLimit < 0 ? { title: "Unlimited", detail: "No source-IP cap" } : { title: `${client.connectionLimit} sources`, detail: "Unique source IPs across protocols" };
      const status = clientActivationState(client);
      const quotaProgress = clientQuotaProgress(client.trafficLimitBytes, client.trafficUsedBytes);
      const expanded = viewMode === "compact" && expandedCompactClientId === client.id;
      const actions = <ClientActions client={client} pending={pending} status={status} subscriptionUrl={subscriptionUrl} expanded={expanded} onToggleExpansion={viewMode === "compact" ? () => setExpandedCompactClientId(current => nextExpandedCompactClientId(current, client.id)) : undefined} onToggle={onToggle} onActivate={onActivate} onRotate={onRotate} onReset={setResetCandidate} onDelete={setDeleteCandidate} onCopy={onCopy} />;

      if (viewMode === "compact" && !expanded) return <article key={client.id} className="overflow-hidden rounded-xl border border-border bg-card/45 shadow-sm transition-[border-color,box-shadow] duration-200"><div className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(10rem,auto)_minmax(14rem,1fr)_auto] sm:items-center sm:gap-5"><ClientIdentity client={client} status={status} compact validity={validity} />{quotaProgress ? <QuotaProgressBar quotaProgress={quotaProgress} compact /> : <div className="min-w-0"><div className="flex items-center justify-between gap-3 text-[11px] font-medium"><span className="text-muted-foreground">Data usage</span><span className="tabular-nums text-foreground">Unlimited</span></div><p className="mt-1 text-xs text-muted-foreground">{formatBytes(client.trafficUsedBytes)} used</p></div>}<div className="sm:justify-self-end">{actions}</div></div></article>;

      return <article key={client.id} className="overflow-hidden rounded-xl border border-border bg-card/45 shadow-sm"><div className="grid gap-3 p-5 sm:p-6 md:grid-cols-[minmax(10rem,auto)_minmax(13rem,1fr)_auto] md:items-center md:gap-5"><ClientIdentity client={client} status={status} compact={false} validity={validity} />{quotaProgress ? <div className="min-w-0 md:px-1"><QuotaProgressBar quotaProgress={quotaProgress} /></div> : <div className="hidden md:block" />}<div className="md:justify-self-end">{actions}</div></div><div className="grid divide-y border-y border-border bg-muted/20 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4"><div className="p-4"><p className="protocol-overline">Data quota</p><p className="mt-1 text-sm font-semibold">{quotaDetail.title}</p><p className="mt-1 text-xs text-muted-foreground">{quotaDetail.detail}</p></div><div className="p-4"><p className="protocol-overline">Validity</p><p className="mt-1 text-sm font-semibold">{validity.title}</p><p className="mt-1 text-xs text-muted-foreground">{validity.detail}</p></div><div className="p-4"><p className="protocol-overline">Speed</p><p className="mt-1 text-sm font-semibold">{speedDetail.title}</p><p className="mt-1 text-xs text-muted-foreground">{speedDetail.detail}</p></div><div className="p-4"><p className="protocol-overline">Connections</p><p className="mt-1 text-sm font-semibold">{connectionDetail.title}</p><p className="mt-1 text-xs text-muted-foreground">{connectionDetail.detail}</p></div></div><details className="group"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-medium hover:bg-muted/30 sm:px-6"><span>Policy & quota controls</span><span className="text-xs font-normal text-muted-foreground group-open:hidden">Edit limits</span><span className="hidden text-xs font-normal text-muted-foreground group-open:inline">Close editor</span></summary><form className="grid gap-3 border-t border-border bg-muted/15 px-5 py-5 sm:grid-cols-2 lg:grid-cols-[minmax(8rem,1fr)_5.5rem_7rem_7rem_8rem_minmax(12rem,1fr)_auto] lg:items-end sm:px-6" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); const unit = data.get("unit") === "MB" ? "MB" : "GB"; onSavePolicy(client.id, quotaToBytes(String(data.get("traffic") || "-1"), unit), policyDays(String(data.get("days") || "-1")), policySpeed(String(data.get("speed") || "-1")), policyConnections(String(data.get("connections") || "-1"))); }}><div className="space-y-1.5"><Label className="text-xs"><HardDrive className="mr-1 inline h-3.5 w-3.5" />Storage limit</Label><Input name="traffic" type="number" min="-1" step="0.01" defaultValue={quota.value} className="protocol-input" /></div><div className="space-y-1.5"><Label className="text-xs">Unit</Label><select name="unit" defaultValue={quota.unit} className="protocol-input h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="GB">GB</option><option value="MB">MB</option></select></div><div className="space-y-1.5"><Label className="text-xs"><CalendarClock className="mr-1 inline h-3.5 w-3.5" />Day limit</Label><Input name="days" type="number" min="-1" max="3650" defaultValue={client.dayLimit} className="protocol-input" /></div><div className="space-y-1.5"><Label className="text-xs"><Gauge className="mr-1 inline h-3.5 w-3.5" />Speed Mbps</Label><Input name="speed" type="number" min="-1" max="100000" step="1" defaultValue={client.speedLimitMbps} className="protocol-input" /></div><div className="space-y-1.5"><Label className="text-xs"><Network className="mr-1 inline h-3.5 w-3.5" />Connections</Label><Input name="connections" type="number" min="-1" max="10000" step="1" defaultValue={client.connectionLimit} className="protocol-input" /></div><p className="text-xs leading-5 text-muted-foreground"><strong>-1</strong> means unlimited for storage, expiry, speed, and unique source IPs. A finite connection cap accepts multiplexed tunnels from one source while limiting new sources.</p><Button size="sm" type="submit" disabled={pending || client.activationPending}><Save className="mr-1.5 h-3.5 w-3.5" />Save policy</Button></form></details></article>;
    })}
    <AlertDialog open={Boolean(resetCandidate)} onOpenChange={open => { if (!open) setResetCandidate(null); }}><AlertDialogContent className="protocol-dialog">{resetCandidate && resetCopy ? <><AlertDialogHeader><AlertDialogTitle>{resetCopy.title}</AlertDialogTitle><AlertDialogDescription>{resetCopy.description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={pending} onClick={() => { onResetUsage(resetCandidate.id); setResetCandidate(null); }}>{resetCopy.action}</AlertDialogAction></AlertDialogFooter></> : null}</AlertDialogContent></AlertDialog>
    <AlertDialog open={Boolean(deleteCandidate)} onOpenChange={open => { if (!open) setDeleteCandidate(null); }}><AlertDialogContent className="protocol-dialog">{deleteCandidate && deleteCopy ? <><AlertDialogHeader><AlertDialogTitle>{deleteCopy.title}</AlertDialogTitle><AlertDialogDescription>{deleteCopy.description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={pending} onClick={() => { onDelete(deleteCandidate.id, deleteCandidate.name); setDeleteCandidate(null); }}>{deleteCopy.action}</AlertDialogAction></AlertDialogFooter></> : null}</AlertDialogContent></AlertDialog>
  </div>;
}
