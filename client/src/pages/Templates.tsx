import DashboardLayout from "@/components/DashboardLayout";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { CopyPlus, FolderCog, Plus, Save, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";

type QuotaUnit = "MB" | "GB";

function bytesToFormValue(bytes: number): { value: string; unit: QuotaUnit } {
  if (bytes < 0) return { value: "-1", unit: "GB" };
  if (bytes >= 1024 ** 3 && bytes % (1024 ** 3) === 0) return { value: String(bytes / 1024 ** 3), unit: "GB" };
  return { value: String(Math.round((bytes / 1024 ** 2) * 100) / 100), unit: "MB" };
}

function limitToBytes(value: string, unit: QuotaUnit) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === -1) return -1;
  return Math.max(0, Math.min(Math.round(parsed * (unit === "GB" ? 1024 ** 3 : 1024 ** 2)), Number.MAX_SAFE_INTEGER));
}

function integerLimit(value: string, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === -1) return -1;
  return Math.max(1, Math.min(Math.floor(parsed), maximum));
}

function formatBytes(bytes: number) {
  if (bytes < 0) return "Unlimited";
  if (bytes >= 1024 ** 3) return `${Math.round((bytes / 1024 ** 3) * 100) / 100} GB`;
  return `${Math.round((bytes / 1024 ** 2) * 100) / 100} MB`;
}

function TemplatesLoading() {
  return <div className="protocol-shell min-h-full"><div className="mx-auto max-w-6xl space-y-5 py-2 sm:py-5"><header className="protocol-header"><Skeleton className="h-3 w-24" /><Skeleton className="mt-3 h-9 w-56" /><Skeleton className="mt-3 h-4 w-96 max-w-full" /></header><section className="grid gap-5 xl:grid-cols-[.95fr_1.05fr]"><Skeleton className="h-96" /><Skeleton className="h-96" /></section></div></div>;
}

