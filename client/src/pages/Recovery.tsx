import DashboardLayout from "@/components/DashboardLayout";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, ArchiveRestore, Download, FileJson2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

function downloadSnapshot(snapshot: unknown) {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `nginx-gateway-recovery-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function Recovery() {
  const utils = trpc.useUtils();
  const snapshotQuery = trpc.recovery.exportSnapshot.useQuery(undefined, { enabled: false, retry: false });
  const [rawSnapshot, setRawSnapshot] = useState("");
  const preview = useMemo(() => {
    try {
      const parsed = JSON.parse(rawSnapshot) as { schemaVersion?: unknown; clients?: unknown[]; templates?: unknown[] };
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.clients) || !Array.isArray(parsed.templates)) return null;
      return { clients: parsed.clients.length, templates: parsed.templates.length };
    } catch { return null; }
  }, [rawSnapshot]);
  const restore = trpc.recovery.importSnapshot.useMutation({
    onSuccess: async result => {
      await Promise.all([utils.vless.get.invalidate(), utils.vless.clients.invalidate(), utils.templates.list.invalidate()]);
      toast.success(`Recovery import restored ${result.clientCount} client${result.clientCount === 1 ? "" : "s"} and ${result.templateCount} template${result.templateCount === 1 ? "" : "s"}`);
      setRawSnapshot("");
      window.setTimeout(() => window.location.assign("/admin/clients"), 300);
    },
    onError: error => toast.error(error.message),
  });
  const requestDownload = async () => {
    const result = await snapshotQuery.refetch();
    if (!result.data) { toast.error(result.error?.message || "Recovery export could not be created"); return; }
    downloadSnapshot(result.data);
    toast.success("Recovery snapshot downloaded");
  };
  const startRestore = () => {
    try { restore.mutate(JSON.parse(rawSnapshot)); }
    catch { toast.error("Paste a valid JSON recovery snapshot first"); }
  };
  const loadSnapshotFile = (file?: File) => {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { toast.error("Recovery snapshots must be 4 MB or smaller"); return; }
    file.text().then(text => { setRawSnapshot(text); toast.success("Recovery snapshot loaded — review before importing"); }, () => toast.error("Could not read the selected recovery file"));
  };

  return <DashboardLayout><div className="protocol-shell min-h-full"><div className="mx-auto max-w-6xl space-y-5 py-2 sm:py-5"><header className="protocol-header"><p className="protocol-overline">Gateway administration</p><h1 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Recovery</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Export a portable recovery snapshot or restore one after verifying its source. Recovery snapshots contain sensitive gateway credentials.</p></header>
    <section className="grid gap-5 xl:grid-cols-2"><article className="protocol-panel p-5 sm:p-6"><div className="flex items-start justify-between"><div><p className="protocol-overline">Export</p><h2 className="mt-2 text-lg font-semibold">Create recovery snapshot</h2><p className="mt-1 text-sm text-muted-foreground">Includes gateway transport settings, client credentials and policy state, recorded usage, and policy templates.</p></div><FileJson2 className="h-5 w-5 text-primary" /></div><div className="mt-6 rounded-lg border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-amber-900 dark:text-amber-100"><div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p><strong>Store it securely.</strong> Anyone with this file can import the included client credentials and subscription tokens.</p></div></div><Button className="mt-6" onClick={requestDownload} disabled={snapshotQuery.isFetching}><Download className="mr-2 h-4 w-4" />Download snapshot</Button></article>
      <article className="protocol-panel p-5 sm:p-6"><div className="flex items-start justify-between"><div><p className="protocol-overline">Import</p><h2 className="mt-2 text-lg font-semibold">Restore gateway state</h2><p className="mt-1 text-sm text-muted-foreground">Choose or paste a version 1 Recovery JSON snapshot. It is validated before any data is changed.</p></div><ArchiveRestore className="h-5 w-5 text-primary" /></div><Input className="protocol-input mt-5 cursor-pointer" type="file" accept="application/json,.json" onChange={event => loadSnapshotFile(event.target.files?.[0])} aria-label="Choose recovery snapshot file" /><Textarea className="protocol-input mt-3 min-h-52 font-mono text-xs leading-5" value={rawSnapshot} onChange={event => setRawSnapshot(event.target.value)} placeholder={'{\n  "schemaVersion": 1,\n  "profile": { ... },\n  "templates": [],\n  "clients": []\n}'} aria-label="Recovery snapshot JSON" />{preview ? <p className="mt-3 text-xs text-muted-foreground">Validated shape preview: {preview.clients} client{preview.clients === 1 ? "" : "s"} · {preview.templates} template{preview.templates === 1 ? "" : "s"}</p> : rawSnapshot ? <p className="mt-3 text-xs text-destructive">This does not look like a version 1 recovery snapshot yet.</p> : null}<AlertDialog><AlertDialogTrigger asChild><Button className="mt-5" variant="outline" disabled={!preview || restore.isPending}><Upload className="mr-2 h-4 w-4" />Import and replace gateway state</Button></AlertDialogTrigger><AlertDialogContent className="protocol-dialog"><AlertDialogHeader><AlertDialogTitle>Replace current gateway state?</AlertDialogTitle><AlertDialogDescription>This overwrites the current gateway profile, all named clients, their credentials and policies, and saved templates. Active gateway tunnels are closed after the restored Xray configuration is loaded. Owner devices and browser sessions are not included or changed.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={startRestore}>Replace and restore</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></article></section>
    <section className="protocol-panel p-5 sm:p-6"><div className="flex items-center gap-3"><ArchiveRestore className="h-5 w-5 text-primary" /><div><p className="protocol-overline">Scope</p><h2 className="mt-1 text-lg font-semibold">What Recovery does and does not transfer</h2></div></div><div className="mt-5 grid gap-4 text-sm sm:grid-cols-2"><div><p className="font-medium">Included</p><p className="mt-1 leading-6 text-muted-foreground">Gateway profile, protocol routes, global-profile state, named-client credentials, policy limits, expiry and quota state, recorded traffic usage, and policy templates.</p></div><div><p className="font-medium">Excluded deliberately</p><p className="mt-1 leading-6 text-muted-foreground">Owner browser devices, sign-in sessions, subscription-delivery history, activation timers, and local runtime process state are not exported or restored.</p></div></div></section>
  </div></div></DashboardLayout>;
}
