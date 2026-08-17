import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarClock, Copy, HardDrive, KeyRound, MoreHorizontal, Power, RotateCcw, Save, Trash2 } from "lucide-react";
import { FormEvent } from "react";

type QuotaUnit = "MB" | "GB";

type ClientRecord = {
  id: number;
  name: string;
  enabled: boolean;
  expiresAt: Date | string | null;
  trafficLimitBytes: number;
  trafficUsedBytes: number;
  remainingTrafficBytes: number | null;
  trafficUsageAvailable: boolean;
  quotaExhaustedAt: Date | string | null;
  dayLimit: number;
  subscriptionPath: string;
  subscriptionDeliveryCount: number;
  lastSubscriptionAt: Date | string | null;
  createdAt: Date | string;
};

type ClientRegistryProps = {
  clients: ClientRecord[];
  pending: boolean;
  onToggle: (id: number, enabled: boolean) => void;
  onRotate: (id: number) => void;
  onResetUsage: (id: number) => void;
  onDelete: (id: number, name: string) => void;
  onCopy: (value: string) => void;
  onSavePolicy: (id: number, trafficLimitBytes: number, dayLimit: number) => void;
};

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

function dayStatus(expiresAt: Date | string | null, dayLimit: number) {
  if (dayLimit < 0) return { title: "Unlimited", detail: "No expiry policy" };
  if (!expiresAt) return { title: "Not scheduled", detail: `${dayLimit} day policy` };
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (remainingMs <= 0) return { title: "Expired", detail: new Date(expiresAt).toLocaleDateString() };
  return { title: `${Math.ceil(remainingMs / 86_400_000)} days left`, detail: `Expires ${new Date(expiresAt).toLocaleDateString()}` };
}

export function ClientRegistry({ clients, pending, onToggle, onRotate, onResetUsage, onDelete, onCopy, onSavePolicy }: ClientRegistryProps) {
  if (!clients.length) return <div className="rounded-xl border border-dashed border-border bg-card/30 px-5 py-14 text-center"><HardDrive className="mx-auto h-7 w-7 text-muted-foreground" /><h3 className="mt-3 font-medium">No named clients yet</h3><p className="mt-1 text-sm text-muted-foreground">Create an identity above to issue independent credentials and a subscription feed.</p></div>;

  return <div className="space-y-3">{clients.map(client => {
    const subscriptionUrl = `${window.location.origin}${client.subscriptionPath}`;
    const quota = limitFormValue(client.trafficLimitBytes);
    const validity = dayStatus(client.expiresAt, client.dayLimit);
    const quotaDetail = client.trafficLimitBytes < 0
      ? { title: "Unlimited", detail: client.trafficUsageAvailable ? `${formatBytes(client.trafficUsedBytes)} used` : "Traffic sampler unavailable" }
      : client.trafficUsageAvailable
        ? { title: `${formatBytes(client.trafficUsedBytes)} / ${formatBytes(client.trafficLimitBytes)}`, detail: `${formatBytes(client.remainingTrafficBytes || 0)} remaining` }
        : { title: `${formatBytes(client.trafficUsedBytes)} / ${formatBytes(client.trafficLimitBytes)}`, detail: "Last persisted use · sampler offline" };

    return <article key={client.id} className="overflow-hidden rounded-xl border border-border bg-card/45 shadow-sm"><div className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-lg font-semibold">{client.name}</h3><Badge variant="outline" className={client.enabled ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : client.quotaExhaustedAt ? "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-muted-foreground/30 text-muted-foreground"}>{client.enabled ? "Enabled" : client.quotaExhaustedAt ? "Quota reached" : "Disabled"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Created {new Date(client.createdAt).toLocaleDateString()}</p></div><div className="flex shrink-0 items-center gap-2"><Button size="sm" variant={client.enabled ? "outline" : "default"} onClick={() => onToggle(client.id, !client.enabled)} disabled={pending}><Power className="mr-1.5 h-3.5 w-3.5" />{client.enabled ? "Disable" : "Enable"}</Button><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="outline" aria-label={`More actions for ${client.name}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-52"><DropdownMenuLabel>Client actions</DropdownMenuLabel><DropdownMenuItem onSelect={() => onCopy(subscriptionUrl)}><Copy className="mr-2 h-4 w-4" />Copy subscription</DropdownMenuItem><DropdownMenuItem onSelect={() => onRotate(client.id)}><KeyRound className="mr-2 h-4 w-4" />Rotate credentials</DropdownMenuItem><DropdownMenuItem onSelect={event => { event.preventDefault(); if (window.confirm(`Reset recorded usage for ${client.name} to 0? This keeps credentials and limits unchanged.`)) onResetUsage(client.id); }}><RotateCcw className="mr-2 h-4 w-4" />Reset usage</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={event => { event.preventDefault(); if (window.confirm(`Permanently delete ${client.name}? This cannot be undone.`)) onDelete(client.id, client.name); }}><Trash2 className="mr-2 h-4 w-4" />Delete permanently</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div><div className="grid divide-y border-y border-border bg-muted/20 sm:grid-cols-2 sm:divide-x sm:divide-y-0"><div className="p-4"><p className="protocol-overline">Data quota</p><p className="mt-1 text-sm font-semibold">{quotaDetail.title}</p><p className="mt-1 text-xs text-muted-foreground">{quotaDetail.detail}</p></div><div className="p-4"><p className="protocol-overline">Validity</p><p className="mt-1 text-sm font-semibold">{validity.title}</p><p className="mt-1 text-xs text-muted-foreground">{validity.detail}</p></div></div><details className="group"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-medium hover:bg-muted/30 sm:px-6"><span>Policy & quota controls</span><span className="text-xs font-normal text-muted-foreground group-open:hidden">Edit limits</span><span className="hidden text-xs font-normal text-muted-foreground group-open:inline">Close editor</span></summary><form className="grid gap-3 border-t border-border bg-muted/15 px-5 py-5 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,1fr)_6rem_8rem_minmax(12rem,1fr)_auto] lg:items-end sm:px-6" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); const unit = data.get("unit") === "MB" ? "MB" : "GB"; onSavePolicy(client.id, quotaToBytes(String(data.get("traffic") || "-1"), unit), policyDays(String(data.get("days") || "-1"))); }}><div className="space-y-1.5"><Label className="text-xs"><HardDrive className="mr-1 inline h-3.5 w-3.5" />Storage limit</Label><Input name="traffic" type="number" min="-1" step="0.01" defaultValue={quota.value} className="protocol-input" /></div><div className="space-y-1.5"><Label className="text-xs">Unit</Label><select name="unit" defaultValue={quota.unit} className="protocol-input h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="GB">GB</option><option value="MB">MB</option></select></div><div className="space-y-1.5"><Label className="text-xs"><CalendarClock className="mr-1 inline h-3.5 w-3.5" />Day limit</Label><Input name="days" type="number" min="-1" max="3650" defaultValue={client.dayLimit} className="protocol-input" /></div><p className="text-xs leading-5 text-muted-foreground"><strong>-1</strong> means unlimited for both controls. Saving a positive day limit starts a new expiry window now.</p><Button size="sm" type="submit" disabled={pending}><Save className="mr-1.5 h-3.5 w-3.5" />Save policy</Button></form></details></article>;
  })}</div>;
}