export default function Templates() {
  const utils = trpc.useUtils();
  const templatesQuery = trpc.templates.list.useQuery(undefined, { retry: false });
  const [name, setName] = useState("");
  const [trafficLimit, setTrafficLimit] = useState("-1");
  const [trafficUnit, setTrafficUnit] = useState<QuotaUnit>("GB");
  const [dayLimit, setDayLimit] = useState("-1");
  const [speedLimitMbps, setSpeedLimitMbps] = useState("-1");
  const [connectionLimit, setConnectionLimit] = useState("-1");
  const refresh = () => utils.templates.list.invalidate();
  const create = trpc.templates.create.useMutation({
    onSuccess: () => { setName(""); setTrafficLimit("-1"); setDayLimit("-1"); setSpeedLimitMbps("-1"); setConnectionLimit("-1"); toast.success("Policy template created"); refresh(); },
    onError: error => toast.error(error.message),
  });
  const update = trpc.templates.update.useMutation({ onSuccess: () => { toast.success("Policy template saved"); refresh(); }, onError: error => toast.error(error.message) });
  const remove = trpc.templates.remove.useMutation({ onSuccess: () => { toast.success("Policy template deleted"); refresh(); }, onError: error => toast.error(error.message) });

  if (templatesQuery.isLoading || !templatesQuery.data) return <DashboardLayout><TemplatesLoading /></DashboardLayout>;
  const templates = templatesQuery.data;
  return <DashboardLayout><div className="protocol-shell min-h-full"><div className="mx-auto max-w-6xl space-y-5 py-2 sm:py-5">
    <header className="protocol-header flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="protocol-overline">Client operations</p><h1 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Policy templates</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Save reusable limit profiles, then apply one to a new client form without copying policy values by hand.</p></div><Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary"><FolderCog className="mr-1.5 h-3.5 w-3.5" />{templates.length} saved</Badge></header>

    <section className="grid gap-5 xl:grid-cols-[.95fr_1.05fr]"><div className="protocol-panel p-5 sm:p-6"><div className="flex items-start justify-between"><div><p className="protocol-overline">New preset</p><h2 className="mt-2 text-lg font-semibold">Create policy template</h2><p className="mt-1 text-sm text-muted-foreground">Templates store only limits. They never contain client credentials, routes, or traffic history.</p></div><CopyPlus className="h-5 w-5 text-primary" /></div><form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={(event: FormEvent) => { event.preventDefault(); if (!name.trim() || create.isPending) return; create.mutate({ name, trafficLimitBytes: limitToBytes(trafficLimit, trafficUnit), dayLimit: integerLimit(dayLimit, 3650), speedLimitMbps: integerLimit(speedLimitMbps, 100_000), connectionLimit: integerLimit(connectionLimit, 10_000) }); }}><div className="space-y-2 sm:col-span-2"><Label htmlFor="template-name">Template name</Label><Input id="template-name" value={name} onChange={event => setName(event.target.value)} placeholder="Example: monthly standard" className="protocol-input" /></div><div className="space-y-2"><Label>Storage limit</Label><div className="grid grid-cols-[minmax(0,1fr)_5.75rem] gap-2"><Input value={trafficLimit} onChange={event => setTrafficLimit(event.target.value)} type="number" min="-1" step="0.01" className="protocol-input" /><select value={trafficUnit} onChange={event => setTrafficUnit(event.target.value as QuotaUnit)} className="protocol-input h-10 rounded-md border border-input bg-background px-2 text-sm"><option value="GB">GB</option><option value="MB">MB</option></select></div></div><div className="space-y-2"><Label>Day limit</Label><Input value={dayLimit} onChange={event => setDayLimit(event.target.value)} type="number" min="-1" max="3650" className="protocol-input" /></div><div className="space-y-2"><Label>Speed Mbps</Label><Input value={speedLimitMbps} onChange={event => setSpeedLimitMbps(event.target.value)} type="number" min="-1" max="100000" className="protocol-input" /></div><div className="space-y-2"><Label>Connections</Label><Input value={connectionLimit} onChange={event => setConnectionLimit(event.target.value)} type="number" min="-1" max="10000" className="protocol-input" /></div><p className="sm:col-span-2 text-xs leading-5 text-muted-foreground"><strong>-1</strong> means unlimited for every policy field.</p><Button className="sm:w-fit" disabled={create.isPending}><Plus className="mr-2 h-4 w-4" />Save template</Button></form></div>

      <div className="space-y-3"><div className="flex items-end justify-between"><div><p className="protocol-overline">Saved presets</p><h2 className="mt-1 text-lg font-semibold">Reusable client policies</h2></div><span className="text-xs text-muted-foreground">Applied only when you choose one</span></div>{templates.length === 0 ? <div className="protocol-panel p-10 text-center"><FolderCog className="mx-auto h-8 w-8 text-muted-foreground" /><h3 className="mt-4 font-semibold">No policy templates yet</h3><p className="mt-2 text-sm text-muted-foreground">Create a reusable quota and connection policy for future clients.</p></div> : templates.map(template => { const quota = bytesToFormValue(Number(template.trafficLimitBytes)); return <article key={template.id} className="protocol-panel overflow-hidden p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-semibold">{template.name}</h3><div className="mt-3 flex flex-wrap gap-2 text-xs"><Badge variant="secondary">{formatBytes(Number(template.trafficLimitBytes))}</Badge><Badge variant="secondary">{template.dayLimit < 0 ? "Unlimited days" : `${template.dayLimit} days`}</Badge><Badge variant="secondary">{template.speedLimitMbps < 0 ? "Unlimited Mbps" : `${template.speedLimitMbps} Mbps`}</Badge><Badge variant="secondary">{template.connectionLimit < 0 ? "Unlimited sources" : `${template.connectionLimit} sources`}</Badge></div></div><AlertDialog><AlertDialogTrigger asChild><Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={remove.isPending}><Trash2 className="mr-2 h-3.5 w-3.5" />Delete</Button></AlertDialogTrigger><AlertDialogContent className="protocol-dialog"><AlertDialogHeader><AlertDialogTitle>Delete this template?</AlertDialogTitle><AlertDialogDescription>Existing clients are not changed. This only removes the reusable policy preset.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => remove.mutate({ id: template.id })}>Delete template</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div><details className="group mt-5 border-t border-border pt-4"><summary className="cursor-pointer text-sm font-medium">Edit policy <span className="ml-2 text-xs font-normal text-muted-foreground">Open controls</span></summary><form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); const unit = data.get("unit") === "MB" ? "MB" : "GB"; update.mutate({ id: template.id, name: String(data.get("name") || ""), trafficLimitBytes: limitToBytes(String(data.get("traffic") || "-1"), unit), dayLimit: integerLimit(String(data.get("days") || "-1"), 3650), speedLimitMbps: integerLimit(String(data.get("speed") || "-1"), 100_000), connectionLimit: integerLimit(String(data.get("connections") || "-1"), 10_000) }); }}><div className="space-y-2 sm:col-span-2"><Label>Name</Label><Input name="name" defaultValue={template.name} className="protocol-input" /></div><div className="space-y-2"><Label>Storage limit</Label><div className="grid grid-cols-[minmax(0,1fr)_5.75rem] gap-2"><Input name="traffic" type="number" min="-1" step="0.01" defaultValue={quota.value} className="protocol-input" /><select name="unit" defaultValue={quota.unit} className="protocol-input h-10 rounded-md border border-input bg-background px-2 text-sm"><option value="GB">GB</option><option value="MB">MB</option></select></div></div><div className="space-y-2"><Label>Day limit</Label><Input name="days" type="number" min="-1" max="3650" defaultValue={template.dayLimit} className="protocol-input" /></div><div className="space-y-2"><Label>Speed Mbps</Label><Input name="speed" type="number" min="-1" max="100000" defaultValue={template.speedLimitMbps} className="protocol-input" /></div><div className="space-y-2"><Label>Connections</Label><Input name="connections" type="number" min="-1" max="10000" defaultValue={template.connectionLimit} className="protocol-input" /></div><Button size="sm" type="submit" disabled={update.isPending}><Save className="mr-2 h-3.5 w-3.5" />Save changes</Button></form></details></article>; })}</div></section>
  </div></div></DashboardLayout>;
}
